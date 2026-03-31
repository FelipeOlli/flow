"use client";

import { useState } from "react";
import { format } from "date-fns";
import { FlowTask } from "@/types/task";

interface TaskBlockProps {
  task: FlowTask;
  top: number;
  height: number;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isPending?: boolean;
  compact?: boolean;
  isDragging?: boolean;
  colIndex?: number;
  totalCols?: number;
  onTaskPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function TaskBlock({
  task, top, height, onComplete, onEdit, onDelete,
  isPending, compact, isDragging, colIndex = 0, totalCols = 1,
  onTaskPointerDown,
}: TaskBlockProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isShort = height < 36;
  const color = task.isComplete ? "#0f9d58" : (task.calendarBgColor ?? "#4285f4");

  const colWidth = 1 / totalCols;
  const colLeft = colIndex / totalCols;

  function formatTime(iso: string) {
    try { return format(new Date(iso), "HH:mm"); } catch { return ""; }
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmDelete) { onDelete(); }
    else { setConfirmDelete(true); setTimeout(() => setConfirmDelete(false), 2500); }
  }

  return (
    <div
      data-task-block="true"
      className={`absolute rounded-xl border overflow-hidden cursor-pointer transition-shadow
        ${isShort ? "flex items-center px-1.5" : "px-2 py-1.5"}
        ${isDragging ? "shadow-2xl shadow-black/50 z-30" : ""}
      `}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        backgroundColor: color,
        borderColor: "rgba(0,0,0,0.35)",
        left: totalCols > 1 ? `calc(${colLeft * 100}% + 2px)` : "2px",
        right: totalCols === 1 ? "2px" : undefined,
        width: totalCols > 1 ? `calc(${colWidth * 100}% - 3px)` : undefined,
        opacity: isDragging ? 0.85 : isPending ? 0.5 : 1,
        touchAction: "none",
        zIndex: isDragging ? 30 : undefined,
        transition: isDragging ? "box-shadow 0.1s, opacity 0.1s" : "opacity 0.2s",
      }}
      onPointerDown={onTaskPointerDown}
      onClick={(e) => { e.stopPropagation(); onEdit(); }}
    >
      {compact ? (
        <p className="text-[10px] font-semibold text-white truncate pl-1 leading-tight drop-shadow-sm">
          {task.title}
        </p>
      ) : (
        <div className="flex items-start gap-1.5">
          {/* Checkbox */}
          <button
            onClick={(e) => { e.stopPropagation(); onComplete(); }}
            disabled={isPending}
            className={`flex-shrink-0 rounded-full border-2 flex items-center justify-center mt-0.5 transition-all active:scale-90
              ${isShort ? "w-3 h-3" : "w-3.5 h-3.5"}
              ${task.isComplete ? "border-white bg-white/30" : "border-white/60 hover:border-white"}`}
          >
            {task.isComplete && (
              <svg viewBox="0 0 24 24" className="w-2 h-2 text-white" fill="none" stroke="currentColor" strokeWidth={4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
          {/* Content */}
          <div className="flex-1 min-w-0">
            <p className={`font-semibold leading-tight truncate text-white drop-shadow-sm
              ${isShort ? "text-[11px]" : "text-xs"}
              ${task.isComplete ? "line-through opacity-70" : ""}`}>
              {task.title}
            </p>
            {!isShort && (
              <p className="text-[10px] mt-0.5 text-white/75">
                {formatTime(task.startTime)} — {formatTime(task.endTime)}
              </p>
            )}
            {!isShort && task.calendarName && (
              <p className="text-[10px] mt-0.5 text-white/50 truncate">
                {task.calendarName}
              </p>
            )}
          </div>
          {/* Delete */}
          {!isShort && (
            <button
              onClick={handleDeleteClick}
              className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all
                ${confirmDelete ? "bg-white/30 text-white" : "text-white/40 hover:text-white/80"}`}
            >
              {confirmDelete
                ? <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
                : <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="none" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
              }
            </button>
          )}
        </div>
      )}
    </div>
  );
}
