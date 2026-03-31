"use client";

import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { FlowTask, CreateTaskInput, UpdateTaskInput } from "@/types/task";

interface TaskFormProps {
  task?: FlowTask | null;
  currentDate: string;
  defaults?: { startTime?: string; endTime?: string };
  onClose: () => void;
  onSave: (data: CreateTaskInput | UpdateTaskInput) => Promise<void>;
}

function toLocalDatetimeValue(iso: string): string {
  try { return format(new Date(iso), "yyyy-MM-dd'T'HH:mm"); } catch { return ""; }
}

function buildDefaultStart(currentDate: string, defaultIso?: string): string {
  if (defaultIso) return toLocalDatetimeValue(defaultIso);
  const d = new Date(currentDate);
  const now = new Date();
  d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  const minutes = Math.ceil(d.getMinutes() / 30) * 30;
  d.setMinutes(minutes, 0, 0);
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

function buildDefaultEnd(start: string, defaultIso?: string): string {
  if (defaultIso) return toLocalDatetimeValue(defaultIso);
  const d = new Date(start);
  d.setMinutes(d.getMinutes() + 60);
  return format(d, "yyyy-MM-dd'T'HH:mm");
}

export function TaskForm({ task, currentDate, defaults, onClose, onSave }: TaskFormProps) {
  const isEditing = !!task;
  const titleRef = useRef<HTMLInputElement>(null);

  const defaultStart = task
    ? toLocalDatetimeValue(task.startTime)
    : buildDefaultStart(currentDate, defaults?.startTime);
  const defaultEnd = task
    ? toLocalDatetimeValue(task.endTime)
    : buildDefaultEnd(defaultStart, defaults?.endTime);

  const [title, setTitle] = useState(task?.title ?? "");
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [description, setDescription] = useState(task?.description ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  function handleStartChange(value: string) {
    setStartTime(value);
    const end = new Date(endTime);
    if (end <= new Date(value)) {
      const newEnd = new Date(value);
      newEnd.setMinutes(newEnd.getMinutes() + 60);
      setEndTime(format(newEnd, "yyyy-MM-dd'T'HH:mm"));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Digite um título"); return; }
    if (new Date(endTime) <= new Date(startTime)) {
      setError("O horário de fim deve ser após o início");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onSave({
        title: title.trim(),
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        description: description.trim() || undefined,
      });
      onClose();
    } catch {
      setError("Erro ao salvar. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-gray-900 rounded-t-3xl border-t border-gray-800 p-6 pb-10 max-h-[92vh] overflow-y-auto">
        <div className="w-12 h-1 bg-gray-700 rounded-full mx-auto mb-5" />
        <h2 className="text-lg font-semibold text-white mb-5">
          {isEditing ? "Editar" : "Nova tarefa"}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={titleRef}
            type="text"
            placeholder="O que precisa ser feito?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-2xl px-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-gray-700"
          />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Início</label>
              <input type="datetime-local" value={startTime} onChange={(e) => handleStartChange(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-2xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-gray-700" />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Fim</label>
              <input type="datetime-local" value={endTime} min={startTime} onChange={(e) => setEndTime(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-2xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-gray-700" />
            </div>
          </div>
          <textarea placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)}
            rows={2} className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-gray-700 resize-none" />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-3.5 rounded-2xl bg-gray-800 text-gray-300 font-medium active:bg-gray-700 transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 py-3.5 rounded-2xl bg-emerald-500 text-white font-medium active:bg-emerald-600 transition-colors disabled:opacity-50">
              {loading ? "Salvando..." : isEditing ? "Salvar" : "Criar"}
            </button>
          </div>
        </form>
      </div>
    </>
  );
}
