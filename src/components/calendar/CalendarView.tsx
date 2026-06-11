"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isToday, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { signOut, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FlowTask, CreateTaskInput, UpdateTaskInput, Pillar } from "@/types/task";
import { CALENDAR_PILLAR_OVERRIDES } from "@/lib/pillar-config";
import { DayView } from "./DayView";
import { ThreeDayView } from "./ThreeDayView";
import { WeekView } from "./WeekView";
import { MonthView } from "./MonthView";
import { EventPopover, EventAnchorPoint } from "./EventPopover";
import { TaskForm } from "@/components/tasks/TaskForm";
import { DashboardView } from "@/components/dashboard/DashboardView";
import { WeeklyReviewView } from "@/components/dashboard/WeeklyReviewView";
import { getPushStatus, registerPush, unregisterPush, getActiveSubscription, type PushStatus } from "@/lib/push-client";
import { VoiceCaptureModal } from "./VoiceCaptureModal";
import { type ParsedEvent } from "@/lib/openai-event-parser";

type View = "day" | "3days" | "week" | "month";
const LAYERS = {
  fab: "z-[1200]",
  fabBehindOverlay: "z-10",
  toast: "z-[1300]",
} as const;

type MigrationDiagnosticsPayload = {
  sourceEvents?: number;
  pendingEvents?: number;
  completedEvents?: number;
  allDayEvents?: number;
  eligibleTimed?: number;
  eligibleAllDay?: number;
  includeCompletedTimed?: boolean;
  includeAllDayFilter?: boolean;
};

function extractFailedDetailSamples(details: unknown): string[] {
  if (!Array.isArray(details)) return [];
  return details
    .filter((x): x is string => typeof x === "string" && x.includes("✗"))
    .map((s) => s.replace(/^✗\s*/, "").trim())
    .filter(Boolean);
}

function buildManualMigrationMessage(
  migrated: number,
  skipped: number,
  sourceDateKey: string,
  targetDateKey: string,
  diagnostics: MigrationDiagnosticsPayload | undefined,
  details: unknown
): { text: string; autoClearMs: number } {
  const failSamples = extractFailedDetailSamples(details);
  const eligible = (diagnostics?.eligibleTimed ?? 0) + (diagnostics?.eligibleAllDay ?? 0);

  if (migrated > 0) {
    let text = `${migrated} tarefa(s) migrada(s) de ${sourceDateKey} para ${targetDateKey}.`;
    if (skipped > 0) {
      text += `\n${skipped} tarefa(s) falharam.`;
      if (failSamples.length) {
        text += "\nExemplos:";
        for (const s of failSamples.slice(0, 3)) text += `\n— ${s}`;
      }
    }
    if (diagnostics && typeof diagnostics.sourceEvents === "number") {
      text += `\n\nResumo: ${diagnostics.sourceEvents} na origem, ${eligible} elegíveis, ${migrated} migradas, ${skipped} falharam.`;
    }
    return { text, autoClearMs: 8_000 };
  }
  if (skipped > 0) {
    let text = `Nenhuma tarefa foi migrada com sucesso de ${sourceDateKey} para ${targetDateKey}.\n${skipped} tarefa(s) falharam.`;
    if (failSamples.length) {
      text += "\nExemplos:";
      for (const s of failSamples.slice(0, 3)) text += `\n— ${s}`;
    } else {
      text += "\nConfira os logs do servidor para detalhes.";
    }
    if (diagnostics && typeof diagnostics.sourceEvents === "number") {
      text += `\n\nResumo: ${diagnostics.sourceEvents} na origem, ${eligible} elegíveis.`;
    }
    return { text, autoClearMs: 10_000 };
  }
  let text = `Nenhuma tarefa elegível em ${sourceDateKey}.`;
  if (diagnostics && typeof diagnostics.sourceEvents === "number") {
    text += `\n\nNa origem (${sourceDateKey}):\n— Total de eventos (editáveis): ${diagnostics.sourceEvents}`;
    text += `\n— Com horário, pendentes: ${diagnostics.pendingEvents ?? 0}`;
    text += `\n— Concluídos (verde): ${diagnostics.completedEvents ?? 0}`;
    text += `\n— Dia inteiro: ${diagnostics.allDayEvents ?? 0}`;
    text += `\n— Elegíveis com horário: ${diagnostics.eligibleTimed ?? 0}`;
    text += `\n— Elegíveis dia inteiro: ${diagnostics.eligibleAllDay ?? 0}`;
  }
  return { text, autoClearMs: 10_000 };
}

interface CalendarViewProps {
  initialDate?: string;
}

