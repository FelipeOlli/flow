"use client";

import { useEffect, useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";

export interface EventAnchorPoint {
  x: number;
  y: number;
}

interface EventPopoverProps {
  task: FlowTask;
  anchor: EventAnchorPoint | null;
  pending?: boolean;
  onClose: () => void;
  onEdit: (task: FlowTask) => void;
  onDelete: (task: FlowTask) => void;
  onToggleComplete: (task: FlowTask) => void;
}

export function EventPopover({
  task,
  anchor,
  pending,
  onClose,
  onEdit,
  onDelete,
  onToggleComplete,
}: EventPopoverProps) {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const positionStyle = useMemo(() => {
    if (typeof window === "undefined" || !anchor) {
      return {
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
      } as const;
    }

    const cardWidth = Math.min(380, window.innerWidth - 24);
    const cardHeight = 250;
    const pad = 12;
    const preferLeft = anchor.x + 20 + cardWidth > window.innerWidth;
    const rawLeft = preferLeft ? anchor.x - cardWidth - 20 : anchor.x + 20;
    const rawTop = anchor.y - cardHeight / 2;

    const left = Math.max(pad, Math.min(rawLeft, window.innerWidth - cardWidth - pad));
    const top = Math.max(pad, Math.min(rawTop, window.innerHeight - cardHeight - pad));

    return { top: `${top}px`, left: `${left}px`, width: `${cardWidth}px` } as const;
  }, [anchor]);

  const dateLabel = task.startTime
    ? format(new Date(task.startTime), "EEEE, d 'de' MMMM", { locale: ptBR })
    : "";
  const timeLabel = task.isAllDay
    ? "Dia inteiro"
    : `${format(new Date(task.startTime), "HH:mm")} - ${format(new Date(task.endTime), "HH:mm")}`;

  return (
    <div className="fixed inset-0 z-[70]" onClick={onClose}>
      <div
        className="fixed rounded-2xl border border-[#3c4043] bg-[#202124] shadow-2xl shadow-black/40 text-[#e8eaed]"
        style={positionStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <h3 className="text-[26px] leading-tight font-normal">{task.title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full border border-[#8ab4f8] text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors"
            aria-label="Fechar"
          >
            X
          </button>
        </div>

        <div className="px-4 pb-4 space-y-3">
          <div className="text-sm text-[#e8eaed]">
            <p className="capitalize">{dateLabel}</p>
            <p>{timeLabel}</p>
          </div>

          {task.description && (
            <p className="text-sm text-[#bdc1c6] line-clamp-2">{task.description}</p>
          )}

          {task.calendarName && (
            <p className="text-sm text-[#9aa0a6]">{task.calendarName}</p>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={pending}
              onClick={() => onToggleComplete(task)}
              className="px-3 py-1.5 rounded-lg border border-[#5f6368] text-xs text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors disabled:opacity-50"
            >
              {task.isComplete ? "Marcar pendente" : "Marcar concluido"}
            </button>
            <button
              type="button"
              onClick={() => onEdit(task)}
              className="px-3 py-1.5 rounded-lg border border-[#5f6368] text-xs text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors"
            >
              Editar
            </button>
            <button
              type="button"
              onClick={() => onDelete(task)}
              className="px-3 py-1.5 rounded-lg border border-[#f28b82]/50 text-xs text-[#f28b82] hover:bg-[#f28b82]/10 transition-colors"
            >
              Excluir
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
