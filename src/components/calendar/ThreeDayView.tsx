"use client";

import { useEffect, useRef, useState } from "react";
import { format, addDays, isToday, isSameDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { TaskBlock } from "@/components/tasks/TaskBlock";
import { getEventSurfaceColor } from "@/lib/colors";
import { EventAnchorPoint } from "./EventPopover";
import {
  CALENDAR_DIMENSIONS,
  HOURS,
  computeLayout,
  currentTimeY,
  durationToPx,
  formatHourLabel,
  timeToY,
  yToTime,
} from "./calendarLayout";

interface ThreeDayViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  pendingIds: Set<string>;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
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

  function getAnchorFromElement(el: HTMLElement): EventAnchorPoint {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Day headers */}
      <div className="flex border-b border-[#3c4043] bg-[#202124]">
        <div className="w-11 flex-shrink-0" />
        {days.map((day) => (
          <button
            key={day.toISOString()}
            onClick={() => onDayClick(day)}
            className="flex-1 py-2.5 text-center hover:bg-[#2a2b2e] transition-colors"
          >
            <p className="text-[10px] text-[#9aa0a6] uppercase tracking-wide">
              {format(day, "EEE", { locale: ptBR })}
            </p>
            <div className={`mx-auto mt-1 w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold
              ${isToday(day) ? "bg-[#8ab4f8] text-[#202124]" : "text-[#e8eaed]"}`}>
              {format(day, "d")}
            </div>
          </button>
        ))}
      </div>

      {/* All-day row */}
      <div className="flex border-b border-[#3c4043] bg-[#202124] min-h-9">
        <div className="w-11 flex-shrink-0 px-1.5 py-2 text-[10px] uppercase tracking-wide text-[#9aa0a6]">dia</div>
        {days.map((day) => {
          const allDayTasks = tasks
            .filter((t) => t.isAllDay && t.startTime && isSameDay(new Date(t.startTime), day))
            .slice(0, 1);
          return (
            <div key={`all-day-${day.toISOString()}`} className="flex-1 px-1 py-1 border-l border-[#3c4043] min-h-9">
              {allDayTasks.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                  className="w-full truncate rounded px-1.5 py-0.5 text-[10px] font-medium text-left text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)] border transition-colors"
                  style={{
                    backgroundColor: getEventSurfaceColor(task.calendarBgColor, task.isComplete, task.selfResponseStatus),
                    borderColor: "rgba(12,14,16,0.56)",
                  }}
                >
                  {task.title}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* Scrollable timeline */}
      <div ref={scrollRef} className="overflow-y-auto flex-1">
        <div className="flex" style={{ height: `${(CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START + 1) * CALENDAR_DIMENSIONS.HOUR_PX}px` }}>
          {/* Time labels */}
          <div className="w-11 flex-shrink-0 relative">
            {HOURS.map((h) => (
              <div key={h} className="absolute right-1.5" style={{ top: `${(h - CALENDAR_DIMENSIONS.DAY_START) * CALENDAR_DIMENSIONS.HOUR_PX - 7}px` }}>
                <span className="text-[10px] text-[#9aa0a6] tabular-nums select-none">
                  {formatHourLabel(h)}
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
                className="flex-1 relative border-l border-[#3c4043] cursor-pointer"
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("[data-task-block]")) return;
                  onTimeClick(yToTime(e.nativeEvent.offsetY, day));
                }}
              >
                {/* Hour lines */}
                {HOURS.map((h) => (
                  <div key={h} className="absolute left-0 right-0 border-t border-[#3c4043] pointer-events-none"
                    style={{ top: `${(h - CALENDAR_DIMENSIONS.DAY_START) * CALENDAR_DIMENSIONS.HOUR_PX}px` }} />
                ))}

                {/* Current time */}
                {isCurrentDay && nowY >= 0 && (
                  <div className="absolute left-0 right-0 flex items-center z-10 pointer-events-none"
                    style={{ top: `${nowY}px` }}>
                    <div className="w-2 h-2 rounded-full bg-[#ea4335] -ml-1 flex-shrink-0" />
                    <div className="flex-1 h-[2px] bg-[#ea4335]" />
                  </div>
                )}

                {/* Events */}
                {layout.map(({ task, col, totalCols, sameStartIndex, sameStartTotal }) => (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    top={timeToY(task.startTime)}
                    height={durationToPx(task.startTime, task.endTime)}
                    isPending={pendingIds.has(task.id)}
                    colIndex={col}
                    totalCols={totalCols}
                    sameStartIndex={sameStartIndex}
                    sameStartTotal={sameStartTotal}
                    onComplete={() => onComplete(task)}
                    onEdit={(e) => onEdit(task, { x: e.clientX, y: e.clientY })}
                    onDelete={() => onDelete(task)}
                  />
                ))}
              </div>
            );
          })}
        </div>
        <div style={{ height: `${CALENDAR_DIMENSIONS.BOTTOM_SPACER_PX}px` }} />
      </div>
    </div>
  );
}
