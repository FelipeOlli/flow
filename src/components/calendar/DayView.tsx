"use client";

import { useEffect, useRef, useState } from "react";
import { isToday } from "date-fns";
import { FlowTask } from "@/types/task";
import { TaskBlock } from "@/components/tasks/TaskBlock";
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
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask) => void;
  onDelete: (task: FlowTask) => void;
  onTimeClick: (time: Date) => void;
  onMove?: (task: FlowTask, newStart: Date, newEnd: Date) => void;
}

export function DayView({ tasks, currentDate, pendingIds, onComplete, onEdit, onDelete, onTimeClick, onMove }: DayViewProps) {
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

  return (
    <div className="flex flex-col flex-1">
      {/* All-day + progress */}
      <div className="px-4 pt-2 pb-2 space-y-2">
        {allDayTasks.map((t) => (
          <div key={t.id} onClick={() => onEdit(t)}
            className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#2a2b2e] border border-[#3c4043] cursor-pointer">
            <button onClick={(e) => { e.stopPropagation(); onComplete(t); }}
              type="button"
              className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                ${t.isComplete ? "bg-emerald-500 border-emerald-500" : "border-[#5f6368]"}`}>
              {t.isComplete && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </button>
            <span className={`text-xs truncate ${t.isComplete ? "line-through text-[#9aa0a6]" : "text-[#e8eaed]"}`}>{t.title}</span>
            <span className="ml-auto text-xs text-[#9aa0a6] flex-shrink-0">dia inteiro</span>
          </div>
        ))}
        {total > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-[#3c4043] overflow-hidden rounded-full">
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
              <div className="w-2 h-2 rounded-full bg-[#f28b82] -ml-1 flex-shrink-0" />
              <div className="flex-1 h-px bg-[#f28b82]" />
            </div>
          )}

          {layout.map(({ task, col, totalCols }) => {
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
                isDragging={isBeingDragged}
                onTaskPointerDown={(e) => handleTaskPointerDown(e, task)}
                onComplete={() => onComplete(task)}
                onEdit={() => { if (!justDraggedRef.current) onEdit(task); }}
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
