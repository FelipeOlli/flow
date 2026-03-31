"use client";

import { useEffect, useRef, useState } from "react";
import { format, addDays, isToday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { TaskBlock } from "@/components/tasks/TaskBlock";

const DAY_START = 6;
const DAY_END = 23;
const HOUR_PX = 56;
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => i + DAY_START);

function timeToY(iso: string) {
  const d = new Date(iso);
  return ((d.getHours() - DAY_START) + d.getMinutes() / 60) * HOUR_PX;
}

function durationToPx(start: string, end: string) {
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  return Math.max((mins / 60) * HOUR_PX, 18);
}

function currentTimeY() {
  const now = new Date();
  return ((now.getHours() - DAY_START) + now.getMinutes() / 60) * HOUR_PX;
}

function computeLayout(tasks: FlowTask[]) {
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

function yToTime(y: number, baseDate: Date): Date {
  const totalMins = Math.round((y / HOUR_PX) * 60 / 30) * 30;
  const time = new Date(baseDate);
  time.setHours(DAY_START + Math.floor(totalMins / 60), totalMins % 60, 0, 0);
  return time;
}

interface ThreeDayViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  pendingIds: Set<string>;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask) => void;
  onDelete: (task: FlowTask) => void;
  onTimeClick: (time: Date) => void;
  onDayClick: (date: Date) => void;
}

export function ThreeDayView({ tasks, currentDate, pendingIds, onComplete, onEdit, onDelete, onTimeClick, onDayClick }: ThreeDayViewProps) {
  const [nowY, setNowY] = useState(currentTimeY());
  const scrollRef = useRef<HTMLDivElement>(null);

  const days = Array.from({ length: 3 }, (_, i) => addDays(currentDate, i));

  useEffect(() => {
    const t = setInterval(() => setNowY(currentTimeY()), 30000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = Math.max(0, nowY - 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function getLayoutForDay(day: Date) {
    const dayTasks = tasks.filter(
      (t) => !t.isAllDay && t.startTime && isSameDay(new Date(t.startTime), day)
    );
    return computeLayout(dayTasks);
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Day headers */}
      <div className="flex border-b border-gray-800/60 bg-gray-950">
        <div className="w-10 flex-shrink-0" />
        {days.map((day) => (
          <button
            key={day.toISOString()}
            onClick={() => onDayClick(day)}
            className="flex-1 py-2 text-center active:bg-gray-800 transition-colors"
          >
            <p className="text-[10px] text-gray-600 uppercase tracking-wide">
              {format(day, "EEE", { locale: ptBR })}
            </p>
            <div className={`mx-auto mt-0.5 w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold
              ${isToday(day) ? "bg-emerald-500 text-white" : "text-gray-300"}`}>
              {format(day, "d")}
            </div>
          </button>
        ))}
      </div>

      {/* Scrollable timeline */}
      <div ref={scrollRef} className="overflow-y-auto flex-1">
        <div className="flex" style={{ height: `${(DAY_END - DAY_START + 1) * HOUR_PX}px` }}>
          {/* Time labels */}
          <div className="w-10 flex-shrink-0 relative">
            {HOURS.map((h) => (
              <div key={h} className="absolute right-1.5" style={{ top: `${(h - DAY_START) * HOUR_PX - 7}px` }}>
                <span className="text-[10px] text-gray-700 tabular-nums select-none">
                  {String(h).padStart(2, "0")}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const layout = getLayoutForDay(day);
            const isCurrentDay = isToday(day);
            return (
              <div
                key={day.toISOString()}
                className="flex-1 relative border-l border-gray-800/40 cursor-pointer"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-task-block]")) return;
                  onTimeClick(yToTime(e.nativeEvent.offsetY, day));
                }}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-gray-800/30 pointer-events-none"
                    style={{ top: `${(h - DAY_START) * HOUR_PX}px` }} />
                ))}

                {/* Current time */}
                {isCurrentDay && nowY >= 0 && (
                  <div className="absolute left-0 right-0 flex items-center z-10 pointer-events-none"
                    style={{ top: `${nowY}px` }}>
                    <div className="w-1.5 h-1.5 rounded-full bg-red-500 -ml-0.5 flex-shrink-0" />
                    <div className="flex-1 h-px bg-red-500/60" />
                  </div>
                )}

                {/* Events */}
                {layout.map(({ task, col, totalCols }) => (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    top={timeToY(task.startTime)}
                    height={durationToPx(task.startTime, task.endTime)}
                    isPending={pendingIds.has(task.id)}
                    colIndex={col}
                    totalCols={totalCols}
                    compact
                    onComplete={() => onComplete(task)}
                    onEdit={() => onEdit(task)}
                    onDelete={() => onDelete(task)}
                  />
                ))}
              </div>
            );
          })}
        </div>
        <div className="h-24" />
      </div>
    </div>
  );
}
