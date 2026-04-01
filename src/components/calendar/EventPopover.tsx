"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { UpdateTaskInput } from "@/types/task";

export interface EventAnchorPoint {
  x: number;
  y: number;
}

interface EventPopoverProps {
  task: FlowTask;
  anchor: EventAnchorPoint | null;
  pending?: boolean;
  onClose: () => void;
  onSaveEdit: (task: FlowTask, updates: UpdateTaskInput) => Promise<void>;
  onDelete: (task: FlowTask) => void;
  onToggleComplete: (task: FlowTask) => void;
}

export function EventPopover({
  task,
  anchor,
  pending,
  onClose,
  onSaveEdit,
  onDelete,
  onToggleComplete,
}: EventPopoverProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const [startTime, setStartTime] = useState(toLocalDatetime(task.startTime));
  const [endTime, setEndTime] = useState(toLocalDatetime(task.endTime));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStartTime(toLocalDatetime(task.startTime));
    setEndTime(toLocalDatetime(task.endTime));
    setEditing(false);
    setError("");
  }, [task]);

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

  async function handleSaveInlineEdit() {
    if (!title.trim()) {
      setError("Digite um título");
      return;
    }
    if (!task.isAllDay && new Date(endTime) <= new Date(startTime)) {
      setError("Fim deve ser após início");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const updates: UpdateTaskInput = {
        title: title.trim(),
        description: description.trim() || undefined,
      };
      if (!task.isAllDay) {
        updates.startTime = new Date(startTime).toISOString();
        updates.endTime = new Date(endTime).toISOString();
      }
      await onSaveEdit(task, updates);
      setEditing(false);
    } catch {
      setError("Erro ao salvar alterações");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[70]" onClick={onClose}>
      <div
        className="fixed rounded-2xl border border-[#3c4043] bg-[#202124] shadow-2xl shadow-black/40 text-[#e8eaed]"
        style={positionStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <h3 className="text-[26px] leading-tight font-normal">{editing ? "Editar evento" : task.title}</h3>
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
          {!editing ? (
            <>
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
                  onClick={() => setEditing(true)}
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
            </>
          ) : (
            <div className="space-y-3">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-2.5 text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]"
                placeholder="Título"
              />
              {!task.isAllDay && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-2 text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]"
                  />
                  <input
                    type="datetime-local"
                    value={endTime}
                    min={startTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-2 text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]"
                  />
                </div>
              )}
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={2}
                className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-2 text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] resize-none"
                placeholder="Descrição"
              />
              {error && <p className="text-xs text-[#f28b82]">{error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setEditing(false); setError(""); }}
                  className="flex-1 px-3 py-2 rounded-lg border border-[#5f6368] text-xs text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={handleSaveInlineEdit}
                  className="flex-1 px-3 py-2 rounded-lg bg-[#8ab4f8] text-[#202124] text-xs font-medium hover:brightness-95 transition-colors disabled:opacity-50"
                >
                  {saving ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function toLocalDatetime(iso: string): string {
  try {
    return format(new Date(iso), "yyyy-MM-dd'T'HH:mm");
  } catch {
    return "";
  }
}
