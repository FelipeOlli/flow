"use client";

import { useEffect, useRef, useState } from "react";
import { isToday } from "date-fns";
import { FlowTask } from "@/types/task";
import { TaskBlock } from "@/components/tasks/TaskBlock";

const DAY_START = 6;
const DAY_END = 23;
const HOUR_PX = 64;
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => i + DAY_START);

function timeToY(iso: string) {
  const d = new Date(iso);
  return ((d.getHours() - DAY_START) + d.getMinutes() / 60) * HOUR_PX;
}

function durationToPx(start: string, end: string) {
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  return Math.max((mins / 60) * HOUR_PX, 22);
}

function currentTimeY() {
  const now = new Date();
  return ((now.getHours() - DAY_START) + now.getMinutes() / 60) * HOUR_PX;
}

function yToTime(y: number, baseDate: Date): Date {
  const totalMins = Math.round((y / HOUR_PX) * 60 / 30) * 30;
  const time = new Date(baseDate);
  time.setHours(DAY_START + Math.floor(totalMins / 60), totalMins % 60, 0, 0);
  return time;
}

interface DayViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  pendingIds: Set<string>;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask) => void;
  onDelete: (task: FlowTask) => void;
  onTimeClick: (time: Date) => void;
}

export function DayView({ tasks, currentDate, pendingIds, onComplete, onEdit, onDelete, onTimeClick }: DayViewProps) {
  const [nowY, setNowY] = useState(currentTimeY());
  const scrollRef = useRef<HTMLDivElement>(null);
  const isCurrentDay = isToday(currentDate);

  useEffect(() => {
    if (!isCurrentDay) return;
    const t = setInterval(() => setNowY(currentTimeY()), 30000);
    return () => clearInterval(t);
  }, [isCurrentDay]);

  useEffect(() => {
    if (!isCurrentDay || !scrollRef.current) return;
    scrollRef.current.scrollTop = Math.max(0, nowY - 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const timedTasks = tasks.filter((t) => !t.isAllDay);
  const allDayTasks = tasks.filter((t) => t.isAllDay);
  const completed = timedTasks.filter((t) => t.isComplete).length;
  const total = timedTasks.length;

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest("[data-task-block]")) return;
    const y = e.nativeEvent.offsetY;
    onTimeClick(yToTime(y, currentDate));
  }

  return (
    <div className="flex flex-col flex-1">
      {/* All-day + progress */}
      <div className="px-4 pt-2 pb-2 space-y-2">
        {allDayTasks.map((t) => (
          <div key={t.id} onClick={() => onEdit(t)}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800/50 border border-gray-700/40 cursor-pointer">
            <button onClick={(e) => { e.stopPropagation(); onComplete(t); }}
              className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                ${t.isComplete ? "bg-emerald-500 border-emerald-500" : "border-gray-500"}`}>
              {t.isComplete && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </button>
            <span className={`text-xs truncate ${t.isComplete ? "line-through text-gray-500" : "text-gray-300"}`}>{t.title}</span>
            <span className="ml-auto text-xs text-gray-700 flex-shrink-0">dia inteiro</span>
          </div>
        ))}
        {total > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-800 overflow-hidden rounded-full">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.round((completed / total) * 100)}%` }} />
            </div>
            <span className="text-xs text-gray-700 tabular-nums">{completed}/{total}</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="overflow-y-auto flex-1">
        <div
          className="relative cursor-pointer"
          style={{ height: `${(DAY_END - DAY_START + 1) * HOUR_PX}px`, marginLeft: "44px", marginRight: "12px" }}
          onClick={handleTimelineClick}
        >
          {HOURS.map((h) => (
            <div key={h} className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${(h - DAY_START) * HOUR_PX}px` }}>
              <span className="absolute -left-10 -top-2.5 text-[11px] text-gray-700 w-8 text-right tabular-nums select-none">
                {String(h).padStart(2, "0")}
              </span>
              <div className="w-full h-px bg-gray-800/60" />
            </div>
          ))}

          {isCurrentDay && nowY >= 0 && nowY <= (DAY_END - DAY_START) * HOUR_PX && (
            <div className="absolute left-0 right-0 flex items-center z-20 pointer-events-none"
              style={{ top: `${nowY}px` }}>
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
              <div className="flex-1 h-px bg-red-500/70" />
            </div>
          )}

          {timedTasks.map((task) => (
            <TaskBlock
              key={task.id}
              task={task}
              top={timeToY(task.startTime)}
              height={durationToPx(task.startTime, task.endTime)}
              isPending={pendingIds.has(task.id)}
              onComplete={() => onComplete(task)}
              onEdit={() => onEdit(task)}
              onDelete={() => onDelete(task)}
            />
          ))}
        </div>
        <div className="h-24" />
      </div>
    </div>
  );
}
