"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarOption, FlowTask, UpdateTaskInput } from "@/types/task";

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
  const [calendarId, setCalendarId] = useState(task.calendarId ?? "primary");
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [calendarLoadError, setCalendarLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStartTime(toLocalDatetime(task.startTime));
    setEndTime(toLocalDatetime(task.endTime));
    setCalendarId(task.calendarId ?? "primary");
    setEditing(false);
    setError("");
    setFeedback("");
  }, [task]);

  useEffect(() => {
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
      } catch {
        if (!active) return;
        setCalendarLoadError("Nao foi possivel carregar agendas.");
        setCalendars([]);
      } finally {
        if (active) setLoadingCalendars(false);
      }
    }
    loadCalendars();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const positionStyle = {
    top: "50%",
    left: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(380px, calc(100vw - 24px))",
  } as const;

  const dateLabel = task.startTime
    ? format(new Date(task.startTime), "EEEE, d 'de' MMMM", { locale: ptBR })
    : "";
  const timeLabel = task.isAllDay
    ? "Dia inteiro"
    : `${format(new Date(task.startTime), "HH:mm")} - ${format(new Date(task.endTime), "HH:mm")}`;

  const attendeeStatusLabel: Record<string, string> = {
    accepted: "Aceito",
    tentative: "Talvez",
    declined: "Recusado",
    needsAction: "Sem resposta",
  };
  const currentResponse = task.selfResponseStatus ?? "needsAction";

  async function handleAttendanceStatus(status: "accepted" | "tentative" | "declined") {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await onSaveEdit(task, {
        calendarId: task.calendarId ?? "primary",
        attendanceStatus: status,
      });
      setFeedback("Presença atualizada.");
    } catch {
      setError("Erro ao atualizar presença");
    } finally {
      setSaving(false);
    }
  }

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
    setFeedback("");
    try {
      const updates: UpdateTaskInput = {
        title: title.trim(),
        description: description.trim() || undefined,
        calendarId: task.calendarId ?? "primary",
      };
      if (!task.isAllDay) {
        updates.startTime = new Date(startTime).toISOString();
        updates.endTime = new Date(endTime).toISOString();
      }
      if (calendarId !== (task.calendarId ?? "primary")) {
        updates.targetCalendarId = calendarId;
      }
      await onSaveEdit(task, updates);
      setEditing(false);
      setFeedback("Evento atualizado com sucesso.");
    } catch {
      setError("Erro ao salvar alterações");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[4000]" onClick={onClose}>
      <div
        className="fixed rounded-2xl border border-[#3c4043] bg-[#202124] shadow-2xl shadow-black/40 text-[#e8eaed]"
        style={positionStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <h3 className={`text-[26px] leading-tight font-normal ${!editing && task.isCancelled ? "line-through text-[#9aa0a6]" : ""}`}>
            {editing ? "Editar evento" : task.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 min-w-9 min-h-9 rounded-full border border-[#8ab4f8] text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors flex items-center justify-center"
            aria-label="Fechar"
          >
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-4 pb-4 space-y-3 max-h-[min(72vh,560px)] overflow-y-auto">
          {!editing ? (
            <>
              <div className={`text-sm text-[#e8eaed] ${task.isCancelled ? "line-through text-[#9aa0a6]" : ""}`}>
                <p className="capitalize">{dateLabel}</p>
                <p>{timeLabel}</p>
              </div>

              <div className="space-y-1">
                <p className="text-xs uppercase tracking-wide text-[#9aa0a6]">Recorrência</p>
                {task.isRecurring ? (
                  <>
                    <p className="text-sm text-[#e8eaed]">{task.recurrenceSummary ?? "Evento recorrente"}</p>
                    {task.recurrenceEndHint && (
                      <p className="text-sm text-[#9aa0a6]">{task.recurrenceEndHint}</p>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-[#9aa0a6]">Não se repete</p>
                )}
              </div>

              <div className="space-y-1.5">
                <p className="text-xs uppercase tracking-wide text-[#9aa0a6]">Descrição</p>
                {task.description ? (
                  <p className="text-sm text-[#bdc1c6] whitespace-pre-wrap break-words">{task.description}</p>
                ) : (
                  <p className="text-sm text-[#9aa0a6]">Nenhuma descrição ainda.</p>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs text-[#8ab4f8] hover:underline"
                >
                  {task.description ? "Editar descrição" : "Adicionar descrição"}
                </button>
              </div>

              {task.calendarName && (
                <p className="text-sm text-[#9aa0a6]">{task.calendarName}</p>
              )}

              {task.meetingUrl && (
                <a
                  href={task.meetingUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#8ab4f8]/60 text-sm text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors"
                >
                  Entrar com Google Meet
                </a>
              )}

              {task.attendees && task.attendees.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs uppercase tracking-wide text-[#9aa0a6]">Convidados</p>
                  <div className="space-y-1.5">
                    {task.attendees.map((attendee, index) => (
                      <div
                        key={`${attendee.email ?? attendee.name ?? "attendee"}-${index}`}
                        className="text-sm text-[#e8eaed] break-words"
                      >
                        <span>{attendee.name?.trim() || attendee.email || "Convidado"}</span>
                        {attendee.responseStatus && (
                          <span className="text-[#9aa0a6]"> - {attendeeStatusLabel[attendee.responseStatus] ?? "Sem resposta"}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-[#9aa0a6]">Sua presença</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={pending || saving}
                    onClick={() => handleAttendanceStatus("accepted")}
                    className={`px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                      currentResponse === "accepted"
                        ? "border-emerald-400/70 bg-emerald-400/15 text-emerald-300"
                        : "border-[#5f6368] text-[#e8eaed] hover:bg-[#2a2b2e]"
                    }`}
                  >
                    Sim
                  </button>
                  <button
                    type="button"
                    disabled={pending || saving}
                    onClick={() => handleAttendanceStatus("tentative")}
                    className={`px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                      currentResponse === "tentative"
                        ? "border-amber-400/70 bg-amber-400/15 text-amber-300"
                        : "border-[#5f6368] text-[#e8eaed] hover:bg-[#2a2b2e]"
                    }`}
                  >
                    Talvez
                  </button>
                  <button
                    type="button"
                    disabled={pending || saving}
                    onClick={() => handleAttendanceStatus("declined")}
                    className={`px-3 py-1.5 rounded-lg border text-xs transition-colors disabled:opacity-50 ${
                      currentResponse === "declined"
                        ? "border-[#9aa0a6]/70 bg-[#9aa0a6]/20 text-[#e8eaed]"
                        : "border-[#5f6368] text-[#e8eaed] hover:bg-[#2a2b2e]"
                    }`}
                  >
                    Nao
                  </button>
                </div>
                <p className="text-xs text-[#9aa0a6]">
                  Status atual: {attendeeStatusLabel[currentResponse] ?? "Sem resposta"}
                </p>
              </div>

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
              {feedback && <p className="text-xs text-emerald-400">{feedback}</p>}
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
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Agenda</label>
                <select
                  value={calendarId}
                  onChange={(e) => setCalendarId(e.target.value)}
                  className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-2 text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]"
                >
                  <option value={task.calendarId ?? "primary"}>
                    {task.calendarName ?? "Agenda atual"}
                  </option>
                  {calendars
                    .filter((cal) => cal.id !== (task.calendarId ?? "primary"))
                    .map((cal) => (
                      <option key={cal.id} value={cal.id}>
                        {cal.name}
                      </option>
                    ))}
                </select>
                {loadingCalendars && (
                  <p className="text-[11px] text-[#9aa0a6] mt-1">Carregando agendas...</p>
                )}
                {!loadingCalendars && calendarLoadError && (
                  <p className="text-[11px] text-[#f28b82] mt-1">{calendarLoadError}</p>
                )}
              </div>
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
              {feedback && <p className="text-xs text-emerald-400">{feedback}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { setEditing(false); setError(""); setFeedback(""); }}
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
