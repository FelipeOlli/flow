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
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [calendarLoadError, setCalendarLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (isEditing) return;
    let active = true;
    async function loadCalendars() {
      setLoadingCalendars(true);
      setCalendarLoadError("");
      try {
        const res = await fetch("/api/calendars");
        if (!res.ok) throw new Error();
        const data: CalendarOption[] = await res.json();
        if (!active) return;
        setCalendars(data);
        if (data.length > 0) {
          const primary = data.find((c) => c.id === "primary");
          setCalendarId(primary?.id ?? data[0].id);
        }
      } catch {
        if (!active) return;
        setCalendarLoadError("Nao foi possivel carregar as agendas.");
        setCalendars([]);
      } finally {
        if (active) setLoadingCalendars(false);
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
        <div className="w-full max-w-3xl bg-[#202124] rounded-2xl border border-[#3c4043] shadow-2xl shadow-black/40 p-4 sm:p-6 max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-2xl font-normal text-[#e8eaed]">
              {isEditing ? "Editar evento" : "Novo evento"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 rounded-full border border-[#8ab4f8] text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors"
              aria-label="Fechar"
            >
              X
            </button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              ref={titleRef}
              type="text"
              placeholder="O que precisa ser feito?"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-[#2a2b2e] text-[#e8eaed] placeholder-[#9aa0a6] rounded-xl px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043]"
            />

            {/* Quick duration */}
            <div>
              <label className="text-xs text-[#9aa0a6] mb-1.5 block">Duração rápida</label>
              <div className="flex gap-2">
                {QUICK_DURATIONS.map(({ mins, label }) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setDuration(mins)}
                    className={`flex-1 py-2 rounded-xl text-xs font-medium transition-colors
                      ${currentDurationMins === mins
                        ? "bg-emerald-500 text-white"
                        : "bg-[#2a2b2e] text-[#bdc1c6] hover:text-[#e8eaed] border border-[#3c4043]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Início</label>
                <input type="datetime-local" value={startTime} onChange={(e) => handleStartChange(e.target.value)}
                  className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043]" />
              </div>
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Fim</label>
                <input type="datetime-local" value={endTime} min={startTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043]" />
              </div>
            </div>
            <textarea placeholder="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)}
              rows={2} className="w-full bg-[#2a2b2e] text-[#e8eaed] placeholder-[#9aa0a6] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043] resize-none" />
            {!isEditing && (
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Calendário</label>
                <select
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                  className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043]"
                >
                {loadingCalendars && <option value={calendarId}>Carregando agendas...</option>}
                {!loadingCalendars && calendars.length === 0 && <option value="primary">Principal</option>}
                  {calendars.map((cal) => (
                    <option key={cal.id} value={cal.id}>
                      {cal.name}
                    </option>
                  ))}
                </select>
              {!loadingCalendars && calendarLoadError && (
                <p className="text-[11px] text-[#f28b82] mt-1">{calendarLoadError}</p>
              )}
              </div>
            )}
            {isEditing && task && onComplete && (
              <button
                type="button"
                onClick={() => { onComplete(task); onClose(); }}
                title={task.isComplete ? "Marcar como pendente" : "Marcar como concluído"}
                className={`w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors border
                  ${task.isComplete
                    ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/40 hover:bg-emerald-500/30"
                    : "bg-[#2a2b2e] text-[#bdc1c6] hover:text-[#e8eaed] border-[#3c4043]"}`}
              >
                <span>{task.isComplete ? "Concluído" : "Marcar concluído"}</span>
              </button>
            )}
            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="flex-1 py-3 rounded-xl bg-[#2a2b2e] border border-[#3c4043] text-[#e8eaed] font-medium hover:bg-[#313236] transition-colors">
                Cancelar
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50">
                {loading ? "Salvando..." : isEditing ? "Salvar" : "Criar"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