export function CalendarView({ initialDate }: CalendarViewProps) {
  const router = useRouter();
  const [view, setView] = useState<View>("day");
  const [showDashboard, setShowDashboard] = useState(false);
  const [showWeeklyReview, setShowWeeklyReview] = useState(false);
  const [dayDisplayMode, setDayDisplayMode] = useState<"grid" | "list" | "calendar" | "priority">("list");
  const [multiDayDisplayMode, setMultiDayDisplayMode] = useState<"grid" | "list">("grid");
  const [currentDate, setCurrentDate] = useState(() =>
    initialDate ? new Date(initialDate) : new Date()
  );
  const [tasks, setTasks] = useState<FlowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<FlowTask | null>(null);
  const [formDefaults, setFormDefaults] = useState<Partial<ParsedEvent> & { startTime?: string; endTime?: string }>({});
  const [showVoiceCapture, setShowVoiceCapture] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);
  const [manualSourceDate, setManualSourceDate] = useState("");
  const [manualTargetDate, setManualTargetDate] = useState("");
  const [migrationIncludeAllDay, setMigrationIncludeAllDay] = useState(true);
  const [selectedTask, setSelectedTask] = useState<FlowTask | null>(null);
  const [eventAnchor, setEventAnchor] = useState<EventAnchorPoint | null>(null);
  const [googleConnected, setGoogleConnected] = useState<boolean | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FlowTask[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchDropdownPos, setSearchDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);
  const searchDropdownRef = useRef<HTMLDivElement | null>(null);
  const [migrationMenuOpen, setMigrationMenuOpen] = useState(false);
  const [migrationMenuPos, setMigrationMenuPos] = useState<{ top: number; right: number } | null>(null);
  const migrationMenuRef = useRef<HTMLDivElement | null>(null);
  const migrationButtonRef = useRef<HTMLButtonElement | null>(null);
  const migrateResultClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoPillarPatchedRef = useRef<Set<string>>(new Set());
  const [autoMigrationStatus, setAutoMigrationStatus] = useState<{
    state: "idle" | "running" | "success" | "error";
    finishedAt?: string;
    migrated?: number;
    error?: string;
    diagnostics?: { targetDateKey?: string };
  } | null>(null);
  const [pushStatus, setPushStatus] = useState<PushStatus>("default");
  const [pushActive, setPushActive] = useState(false);
  const [pushModalOpen, setPushModalOpen] = useState(false);
  const pushButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pushModalPos, setPushModalPos] = useState<{ top: number; right: number } | null>(null);

  function scheduleMigrateResultClear(ms: number) {
    if (migrateResultClearRef.current) clearTimeout(migrateResultClearRef.current);
    migrateResultClearRef.current = setTimeout(() => {
      setMigrateResult(null);
      migrateResultClearRef.current = null;
    }, ms);
  }

  const fetchTasks = useCallback(async (opts?: { background?: boolean }) => {
    const silent = opts?.background === true;
    if (!silent) setLoading(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    let startDate: Date, endDate: Date;
    if (view === "day") {
      startDate = startOfDay(currentDate);
      endDate = endOfDay(currentDate);
    } else if (view === "3days") {
      startDate = startOfDay(currentDate);
      endDate = endOfDay(addDays(currentDate, 2));
    } else if (view === "week") {
      startDate = startOfWeek(currentDate, { weekStartsOn: 1 });
      endDate = endOfWeek(currentDate, { weekStartsOn: 1 });
    } else {
      startDate = startOfWeek(startOfMonth(currentDate), { weekStartsOn: 1 });
      endDate = endOfWeek(endOfMonth(currentDate), { weekStartsOn: 1 });
    }

    try {
      const res = await fetch(
        `/api/tasks?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&tz=${encodeURIComponent(tz)}`
      );
      if (res.status === 401) { router.replace("/sign-in"); return; }
      if (res.ok) setTasks(await res.json());
    } finally {
      if (!silent) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, view, format(currentDate, "yyyy-MM-dd")]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

  // Auto-persiste o pilar para eventos de calendários mapeados que ainda não têm flowPillar salvo
  useEffect(() => {
    const toPatch = tasks.filter((t) => {
      if (t.isComplete || autoPillarPatchedRef.current.has(t.id)) return false;
      const expectedPillar = CALENDAR_PILLAR_OVERRIDES[t.calendarName ?? ""];
      return expectedPillar && t.pillar === expectedPillar;
    });
    if (toPatch.length === 0) return;
    toPatch.forEach((t) => autoPillarPatchedRef.current.add(t.id));
    toPatch.forEach((t) => {
      fetch(`/api/tasks/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pillar: CALENDAR_PILLAR_OVERRIDES[t.calendarName ?? ""], calendarId: t.calendarId ?? "primary" }),
      }).catch(() => {});
    });
  }, [tasks]);

  useEffect(() => {
    fetch("/api/google-status")
      .then((r) => r.json())
      .then((data) => setGoogleConnected(data.connected === true))
      .catch(() => setGoogleConnected(false));
  }, []);

  useEffect(() => {
    const status = getPushStatus();
    setPushStatus(status);
    if (status === "granted") {
      getActiveSubscription().then((sub) => setPushActive(!!sub));
    }
  }, []);

  useEffect(() => {
    async function checkAndRecoverMigration() {
      try {
        const res = await fetch("/api/cron/migrate/status");
        if (!res.ok) return;
        const status = await res.json();
        setAutoMigrationStatus(status);

        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const todayKey = new Date().toLocaleDateString("sv-SE", { timeZone: tz });
        const alreadyCoveredToday =
          (status.state === "success" || status.state === "running") &&
          status.diagnostics?.targetDateKey === todayKey;

        if (!alreadyCoveredToday) {
          const migrateRes = await fetch("/api/cron/migrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tz }),
          });
          if (migrateRes.ok) {
            const newStatusRes = await fetch("/api/cron/migrate/status");
            if (newStatusRes.ok) setAutoMigrationStatus(await newStatusRes.json());
            fetchTasks({ background: true });
          }
        }
      } catch {
        // falha silenciosa — não interrompe o uso do app
      }
    }
    checkAndRecoverMigration();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function navigate(dir: "prev" | "next") {
    const delta = dir === "prev" ? -1 : 1;
    setCurrentDate((prev) => {
      const d = new Date(prev);
      if (view === "day") d.setDate(d.getDate() + delta);
      else if (view === "3days") d.setDate(d.getDate() + 3 * delta);
      else if (view === "week") d.setDate(d.getDate() + 7 * delta);
      else d.setMonth(d.getMonth() + delta);
      return d;
    });
  }

  function goToDate(date: Date) {
    setCurrentDate(date);
    setView("day");
    setSelectedTask(null);
    setEventAnchor(null);
  }

  function openEventCard(task: FlowTask, anchor: EventAnchorPoint) {
    setSelectedTask(task);
    setEventAnchor(anchor);
  }

  function closeEventCard() {
    setSelectedTask(null);
    setEventAnchor(null);
  }

  async function handleComplete(task: FlowTask, scope?: "this" | "thisAndFollowing" | "all") {
    const newComplete = !task.isComplete;
    const effectiveScope = scope ?? "this";
    // Optimistic update apenas para scope "this"; outros escopos afetam a série inteira — refetch após
    if (effectiveScope === "this") {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isComplete: newComplete } : t));
    }
    setPendingIds((p) => new Set(p).add(task.id));
    try {
      const body: Record<string, unknown> = {
        isComplete: newComplete,
        calendarId: task.calendarId ?? "primary",
      };
      if (newComplete && effectiveScope !== "this") body.completeScope = effectiveScope;
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) {
        router.replace("/sign-in");
        return;
      }
      if (!res.ok) throw new Error("Failed to toggle completion");
      if (effectiveScope !== "this") await fetchTasks({ background: true });
    } catch {
      // Revert optimistic state when the server rejects the update.
      if (effectiveScope === "this") {
        setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isComplete: task.isComplete } : t));
      }
      setMigrateResult("Não foi possível salvar. Verifique o acesso ao calendário.");
      scheduleMigrateResultClear(4_000);
    } finally {
      setPendingIds((p) => { const n = new Set(p); n.delete(task.id); return n; });
    }
  }

  async function handleImportant(task: FlowTask, scope: "this" | "all" = "this") {
    const newImportant = !task.isImportant;
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isImportant: newImportant } : t));
    setPendingIds((p) => new Set(p).add(task.id));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isImportant: newImportant, calendarId: task.calendarId ?? "primary", scope }),
      });
      if (res.status === 401) {
        router.replace("/sign-in");
        return;
      }
      if (!res.ok) throw new Error("Failed to toggle important");
    } catch {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isImportant: task.isImportant } : t));
      setMigrateResult("Não foi possível salvar. Verifique o acesso ao calendário.");
      scheduleMigrateResultClear(4_000);
    } finally {
      setPendingIds((p) => { const n = new Set(p); n.delete(task.id); return n; });
    }
  }

  async function handleSetTag(task: FlowTask, tag: "O" | "E" | "D" | null, scope: "this" | "all" = "this") {
    const newCategory = tag === "O" ? "operational" : tag === "E" ? "strategic" : undefined;
    const newDelegable = tag === "D";
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, category: newCategory, isDelegable: newDelegable } : t));
    setPendingIds((p) => new Set(p).add(task.id));
    const calendarId = task.calendarId ?? "primary";
    try {
      for (const body of [
        { category: newCategory ?? null, calendarId, scope },
        { isDelegable: newDelegable, calendarId, scope },
      ]) {
        const res = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.status === 401) { router.replace("/sign-in"); return; }
        if (!res.ok) throw new Error("Failed");
      }
    } catch {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, category: task.category, isDelegable: task.isDelegable } : t));
      setMigrateResult("Não foi possível salvar. Verifique o acesso ao calendário.");
      scheduleMigrateResultClear(4_000);
    } finally {
      setPendingIds((p) => { const n = new Set(p); n.delete(task.id); return n; });
    }
  }

  async function handleSetPillar(task: FlowTask, pillar: Pillar | null, scope: "this" | "all" = "this") {
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, pillar: pillar ?? undefined } : t));
    setPendingIds((p) => new Set(p).add(task.id));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pillar, calendarId: task.calendarId ?? "primary", scope }),
      });
      if (res.status === 401) { router.replace("/sign-in"); return; }
      if (!res.ok) throw new Error("Failed");
    } catch {
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, pillar: task.pillar } : t));
      setMigrateResult("Não foi possível salvar. Verifique o acesso ao calendário.");
      scheduleMigrateResultClear(4_000);
    } finally {
      setPendingIds((p) => { const n = new Set(p); n.delete(task.id); return n; });
    }
  }

  async function handleSave(data: CreateTaskInput | UpdateTaskInput) {
    if (editingTask) {
      const res = await fetch(`/api/tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, calendarId: editingTask.calendarId ?? "primary" }),
      });
      if (!res.ok) throw new Error();
    } else {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error();
    }
    await fetchTasks();
  }

  async function handleDelete(task: FlowTask, scope: "this" | "thisAndFollowing" | "all" = "this") {
    closeEventCard();
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    const calId = encodeURIComponent(task.calendarId ?? "primary");
    await fetch(`/api/tasks/${task.id}?calendarId=${calId}&deleteScope=${scope}`, { method: "DELETE" });
    await fetchTasks();
  }

  async function handleMove(task: FlowTask, newStart: Date, newEnd: Date) {
    // Optimistic update
    setTasks((prev) => prev.map((t) =>
      t.id === task.id
        ? { ...t, startTime: newStart.toISOString(), endTime: newEnd.toISOString() }
        : t
    ));
    setPendingIds((p) => new Set(p).add(task.id));
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startTime: newStart.toISOString(),
          endTime: newEnd.toISOString(),
          calendarId: task.calendarId ?? "primary",
        }),
      });
    } finally {
      setPendingIds((p) => { const n = new Set(p); n.delete(task.id); return n; });
      await fetchTasks();
    }
  }

  async function handleInlineEdit(task: FlowTask, updates: UpdateTaskInput) {
    const calendarId = updates.targetCalendarId ?? updates.calendarId ?? task.calendarId ?? "primary";
    const { isImportant, isDelegable, category, pillar, ...baseUpdates } = updates;

    const patch = async (body: Record<string, unknown>) => {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, calendarId }),
      });
      if (!res.ok) throw new Error("Failed to update event");
    };

    await patch(baseUpdates);

    if (isImportant !== undefined && isImportant !== task.isImportant) {
      await patch({ isImportant });
    }
    if (isDelegable !== undefined || category !== undefined) {
      const tagChanged =
        isDelegable !== task.isDelegable || category !== (task.category ?? null);
      if (tagChanged) {
        if (isDelegable !== undefined) await patch({ isDelegable });
        if (category !== undefined) await patch({ category });
      }
    }
    if (pillar !== undefined && pillar !== (task.pillar ?? null)) {
      await patch({ pillar });
    }

    await fetchTasks();
  }

  async function handleManualMigration() {
    const fromDate = manualSourceDate.trim();
    const toDate = manualTargetDate.trim();
    if (!fromDate || !toDate) {
      setMigrateResult("Selecione data de origem e data de destino para migrar.");
      scheduleMigrateResultClear(4_000);
      return;
    }
    if (fromDate === toDate) {
      setMigrateResult("A origem e o destino não podem ser a mesma data.");
      scheduleMigrateResultClear(4_000);
      return;
    }

    setMigrating(true);
    setMigrateResult(null);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Sao_Paulo";
      const payload = {
        fromDate,
        toDate,
        tz,
        includeCompleted: false,
        includeAllDay: migrationIncludeAllDay,
      };
      const res = await fetch("/api/cron/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        router.replace("/sign-in");
        return;
      }
      if (!res.ok) {
        const errMsg =
          typeof data.error === "string"
            ? `Erro ao migrar: ${data.error}`
            : "Erro ao migrar. Tente novamente.";
        setMigrateResult(errMsg);
        scheduleMigrateResultClear(errMsg.length > 80 ? 8_000 : 5_000);
        return;
      }

      const migrated = Number(data.migrated ?? 0);
      const skipped = Number(data.skipped ?? 0);
      const sourceDateKey = typeof data?.diagnostics?.sourceDateKey === "string"
        ? data.diagnostics.sourceDateKey
        : fromDate;
      const targetDateKey = typeof data?.diagnostics?.targetDateKey === "string"
        ? data.diagnostics.targetDateKey
        : toDate;
      const diagnosticsRaw = data?.diagnostics as MigrationDiagnosticsPayload | undefined;
      const { text, autoClearMs } = buildManualMigrationMessage(
        migrated,
        skipped,
        sourceDateKey,
        targetDateKey,
        diagnosticsRaw,
        data.details
      );
      setMigrateResult(text);
      scheduleMigrateResultClear(autoClearMs);
      if (migrated > 0 && sourceDateKey) {
        setTasks((prev) =>
          prev.filter((t) => format(new Date(t.startTime), "yyyy-MM-dd") !== sourceDateKey)
        );
      }
      await fetchTasks({ background: true });
      setMigrationMenuOpen(false);
      setTimeout(() => {
        void fetchTasks({ background: true });
      }, 2500);
    } catch {
      setMigrateResult("Erro ao migrar. Tente novamente.");
      scheduleMigrateResultClear(5_000);
    } finally {
      setMigrating(false);
    }
  }

  function openSearchResult(task: FlowTask) {
    const start = new Date(task.startTime);
    setCurrentDate(start);
    setView("day");
    setSelectedTask(task);
    setEventAnchor({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    setSearchOpen(false);
  }

  useEffect(() => {
    if (!selectedTask) return;
    const updated = tasks.find((t) => t.id === selectedTask.id);
    if (updated) setSelectedTask(updated);
  }, [selectedTask, tasks]);

  useEffect(() => {
    const term = searchQuery.trim();
    if (!term) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const res = await fetch(
          `/api/tasks?q=${encodeURIComponent(term)}&limit=80&tz=${encodeURIComponent(tz)}`
        );
        if (res.status === 401) {
          router.replace("/sign-in");
          return;
        }
        if (!res.ok) throw new Error("Failed to search events");
        const data: FlowTask[] = await res.json();
        const normalize = (s: string) =>
          s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
        const words = normalize(term).split(/\s+/).filter(Boolean);
        const filtered = data.filter((t) => {
          const hay = normalize(`${t.title ?? ""} ${t.description ?? ""}`);
          return words.every((w) => hay.includes(w));
        });
        const ordered = filtered.sort(
          (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
        );
        setSearchResults(ordered);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [router, searchQuery]);

  useEffect(
    () => () => {
      if (migrateResultClearRef.current) clearTimeout(migrateResultClearRef.current);
    },
    []
  );

  useEffect(() => {
    if (!searchOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSearchOpen(false);
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        !searchContainerRef.current?.contains(target) &&
        !searchDropdownRef.current?.contains(target)
      ) setSearchOpen(false);
    }

    window.addEventListener("keydown", handleEscape);
    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [searchOpen]);

  useEffect(() => {
    if (!migrationMenuOpen) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMigrationMenuOpen(false);
    }

    function handleOutsideClick(event: MouseEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (
        !migrationMenuRef.current?.contains(target) &&
        !migrationButtonRef.current?.contains(target)
      ) setMigrationMenuOpen(false);
    }

    window.addEventListener("keydown", handleEscape);
    window.addEventListener("mousedown", handleOutsideClick);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [migrationMenuOpen]);

  function openCreateForm(time?: Date) {
    setEditingTask(null);
    if (time) {
      const end = new Date(time);
      end.setHours(end.getHours() + 1);
      setFormDefaults({ startTime: time.toISOString(), endTime: end.toISOString() });
    } else {
      setFormDefaults({});
    }
    setShowForm(true);
  }

  function handleVoiceResult(parsed: ParsedEvent) {
    setEditingTask(null);
    setFormDefaults(parsed);
    setShowVoiceCapture(false);
    setShowForm(true);
  }

  const VIEW_LABELS: Record<View, string> = {
    day: "Dia",
    "3days": "3 dias",
    week: "Semana",
    month: "Mês",
  };

  const dateLabel = (() => {
    if (view === "day") {
      const prefix = isToday(currentDate) ? "Hoje • " : "";
      return `${prefix}${format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR })}`;
    }
    if (view === "3days") {
      const end = addDays(currentDate, 2);
      return `${format(currentDate, "EEE, d MMM", { locale: ptBR })} — ${format(end, "EEE, d MMM", { locale: ptBR })}`;
    }
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
      const we = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(ws, "d MMM")} — ${format(we, "d MMM", { locale: ptBR })}`;
    }
    return format(currentDate, "MMMM yyyy", { locale: ptBR });
  })();

  const overlayOpen = showForm || !!selectedTask;

  return (
    <div className="h-svh bg-[#202124] flex flex-col">
      {/* Banner: Google Calendar não conectado */}
      {googleConnected === false && (
        <div className="flex-shrink-0 bg-[#3c2a00] border-b border-[#fdd663]/30 px-4 py-2.5 flex items-center gap-3">
          <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#fdd663] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-xs text-[#fdd663] flex-1">Google Calendar não conectado.</p>
          <button
            onClick={() => signIn("google", { callbackUrl: "/today" })}
            className="text-xs font-medium text-[#fdd663] underline underline-offset-2 hover:text-yellow-300 whitespace-nowrap"
          >
            Conectar agora
          </button>
        </div>
      )}
      {/* Header */}
      <div className="flex-shrink-0 bg-[#202124] border-b border-[#3c4043] relative z-10">
        <div className="flex items-center justify-between gap-2 px-3 py-3">
          <div className="flex items-center">
            <button onClick={() => navigate("prev")}
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:bg-[#2a2b2e] transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button onClick={() => setCurrentDate(new Date())} className="w-56 text-center px-1">
              <p className="text-sm font-medium text-[#e8eaed] capitalize truncate">{dateLabel}</p>
            </button>

            <button onClick={() => navigate("next")}
              className="w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:bg-[#2a2b2e] transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Calendário */}
            <button
              onClick={() => { setShowDashboard(false); setShowWeeklyReview(false); }}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                !showDashboard && !showWeeklyReview
                  ? "bg-[#3c4043] text-[#e8eaed]"
                  : "text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2a2b2e]"
              }`}
              aria-label="Calendário"
              title="Calendário"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>

            {/* Dashboard */}
            <button
              onClick={() => { setShowDashboard(true); setShowWeeklyReview(false); }}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                showDashboard && !showWeeklyReview
                  ? "bg-[#3c4043] text-[#e8eaed]"
                  : "text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2a2b2e]"
              }`}
              aria-label="Painel de desempenho"
              title="Painel de desempenho"
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </button>

            {/* Revisão Semanal */}
            {(() => {
              const isFriday = new Date().getDay() === 5;
              return (
                <button
                  onClick={() => { setShowWeeklyReview(true); setShowDashboard(false); }}
                  className={`relative w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                    showWeeklyReview
                      ? "bg-[#3c4043] text-[#e8eaed]"
                      : "text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2a2b2e]"
                  }`}
                  aria-label="Revisão semanal"
                  title="Revisão semanal"
                >
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  {isFriday && !showWeeklyReview && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#a78bfa]" />
                  )}
                </button>
              );
            })()}

            {/* Notificações Push */}
            <button
              ref={pushButtonRef}
              type="button"
              onClick={() => {
                if (pushButtonRef.current) {
                  const rect = pushButtonRef.current.getBoundingClientRect();
                  setPushModalPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                }
                setPushModalOpen((prev) => !prev);
              }}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                pushActive
                  ? "text-[#8ab4f8] bg-[#8ab4f8]/10"
                  : "text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2a2b2e]"
              }`}
              aria-label="Notificações"
              title="Notificações push"
            >
              {pushActive ? (
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                  <path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 002 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z"/>
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              )}
            </button>

            {/* Migração (3 pontos) */}
            <div className="relative">
              <button
                ref={migrationButtonRef}
                type="button"
                onClick={() => {
                  if (!migrationMenuOpen && migrationButtonRef.current) {
                    const rect = migrationButtonRef.current.getBoundingClientRect();
                    setMigrationMenuPos({ top: rect.bottom + 8, right: window.innerWidth - rect.right });
                  }
                  setMigrationMenuOpen((prev) => !prev);
                }}
                className="w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors"
                aria-label="Ações avançadas"
                title="Ações avançadas"
              >
                <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 5.25a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm0 8a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5zm0 8a1.25 1.25 0 110-2.5 1.25 1.25 0 010 2.5z" />
                </svg>
              </button>

              {migrationMenuOpen && migrationMenuPos && createPortal(
                <div
                  ref={migrationMenuRef}
                  className="fixed w-72 rounded-lg border border-[#3c4043] bg-[#202124] shadow-xl shadow-black/40 p-3 z-[9999]"
                  style={{ top: migrationMenuPos.top, right: migrationMenuPos.right }}
                >
                  {/* Status da migração automática */}
                  <div className="mb-3 pb-3 border-b border-[#3c4043]">
                    <p className="text-xs font-medium text-[#9aa0a6] mb-1.5">Migração automática</p>
                    {!autoMigrationStatus || autoMigrationStatus.state === "idle" ? (
                      <p className="text-[11px] text-[#9aa0a6]">Ainda não executou desde o último boot.</p>
                    ) : autoMigrationStatus.state === "running" ? (
                      <div className="flex items-center gap-1.5 text-[11px] text-[#fdd663]">
                        <div className="w-2 h-2 rounded-full bg-[#fdd663] animate-pulse" />
                        Executando...
                      </div>
                    ) : autoMigrationStatus.state === "error" ? (
                      <div className="flex items-start gap-1.5 text-[11px] text-[#f28b82]">
                        <div className="w-2 h-2 mt-0.5 rounded-full bg-[#f28b82] flex-shrink-0" />
                        <span>Falhou: {autoMigrationStatus.error ?? "erro desconhecido"}</span>
                      </div>
                    ) : (
                      <div className="flex items-start gap-1.5 text-[11px] text-[#81c995]">
                        <div className="w-2 h-2 mt-0.5 rounded-full bg-[#81c995] flex-shrink-0" />
                        <span>
                          {autoMigrationStatus.migrated ?? 0} evento(s) migrado(s)
                          {autoMigrationStatus.finishedAt
                            ? ` · ${new Date(autoMigrationStatus.finishedAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
                            : ""}
                        </span>
                      </div>
                    )}
                  </div>
                  <p className="text-xs font-medium text-[#e8eaed] mb-2">Migração manual</p>
                  <div className="space-y-2">
                    <label htmlFor="manual-migration-source" className="block text-[11px] text-[#9aa0a6]">
                      Origem
                    </label>
                    <input
                      id="manual-migration-source"
                      type="date"
                      value={manualSourceDate}
                      onChange={(event) => setManualSourceDate(event.target.value)}
                      className="h-8 w-full rounded-md border border-[#3c4043] bg-[#2a2b2e] px-2 text-[11px] text-[#e8eaed] outline-none focus:border-[#8ab4f8]"
                      aria-label="Data de origem da migração"
                    />
                    <label htmlFor="manual-migration-target" className="block text-[11px] text-[#9aa0a6]">
                      Destino
                    </label>
                    <input
                      id="manual-migration-target"
                      type="date"
                      value={manualTargetDate}
                      onChange={(event) => setManualTargetDate(event.target.value)}
                      className="h-8 w-full rounded-md border border-[#3c4043] bg-[#2a2b2e] px-2 text-[11px] text-[#e8eaed] outline-none focus:border-[#8ab4f8]"
                      aria-label="Data de destino da migração"
                    />
                    <label className="flex items-start gap-2 text-[11px] text-[#e8eaed] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={migrationIncludeAllDay}
                        onChange={(e) => setMigrationIncludeAllDay(e.target.checked)}
                        className="mt-0.5 rounded border-[#3c4043]"
                        aria-label="Incluir eventos de dia inteiro na migração"
                      />
                      <span>Incluir dia inteiro</span>
                    </label>
                    <button
                      onClick={handleManualMigration}
                      disabled={migrating || !manualSourceDate || !manualTargetDate || manualSourceDate === manualTargetDate}
                      title="Migrar tarefas conforme as opções marcadas entre origem e destino"
                      aria-label="Migrar tarefas entre as datas escolhidas"
                      className="w-full h-8 rounded-md border border-[#3c4043] text-xs font-medium text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors disabled:opacity-40 disabled:hover:bg-transparent flex items-center justify-center"
                    >
                      {migrating
                        ? <div className="w-3.5 h-3.5 border-2 border-[#5f6368]/40 border-t-[#e8eaed] rounded-full animate-spin" />
                        : "Migrar"}
                    </button>
                    <p className="text-[10px] text-[#9aa0a6] leading-snug pt-1">
                      As opções definem o escopo da migração manual. O cron noturno continua migrando só tarefas com
                      horário, pendentes (sem verde) e sem dia inteiro.
                    </p>
                  </div>
                </div>,
                document.body
              )}
            </div>

            {/* Modal de Notificações Push */}
            {pushModalOpen && pushModalPos && typeof document !== "undefined" && createPortal(
              <>
                <div className="fixed inset-0 z-[4500]" onClick={() => setPushModalOpen(false)} />
                <div
                  className="fixed z-[4600] w-64 bg-[#2a2b2e] border border-[#3c4043] rounded-xl shadow-2xl p-4 space-y-3 text-sm"
                  style={{ top: pushModalPos.top, right: pushModalPos.right }}
                >
                  <p className="text-xs font-medium text-[#e8eaed]">Notificações Push</p>
                  {pushStatus === "unsupported" && (
                    <p className="text-[11px] text-[#9aa0a6] leading-snug">
                      Seu navegador não suporta notificações push. Use Chrome ou Safari (iOS 16.4+ com app na tela inicial).
                    </p>
                  )}
                  {pushStatus === "denied" && (
                    <p className="text-[11px] text-[#9aa0a6] leading-snug">
                      Notificações bloqueadas. Reative nas configurações do navegador e recarregue a página.
                    </p>
                  )}
                  {(pushStatus === "default" || (pushStatus === "granted" && !pushActive)) && (
                    <>
                      <p className="text-[11px] text-[#9aa0a6] leading-snug">
                        Receba alertas 10 minutos antes de cada evento, mesmo com o app em background.
                      </p>
                      <p className="text-[11px] text-[#9aa0a6] leading-snug">
                        📱 iPhone: abra no Safari → Compartilhar → &quot;Adicionar à Tela de Início&quot; antes de ativar.
                      </p>
                      <button
                        onClick={async () => {
                          const ok = await registerPush();
                          if (ok) {
                            setPushActive(true);
                            setPushStatus("granted");
                            setPushModalOpen(false);
                            setMigrateResult("Notificações ativadas!");
                          } else {
                            setMigrateResult("Não foi possível ativar as notificações. Verifique as permissões do navegador.");
                          }
                        }}
                        className="w-full py-2 rounded-lg bg-[#8ab4f8] text-[#202124] text-xs font-medium hover:bg-[#93bbf8] transition-colors"
                      >
                        Ativar notificações
                      </button>
                    </>
                  )}
                  {pushStatus === "granted" && pushActive && (
                    <>
                      <p className="text-[11px] text-[#9aa0a6] leading-snug">
                        Notificações ativas neste dispositivo. Você receberá alertas 10 min antes de cada evento.
                      </p>
                      <button
                        onClick={async () => {
                          const res = await fetch("/api/push/test", { method: "POST" });
                          const data = await res.json();
                          setPushModalOpen(false);
                          setMigrateResult(res.ok ? `Notificação de teste enviada para ${data.sent} dispositivo(s)!` : "Erro ao enviar teste.");
                        }}
                        className="w-full py-2 rounded-lg border border-[#3c4043] text-[#e8eaed] text-xs font-medium hover:bg-[#3c4043] transition-colors"
                      >
                        Enviar notificação de teste
                      </button>
                      <button
                        onClick={async () => {
                          await unregisterPush();
                          setPushActive(false);
                          setPushModalOpen(false);
                          setMigrateResult("Notificações desativadas neste dispositivo.");
                        }}
                        className="w-full py-2 rounded-lg border border-[#f28b82]/40 text-[#f28b82] text-xs font-medium hover:bg-[#f28b82]/10 transition-colors"
                      >
                        Desativar notificações
                      </button>
                    </>
                  )}
                </div>
              </>,
              document.body
            )}

            <button onClick={() => signOut({ callbackUrl: "/sign-in" })}
              className="w-8 h-8 flex items-center justify-center text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </div>

        {/* Busca global */}
        <div className="px-3 pb-2.5">
          <div ref={searchContainerRef} className="relative">
            <label htmlFor="event-search" className="sr-only">Buscar eventos</label>
            <div className="h-10 rounded-lg border border-[#3c4043] bg-[#2a2b2e] flex items-center gap-2 px-3">
              <svg viewBox="0 0 24 24" className="w-4 h-4 text-[#9aa0a6]" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M10.5 18a7.5 7.5 0 100-15 7.5 7.5 0 000 15z" />
              </svg>
              <input
                id="event-search"
                type="text"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  if (searchContainerRef.current) {
                    const rect = searchContainerRef.current.getBoundingClientRect();
                    setSearchDropdownPos({ top: rect.bottom + 8, left: rect.left, width: rect.width });
                  }
                  setSearchOpen(true);
                }}
                onFocus={() => {
                  if (searchContainerRef.current) {
                    const rect = searchContainerRef.current.getBoundingClientRect();
                    setSearchDropdownPos({ top: rect.bottom + 8, left: rect.left, width: rect.width });
                  }
                  setSearchOpen(true);
                }}
                placeholder="Buscar em todos os eventos"
                className="flex-1 bg-transparent text-sm text-[#e8eaed] placeholder:text-[#9aa0a6] outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery("");
                    setSearchResults([]);
                    setSearchOpen(false);
                  }}
                  className="w-6 h-6 rounded-full text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#3c4043] transition-colors"
                  aria-label="Limpar busca"
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 mx-auto" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {searchOpen && searchQuery.trim() && searchDropdownPos && createPortal(
              <div
                ref={searchDropdownRef}
                className="fixed z-[9999] rounded-xl border border-[#3c4043] bg-[#202124] shadow-2xl shadow-black/40 overflow-hidden"
                style={{ top: searchDropdownPos.top, left: searchDropdownPos.left, width: searchDropdownPos.width }}
              >
                {searching ? (
                  <div className="px-4 py-5 text-sm text-[#9aa0a6] flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-[#8ab4f8]/30 border-t-[#8ab4f8] rounded-full animate-spin" />
                    Buscando eventos...
                  </div>
                ) : searchResults.length === 0 ? (
                  <div className="px-4 py-5 text-sm text-[#9aa0a6]">Nenhum evento encontrado.</div>
                ) : (
                  <div className="max-h-80 overflow-y-auto">
                    {searchResults.map((task) => (
                      <button
                        key={`${task.calendarId ?? "primary"}:${task.id}:${task.startTime}`}
                        type="button"
                        onClick={() => openSearchResult(task)}
                        className="w-full text-left px-4 py-3 border-b border-[#2f3133] last:border-b-0 hover:bg-[#2a2b2e] transition-colors"
                      >
                        <p className="text-sm font-medium text-[#e8eaed] truncate">{task.title}</p>
                        <p className="text-xs text-[#9aa0a6] mt-1">
                          {task.isAllDay
                            ? format(new Date(task.startTime), "dd/MM/yyyy", { locale: ptBR })
                            : format(new Date(task.startTime), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                          {task.calendarName ? ` • ${task.calendarName}` : ""}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </div>,
              document.body
            )}
          </div>
        </div>

        {!showDashboard && !showWeeklyReview && (
          <>
            {/* View switcher */}
            <div className="flex gap-1 px-3 pb-2.5">
              {(["day", "3days", "week", "month"] as View[]).map((v) => (
                <button key={v} onClick={() => setView(v)}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium transition-colors
                    ${view === v ? "bg-[#3c4043] text-[#e8eaed]" : "text-[#9aa0a6] hover:text-[#e8eaed]"}`}>
                  {VIEW_LABELS[v]}
                </button>
              ))}
            </div>

            {(view === "day" || view === "3days" || view === "week") && (
              <div className="px-3 pb-2.5">
                {view === "day" ? (
                  <div className="grid grid-cols-4 gap-1 rounded-md bg-[#2a2b2e] p-1 border border-[#3c4043]">
                    {(["list", "grid", "calendar", "priority"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setDayDisplayMode(m)}
                        className={`py-1.5 rounded text-xs font-medium transition-colors ${
                          dayDisplayMode === m ? "bg-[#3c4043] text-[#e8eaed]" : "text-[#9aa0a6] hover:text-[#e8eaed]"
                        }`}
                      >
                        {m === "list" ? "Lista" : m === "grid" ? "Grade" : m === "calendar" ? "Agenda" : "Prioridade"}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-1 rounded-md bg-[#2a2b2e] p-1 border border-[#3c4043]">
                    {(["list", "grid"] as const).map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setMultiDayDisplayMode(m)}
                        className={`py-1.5 rounded text-xs font-medium transition-colors ${
                          multiDayDisplayMode === m ? "bg-[#3c4043] text-[#e8eaed]" : "text-[#9aa0a6] hover:text-[#e8eaed]"
                        }`}
                      >
                        {m === "list" ? "Lista" : "Grade"}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Dashboard */}
      {showDashboard && !showWeeklyReview && <DashboardView onBack={() => setShowDashboard(false)} />}

      {/* Revisão Semanal */}
      {showWeeklyReview && <WeeklyReviewView />}

      {/* Loading */}
      {!showDashboard && !showWeeklyReview && loading && (
        <div className="flex justify-center items-center py-8">
          <div className="w-5 h-5 border-2 border-[#8ab4f8]/30 border-t-[#8ab4f8] rounded-full animate-spin" />
        </div>
      )}

      {/* Views */}
      {!showDashboard && !showWeeklyReview && !loading && view === "day" && (
        <DayView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={openEventCard}
          onDelete={handleDelete} onTimeClick={openCreateForm} onMove={handleMove}
          onImportant={handleImportant}
          displayMode={dayDisplayMode} />
      )}
      {!showDashboard && !showWeeklyReview && !loading && view === "3days" && (
        <ThreeDayView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={openEventCard}
          onDelete={handleDelete} onTimeClick={openCreateForm} onDayClick={goToDate}
          onImportant={handleImportant}
          displayMode={multiDayDisplayMode} />
      )}
      {!showDashboard && !showWeeklyReview && !loading && view === "week" && (
        <WeekView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={openEventCard}
          onDelete={handleDelete} onTimeClick={openCreateForm} onDayClick={goToDate}
          onImportant={handleImportant}
          displayMode={multiDayDisplayMode} />
      )}
      {!showDashboard && !showWeeklyReview && !loading && view === "month" && (
        <MonthView tasks={tasks} currentDate={currentDate} onDayClick={goToDate}
          onEventClick={openEventCard} onComplete={handleComplete} onImportant={handleImportant} />
      )}

      {/* FAB — hidden in dashboard/projects/review mode */}
      {!showDashboard && !showWeeklyReview && (
        <>
          {/* FAB voz IA */}
          <button
            onClick={() => setShowVoiceCapture(true)}
            title="Criar evento por voz com IA"
            className={`fixed bottom-[5.5rem] right-4 w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform backdrop-blur-md bg-[#a78bfa]/30 border border-[#a78bfa]/40 shadow-lg shadow-black/30 ${overlayOpen ? LAYERS.fabBehindOverlay : LAYERS.fab}`}
          >
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-white" fill="currentColor">
              <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3zM19 13.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" />
            </svg>
          </button>
          {/* FAB criar evento */}
          <button onClick={() => openCreateForm()}
            className={`fixed bottom-6 right-4 w-14 h-14 rounded-full flex items-center justify-center active:scale-95 transition-transform backdrop-blur-md bg-[#8ab4f8]/30 border border-[#8ab4f8]/40 shadow-lg shadow-black/30 ${overlayOpen ? LAYERS.fabBehindOverlay : LAYERS.fab}`}>
            <svg viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </>
      )}

      {/* Toast migração */}
      {migrateResult && (
        <div
          className={`fixed top-20 left-1/2 -translate-x-1/2 ${LAYERS.toast} max-w-[min(420px,calc(100vw-32px))] bg-[#2a2b2e] border border-[#3c4043] text-[#e8eaed] text-sm px-4 py-3 rounded-md shadow-lg whitespace-pre-line text-left`}
          role="status"
        >
          {migrateResult}
        </div>
      )}

      {showVoiceCapture && (
        <VoiceCaptureModal
          onResult={handleVoiceResult}
          onClose={() => setShowVoiceCapture(false)}
        />
      )}

      {showForm && (
        <TaskForm task={editingTask} currentDate={currentDate.toISOString()} defaults={formDefaults}
          onClose={() => { setShowForm(false); setEditingTask(null); setFormDefaults({}); }}
          onSave={handleSave}
          onComplete={handleComplete} />
      )}

      {selectedTask && (
        <EventPopover
          task={selectedTask}
          anchor={eventAnchor}
          pending={pendingIds.has(selectedTask.id)}
          onClose={closeEventCard}
          onSaveEdit={handleInlineEdit}
          onDelete={handleDelete}
          onToggleComplete={async (task, scope) => {
            await handleComplete(task, scope);
            if (!scope || scope === "this") closeEventCard();
          }}
          onToggleImportant={handleImportant}
          onSetTag={handleSetTag}
          onSetPillar={handleSetPillar}
        />
      )}
    </div>
  );
}
