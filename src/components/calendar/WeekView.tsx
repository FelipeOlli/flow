"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { format, startOfWeek, addDays, isToday, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { TaskBlock } from "@/components/tasks/TaskBlock";
import { getEventSurfaceColor } from "@/lib/colors";
import { EventAnchorPoint } from "./EventPopover";
import {
  CALENDAR_DIMENSIONS,
  CURRENT_TIME_LINE_Z_INDEX,
  HOURS,
  computeLayout,
  currentTimeY,
  durationToPx,
  formatHourLabel,
  timeToY,
  yToTime,
} from "./calendarLayout";
import { getDateKeyInTimeZone, getTaskGridDateKey } from "@/lib/timezone";

interface WeekViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  pendingIds: Set<string>;
  displayMode?: "grid" | "list";
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onDelete: (task: FlowTask) => void;
  onTimeClick: (time: Date) => void;
  onDayClick: (date: Date) => void;
}

export function WeekView({ tasks, currentDate, pendingIds, displayMode = "grid", onComplete, onEdit, onDelete, onTimeClick, onDayClick }: WeekViewProps) {
  const [nowY, setNowY] = useState(currentTimeY());
  const scrollRef = useRef<HTMLDivElement>(null);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const weekStart = startOfDay(startOfWeek(currentDate, { weekStartsOn: 1 }));
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

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
    const colKey = getDateKeyInTimeZone(day, tz);
    const dayTasks = tasks.filter(
      (t) =>
        !t.isAllDay &&
        t.startTime &&
        getTaskGridDateKey(t.startTime, t.isAllDay, tz) === colKey
    );
    return computeLayout(dayTasks);
  }

  function getAnchorFromElement(el: HTMLElement): EventAnchorPoint {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  if (displayMode === "list") {
    const nowTs = Date.now();
    return (
      <div className="flex flex-col flex-1 overflow-y-auto px-3 pb-20 pt-2 space-y-4">
        {weekDays.map((day) => {
          const colKey = getDateKeyInTimeZone(day, tz);
          const dayAllDay = tasks.filter(
            (t) => t.isAllDay && t.startTime && getTaskGridDateKey(t.startTime, true, tz) === colKey
          );
          const dayTimed = tasks
            .filter((t) => !t.isAllDay && t.startTime && getTaskGridDateKey(t.startTime, t.isAllDay, tz) === colKey)
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
          const isCurrentDay = isToday(day);
          const nowSeparatorIndex = isCurrentDay
            ? dayTimed.findIndex((t) => new Date(t.startTime).getTime() > nowTs)
            : -1;
          const separatorIndex = nowSeparatorIndex === -1 ? dayTimed.length : nowSeparatorIndex;
          const renderNowSeparator = (key: string) => (
            <div key={key} className="flex items-center gap-2 px-1 py-1">
              <div className="h-[2px] w-3 rounded bg-[#ea4335]" />
              <p className="text-[11px] font-medium text-[#ea4335]">Agora {format(new Date(), "HH:mm")}</p>
              <div className="h-px flex-1 bg-[#ea4335]/50" />
            </div>
          );
          return (
            <div key={day.toISOString()}>
              <button
                onClick={() => onDayClick(day)}
                className="flex items-center gap-2 mb-2 w-full text-left hover:opacity-80 transition-opacity"
              >
                <div className={`w-7 h-7 flex items-center justify-center rounded-full text-xs font-semibold flex-shrink-0
                  ${isCurrentDay ? "bg-[#8ab4f8] text-[#202124]" : "text-[#e8eaed]"}`}>
                  {format(day, "d")}
                </div>
                <span className="text-sm font-medium text-[#9aa0a6] capitalize">
                  {format(day, "EEE, d 'de' MMM", { locale: ptBR })}
                </span>
              </button>
              <div className="space-y-2">
                {dayAllDay.map((task) => (
                  <div
                    key={task.id}
                    onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                    className="rounded-lg border px-3 py-2 cursor-pointer"
                    style={{
                      backgroundColor: getEventSurfaceColor(task.calendarBgColor, task.isComplete, task.selfResponseStatus, task.isCancelled),
                      borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <button type="button" onClick={(e) => { e.stopPropagation(); onComplete(task); }}
                        className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                          ${task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"}`}>
                        {task.isComplete && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                      </button>
                      <div className="min-w-0">
                        <p className={`text-base font-semibold leading-tight text-[#e8eaed] truncate ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>{task.title}</p>
                        <p className={`text-sm text-[#d2d6da] mt-0.5 ${task.isCancelled ? "line-through" : ""}`}>Dia inteiro</p>
                      </div>
                    </div>
                  </div>
                ))}
                {isCurrentDay && dayTimed.length === 0 && renderNowSeparator(`now-empty-${day.toISOString()}`)}
                {dayTimed.map((task, index) => (
                  <Fragment key={`${task.calendarId ?? "primary"}:${task.id}:${task.startTime}`}>
                    {isCurrentDay && index === separatorIndex && renderNowSeparator(`now-${day.toISOString()}-${index}`)}
                    <div
                      onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                      className="rounded-lg border px-3 py-2 cursor-pointer"
                      style={{
                        backgroundColor: getEventSurfaceColor(task.calendarBgColor, task.isComplete, task.selfResponseStatus, task.isCancelled),
                        borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <button type="button" onClick={(e) => { e.stopPropagation(); onComplete(task); }}
                          className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                            ${task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"}`}>
                          {task.isComplete && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                        </button>
                        <div className="min-w-0">
                          <p className={`text-base font-semibold leading-tight text-[#e8eaed] truncate ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>{task.title}</p>
                          <p className={`text-sm text-[#d2d6da] mt-0.5 ${task.isCancelled ? "line-through" : ""}`}>
                            {format(new Date(task.startTime), "HH:mm")} - {format(new Date(task.endTime), "HH:mm")}
                          </p>
                          {task.calendarName && <p className="text-xs text-[#9aa0a6] mt-0.5 truncate">{task.calendarName}</p>}
                        </div>
                      </div>
                    </div>
                  </Fragment>
                ))}
                {isCurrentDay && dayTimed.length > 0 && separatorIndex === dayTimed.length &&
                  renderNowSeparator(`now-end-${day.toISOString()}`)}
                {dayAllDay.length === 0 && dayTimed.length === 0 && (
                  <p className="text-xs text-[#5f6368] px-1">Sem tarefas</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      {/* Day headers - sticky */}
      <div className="flex border-b border-[#3c4043] bg-[#202124]">
        <div className="w-11 flex-shrink-0" />
        {weekDays.map((day) => (
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
        {weekDays.map((day) => {
          const colKey = getDateKeyInTimeZone(day, tz);
          const allDayTasks = tasks.filter(
            (t) =>
              t.isAllDay && t.startTime && getTaskGridDateKey(t.startTime, true, tz) === colKey
          );
          return (
            <div
              key={`all-day-${day.toISOString()}`}
              className="flex-1 px-1 py-1 border-l border-[#3c4043] min-h-9 flex flex-col gap-0.5 max-h-28 overflow-y-auto"
            >
              {allDayTasks.map((task) => (
                <div
                  key={task.id}
                  role="button"
                  tabIndex={0}
                  onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onEdit(task, getAnchorFromElement(e.currentTarget));
                    }
                  }}
                  className={`w-full rounded px-1.5 py-0.5 text-[10px] border transition-colors cursor-pointer flex items-center gap-1.5 ${
                    task.isCancelled ? "text-[#9aa0a6]" : "text-white"
                  }`}
                  style={{
                    backgroundColor: getEventSurfaceColor(
                      task.calendarBgColor,
                      task.isComplete,
                      task.selfResponseStatus,
                      task.isCancelled
                    ),
                    borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
                  }}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onComplete(task);
                    }}
                    className={`w-3.5 h-3.5 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
                      task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"
                    }`}
                    aria-label={task.isComplete ? "Marcar pendente" : "Marcar concluído"}
                  >
                    {task.isComplete && (
                      <svg viewBox="0 0 24 24" className="w-2 h-2 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span className={`truncate font-medium drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)] ${
                    task.isComplete || task.isCancelled ? "line-through opacity-80" : ""
                  }`}>
                    {task.title}
                  </span>
                </div>
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
          {weekDays.map((day) => {
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
                  <div className="absolute left-0 right-0 flex items-center pointer-events-none"
                    style={{ top: `${nowY}px`, zIndex: CURRENT_TIME_LINE_Z_INDEX }}>
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
