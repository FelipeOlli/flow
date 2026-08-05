"use client";

import { useState } from "react";
import { format } from "date-fns";
import { FlowTask } from "@/types/task";
import { getEventSurfaceColor } from "@/lib/colors";
import { computeDaysOpen, agingBadgeColor, categoryLetters } from "@/lib/aging";

interface TaskBlockProps {
  task: FlowTask;
  top: number;
  height: number;
  onComplete: () => void;
  onEdit: (e: React.MouseEvent<HTMLDivElement>) => void;
  onDelete: () => void;
  isPending?: boolean;
  compact?: boolean;
  isDragging?: boolean;
  colStart?: number;
  colSpan?: number;
  totalCols?: number;
  onTaskPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onImportant?: () => void;
  hasConflict?: boolean;
  /** Evento cancelado/recusado: horário livre, exibido como faixa fina clicável. */
  ghost?: boolean;
}

export function TaskBlock({
  task, top, height, onComplete, onEdit, onDelete,
  isPending, compact, isDragging, colStart = 0, colSpan = 1, totalCols = 1,
  onTaskPointerDown, onImportant, hasConflict, ghost,
}: TaskBlockProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dense = height < 30 || (compact && totalCols >= 3);
  const compactMode = !dense && (compact || height < 44);
  const fullMode = !dense && !compactMode;
  const color = getEventSurfaceColor(
    task.calendarBgColor,
    task.isComplete,
    task.selfResponseStatus,
    task.isCancelled,
    task.isImportant
  );

  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Sao_Paulo";
  const daysOpen = computeDaysOpen(task, tz);
  const catLetters = categoryLetters(task);
  const startDate = new Date(task.startTime);
  const startOrder = startDate.getHours() * 60 + startDate.getMinutes();

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
      className={`absolute rounded-md border overflow-hidden cursor-pointer transition-shadow
        ${dense ? "flex items-center px-1.5 py-0.5" : compactMode ? "px-1.5 py-1" : "px-2 py-1.5"}
        ${isDragging ? "shadow-2xl shadow-black/50 z-30" : ""}
      `}
      style={{
        top: `${top}px`,
        height: `${height}px`,
        backgroundColor: color,
        borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(32,33,36,0.45)",
        left: ghost ? "2px" : totalCols > 1 ? `calc(${(colStart / totalCols) * 100}% + 2px)` : "2px",
        right: ghost ? undefined : totalCols > 1 ? undefined : "2px",
        width: ghost ? "10px" : totalCols > 1 ? `calc(${(colSpan / totalCols) * 100}% - 3px)` : undefined,
        opacity: isDragging ? 0.88 : isPending ? 0.55 : ghost ? 0.55 : 1,
        touchAction: "none",
        zIndex: isDragging ? 300 : ghost ? 50 + startOrder : (100 + startOrder),
        transition: isDragging ? "box-shadow 0.1s, opacity 0.1s" : "opacity 0.2s",
      }}
      onPointerDown={ghost ? undefined : onTaskPointerDown}
      onClick={(e) => { e.stopPropagation(); onEdit(e); }}
    >
      {ghost ? null : (
      <>
      {/* Badges D/O/E no topo do card */}
      {catLetters.length > 0 && (
        <div className="absolute top-0.5 right-0.5 flex gap-0.5 z-10">
          {catLetters.map(({ letter, color }) => (
            <span key={letter} className={`text-[8px] font-bold leading-none px-0.5 rounded-[2px] bg-black/30 ${color}`}>{letter}</span>
          ))}
        </div>
      )}
      {dense ? (
        /* Modo denso: título + horário inline em uma linha (estilo Google) */
        <div className="flex items-center gap-1 w-full overflow-hidden">
          <p className={`flex-1 truncate leading-tight text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]
            ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}
            ${compact ? "text-[10px] font-semibold" : "text-[10px] font-medium"}`}>
            {task.title}
            <span className="ml-1 opacity-80 font-normal">{formatTime(task.startTime)}</span>
          </p>
          {task.attendees && task.attendees.length > 0 && (
            <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 flex-shrink-0 text-white" fill="currentColor">
              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
            </svg>
          )}
          {task.isRecurring && (
            <span className="inline-flex items-center gap-0.5 flex-shrink-0">
              <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white/70" fill="currentColor">
                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
              </svg>
              {task.recurrenceCode && (
                <span className="text-[8px] font-bold leading-none text-white/70">{task.recurrenceCode}</span>
              )}
            </span>
          )}
          {daysOpen >= 1 && (
            <span className={`text-[9px] font-medium flex-shrink-0 leading-none ${agingBadgeColor(daysOpen)}`}>
              {daysOpen}d
            </span>
          )}
          {hasConflict && (
            <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 flex-shrink-0 text-[#ea4335]" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          )}
        </div>
      ) : (
        <div className="flex items-start gap-1.5">
          {/* Checkbox */}
          {!compactMode && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onComplete(); }}
              disabled={isPending}
              className={`flex-shrink-0 rounded-full border flex items-center justify-center mt-0.5 transition-all active:scale-90 w-3.5 h-3.5
                ${task.isComplete ? "border-white/80 bg-white/20" : "border-white/60 hover:border-white"}`}
            >
              {task.isComplete && (
                <svg viewBox="0 0 24 24" className="w-2 h-2 text-white" fill="none" stroke="currentColor" strokeWidth={3.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
          )}
          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className={`flex items-center gap-1 font-medium leading-tight text-white
              ${compactMode ? "text-[10px]" : "text-[11px]"}
              ${task.isComplete || task.isCancelled ? "line-through opacity-70" : ""}`}>
              <span className="truncate">{task.title}</span>
              {task.attendees && task.attendees.length > 0 && (
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 flex-shrink-0 text-white" fill="currentColor">
                  <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                </svg>
              )}
              {task.isRecurring && (
                <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                  <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white/70" fill="currentColor">
                    <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                  </svg>
                  {task.recurrenceCode && (
                    <span className="text-[8px] font-bold leading-none text-white/70">{task.recurrenceCode}</span>
                  )}
                </span>
              )}
              {daysOpen >= 1 && (
                <span className={`text-[9px] font-medium flex-shrink-0 leading-none ${agingBadgeColor(daysOpen)}`}>
                  {daysOpen}d
                </span>
              )}
              {hasConflict && (
                <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 flex-shrink-0 text-[#ea4335]" fill="none" stroke="currentColor" strokeWidth={2.2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              )}
              {onImportant && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onImportant(); }}
                  className={`flex-shrink-0 transition-colors ${task.isImportant ? "text-white" : "text-white/40 hover:text-white/70"}`}
                  aria-label={task.isImportant ? "Remover destaque" : "Marcar como importante"}
                >
                  <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill={task.isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={task.isImportant ? 0 : 1.5}>
                    {task.isImportant
                      ? <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                      : <path d="M22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                    }
                  </svg>
                </button>
              )}
            </div>
            {!compactMode && (
              <p className={`text-[10px] mt-0.5 text-white/90 ${task.isCancelled ? "line-through" : ""}`}>
                {formatTime(task.startTime)} — {formatTime(task.endTime)}
              </p>
            )}
            {fullMode && task.calendarName && (
              <p className="text-[10px] mt-0.5 text-white/60 truncate">
                {task.calendarName}
              </p>
            )}
          </div>
          {/* Important + Delete */}
          {fullMode && onImportant && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onImportant(); }}
              className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all
                ${task.isImportant ? "text-white" : "text-white/40 hover:text-white/80"}`}
              aria-label={task.isImportant ? "Remover destaque" : "Marcar como importante"}
            >
              <svg viewBox="0 0 24 24" className="w-3 h-3" fill={task.isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={task.isImportant ? 0 : 1.5}>
                {task.isImportant
                  ? <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                  : <path d="M22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                }
              </svg>
            </button>
          )}
          {fullMode && (
            <button
              type="button"
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
      </>
      )}
    </div>
  );
}
