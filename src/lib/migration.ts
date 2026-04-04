import { differenceInMinutes } from "date-fns";
import { getEventsForDateKey, moveAllDayEvent, moveEvent } from "./google-calendar";
import {
  diffDateKeysInDays,
  getDateKeyInTimeZone,
  getReferenceDateForDateKey,
  getTimePartsInTimeZone,
  shiftDateKey,
  zonedDateTimeToUtc,
} from "./timezone";

function extractErrorReason(err: unknown): string {
  if (err && typeof err === "object") {
    const o = err as {
      code?: number;
      status?: number;
      response?: { status?: number };
      errors?: { message?: string }[];
      message?: string;
    };
    const status = o.code ?? o.status ?? o.response?.status;
    const msg = o.errors?.[0]?.message ?? o.message ?? "";
    if (status) return `${status}: ${msg || "erro"}`;
    if (msg) return msg.slice(0, 100);
  }
  return "erro";
}

export interface MigrationFilterOptions {
  includeCompletedTimed: boolean;
  includeAllDay: boolean;
}

/** Cron / migração automática: só pendentes com horário. */
export const MIGRATION_AUTO_FILTER: MigrationFilterOptions = {
  includeCompletedTimed: false,
  includeAllDay: false,
};

/** Migração manual (padrão UI): inclui concluídas e dia inteiro. */
export const MIGRATION_MANUAL_DEFAULT_FILTER: MigrationFilterOptions = {
  includeCompletedTimed: true,
  includeAllDay: true,
};

export interface MigrationDiagnostics {
  sourceDateKey: string;
  targetDateKey: string;
  sourceDate: string;
  targetDate: string;
  timeZone: string;
  sourceEvents: number;
  targetEvents: number;
  /** Timed não concluídos (estatística; útil para o cron). */
  pendingEvents: number;
  completedEvents: number;
  allDayEvents: number;
  /** Fila real desta execução: timed (com horário). */
  eligibleTimed: number;
  /** Fila real desta execução: dia inteiro. */
  eligibleAllDay: number;
  includeCompletedTimed: boolean;
  includeAllDayFilter: boolean;
}

export interface MigrationResult {
  migrated: number;
  skipped: number;
  details: string[];
  diagnostics: MigrationDiagnostics;
}

function extractAllDayBounds(task: { startTime: string; endTime: string }): {
  start: string;
  endExclusive: string;
} | null {
  const startM = /^(\d{4}-\d{2}-\d{2})/.exec(task.startTime.trim());
  const endM = /^(\d{4}-\d{2}-\d{2})/.exec(task.endTime.trim());
  if (!startM || !endM) return null;
  return { start: startM[1], endExclusive: endM[1] };
}

export async function runMigration(
  accessToken: string,
  timeZone: string,
  fromDate?: Date,
  toDate?: Date,
  filter: MigrationFilterOptions = MIGRATION_AUTO_FILTER
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
  const dayDelta = diffDateKeysInDays(sourceDateKey, targetDateKey);

  console.log(`[FLOW MIGRATION] Buscando eventos de ${sourceDateKey} → ${targetDateKey} (${timeZone})`);

  const [sourceEvents, targetEvents] = await Promise.all([
    getEventsForDateKey(accessToken, sourceDateKey, timeZone, { writableOnly: true }),
    getEventsForDateKey(accessToken, targetDateKey, timeZone),
  ]);

  console.log(`[FLOW MIGRATION] Encontrados ${sourceEvents.length} eventos na origem`);

  const timedPendingOnly = sourceEvents.filter(
    (e) => !e.isCancelled && !e.isAllDay && !e.isComplete
  );
  const allDayOnSource = sourceEvents.filter((e) => !e.isCancelled && e.isAllDay);

  const timedToMove = sourceEvents.filter(
    (e) =>
      !e.isCancelled &&
      !e.isAllDay &&
      (filter.includeCompletedTimed || !e.isComplete)
  );
  const allDayToMove = filter.includeAllDay
    ? allDayOnSource.filter((e) => !e.isCancelled && extractAllDayBounds(e) !== null)
    : [];

  const diagnostics: MigrationDiagnostics = {
    sourceDateKey,
    targetDateKey,
    sourceDate: sourceDay.toISOString(),
    targetDate: targetDay.toISOString(),
    timeZone,
    sourceEvents: sourceEvents.length,
    targetEvents: targetEvents.length,
    pendingEvents: timedPendingOnly.length,
    completedEvents: sourceEvents.filter((e) => e.isComplete).length,
    allDayEvents: allDayOnSource.length,
    eligibleTimed: timedToMove.length,
    eligibleAllDay: allDayToMove.length,
    includeCompletedTimed: filter.includeCompletedTimed,
    includeAllDayFilter: filter.includeAllDay,
  };

  console.log(
    `[FLOW MIGRATION] Fila: ${timedToMove.length} com horário, ${allDayToMove.length} dia inteiro (filtro concluídas=${filter.includeCompletedTimed}, allDay=${filter.includeAllDay})`,
    timedToMove.map((e) => `"${e.title}" [${e.calendarId}]`)
  );
  console.log("[FLOW MIGRATION] Diagnóstico:", diagnostics);

  if (timedToMove.length === 0 && allDayToMove.length === 0) {
    return { migrated: 0, skipped: 0, details: [], diagnostics };
  }

  let migrated = 0;
  let skipped = 0;
  const details: string[] = [];

  for (const event of timedToMove) {
    try {
      const originalStart = new Date(event.startTime);
      const originalEnd = new Date(event.endTime);
      const duration = differenceInMinutes(originalEnd, originalStart);
      const { hour, minute } = getTimePartsInTimeZone(originalStart, timeZone);

      const newStart = zonedDateTimeToUtc(targetDateKey, timeZone, hour, minute, 0, 0);
      const newEnd = new Date(newStart.getTime() + duration * 60_000);

      const preserveComplete = filter.includeCompletedTimed && event.isComplete;

      await moveEvent(
        accessToken,
        event.id,
        newStart,
        newEnd,
        timeZone,
        event.calendarId ?? "primary",
        { preserveComplete }
      );

      details.push(`✓ "${event.title}" → ${newStart.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`);
      migrated++;
      console.log(`[FLOW MIGRATION] Migrado: "${event.title}" para ${newStart.toISOString()}`);
    } catch (err) {
      console.error(`[FLOW MIGRATION] Falhou: "${event.title}"`, err);
      details.push(`✗ "${event.title}" (${extractErrorReason(err)})`);
      skipped++;
    }
  }

  for (const event of allDayToMove) {
    const bounds = extractAllDayBounds(event);
    if (!bounds) {
      skipped++;
      details.push(`✗ "${event.title}" (datas dia inteiro inválidas)`);
      continue;
    }
    try {
      const preserveComplete = filter.includeAllDay && event.isComplete;
      await moveAllDayEvent(
        accessToken,
        event.id,
        event.calendarId ?? "primary",
        bounds.start,
        bounds.endExclusive,
        dayDelta,
        { preserveComplete }
      );
      details.push(`✓ "${event.title}" → dia inteiro`);
      migrated++;
      console.log(`[FLOW MIGRATION] Migrado (dia inteiro): "${event.title}"`);
    } catch (err) {
      console.error(`[FLOW MIGRATION] Falhou (dia inteiro): "${event.title}"`, err);
      details.push(`✗ "${event.title}" (${extractErrorReason(err)})`);
      skipped++;
    }
  }

  return { migrated, skipped, details, diagnostics };
}
