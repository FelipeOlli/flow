"use client";

import { useState, useEffect, useCallback } from "react";
import { format, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isToday, addDays } from "date-fns";
import { ptBR } from "date-fns/locale";
import { signOut } from "next-auth/react";
import { useRouter } from "next/navigation";
import { FlowTask, CreateTaskInput, UpdateTaskInput } from "@/types/task";
import { DayView } from "./DayView";
import { ThreeDayView } from "./ThreeDayView";
import { WeekView } from "./WeekView";
import { MonthView } from "./MonthView";
import { EventPopover, EventAnchorPoint } from "./EventPopover";
import { TaskForm } from "@/components/tasks/TaskForm";

type View = "day" | "3days" | "week" | "month";

interface CalendarViewProps {
  initialDate?: string;
}

export function CalendarView({ initialDate }: CalendarViewProps) {
  const router = useRouter();
  const [view, setView] = useState<View>("day");
  const [currentDate, setCurrentDate] = useState(() =>
    initialDate ? new Date(initialDate) : new Date()
  );
  const [tasks, setTasks] = useState<FlowTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<FlowTask | null>(null);
  const [formDefaults, setFormDefaults] = useState<{ startTime?: string; endTime?: string }>({});
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<FlowTask | null>(null);
  const [eventAnchor, setEventAnchor] = useState<EventAnchorPoint | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
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
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, view, format(currentDate, "yyyy-MM-dd")]);

  useEffect(() => { fetchTasks(); }, [fetchTasks]);

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

  async function handleComplete(task: FlowTask) {
    const newComplete = !task.isComplete;
    setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isComplete: newComplete } : t));
    setPendingIds((p) => new Set(p).add(task.id));
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isComplete: newComplete, calendarId: task.calendarId ?? "primary" }),
      });
      if (res.status === 401) {
        router.replace("/sign-in");
        return;
      }
      if (!res.ok) throw new Error("Failed to toggle completion");
    } catch {
      // Revert optimistic state when the server rejects the update.
      setTasks((prev) => prev.map((t) => t.id === task.id ? { ...t, isComplete: task.isComplete } : t));
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

  async function handleDelete(task: FlowTask) {
    closeEventCard();
    setTasks((prev) => prev.filter((t) => t.id !== task.id));
    const calId = encodeURIComponent(task.calendarId ?? "primary");
    await fetch(`/api/tasks/${task.id}?calendarId=${calId}`, { method: "DELETE" });
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
    const res = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...updates, calendarId: task.calendarId ?? "primary" }),
    });
    if (!res.ok) throw new Error("Failed to update event");
    await fetchTasks();
  }

  async function handleManualMigration() {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await fetch("/api/cron/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: format(currentDate, "yyyy-MM-dd") }),
      });
      const data = await res.json();
      if (data.migrated === 0) {
        setMigrateResult("Nenhuma tarefa pendente para migrar.");
      } else {
        setMigrateResult(`${data.migrated} tarefa(s) migrada(s) para amanhã.`);
      }
      await fetchTasks();
    } catch {
      setMigrateResult("Erro ao migrar. Tente novamente.");
    } finally {
      setMigrating(false);
      setTimeout(() => setMigrateResult(null), 4000);
    }
  }

  useEffect(() => {
    if (!selectedTask) return;
    const updated = tasks.find((t) => t.id === selectedTask.id);
    if (updated) setSelectedTask(updated);
    else closeEventCard();
  }, [selectedTask, tasks]);

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

  const VIEW_LABELS: Record<View, string> = {
    day: "Dia",
    "3days": "3 dias",
    week: "Semana",
    month: "Mês",
  };

  const dateLabel = (() => {
    if (view === "day") return isToday(currentDate) ? "Hoje" : format(currentDate, "EEE, d MMM", { locale: ptBR });
    if (view === "3days") {
      const end = addDays(currentDate, 2);
      return `${format(currentDate, "d MMM")} — ${format(end, "d MMM", { locale: ptBR })}`;
    }
    if (view === "week") {
      const ws = startOfWeek(currentDate, { weekStartsOn: 1 });
      const we = endOfWeek(currentDate, { weekStartsOn: 1 });
      return `${format(ws, "d MMM")} — ${format(we, "d MMM", { locale: ptBR })}`;
    }
    return format(currentDate, "MMMM yyyy", { locale: ptBR });
  })();

  return (
    <div className="h-svh bg-[#202124] flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-[#202124] border-b border-[#3c4043]">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => navigate("prev")}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:bg-[#2a2b2e] transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button onClick={() => setCurrentDate(new Date())} className="flex-1 text-center">
            <p className="text-base font-medium text-[#e8eaed] capitalize">{dateLabel}</p>
          </button>

          <button onClick={() => navigate("next")}
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:bg-[#2a2b2e] transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Migrar pendentes */}
          <button
            onClick={handleManualMigration}
            disabled={migrating}
            title="Migrar tarefas pendentes para hoje"
            aria-label="Migrar tarefas pendentes para hoje"
            className="w-8 h-8 flex items-center justify-center rounded-full text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {migrating
              ? <div className="w-3.5 h-3.5 border-2 border-[#5f6368]/40 border-t-[#e8eaed] rounded-full animate-spin" />
              : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.9}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 4.75v2.5M17 4.75v2.5M4.75 9.5h14.5M6.5 7h11a1.75 1.75 0 011.75 1.75v9.75A1.75 1.75 0 0117.5 20.25h-11a1.75 1.75 0 01-1.75-1.75V8.75A1.75 1.75 0 016.5 7z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.5 14h5M12.5 11l2 3-2 3" />
                </svg>
            }
          </button>

          <button onClick={() => signOut({ callbackUrl: "/sign-in" })}
            className="w-8 h-8 flex items-center justify-center text-[#9aa0a6] hover:text-[#e8eaed] transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

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
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <div className="w-5 h-5 border-2 border-[#8ab4f8]/30 border-t-[#8ab4f8] rounded-full animate-spin" />
        </div>
      )}

      {/* Views */}
      {!loading && view === "day" && (
        <DayView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={openEventCard}
          onDelete={handleDelete} onTimeClick={openCreateForm} onMove={handleMove} />
      )}
      {!loading && view === "3days" && (
        <ThreeDayView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={openEventCard}
          onDelete={handleDelete} onTimeClick={openCreateForm} onDayClick={goToDate} />
      )}
      {!loading && view === "week" && (
        <WeekView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={openEventCard}
          onDelete={handleDelete} onTimeClick={openCreateForm} onDayClick={goToDate} />
      )}
      {!loading && view === "month" && (
        <MonthView tasks={tasks} currentDate={currentDate} onDayClick={goToDate}
          onEventClick={openEventCard} />
      )}

      {/* FAB */}
      <button onClick={() => openCreateForm()}
        className="fixed bottom-6 right-4 w-14 h-14 bg-[#8ab4f8] rounded-full shadow-lg shadow-black/30 flex items-center justify-center active:scale-95 transition-transform z-30">
        <svg viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Toast migração */}
      {migrateResult && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-[#2a2b2e] border border-[#3c4043] text-[#e8eaed] text-sm px-4 py-2.5 rounded-md shadow-lg whitespace-nowrap">
          {migrateResult}
        </div>
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
          onToggleComplete={async (task) => {
            await handleComplete(task);
            closeEventCard();
          }}
        />
      )}
    </div>
  );
}
