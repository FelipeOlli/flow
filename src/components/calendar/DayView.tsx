"use client";

import { useEffect, useRef, useState } from "react";
import { format, isToday } from "date-fns";
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
  snapY,
  timeToY,
  yToTime,
} from "./calendarLayout";

interface DayViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  pendingIds: Set<string>;
  displayMode?: "grid" | "list";
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onDelete: (task: FlowTask) => void;
  onTimeClick: (time: Date) => void;
  onMove?: (task: FlowTask, newStart: Date, newEnd: Date) => void;
}

export function DayView({ tasks, currentDate, pendingIds, displayMode = "grid", onComplete, onEdit, onDelete, onTimeClick, onMove }: DayViewProps) {
  const [nowY, setNowY] = useState(currentTimeY());
  const scrollRef = useRef<HTMLDivElement>(null);
  const isCurrentDay = isToday(currentDate);

  // Drag state
  const dragRef = useRef<{
    task: FlowTask;
    startClientY: number;
    originalTop: number;
    moved: boolean;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragTop, setDragTop] = useState(0);
  const justDraggedRef = useRef(false);
  const onMoveRef = useRef(onMove);
  const currentDateRef = useRef(currentDate);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  useEffect(() => { currentDateRef.current = currentDate; }, [currentDate]);

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

  // Global pointer events for drag
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const dr = dragRef.current;
      if (!dr) return;
      const delta = e.clientY - dr.startClientY;
      if (Math.abs(delta) > 5) dr.moved = true;
      if (dr.moved) {
        const raw = Math.max(0, dr.originalTop + delta);
        setDragId(dr.task.id);
        setDragTop(snapY(raw));
      }
    }
    function onPointerUp(e: PointerEvent) {
      const dr = dragRef.current;
      if (!dr) return;
      dragRef.current = null;
      if (dr.moved) {
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 100);
        const delta = e.clientY - dr.startClientY;
        const raw = Math.max(0, dr.originalTop + delta);
        const newStart = yToTime(snapY(raw), currentDateRef.current);
        const duration = new Date(dr.task.endTime).getTime() - new Date(dr.task.startTime).getTime();
        const newEnd = new Date(newStart.getTime() + duration);
        onMoveRef.current?.(dr.task, newStart, newEnd);
      }
      setDragId(null);
    }
    function onPointerCancel() {
      dragRef.current = null;
      setDragId(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  const timedTasks = tasks.filter((t) => !t.isAllDay);
  const allDayTasks = tasks.filter((t) => t.isAllDay);
  const orderedTimedTasks = [...timedTasks].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const completed = timedTasks.filter((t) => t.isComplete).length;
  const total = timedTasks.length;
  const layout = computeLayout(timedTasks);

  function handleTaskPointerDown(e: React.PointerEvent<HTMLDivElement>, task: FlowTask) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    dragRef.current = {
      task,
      startClientY: e.clientY,
      originalTop: timeToY(task.startTime),
      moved: false,
    };
  }

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if (justDraggedRef.current) return;
    if ((e.target as HTMLElement).closest("[data-task-block]")) return;
    const y = e.nativeEvent.offsetY;
    onTimeClick(yToTime(y, currentDate));
  }

  function getAnchorFromElement(el: HTMLElement): EventAnchorPoint {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  if (displayMode === "list") {
    const pendingCount = Math.max(0, total - completed);
    return (
      <div className="flex flex-col flex-1 overflow-y-auto px-3 pb-20 pt-2">
        <div className="mb-2 rounded-lg border border-[#3c4043] bg-[#2a2b2e] px-3 py-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#e8eaed]">
            {pendingCount} tarefa(s) pendente(s)
          </p>
          <span className="text-xs text-[#9aa0a6] capitalize">
            {format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </span>
        </div>

        {allDayTasks.length > 0 && (
          <div className="space-y-2 mb-3">
            {allDayTasks.map((task) => (
              <div
                key={task.id}
                onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                className="rounded-lg border px-3 py-2 cursor-pointer"
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
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onComplete(task); }}
                    className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                      ${task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"}`}
                  >
                    {task.isComplete && (
                      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="min-w-0">
                    <p className={`text-base font-semibold leading-tight text-[#e8eaed] truncate ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>
                      {task.title}
                    </p>
                    <p className={`text-sm text-[#d2d6da] mt-0.5 ${task.isCancelled ? "line-through" : ""}`}>Dia inteiro</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {orderedTimedTasks.map((task) => (
            <div
              key={`${task.calendarId ?? "primary"}:${task.id}:${task.startTime}`}
              onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
              className="rounded-lg border px-3 py-2 cursor-pointer"
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
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onComplete(task); }}
                  className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                    ${task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"}`}
                >
                  {task.isComplete && (
                    <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
                <div className="min-w-0">
                  <p className={`text-base font-semibold leading-tight text-[#e8eaed] truncate ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>
                    {task.title}
                  </p>
                  <p className={`text-sm text-[#d2d6da] mt-0.5 ${task.isCancelled ? "line-through" : ""}`}>
                    {format(new Date(task.startTime), "HH:mm")} - {format(new Date(task.endTime), "HH:mm")}
                  </p>
                  {task.calendarName && (
                    <p className="text-xs text-[#9aa0a6] mt-0.5 truncate">{task.calendarName}</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1">
      {/* All-day + progress */}
      <div className="px-4 pt-2 pb-2 space-y-2">
        {allDayTasks.map((t) => (
          <div key={t.id} onClick={(e) => onEdit(t, getAnchorFromElement(e.currentTarget))}
            className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer"
            style={{
              backgroundColor: getEventSurfaceColor(
                t.calendarBgColor,
                t.isComplete,
                t.selfResponseStatus,
                t.isCancelled
              ),
              borderColor: t.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
            }}>
            <button onClick={(e) => { e.stopPropagation(); onComplete(t); }}
              type="button"
              className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                ${t.isComplete ? "bg-emerald-500 border-emerald-500" : "border-[#5f6368]"}`}>
              {t.isComplete && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </button>
            <span className={`text-xs font-medium truncate ${t.isComplete || t.isCancelled ? "line-through text-[#9aa0a6]" : "text-[#e8eaed] drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"}`}>{t.title}</span>
            <span className={`ml-auto text-xs text-[#9aa0a6] flex-shrink-0 ${t.isCancelled ? "line-through" : ""}`}>dia inteiro</span>
          </div>
        ))}
        {total > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-[#3c4043] overflow-hidden rounded-full">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.round((completed / total) * 100)}%` }} />
            </div>
            <span className="text-xs text-[#9aa0a6] tabular-nums">{completed}/{total}</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div ref={scrollRef} className="overflow-y-auto flex-1">
        <div
          className="relative cursor-pointer"
          style={{
            height: `${(CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START + 1) * CALENDAR_DIMENSIONS.HOUR_PX}px`,
            marginLeft: `${CALENDAR_DIMENSIONS.TIME_GUTTER_WIDTH}px`,
            marginRight: `${CALENDAR_DIMENSIONS.GRID_SIDE_PADDING}px`,
          }}
          onClick={handleTimelineClick}
        >
          {HOURS.map((h) => (
            <div key={h} className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${(h - CALENDAR_DIMENSIONS.DAY_START) * CALENDAR_DIMENSIONS.HOUR_PX}px` }}>
              <span className="absolute -left-10 -top-2.5 text-[11px] text-[#9aa0a6] w-8 text-right tabular-nums select-none">
                {formatHourLabel(h)}
              </span>
              <div className="w-full h-px bg-[#3c4043]" />
            </div>
          ))}

          {isCurrentDay && nowY >= 0 && nowY <= (CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START) * CALENDAR_DIMENSIONS.HOUR_PX && (
            <div className="absolute left-0 right-0 flex items-center z-20 pointer-events-none"
              style={{ top: `${nowY}px` }}>
              <div className="w-2.5 h-2.5 rounded-full bg-[#ea4335] -ml-1.5 flex-shrink-0" />
              <div className="flex-1 h-[2px] bg-[#ea4335]" />
            </div>
          )}

          {layout.map(({ task, col, totalCols, sameStartIndex, sameStartTotal }) => {
            const isBeingDragged = dragId === task.id;
            const top = isBeingDragged ? dragTop : timeToY(task.startTime);
            return (
              <TaskBlock
                key={task.id}
                task={task}
                top={top}
                height={durationToPx(task.startTime, task.endTime)}
                isPending={pendingIds.has(task.id)}
                colIndex={col}
                totalCols={totalCols}
                sameStartIndex={sameStartIndex}
                sameStartTotal={sameStartTotal}
                isDragging={isBeingDragged}
                onTaskPointerDown={(e) => handleTaskPointerDown(e, task)}
                onComplete={() => onComplete(task)}
                onEdit={(e) => { if (!justDraggedRef.current) onEdit(task, { x: e.clientX, y: e.clientY }); }}
                onDelete={() => onDelete(task)}
              />
            );
          })}
        </div>
        <div style={{ height: `${CALENDAR_DIMENSIONS.BOTTOM_SPACER_PX}px` }} />
      </div>
    </div>
  );
}
