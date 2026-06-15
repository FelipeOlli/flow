"use client";

import { FlowTask } from "@/types/task";

export const CALENDAR_DIMENSIONS = {
  DAY_START: 6,
  DAY_END: 23,
  HOUR_PX: 56,
  MIN_EVENT_HEIGHT: 20,
  TIME_GUTTER_WIDTH: 44,
  GRID_SIDE_PADDING: 12,
  BOTTOM_SPACER_PX: 96,
} as const;

/** Above TaskBlock stacking (100 + minutes-in-day; see TaskBlock.tsx). */
export const CURRENT_TIME_LINE_Z_INDEX = 2000;

export const HOURS = Array.from(
  { length: CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START + 1 },
  (_, i) => i + CALENDAR_DIMENSIONS.DAY_START
);

export function formatHourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

export function timeToY(iso: string): number {
  const d = new Date(iso);
  const raw =
    (d.getHours() - CALENDAR_DIMENSIONS.DAY_START + d.getMinutes() / 60) * CALENDAR_DIMENSIONS.HOUR_PX;
  return Math.max(0, raw);
}

export function durationToPx(start: string, end: string): number {
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  return Math.max((mins / 60) * CALENDAR_DIMENSIONS.HOUR_PX, CALENDAR_DIMENSIONS.MIN_EVENT_HEIGHT);
}

export function currentTimeY(): number {
  const now = new Date();
  return ((now.getHours() - CALENDAR_DIMENSIONS.DAY_START) + now.getMinutes() / 60) * CALENDAR_DIMENSIONS.HOUR_PX;
}

export function yToTime(y: number, baseDate: Date): Date {
  const totalMins = Math.round((y / CALENDAR_DIMENSIONS.HOUR_PX) * 60 / 30) * 30;
  const time = new Date(baseDate);
  time.setHours(CALENDAR_DIMENSIONS.DAY_START + Math.floor(totalMins / 60), totalMins % 60, 0, 0);
  return time;
}

export function snapY(y: number): number {
  return Math.round(y / (CALENDAR_DIMENSIONS.HOUR_PX / 2)) * (CALENDAR_DIMENSIONS.HOUR_PX / 2);
}

/** Durações padrão de slot (mesmos valores dos botões rápidos do TaskForm). */
export const SLOT_DURATIONS = [
  { mins: 15, label: "15m" },
  { mins: 30, label: "30m" },
  { mins: 60, label: "1h" },
  { mins: 90, label: "1,5h" },
  { mins: 120, label: "2h" },
];

/** Retorna true se os dois intervalos se sobrepõem (extremidades exclusivas). */
export function eventsConflict(
  startA: number, endA: number,
  startB: number, endB: number,
): boolean {
  return startA < endB && endA > startB;
}

/**
 * Retorna os eventos de `tasks` que conflitam com o intervalo [startIso, endIso].
 * Ignora all-day, cancelados, recusados e eventos de outros dias.
 * `excludeId` permite ignorar o próprio evento (útil na edição).
 */
export function findConflicts(
  startIso: string,
  endIso: string,
  tasks: FlowTask[],
  excludeId?: string,
): FlowTask[] {
  const start = new Date(startIso).getTime();
  const end   = new Date(endIso).getTime();
  const dayKey = startIso.slice(0, 10); // YYYY-MM-DD

  return tasks.filter((t) => {
    if (t.isAllDay) return false;
    if (t.isCancelled) return false;
    if ((t as FlowTask & { selfResponseStatus?: string }).selfResponseStatus === "declined") return false;
    if (excludeId && t.id === excludeId) return false;
    if (!t.startTime.startsWith(dayKey)) return false;
    const s = new Date(t.startTime).getTime();
    const e = new Date(t.endTime).getTime();
    return eventsConflict(start, end, s, e);
  });
}

/**
 * Para cada duração em SLOT_DURATIONS, encontra o primeiro horário livre
 * >= desiredStartIso no mesmo dia. Retorna só as durações que cabem no dia.
 */
export function suggestFreeSlots(
  desiredStartIso: string,
  tasks: FlowTask[],
  excludeId?: string,
): { mins: number; label: string; startIso: string }[] {
  const dayKey       = desiredStartIso.slice(0, 10);
  const desiredStart = new Date(desiredStartIso).getTime();

  // Eventos ocupados do dia (sem all-day, cancelados, recusados)
  const occupied = tasks.filter((t) => {
    if (t.isAllDay) return false;
    if (t.isCancelled) return false;
    if ((t as FlowTask & { selfResponseStatus?: string }).selfResponseStatus === "declined") return false;
    if (excludeId && t.id === excludeId) return false;
    return t.startTime.startsWith(dayKey);
  });

  // Fim do dia útil do grid
  const dayEndDate = new Date(desiredStartIso);
  dayEndDate.setHours(CALENDAR_DIMENSIONS.DAY_END, 0, 0, 0);
  const dayEnd = dayEndDate.getTime();

  return SLOT_DURATIONS.map(({ mins, label }) => {
    const durMs = mins * 60_000;

    // Candidatos = desiredStart + fins de eventos ocupados que começam após desiredStart
    const candidates = [
      desiredStart,
      ...occupied
        .map((t) => new Date(t.endTime).getTime())
        .filter((e) => e >= desiredStart),
    ].sort((a, b) => a - b);

    for (const candidateStart of candidates) {
      const candidateEnd = candidateStart + durMs;
      if (candidateEnd > dayEnd) break;
      const conflicts = findConflicts(
        new Date(candidateStart).toISOString(),
        new Date(candidateEnd).toISOString(),
        tasks,
        excludeId,
      );
      if (conflicts.length === 0) {
        return { mins, label, startIso: new Date(candidateStart).toISOString() };
      }
    }
    return null;
  }).filter((s): s is { mins: number; label: string; startIso: string } => s !== null);
}

export function computeLayout(tasks: FlowTask[]) {
  if (!tasks.length) return [];
  const sorted = [...tasks].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const colEnds: number[] = [];
  const cols: number[] = [];
  for (const task of sorted) {
    const s = new Date(task.startTime).getTime();
    const e = new Date(task.endTime).getTime();
    let col = colEnds.findIndex((end) => end <= s);
    if (col === -1) col = colEnds.length;
    colEnds[col] = e;
    cols.push(col);
  }
  const sameStartBuckets = new Map<number, number[]>();
  sorted.forEach((task, index) => {
    const start = new Date(task.startTime);
    const startMinuteKey = Math.floor(start.getTime() / 60000);
    const bucket = sameStartBuckets.get(startMinuteKey);
    if (bucket) bucket.push(index);
    else sameStartBuckets.set(startMinuteKey, [index]);
  });

  return sorted.map((task, i) => {
    const s = new Date(task.startTime).getTime();
    const e = new Date(task.endTime).getTime();
    let maxCol = cols[i];
    for (let j = 0; j < sorted.length; j++) {
      const sj = new Date(sorted[j].startTime).getTime();
      const ej = new Date(sorted[j].endTime).getTime();
      if (sj < e && ej > s) maxCol = Math.max(maxCol, cols[j]);
    }
    const startMinuteKey = Math.floor(s / 60000);
    const sameStartIndexes = sameStartBuckets.get(startMinuteKey) ?? [i];
    const sameStartTotal = sameStartIndexes.length;
    const sameStartIndex = sameStartIndexes.indexOf(i);
    return {
      task,
      col: cols[i],
      totalCols: maxCol + 1,
      sameStartIndex,
      sameStartTotal,
    };
  });
}
