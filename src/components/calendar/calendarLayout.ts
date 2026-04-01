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

export const HOURS = Array.from(
  { length: CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START + 1 },
  (_, i) => i + CALENDAR_DIMENSIONS.DAY_START
);

export function formatHourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

export function timeToY(iso: string): number {
  const d = new Date(iso);
  return ((d.getHours() - CALENDAR_DIMENSIONS.DAY_START) + d.getMinutes() / 60) * CALENDAR_DIMENSIONS.HOUR_PX;
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
  return sorted.map((task, i) => {
    const s = new Date(task.startTime).getTime();
    const e = new Date(task.endTime).getTime();
    let maxCol = cols[i];
    for (let j = 0; j < sorted.length; j++) {
      const sj = new Date(sorted[j].startTime).getTime();
      const ej = new Date(sorted[j].endTime).getTime();
      if (sj < e && ej > s) maxCol = Math.max(maxCol, cols[j]);
    }
    return { task, col: cols[i], totalCols: maxCol + 1 };
  });
}
