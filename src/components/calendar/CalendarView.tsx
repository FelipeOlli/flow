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

  async function handleManualMigration() {
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await fetch("/api/cron/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromDate: currentDate.toISOString() }),
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
    <div className="h-svh bg-gray-950 flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 bg-gray-950/95 backdrop-blur-sm border-b border-gray-900">
        <div className="flex items-center gap-2 px-3 py-3">
          <button onClick={() => navigate("prev")}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-800 active:bg-gray-700 transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>

          <button onClick={() => setCurrentDate(new Date())} className="flex-1 text-center">
            <p className="text-base font-semibold text-white capitalize">{dateLabel}</p>
          </button>

          <button onClick={() => navigate("next")}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-gray-800 active:bg-gray-700 transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Migrar pendentes */}
          <button
            onClick={handleManualMigration}
            disabled={migrating}
            title="Migrar tarefas pendentes para amanhã"
            className="w-8 h-8 flex items-center justify-center text-gray-700 hover:text-amber-400 transition-colors disabled:opacity-40"
          >
            {migrating
              ? <div className="w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
              : <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                </svg>
            }
          </button>

          <button onClick={() => signOut({ callbackUrl: "/sign-in" })}
            className="w-8 h-8 flex items-center justify-center text-gray-700 hover:text-gray-500 transition-colors">
            <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>

        {/* View switcher */}
        <div className="flex gap-1 px-3 pb-2.5">
          {(["day", "3days", "week", "month"] as View[]).map((v) => (
            <button key={v} onClick={() => setView(v)}
              className={`flex-1 py-1.5 rounded-xl text-xs font-medium transition-colors
                ${view === v ? "bg-gray-800 text-white" : "text-gray-600 hover:text-gray-500"}`}>
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center items-center py-8">
          <div className="w-5 h-5 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin" />
        </div>
      )}

      {/* Views */}
      {!loading && view === "day" && (
        <DayView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={(t) => { setEditingTask(t); setFormDefaults({}); setShowForm(true); }}
          onDelete={handleDelete} onTimeClick={openCreateForm} onMove={handleMove} />
      )}
      {!loading && view === "3days" && (
        <ThreeDayView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={(t) => { setEditingTask(t); setFormDefaults({}); setShowForm(true); }}
          onDelete={handleDelete} onTimeClick={openCreateForm} onDayClick={goToDate} />
      )}
      {!loading && view === "week" && (
        <WeekView tasks={tasks} currentDate={currentDate} pendingIds={pendingIds}
          onComplete={handleComplete} onEdit={(t) => { setEditingTask(t); setFormDefaults({}); setShowForm(true); }}
          onDelete={handleDelete} onTimeClick={openCreateForm} onDayClick={goToDate} />
      )}
      {!loading && view === "month" && (
        <MonthView tasks={tasks} currentDate={currentDate} onDayClick={goToDate}
          onEventClick={(t) => { setEditingTask(t); setFormDefaults({}); setShowForm(true); }} />
      )}

      {/* FAB */}
      <button onClick={() => openCreateForm()}
        className="fixed bottom-6 right-4 w-14 h-14 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/20 flex items-center justify-center active:scale-95 transition-transform z-30">
        <svg viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Toast migração */}
      {migrateResult && (
        <div className="fixed top-20 left-1/2 -translate-x-1/2 z-50 bg-gray-800 border border-gray-700 text-white text-sm px-4 py-2.5 rounded-2xl shadow-lg whitespace-nowrap">
          {migrateResult}
        </div>
      )}

      {showForm && (
        <TaskForm task={editingTask} currentDate={currentDate.toISOString()} defaults={formDefaults}
          onClose={() => { setShowForm(false); setEditingTask(null); setFormDefaults({}); }}
          onSave={handleSave}
          onComplete={handleComplete} />
      )}
    </div>
  );
}
