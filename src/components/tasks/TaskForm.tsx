"use client";

import { useState, useEffect, useRef } from "react";
import { format } from "date-fns";
import { FlowTask, CreateTaskInput, UpdateTaskInput, CalendarOption } from "@/types/task";

interface TaskFormProps {
  task?: FlowTask | null;
  currentDate: string;
  defaults?: { startTime?: string; endTime?: string };
  onClose: () => void;
  onSave: (data: CreateTaskInput | UpdateTaskInput) => Promise<void>;
  onComplete?: (task: FlowTask) => void;
}

const QUICK_DURATIONS = [
  { mins: 15, label: "15m" },
  { mins: 30, label: "30m" },
  { mins: 60, label: "1h" },
  { mins: 90, label: "1.5h" },
  { mins: 120, label: "2h" },
];

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

export function TaskForm({ task, currentDate, defaults, onClose, onSave, onComplete }: TaskFormProps) {
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
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [calendarId, setCalendarId] = useState("primary");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (isEditing) return;
    let active = true;
    async function loadCalendars() {
      try {
        const res = await fetch("/api/calendars");
        if (!res.ok) return;
        const data: CalendarOption[] = await res.json();
        if (!active) return;
        setCalendars(data);
        if (data.length > 0) {
          const primary = data.find((c) => c.id === "primary");
          setCalendarId(primary?.id ?? data[0].id);
        }
      } catch {
        // Keep default calendar when list fails.
      }
    }
    loadCalendars();
    return () => { active = false; };
  }, [isEditing]);

  const currentDurationMins = Math.round(
    (new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000
  );

  function setDuration(mins: number) {
    const end = new Date(startTime);
    end.setMinutes(end.getMinutes() + mins);
    setEndTime(format(end, "yyyy-MM-dd'T'HH:mm"));
  }

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
      const payload: CreateTaskInput | UpdateTaskInput = {
        title: title.trim(),
        startTime: new Date(startTime).toISOString(),
        endTime: new Date(endTime).toISOString(),
        description: description.trim() || undefined,
      };
      if (!isEditing) payload.calendarId = calendarId;
      await onSave(payload);
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
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-white">
            {isEditing ? "Editar" : "Nova tarefa"}
          </h2>
          {isEditing && task && onComplete && (
            <button
              type="button"
              onClick={() => { onComplete(task); onClose(); }}
              title={task.isComplete ? "Marcar como pendente" : "Marcar como concluído"}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
                ${task.isComplete
                  ? "bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30"
                  : "bg-gray-800 text-gray-400 hover:text-white border border-gray-700"}`}
            >
              <span>{task.isComplete ? "✅ Concluído" : "✅ Concluir"}</span>
            </button>
          )}
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            ref={titleRef}
            type="text"
            placeholder="O que precisa ser feito?"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full bg-gray-800 text-white placeholder-gray-500 rounded-2xl px-4 py-3.5 text-base focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-gray-700"
          />

          {/* Quick duration */}
          <div>
            <label className="text-xs text-gray-500 mb-1.5 block">Duração rápida</label>
            <div className="flex gap-2">
              {QUICK_DURATIONS.map(({ mins, label }) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDuration(mins)}
                  className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors
                    ${currentDurationMins === mins
                      ? "bg-emerald-500 text-white"
                      : "bg-gray-800 text-gray-400 hover:text-gray-300 border border-gray-700"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

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
          {!isEditing && (
            <div>
              <label className="text-xs text-gray-500 mb-1.5 block">Calendário</label>
              <select
                value={calendarId}
                onChange={(e) => setCalendarId(e.target.value)}
                className="w-full bg-gray-800 text-white rounded-2xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 border border-gray-700"
              >
                {calendars.length === 0 && <option value="primary">Principal</option>}
                {calendars.map((cal) => (
                  <option key={cal.id} value={cal.id}>
                    {cal.name}
                  </option>
                ))}
              </select>
            </div>
          )}
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
