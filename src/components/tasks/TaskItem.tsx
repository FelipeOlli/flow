"use client";

import { useState } from "react";
import { format } from "date-fns";
import { FlowTask } from "@/types/task";

interface TaskItemProps {
  task: FlowTask;
  onComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
  isPending?: boolean;
}

export function TaskItem({ task, onComplete, onEdit, onDelete, isPending }: TaskItemProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  function formatTime(iso: string) {
    try {
      return format(new Date(iso), "HH:mm");
    } catch {
      return "";
    }
  }

  function handleDeleteClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete();
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 2500);
    }
  }

  return (
    <div
      className={`
        relative flex items-center gap-3 p-4 rounded-2xl border transition-all duration-300
        ${task.isComplete
          ? "bg-emerald-950/50 border-emerald-900/60"
          : "bg-gray-900 border-gray-800"
        }
        ${isPending ? "opacity-60" : "opacity-100"}
      `}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); onComplete(); }}
        disabled={isPending}
        className={`
          flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center
          transition-all duration-200 active:scale-90
          ${task.isComplete
            ? "bg-emerald-500 border-emerald-500 check-pop"
            : "border-gray-600 hover:border-gray-400"
          }
        `}
        aria-label={task.isComplete ? "Marcar como pendente" : "Marcar como concluída"}
      >
        {task.isComplete && (
          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0" onClick={onEdit}>
        <p className={`
          font-medium text-sm truncate transition-all
          ${task.isComplete ? "line-through text-gray-500" : "text-white"}
        `}>
          {task.title}
        </p>
        {!task.isAllDay && task.startTime && (
          <p className={`text-xs mt-0.5 ${task.isComplete ? "text-gray-600" : "text-gray-500"}`}>
            {formatTime(task.startTime)}
            {task.endTime && ` — ${formatTime(task.endTime)}`}
          </p>
        )}
        {task.description && (
          <p className="text-xs text-gray-600 mt-1 truncate">{task.description}</p>
        )}
      </div>

      {/* Delete button */}
      <button
        onClick={handleDeleteClick}
        className={`
          flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-full transition-all
          ${confirmDelete
            ? "bg-red-500 text-white"
            : "text-gray-600 hover:text-gray-400 hover:bg-gray-800"
          }
        `}
        aria-label={confirmDelete ? "Confirmar exclusão" : "Excluir tarefa"}
      >
        {confirmDelete ? (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        )}
      </button>
    </div>
  );
}
