"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarOption, FlowTask, UpdateTaskInput } from "@/types/task";
import { computeDaysOpen, agingBadgeColor, categoryLetters } from "@/lib/aging";
import { Pillar } from "@/types/task";

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
  onDelete: (task: FlowTask, scope?: "this" | "thisAndFollowing" | "all") => void;
  onToggleComplete: (task: FlowTask, scope?: "this" | "thisAndFollowing" | "all") => void;
  onToggleImportant?: (task: FlowTask, scope?: "this" | "all") => void;
  onSetTag?: (task: FlowTask, tag: "O" | "E" | "D" | null, scope?: "this" | "all") => void;
  onSetPillar?: (task: FlowTask, pillar: Pillar | null, scope?: "this" | "all") => void;
}

const QUICK_DURATIONS = [
  { mins: 15, label: "15m" },
  { mins: 30, label: "30m" },
  { mins: 60, label: "1h" },
  { mins: 90, label: "1.5h" },
  { mins: 120, label: "2h" },
];

export function EventPopover({
  task,
  anchor,
  pending,
  onClose,
  onSaveEdit,
  onDelete,
  onToggleComplete,
  onToggleImportant,
  onSetTag,
  onSetPillar,
}: EventPopoverProps) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description ?? "");
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [startTime, setStartTime] = useState(toLocalDatetime(task.startTime));
  const [endTime, setEndTime] = useState(toLocalDatetime(task.endTime));
  const [calendarId, setCalendarId] = useState(task.calendarId ?? "primary");
  const [editIsImportant, setEditIsImportant] = useState(task.isImportant ?? false);
  const [editTag, setEditTag] = useState<"O" | "E" | "D" | null>(
    task.category === "operational" ? "O" : task.category === "strategic" ? "E" : task.isDelegable ? "D" : null
  );
  const [editPillar, setEditPillar] = useState<Pillar | null>(task.pillar ?? null);
  const [editAttendees, setEditAttendees] = useState<string[]>(
    (task.attendees ?? []).map((a) => a.email ?? "").filter(Boolean)
  );
  const [attendeeInput, setAttendeeInput] = useState("");
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [calendarLoadError, setCalendarLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [showRecurringDeleteDialog, setShowRecurringDeleteDialog] = useState(false);
  const [recurringScope, setRecurringScope] = useState<"this" | "thisAndFollowing" | "all">("this");
  const [showRecurringCompleteDialog, setShowRecurringCompleteDialog] = useState(false);
  const [completeScope, setCompleteScope] = useState<"this" | "thisAndFollowing" | "all">("this");
  const [showRecurringEditDialog, setShowRecurringEditDialog] = useState(false);
  const [editScope, setEditScope] = useState<"this" | "thisAndFollowing" | "all">("this");
  const [pendingUpdates, setPendingUpdates] = useState<UpdateTaskInput | null>(null);
  const [pendingMarkerFn, setPendingMarkerFn] = useState<((scope: "this" | "all") => void) | null>(null);
  const [editRecurring, setEditRecurring] = useState(false);
  const [editRecurrenceType, setEditRecurrenceType] = useState<
    "daily" | "weekly" | "biweekly" | "monthly" | "yearly" | "weekdays"
  >("weekly");

  const BYDAY_MAP = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
  function buildRRule(): string[] {
    if (!editRecurring) return [];
    const dayCode = BYDAY_MAP[new Date(startTime).getDay()];
    switch (editRecurrenceType) {
      case "daily":    return ["RRULE:FREQ=DAILY"];
      case "weekly":   return [`RRULE:FREQ=WEEKLY;BYDAY=${dayCode}`];
      case "biweekly": return [`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`];
      case "monthly":  return ["RRULE:FREQ=MONTHLY"];
      case "yearly":   return ["RRULE:FREQ=YEARLY"];
      case "weekdays": return ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];
    }
  }

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

  useEffect(() => {
    setTitle(task.title);
    setDescription(task.description ?? "");
    setStartTime(toLocalDatetime(task.startTime));
    setEndTime(toLocalDatetime(task.endTime));
    setCalendarId(task.calendarId ?? "primary");
    setEditIsImportant(task.isImportant ?? false);
    setEditTag(task.category === "operational" ? "O" : task.category === "strategic" ? "E" : task.isDelegable ? "D" : null);
    setEditPillar(task.pillar ?? null);
    setEditAttendees((task.attendees ?? []).map((a) => a.email ?? "").filter(Boolean));
    setAttendeeInput("");
    setEditing(false);
    setError("");
    setFeedback("");
    setEditRecurring(false);
    setEditRecurrenceType("weekly");
  }, [task]);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxH = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.6) : 400;
    el.style.height = `${Math.min(el.scrollHeight, maxH)}px`;
  }, [description, editing]);

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
    width: "min(480px, calc(100vw - 24px))",
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

  function buildEditUpdates(): UpdateTaskInput {
    const updates: UpdateTaskInput = {
      title: title.trim(),
      description: description.trim() || undefined,
      calendarId: task.calendarId ?? "primary",
      isImportant: editIsImportant,
      isDelegable: editTag === "D",
      category: editTag === "O" ? "operational" : editTag === "E" ? "strategic" : null,
      pillar: editPillar,
      attendees: editAttendees,
    };
    if (!task.isRecurring && editRecurring) {
      const rrule = buildRRule();
      if (rrule.length) updates.recurrence = rrule;
    }
    if (!task.isAllDay) {
      updates.startTime = new Date(startTime).toISOString();
      updates.endTime = new Date(endTime).toISOString();
    }
    if (calendarId !== (task.calendarId ?? "primary")) {
      updates.targetCalendarId = calendarId;
    }
    return updates;
  }

  async function doSaveEdit(updates: UpdateTaskInput) {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      await onSaveEdit(task, updates);
      setEditing(false);
      setFeedback("Evento atualizado com sucesso.");
    } catch {
      setError("Erro ao salvar alterações");
    } finally {
      setSaving(false);
    }
  }

  function handleSaveInlineEdit() {
    if (!title.trim()) { setError("Digite um título"); return; }
    if (!task.isAllDay && new Date(endTime) <= new Date(startTime)) {
      setError("Fim deve ser após início");
      return;
    }
    const updates = buildEditUpdates();
    if (task.isRecurring) {
      setPendingUpdates(updates);
      setPendingMarkerFn(null);
      setEditScope("this");
      setShowRecurringEditDialog(true);
      return;
    }
    doSaveEdit(updates);
  }

  function handleMarkerAction(fn: (scope: "this" | "all") => void) {
    if (task.isRecurring) {
      setPendingMarkerFn(() => fn);
      setPendingUpdates(null);
      setEditScope("this");
      setShowRecurringEditDialog(true);
      return;
    }
    fn("this");
  }

  return (
    <div className="fixed inset-0 z-[4000]" onClick={onClose}>
      <div
        className="fixed rounded-2xl border border-[#3c4043] bg-[#202124] shadow-2xl shadow-black/40 text-[#e8eaed]"
        style={positionStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
          <h3 className={`flex items-center gap-2 text-[26px] leading-tight font-normal ${!editing && task.isCancelled ? "line-through text-[#9aa0a6]" : ""}`}>
            <span>{editing ? "Editar evento" : task.title}</span>
            {!editing && task.attendees && task.attendees.length > 0 && (
              <svg viewBox="0 0 24 24" className="w-5 h-5 flex-shrink-0 text-white/80" fill="currentColor">
                <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
              </svg>
            )}
          </h3>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {!editing && onToggleImportant && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); handleMarkerAction((scope) => onToggleImportant!(task, scope)); }}
                className={`w-9 h-9 min-w-9 min-h-9 rounded-full border flex items-center justify-center transition-all
                  ${task.isImportant
                    ? "bg-[#F6BF26]/20 border-[#F6BF26]/60 text-[#F6BF26]"
                    : "border-[#5f6368] text-[#9aa0a6] hover:border-[#F6BF26]/60 hover:text-[#F6BF26]/70"}`}
                aria-label={task.isImportant ? "Remover destaque" : "Marcar como importante"}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill={task.isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={task.isImportant ? 0 : 1.5}>
                  {task.isImportant
                    ? <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                    : <path d="M22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                  }
                </svg>
              </button>
            )}
            {!editing && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (task.isRecurring && !task.isComplete) {
                    setCompleteScope("this");
                    setShowRecurringCompleteDialog(true);
                  } else {
                    onToggleComplete(task);
                  }
                }}
                className={`w-9 h-9 min-w-9 min-h-9 rounded-full border flex items-center justify-center transition-all disabled:opacity-50
                  ${task.isComplete
                    ? "bg-emerald-500 border-emerald-500 text-white"
                    : "border-[#5f6368] text-[#9aa0a6] hover:border-emerald-500 hover:text-emerald-400"}`}
                aria-label={task.isComplete ? "Marcar como pendente" : "Marcar como concluído"}
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>
            )}
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
        </div>

        <div className="px-4 pb-4 space-y-3 max-h-[min(80vh,640px)] overflow-y-auto overflow-x-hidden">
          {!editing ? (
            <>
              <div className={`text-sm text-[#e8eaed] ${task.isCancelled ? "line-through text-[#9aa0a6]" : ""}`}>
                <p className="capitalize">{dateLabel}</p>
                <p>{timeLabel}</p>
                {(() => {
                  const tz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Sao_Paulo";
                  const d = computeDaysOpen(task, tz);
                  const cats = categoryLetters(task);
                  return (
                    <>
                      {d >= 1 && <p className={`mt-0.5 font-medium ${agingBadgeColor(d)}`}>{d === 1 ? "1 dia em aberto" : `${d} dias em aberto`}</p>}
                      {cats.length > 0 && (
                        <p className="flex gap-1.5 mt-0.5">
                          {cats.map(({ letter, color }) => (
                            <span key={letter} className={`text-[11px] font-semibold ${color}`}>{letter}</span>
                          ))}
                        </p>
                      )}
                    </>
                  );
                })()}
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

              <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e]/60 p-3 space-y-1.5">
                <p className="text-xs uppercase tracking-wide text-[#9aa0a6]">Descrição</p>
                {task.description ? (
                  <p className="text-sm text-[#e8eaed] whitespace-pre-wrap break-words">{task.description}</p>
                ) : (
                  <p className="text-sm text-[#9aa0a6] italic">Nenhuma descrição ainda.</p>
                )}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="text-xs text-[#8ab4f8] hover:underline"
                >
                  {task.description ? "Editar descrição" : "Adicionar descrição"}
                </button>
              </div>

              {(task.calendarName || task.pillar) && (
                <div className="flex items-center gap-2 flex-wrap">
                  {task.pillar && (() => {
                    const pillarMap: Record<string, { label: string; color: string; bg: string }> = {
                      trabalho:        { label: "💼 Trabalho",        color: "#4285f4", bg: "#4285f420" },
                      saude:           { label: "🩺 Saúde",           color: "#34a853", bg: "#34a85320" },
                      familia:         { label: "👨‍👩‍👧 Família",        color: "#f6bf26", bg: "#f6bf2620" },
                      espiritualidade: { label: "✨ Espiritualidade", color: "#a78bfa", bg: "#a78bfa20" },
                    };
                    const p = pillarMap[task.pillar];
                    return p ? (
                      <span
                        className="text-xs font-medium px-2.5 py-1 rounded-full border"
                        style={{ color: p.color, backgroundColor: p.bg, borderColor: `${p.color}50` }}
                      >
                        {p.label}
                      </span>
                    ) : null;
                  })()}
                  {task.calendarName && (
                    <p className="text-sm text-[#9aa0a6]">{task.calendarName}</p>
                  )}
                </div>
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
                {onSetTag && (() => {
                  const activeTag = task.category === "operational" ? "O" : task.category === "strategic" ? "E" : task.isDelegable ? "D" : null;
                  return (
                    <div className="flex rounded-lg border border-[#5f6368] overflow-hidden">
                      {(["O", "E", "D"] as const).map((tag) => {
                        const isActive = activeTag === tag;
                        const colors: Record<string, string> = { O: "text-white/70", E: "text-[#a78bfa]", D: "text-[#4dd0e1]" };
                        const activeBg: Record<string, string> = { O: "bg-white/10", E: "bg-[#a78bfa]/15", D: "bg-[#4dd0e1]/15" };
                        return (
                          <button
                            key={tag}
                            type="button"
                            disabled={pending}
                            onClick={() => handleMarkerAction((scope) => onSetTag!(task, isActive ? null : tag, scope))}
                            className={`px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 border-r border-[#5f6368] last:border-r-0
                              ${isActive ? `${activeBg[tag]} ${colors[tag]}` : "text-white/30 hover:bg-[#2a2b2e]"}`}
                          >
                            {tag}
                          </button>
                        );
                      })}
                    </div>
                  );
                })()}
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="px-3 py-1.5 rounded-lg border border-[#5f6368] text-xs text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors"
                >
                  Editar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (task.isRecurring) {
                      setRecurringScope("this");
                      setShowRecurringDeleteDialog(true);
                    } else {
                      onDelete(task);
                    }
                  }}
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
              {/* Importante + O/E/D */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditIsImportant((v) => !v)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors border flex-1
                    ${editIsImportant
                      ? "bg-[#F6BF26]/20 border-[#F6BF26]/50 text-[#F6BF26]"
                      : "bg-[#2a2b2e] border-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed]"}`}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={editIsImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Importante
                </button>
                <div className="flex rounded-xl border border-[#3c4043] overflow-hidden">
                  {(["O", "E", "D"] as const).map((tag) => {
                    const isActive = editTag === tag;
                    const colors: Record<string, string> = { O: "text-white/70", E: "text-[#a78bfa]", D: "text-[#4dd0e1]" };
                    const activeBg: Record<string, string> = { O: "bg-white/10", E: "bg-[#a78bfa]/15", D: "bg-[#4dd0e1]/15" };
                    return (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setEditTag((v) => v === tag ? null : tag)}
                        className={`px-3 py-2 text-xs font-semibold transition-colors border-r border-[#3c4043] last:border-r-0
                          ${isActive ? `${activeBg[tag]} ${colors[tag]}` : "bg-[#2a2b2e] text-white/30 hover:text-[#e8eaed]"}`}
                      >
                        {tag}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Pilar */}
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Pilar</label>
                <div className="grid grid-cols-4 gap-1.5">
                  {([
                    { value: "trabalho" as Pillar, label: "💼 Trabalho", color: "#4285f4" },
                    { value: "saude" as Pillar, label: "🩺 Saúde", color: "#34a853" },
                    { value: "familia" as Pillar, label: "👨‍👩‍👧 Família", color: "#f6bf26" },
                    { value: "espiritualidade" as Pillar, label: "✨ Espirit.", color: "#a78bfa" },
                  ] as { value: Pillar; label: string; color: string }[]).map(({ value, label, color }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setEditPillar((v) => v === value ? null : value)}
                      className={`py-2 rounded-xl text-[10px] font-medium transition-colors border ${
                        editPillar === value ? "text-white" : "bg-[#2a2b2e] border-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed]"
                      }`}
                      style={editPillar === value ? { backgroundColor: `${color}25`, borderColor: `${color}80`, color } : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {!task.isAllDay && (
                <>
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="min-w-0">
                      <label className="text-xs text-[#9aa0a6] mb-1.5 block">Início</label>
                      <input
                        type="datetime-local"
                        value={startTime}
                        onChange={(e) => handleStartChange(e.target.value)}
                        className="w-full min-w-0 bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-2 py-2 text-[11px] sm:text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] appearance-none"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="text-xs text-[#9aa0a6] mb-1.5 block">Fim</label>
                      <input
                        type="datetime-local"
                        value={endTime}
                        min={startTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        className="w-full min-w-0 bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-2 py-2 text-[11px] sm:text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] appearance-none"
                      />
                    </div>
                  </div>
                </>
              )}
              <textarea
                ref={descriptionRef}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={1}
                className="w-full bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-3 py-2 text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] resize-y overflow-y-auto min-h-[2.5rem] max-h-[60vh]"
                placeholder="Descrição"
              />
              {/* Repetir — apenas para eventos não-recorrentes com horário */}
              {!task.isRecurring && !task.isAllDay && (
                <div>
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => setEditRecurring((v) => !v)}
                      className="flex items-center gap-2"
                    >
                      <div className={`w-10 rounded-full relative transition-colors`} style={{ height: 22, backgroundColor: editRecurring ? "#8ab4f8" : "#3c4043" }}>
                        <div className="absolute rounded-full bg-white shadow transition-transform" style={{ width: 18, height: 18, top: 2, left: 2, transform: editRecurring ? "translateX(18px)" : "translateX(0)" }} />
                      </div>
                      <span className={`text-xs ${editRecurring ? "text-[#e8eaed]" : "text-[#9aa0a6]"}`}>
                        {editRecurring ? "Evento recorrente" : "Repetir"}
                      </span>
                    </button>
                  </div>
                  {editRecurring && (
                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {([
                        { value: "daily",    label: "Diária" },
                        { value: "weekdays", label: "Dias úteis" },
                        { value: "weekly",   label: "Semanal" },
                        { value: "biweekly", label: "Quinzenal" },
                        { value: "monthly",  label: "Mensal" },
                        { value: "yearly",   label: "Anual" },
                      ] as { value: typeof editRecurrenceType; label: string }[]).map(({ value, label }) => (
                        <button
                          key={value}
                          type="button"
                          onClick={() => setEditRecurrenceType(value)}
                          className={`py-2 rounded-xl text-xs font-medium transition-colors border
                            ${editRecurrenceType === value
                              ? "bg-[#8ab4f8]/15 border-[#8ab4f8]/60 text-[#8ab4f8]"
                              : "bg-[#2a2b2e] border-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed]"}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {/* Convidados */}
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Convidados</label>
                {editAttendees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {editAttendees.map((email) => (
                      <span key={email} className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#3c4043] text-xs text-[#e8eaed]">
                        {email}
                        <button
                          type="button"
                          onClick={() => setEditAttendees((prev) => prev.filter((e) => e !== email))}
                          className="text-[#9aa0a6] hover:text-[#f28b82] transition-colors ml-0.5"
                        >
                          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="email@exemplo.com"
                    value={attendeeInput}
                    onChange={(e) => setAttendeeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === ",") {
                        e.preventDefault();
                        const email = attendeeInput.trim().toLowerCase();
                        if (email && !editAttendees.includes(email)) {
                          setEditAttendees((prev) => [...prev, email]);
                        }
                        setAttendeeInput("");
                      }
                    }}
                    className="flex-1 bg-[#2a2b2e] text-[#e8eaed] placeholder-[#9aa0a6] rounded-xl px-3 py-2 text-sm border border-[#3c4043] focus:outline-none focus:ring-2 focus:ring-[#8ab4f8]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const email = attendeeInput.trim().toLowerCase();
                      if (email && !editAttendees.includes(email)) {
                        setEditAttendees((prev) => [...prev, email]);
                      }
                      setAttendeeInput("");
                    }}
                    className="px-3 py-2 rounded-xl bg-[#3c4043] text-xs text-[#e8eaed] hover:bg-[#4c4f53] transition-colors"
                  >
                    Adicionar
                  </button>
                </div>
              </div>
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

      {/* Diálogo de escopo de edição de evento recorrente */}
      {showRecurringEditDialog && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowRecurringEditDialog(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-[#3c4043] bg-[#2a2b2e] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#e8eaed] mb-4">Editar evento recorrente</h3>
            <div className="space-y-3 mb-5">
              {(
                [
                  { value: "this", label: "Este evento" },
                  { value: "thisAndFollowing", label: "Este e os eventos seguintes" },
                  { value: "all", label: "Todos os eventos" },
                ] as const
              ).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="editScope"
                    value={value}
                    checked={editScope === value}
                    onChange={() => setEditScope(value)}
                    className="accent-[#8ab4f8] w-4 h-4"
                  />
                  <span className="text-sm text-[#e8eaed]">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setShowRecurringEditDialog(false); setPendingUpdates(null); setPendingMarkerFn(null); }}
                className="flex-1 px-3 py-2 rounded-lg border border-[#5f6368] text-xs text-[#e8eaed] hover:bg-[#3c4043] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRecurringEditDialog(false);
                  if (pendingUpdates) {
                    doSaveEdit({ ...pendingUpdates, scope: editScope });
                    setPendingUpdates(null);
                  } else if (pendingMarkerFn) {
                    pendingMarkerFn(editScope === "thisAndFollowing" ? "this" : editScope);
                    setPendingMarkerFn(null);
                  }
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-[#8ab4f8] text-[#202124] text-xs font-semibold hover:brightness-95 transition-colors"
              >
                Salvar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de conclusão de evento recorrente */}
      {showRecurringCompleteDialog && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowRecurringCompleteDialog(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-[#3c4043] bg-[#2a2b2e] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#e8eaed] mb-4">Concluir evento recorrente</h3>
            <div className="space-y-3 mb-5">
              {(
                [
                  { value: "this", label: "Este evento" },
                  { value: "thisAndFollowing", label: "Este e os eventos seguintes" },
                  { value: "all", label: "Todos os eventos" },
                ] as const
              ).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="completeScope"
                    value={value}
                    checked={completeScope === value}
                    onChange={() => setCompleteScope(value)}
                    className="accent-[#a78bfa] w-4 h-4"
                  />
                  <span className="text-sm text-[#e8eaed]">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowRecurringCompleteDialog(false)}
                className="flex-1 px-3 py-2 rounded-lg border border-[#5f6368] text-xs text-[#e8eaed] hover:bg-[#3c4043] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRecurringCompleteDialog(false);
                  onToggleComplete(task, completeScope);
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-emerald-500 text-white text-xs font-semibold hover:brightness-95 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo de exclusão de evento recorrente */}
      {showRecurringDeleteDialog && (
        <div className="fixed inset-0 z-[5000] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowRecurringDeleteDialog(false)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-2xl border border-[#3c4043] bg-[#2a2b2e] p-5 shadow-2xl">
            <h3 className="text-sm font-semibold text-[#e8eaed] mb-4">Excluir evento recorrente</h3>
            <div className="space-y-3 mb-5">
              {(
                [
                  { value: "this", label: "Este evento" },
                  { value: "thisAndFollowing", label: "Este e os eventos seguintes" },
                  { value: "all", label: "Todos os eventos" },
                ] as const
              ).map(({ value, label }) => (
                <label key={value} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="recurringScope"
                    value={value}
                    checked={recurringScope === value}
                    onChange={() => setRecurringScope(value)}
                    className="accent-[#a78bfa] w-4 h-4"
                  />
                  <span className="text-sm text-[#e8eaed]">{label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setShowRecurringDeleteDialog(false)}
                className="flex-1 px-3 py-2 rounded-lg border border-[#5f6368] text-xs text-[#e8eaed] hover:bg-[#3c4043] transition-colors"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRecurringDeleteDialog(false);
                  onDelete(task, recurringScope);
                }}
                className="flex-1 px-3 py-2 rounded-lg bg-[#f28b82] text-[#202124] text-xs font-semibold hover:brightness-95 transition-colors"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
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
