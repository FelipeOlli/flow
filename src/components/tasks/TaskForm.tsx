"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { format } from "date-fns";
import { FlowTask, CreateTaskInput, UpdateTaskInput, CalendarOption, Pillar } from "@/types/task";
import { findConflicts, suggestFreeSlots } from "@/components/calendar/calendarLayout";

interface VoiceDefaults {
  startTime?: string;
  endTime?: string;
  title?: string;
  description?: string;
  calendarId?: string | null;
  isImportant?: boolean;
  isAllDay?: boolean;
  pillar?: Pillar;
  category?: "operational" | "strategic";
  isDelegable?: boolean;
  recurrenceType?: "daily" | "weekdays" | "weekly" | "biweekly" | "monthly" | "yearly";
  attendees?: string[];
}

interface TaskFormProps {
  task?: FlowTask | null;
  currentDate: string;
  defaults?: VoiceDefaults;
  existingTasks?: FlowTask[];
  /** Modo fila: um TaskForm por evento de um lote extraído por IA. */
  queue?: { index: number; total: number };
  onSkip?: () => void;
  onClose: () => void;
  onSave: (data: CreateTaskInput | UpdateTaskInput) => Promise<void>;
  onComplete?: (task: FlowTask) => void;
}

const QUICK_DURATIONS = [
  { mins: 5, label: "5m" },
  { mins: 10, label: "10m" },
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

export function TaskForm({ task, currentDate, defaults, existingTasks, queue, onSkip, onClose, onSave, onComplete }: TaskFormProps) {
  const isEditing = !!task;
  const titleRef = useRef<HTMLInputElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const defaultStart = task
    ? toLocalDatetimeValue(task.startTime)
    : buildDefaultStart(currentDate, defaults?.startTime);
  const defaultEnd = task
    ? toLocalDatetimeValue(task.endTime)
    : buildDefaultEnd(defaultStart, defaults?.endTime);

  const [title, setTitle] = useState(task?.title ?? defaults?.title ?? "");
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [description, setDescription] = useState(task?.description ?? defaults?.description ?? "");
  const [calendars, setCalendars] = useState<CalendarOption[]>([]);
  const [calendarId, setCalendarId] = useState("primary");
  const [loadingCalendars, setLoadingCalendars] = useState(false);
  const [calendarLoadError, setCalendarLoadError] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(!!(defaults?.recurrenceType));
  const [recurrenceType, setRecurrenceType] = useState<
    "daily" | "weekly" | "biweekly" | "monthly" | "yearly" | "weekdays"
  >(defaults?.recurrenceType ?? "weekly");
  const [isImportant, setIsImportant] = useState(defaults?.isImportant ?? false);
  const [tag, setTag] = useState<"O" | "E" | "D" | null>(
    defaults?.isDelegable ? "D" : defaults?.category === "strategic" ? "E" : defaults?.category === "operational" ? "O" : null
  );
  const [pillar, setPillar] = useState<Pillar | null>(defaults?.pillar ?? null);
  const [attendeeInput, setAttendeeInput] = useState("");
  const [attendees, setAttendees] = useState<string[]>(defaults?.attendees ?? []);
  const [frequentAttendees, setFrequentAttendees] = useState<{ email: string; name?: string }[]>([]);

  // Detecção de conflito de horário (apenas na criação)
  const conflictData = useMemo(() => {
    if (isEditing || !existingTasks?.length) return { conflicts: [] as FlowTask[], suggestions: [] as { mins: number; label: string; startIso: string }[] };
    try {
      const startIso = new Date(startTime).toISOString();
      const endIso   = new Date(endTime).toISOString();
      const conflicts = findConflicts(startIso, endIso, existingTasks);
      const suggestions = conflicts.length > 0 ? suggestFreeSlots(startIso, existingTasks) : [];
      return { conflicts, suggestions };
    } catch {
      return { conflicts: [] as FlowTask[], suggestions: [] as { mins: number; label: string; startIso: string }[] };
    }
  }, [isEditing, existingTasks, startTime, endTime]);

  function applySlot(slot: { mins: number; startIso: string }) {
    const start = new Date(slot.startIso);
    const end   = new Date(slot.startIso);
    end.setMinutes(end.getMinutes() + slot.mins);
    setStartTime(format(start, "yyyy-MM-dd'T'HH:mm"));
    setEndTime(format(end, "yyyy-MM-dd'T'HH:mm"));
    setError("");
  }

  useEffect(() => {
    setTimeout(() => titleRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    if (isEditing) return;
    let active = true;
    fetch("/api/attendees/frequent")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: { email: string; name?: string }[]) => { if (active) setFrequentAttendees(data); })
      .catch(() => {});
    return () => { active = false; };
  }, [isEditing]);

  useEffect(() => {
    const el = descriptionRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [description]);

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
          if (defaults?.calendarId && data.some((c) => c.id === defaults.calendarId)) {
            setCalendarId(defaults.calendarId);
          } else {
            const primary = data.find((c) => c.id === "primary");
            setCalendarId(primary?.id ?? data[0].id);
          }
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

  const BYDAY_MAP = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

  function buildRRule(): string[] {
    if (!recurring) return [];
    const dayCode = BYDAY_MAP[new Date(startTime).getDay()];
    switch (recurrenceType) {
      case "daily":     return ["RRULE:FREQ=DAILY"];
      case "weekly":    return [`RRULE:FREQ=WEEKLY;BYDAY=${dayCode}`];
      case "biweekly":  return [`RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=${dayCode}`];
      case "monthly":   return ["RRULE:FREQ=MONTHLY"];
      case "yearly":    return ["RRULE:FREQ=YEARLY"];
      case "weekdays":  return ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setError("Digite um título"); return; }
    if (new Date(endTime) <= new Date(startTime)) {
      setError("O horário de fim deve ser após o início");
      return;
    }
    if (!isEditing && conflictData.conflicts.length > 0) {
      setError("Horário ocupado. Escolha um dos horários sugeridos abaixo.");
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
      if (!isEditing) {
        payload.calendarId = calendarId;
        const rrule = buildRRule();
        if (rrule.length) (payload as CreateTaskInput).recurrence = rrule;
        if (isImportant) (payload as CreateTaskInput).isImportant = true;
        if (tag === "O") (payload as CreateTaskInput).category = "operational";
        if (tag === "E") (payload as CreateTaskInput).category = "strategic";
        if (tag === "D") (payload as CreateTaskInput).isDelegable = true;
        if (pillar) (payload as CreateTaskInput).pillar = pillar;
        if (attendees.length) (payload as CreateTaskInput).attendees = attendees;
      }
      await onSave(payload);
      // No modo fila quem decide o próximo passo (avançar ou encerrar) é o pai;
      // fora da fila, o comportamento de sempre é fechar ao salvar.
      if (!queue) onClose();
    } catch {
      setError("Erro ao salvar. Tente novamente.");
      setLoading(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-[3900] backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-[4000] flex items-center justify-center p-2 sm:p-6">
        <div className="w-full max-w-3xl bg-[#202124] rounded-2xl border border-[#3c4043] shadow-2xl shadow-black/40 p-3 sm:p-6 max-h-[92vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-2xl font-normal text-[#e8eaed]">
                {isEditing ? "Editar evento" : queue ? `Novo evento — ${queue.index + 1} de ${queue.total}` : "Novo evento"}
              </h2>
              {queue && (
                <div className="flex gap-1 mt-2">
                  {Array.from({ length: queue.total }).map((_, i) => (
                    <span
                      key={i}
                      className={`w-1.5 h-1.5 rounded-full ${i <= queue.index ? "bg-[#8ab4f8]" : "bg-[#3c4043]"}`}
                    />
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 min-w-9 min-h-9 rounded-full border border-[#8ab4f8] text-[#8ab4f8] hover:bg-[#8ab4f8]/10 transition-colors flex items-center justify-center"
              aria-label={queue ? "Encerrar fila de eventos" : "Fechar"}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
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
              <div className="grid grid-cols-4 gap-2">
                {QUICK_DURATIONS.map(({ mins, label }) => (
                  <button
                    key={mins}
                    type="button"
                    onClick={() => setDuration(mins)}
                    className={`py-2 rounded-xl text-xs font-medium transition-colors
                      ${currentDurationMins === mins
                        ? "bg-emerald-500 text-white"
                        : "bg-[#2a2b2e] text-[#bdc1c6] hover:text-[#e8eaed] border border-[#3c4043]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="min-w-0">
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Início</label>
                <input type="datetime-local" value={startTime} onChange={(e) => handleStartChange(e.target.value)}
                  className="w-full min-w-0 bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-2 sm:px-3 py-3 text-[11px] sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043] appearance-none" />
              </div>
              <div className="min-w-0">
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Fim</label>
                <input type="datetime-local" value={endTime} min={startTime} onChange={(e) => setEndTime(e.target.value)}
                  className="w-full min-w-0 bg-[#2a2b2e] text-[#e8eaed] rounded-xl px-2 sm:px-3 py-3 text-[11px] sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043] appearance-none" />
              </div>
            </div>
            {/* Aviso de horário ocupado + sugestões */}
            {!isEditing && conflictData.conflicts.length > 0 && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 space-y-2">
                <div className="flex items-center gap-2">
                  <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0 text-red-400" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-sm text-red-400">
                    Horário ocupado por <span className="font-medium">"{conflictData.conflicts[0].title}"</span>
                    {conflictData.conflicts.length > 1 && ` e mais ${conflictData.conflicts.length - 1}`}
                  </p>
                </div>
                {conflictData.suggestions.length > 0 && (
                  <div>
                    <p className="text-xs text-[#9aa0a6] mb-2">Próximos horários livres:</p>
                    <div className="flex flex-wrap gap-2">
                      {conflictData.suggestions.map((s) => (
                        <button
                          key={s.mins}
                          type="button"
                          onClick={() => applySlot(s)}
                          className="px-3 py-1.5 rounded-lg bg-[#2a2b2e] border border-[#3c4043] text-xs text-[#8ab4f8] hover:bg-[#8ab4f8]/10 hover:border-[#8ab4f8]/40 transition-colors"
                        >
                          {s.label} · {format(new Date(s.startIso), "HH:mm")}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <textarea
              ref={descriptionRef}
              placeholder="Descrição (opcional)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full bg-[#2a2b2e] text-[#e8eaed] placeholder-[#9aa0a6] rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043] resize-none overflow-hidden"
            />
            {/* Recurrence — only for new events */}
            {!isEditing && (
              <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] overflow-hidden">
                {/* Toggle row */}
                <button
                  type="button"
                  onClick={() => setRecurring((v) => !v)}
                  className="w-full flex items-center justify-between px-4 py-3 text-sm text-[#e8eaed] hover:bg-[#313236] transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#9aa0a6]" fill="none" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span className={recurring ? "text-[#e8eaed]" : "text-[#9aa0a6]"}>
                      {recurring ? "Evento recorrente" : "Repetir"}
                    </span>
                  </div>
                  {/* Toggle switch */}
                  <div className={`w-10 h-5.5 rounded-full relative transition-colors ${recurring ? "bg-[#8ab4f8]" : "bg-[#3c4043]"}`}
                    style={{ height: 22, width: 40 }}>
                    <div className={`absolute top-0.5 w-4.5 h-4.5 rounded-full bg-white shadow transition-transform ${recurring ? "translate-x-5" : "translate-x-0.5"}`}
                      style={{ width: 18, height: 18, top: 2, left: 2, transform: recurring ? "translateX(18px)" : "translateX(0)" }} />
                  </div>
                </button>

                {/* Frequency options */}
                {recurring && (
                  <div className="px-4 pb-3 grid grid-cols-3 gap-1.5">
                    {(
                      [
                        { value: "daily",    label: "Diária" },
                        { value: "weekdays", label: "Dias úteis" },
                        { value: "weekly",   label: "Semanal" },
                        { value: "biweekly", label: "Quinzenal" },
                        { value: "monthly",  label: "Mensal" },
                        { value: "yearly",   label: "Anual" },
                      ] as const
                    ).map(({ value, label }) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() => setRecurrenceType(value)}
                        className={`py-2 rounded-lg text-xs font-medium transition-colors border ${
                          recurrenceType === value
                            ? "bg-[#8ab4f8]/20 border-[#8ab4f8]/60 text-[#8ab4f8]"
                            : "bg-[#202124] border-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed]"
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Importante + Convidados — só na criação */}
            {!isEditing && (
              <div className="flex gap-3">
                {/* Toggle Importante */}
                <button
                  type="button"
                  onClick={() => setIsImportant((v) => !v)}
                  title={isImportant ? "Remover destaque" : "Marcar como importante"}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-medium transition-colors border
                    ${isImportant
                      ? "bg-[#F6BF26]/20 border-[#F6BF26]/50 text-[#F6BF26]"
                      : "bg-[#2a2b2e] border-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed]"}`}
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill={isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                  </svg>
                  Importante
                </button>
              </div>
            )}

            {/* Categoria O/E/D — só na criação */}
            {!isEditing && (
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Categoria</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {(["O", "E", "D"] as const).map((t) => {
                    const labels = { O: "Operacional", E: "Estratégico", D: "Delegável" };
                    const text = { O: "text-white/70", E: "text-[#a78bfa]", D: "text-[#4dd0e1]" };
                    const bg = { O: "bg-white/10", E: "bg-[#a78bfa]/15", D: "bg-[#4dd0e1]/15" };
                    const border = { O: "border-white/40", E: "border-[#a78bfa]/60", D: "border-[#4dd0e1]/60" };
                    const active = tag === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setTag((v) => (v === t ? null : t))}
                        className={`py-2 rounded-xl text-xs font-medium transition-colors border ${
                          active
                            ? `${bg[t]} ${border[t]} ${text[t]}`
                            : "bg-[#2a2b2e] border-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed]"
                        }`}
                      >
                        {t} — {labels[t]}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Pilar — só na criação */}
            {!isEditing && (
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
                      onClick={() => setPillar((v) => v === value ? null : value)}
                      className={`py-2 rounded-xl text-[10px] font-medium transition-colors border ${
                        pillar === value
                          ? "text-white"
                          : "bg-[#2a2b2e] border-[#3c4043] text-[#9aa0a6] hover:text-[#e8eaed]"
                      }`}
                      style={pillar === value ? { backgroundColor: `${color}25`, borderColor: `${color}80`, color } : undefined}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Convidados — só na criação */}
            {!isEditing && (
              <div>
                <label className="text-xs text-[#9aa0a6] mb-1.5 block">Convidados</label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    placeholder="email@exemplo.com"
                    value={attendeeInput}
                    onChange={(e) => setAttendeeInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const email = attendeeInput.trim().toLowerCase();
                        if (email && !attendees.includes(email)) {
                          setAttendees((prev) => [...prev, email]);
                        }
                        setAttendeeInput("");
                      }
                    }}
                    className="flex-1 bg-[#2a2b2e] text-[#e8eaed] placeholder-[#9aa0a6] rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#8ab4f8] border border-[#3c4043]"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const email = attendeeInput.trim().toLowerCase();
                      if (email && !attendees.includes(email)) {
                        setAttendees((prev) => [...prev, email]);
                      }
                      setAttendeeInput("");
                    }}
                    className="px-3 py-2.5 rounded-xl bg-[#2a2b2e] border border-[#3c4043] text-[#8ab4f8] hover:bg-[#313236] transition-colors text-sm"
                  >
                    Adicionar
                  </button>
                </div>
                {frequentAttendees.filter((a) => !attendees.includes(a.email)).length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {frequentAttendees
                      .filter((a) => !attendees.includes(a.email))
                      .filter((a) => !attendeeInput.trim() || a.email.includes(attendeeInput.trim().toLowerCase()) || a.name?.toLowerCase().includes(attendeeInput.trim().toLowerCase()))
                      .slice(0, 8)
                      .map((a) => (
                        <button
                          key={a.email}
                          type="button"
                          onClick={() => { setAttendees((prev) => [...prev, a.email]); setAttendeeInput(""); }}
                          className="px-2 py-1 rounded-full bg-[#2a2b2e] border border-[#3c4043] text-[11px] text-[#9aa0a6] hover:text-[#e8eaed] hover:border-[#8ab4f8]/60 transition-colors"
                          title={a.email}
                        >
                          {a.name || a.email}
                        </button>
                      ))}
                  </div>
                )}
                {attendees.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {attendees.map((email) => (
                      <span key={email} className="flex items-center gap-1 bg-[#3c4043] text-[#e8eaed] text-xs px-2.5 py-1 rounded-full">
                        {email}
                        <button
                          type="button"
                          onClick={() => setAttendees((prev) => prev.filter((e) => e !== email))}
                          className="text-[#9aa0a6] hover:text-[#e8eaed] ml-0.5"
                          aria-label={`Remover ${email}`}
                        >
                          <svg viewBox="0 0 24 24" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

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
              <button type="button" onClick={queue ? onSkip : onClose}
                className="flex-1 py-3 rounded-xl bg-[#2a2b2e] border border-[#3c4043] text-[#e8eaed] font-medium hover:bg-[#313236] transition-colors">
                {queue ? "Pular" : "Cancelar"}
              </button>
              <button type="submit" disabled={loading}
                className="flex-1 py-3 rounded-xl bg-emerald-500 text-white font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50">
                {loading
                  ? "Salvando..."
                  : isEditing
                  ? "Salvar"
                  : queue && queue.index < queue.total - 1
                  ? "Criar e próximo"
                  : "Criar"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
