import { differenceInMinutes } from "date-fns";
import { getEventsForDateKey, moveEvent } from "./google-calendar";
import { TimeSlot } from "@/types/task";
import {
  getDateKeyInTimeZone,
  getReferenceDateForDateKey,
  getTimePartsInTimeZone,
  shiftDateKey,
  zonedDateTimeToUtc,
} from "./timezone";

const WORK_WINDOW_START_HOUR = 7;
const WORK_WINDOW_END_HOUR = 22;

export interface MigrationDiagnostics {
  sourceDateKey: string;
  targetDateKey: string;
  sourceDate: string;
  targetDate: string;
  timeZone: string;
  sourceEvents: number;
  targetEvents: number;
  pendingEvents: number;
  completedEvents: number;
  allDayEvents: number;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  details: string[];
  diagnostics: MigrationDiagnostics;
}

function findFreeSlot(
  occupied: TimeSlot[],
  targetDay: Date,
  durationMinutes: number
): TimeSlot | null {
  const windowStart = new Date(targetDay);
  windowStart.setHours(WORK_WINDOW_START_HOUR, 0, 0, 0);
  const windowEnd = new Date(targetDay);
  windowEnd.setHours(WORK_WINDOW_END_HOUR, 0, 0, 0);

  const sorted = [...occupied]
    .filter((s) => s.end > windowStart && s.start < windowEnd)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const firstStart = sorted[0]?.start ?? windowEnd;
  const candidateEnd = new Date(windowStart.getTime() + durationMinutes * 60_000);
  if (candidateEnd <= firstStart) return { start: windowStart, end: candidateEnd };

  for (let i = 0; i < sorted.length - 1; i++) {
    const gapStart = sorted[i].end < windowStart ? windowStart : sorted[i].end;
    const gapEnd = sorted[i + 1].start > windowEnd ? windowEnd : sorted[i + 1].start;
    const slotEnd = new Date(gapStart.getTime() + durationMinutes * 60_000);
    if (slotEnd <= gapEnd) return { start: gapStart, end: slotEnd };
  }

  const lastEnd = sorted.at(-1)?.end ?? windowStart;
  const afterLastEnd = new Date(lastEnd.getTime() + durationMinutes * 60_000);
  if (lastEnd >= windowStart && afterLastEnd <= windowEnd) return { start: lastEnd, end: afterLastEnd };

  return null;
}

export async function runMigration(
  accessToken: string,
  timeZone: string,
  fromDate?: Date,
  toDate?: Date
): Promise<MigrationResult> {
  const todayDateKey = getDateKeyInTimeZone(new Date(), timeZone);
  const sourceDateKey = fromDate
    ? getDateKeyInTimeZone(fromDate, timeZone)
    : shiftDateKey(todayDateKey, -1);
  const targetDateKey = toDate
    ? getDateKeyInTimeZone(toDate, timeZone)
    : fromDate
      ? shiftDateKey(sourceDateKey, 1)
      : todayDateKey;
  const sourceDay = getReferenceDateForDateKey(sourceDateKey, timeZone);
  const targetDay = getReferenceDateForDateKey(targetDateKey, timeZone);

  console.log(`[FLOW MIGRATION] Buscando eventos de ${sourceDateKey} → ${targetDateKey} (${timeZone})`);

  // Busca de TODAS as agendas
  const [sourceEvents, targetEvents] = await Promise.all([
    getEventsForDateKey(accessToken, sourceDateKey, timeZone),
    getEventsForDateKey(accessToken, targetDateKey, timeZone),
  ]);

  console.log(`[FLOW MIGRATION] Encontrados ${sourceEvents.length} eventos na origem`);

  // Filtra pendentes (não verde, com horário)
  const uncompleted = sourceEvents.filter((e) => !e.isComplete && !e.isAllDay);
  const completedCount = sourceEvents.filter((e) => e.isComplete).length;
  const allDayCount = sourceEvents.filter((e) => e.isAllDay).length;
  const diagnostics: MigrationDiagnostics = {
    sourceDateKey,
    targetDateKey,
    sourceDate: sourceDay.toISOString(),
    targetDate: targetDay.toISOString(),
    timeZone,
    sourceEvents: sourceEvents.length,
    targetEvents: targetEvents.length,
    pendingEvents: uncompleted.length,
    completedEvents: completedCount,
    allDayEvents: allDayCount,
  };

  console.log(`[FLOW MIGRATION] ${uncompleted.length} eventos pendentes para migrar:`,
    uncompleted.map((e) => `"${e.title}" [${e.calendarId}]`));
  console.log("[FLOW MIGRATION] Diagnóstico:", diagnostics);

  if (uncompleted.length === 0) {
    return { migrated: 0, skipped: 0, details: [], diagnostics };
  }

  // Slots ocupados no dia destino
  const occupied: TimeSlot[] = targetEvents
    .filter((e) => !e.isAllDay && e.startTime)
    .map((e) => ({
      start: new Date(e.startTime),
      end: new Date(e.endTime),
    }));

  let migrated = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const event of uncompleted) {
    try {
      const originalStart = new Date(event.startTime);
      const originalEnd = new Date(event.endTime);
      const duration = differenceInMinutes(originalEnd, originalStart);
      const { hour, minute } = getTimePartsInTimeZone(originalStart, timeZone);

      // Mantém o horário original no timezone de negócio.
      const newStart = zonedDateTimeToUtc(targetDateKey, timeZone, hour, minute, 0, 0);
      const newEnd = new Date(newStart.getTime() + duration * 60_000);

      await moveEvent(
        accessToken,
        event.id,
        newStart,
        newEnd,
        timeZone,
        event.calendarId ?? "primary"
      );

      occupied.push({ start: newStart, end: newEnd });
      details.push(`✓ "${event.title}" → ${newStart.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
      migrated++;
      console.log(`[FLOW MIGRATION] Migrado: "${event.title}" para ${newStart.toISOString()}`);
    } catch (err) {
      console.error(`[FLOW MIGRATION] Falhou: "${event.title}"`, err);
      details.push(`✗ "${event.title}" (erro)`);
      skipped++;
    }
  }

  return { migrated, skipped, details, diagnostics };
}
