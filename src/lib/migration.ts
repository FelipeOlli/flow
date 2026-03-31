import { differenceInMinutes, addDays } from "date-fns";
import { getEventsForDay, moveEvent } from "./google-calendar";
import { TimeSlot } from "@/types/task";

const WORK_WINDOW_START_HOUR = 7;
const WORK_WINDOW_END_HOUR = 22;

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
): Promise<{ migrated: number; skipped: number; details: string[] }> {
  // Cron: ontem → hoje. Manual: hoje → amanhã
  const sourceDay = fromDate ?? (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d; })();
  const targetDay = toDate ?? addDays(new Date(), 0);

  console.log(`[FLOW MIGRATION] Buscando eventos de ${sourceDay.toDateString()} → ${targetDay.toDateString()}`);

  // Busca de TODAS as agendas
  const [sourceEvents, targetEvents] = await Promise.all([
    getEventsForDay(accessToken, sourceDay, timeZone),
    getEventsForDay(accessToken, targetDay, timeZone),
  ]);

  console.log(`[FLOW MIGRATION] Encontrados ${sourceEvents.length} eventos na origem`);

  // Filtra pendentes (não verde, com horário)
  const uncompleted = sourceEvents.filter((e) => !e.isComplete && !e.isAllDay);

  console.log(`[FLOW MIGRATION] ${uncompleted.length} eventos pendentes para migrar:`,
    uncompleted.map((e) => `"${e.title}" [${e.calendarId}]`));

  if (uncompleted.length === 0) return { migrated: 0, skipped: 0, details: [] };

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

      // Mantém o horário original, apenas muda a data
      const newStart = new Date(targetDay);
      newStart.setHours(originalStart.getHours(), originalStart.getMinutes(), 0, 0);
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

  return { migrated, skipped, details };
}
