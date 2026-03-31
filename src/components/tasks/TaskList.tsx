"use client";

import { useState, useOptimistic, useTransition, useEffect, useRef } from "react";
import { FlowTask, CreateTaskInput, UpdateTaskInput } from "@/types/task";
import { TaskBlock } from "./TaskBlock";
import { TaskForm } from "./TaskForm";
import { signOut } from "next-auth/react";
import { isToday } from "date-fns";

interface TaskListProps {
  initialTasks: FlowTask[];
  currentDate: string;
}

const DAY_START = 6;
const DAY_END   = 23;
const HOUR_PX   = 64;
const HOURS = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => i + DAY_START);

function timeToY(iso: string): number {
  const d = new Date(iso);
  return ((d.getHours() - DAY_START) + d.getMinutes() / 60) * HOUR_PX;
}

function durationToPx(startIso: string, endIso: string): number {
  const mins = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000;
  return Math.max((mins / 60) * HOUR_PX, 24);
}

function currentTimeY(): number {
  const now = new Date();
  return ((now.getHours() - DAY_START) + now.getMinutes() / 60) * HOUR_PX;
}

export function TaskList({ initialTasks, currentDate }: TaskListProps) {
  const [tasks, setTasks] = useState<FlowTask[]>(initialTasks);
  const [optimisticTasks, setOptimisticTask] = useOptimistic(tasks);
  const [, startTransition] = useTransition();
  const [showForm, setShowForm] = useState(false);
  const [editingTask, setEditingTask] = useState<FlowTask | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [nowY, setNowY] = useState(currentTimeY());
  const timelineRef = useRef<HTMLDivElement>(null);
  const isCurrentDay = isToday(new Date(currentDate));

  useEffect(() => {
    if (!isCurrentDay) return;
    const interval = setInterval(() => setNowY(currentTimeY()), 30000);
    return () => clearInterval(interval);
  }, [isCurrentDay]);

  useEffect(() => {
    if (!isCurrentDay || !timelineRef.current) return;
    timelineRef.current.scrollTop = Math.max(0, nowY - 120);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh() {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const date = currentDate.split("T")[0];
    const res = await fetch(`/api/tasks?tz=${encodeURIComponent(tz)}&date=${date}`);
    if (res.ok) setTasks(await res.json());
  }

  async function handleComplete(taskId: string) {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    const newComplete = !task.isComplete;

    startTransition(() => {
      setOptimisticTask((prev) =>
        prev.map((t) => (t.id === taskId ? { ...t, isComplete: newComplete } : t))
      );
    });

    setPendingIds((p) => new Set(p).add(taskId));
    try {
      await fetch(`/api/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isComplete: newComplete }),
      });
    } finally {
      setPendingIds((p) => { const n = new Set(p); n.delete(taskId); return n; });
      await refresh();
    }
  }

  async function handleSave(data: CreateTaskInput | UpdateTaskInput) {
    if (editingTask) {
      const res = await fetch(`/api/tasks/${editingTask.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
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
    await refresh();
  }

  async function handleDelete(taskId: string) {
    startTransition(() => {
      setOptimisticTask((prev) => prev.filter((t) => t.id !== taskId));
    });
    await fetch(`/api/tasks/${taskId}`, { method: "DELETE" });
    await refresh();
  }

  const timedTasks = optimisticTasks.filter((t) => !t.isAllDay);
  const allDayTasks = optimisticTasks.filter((t) => t.isAllDay);
  const completed = timedTasks.filter((t) => t.isComplete).length;
  const total = timedTasks.length;

  return (
    <>
      {/* Eventos dia inteiro + progresso */}
      <div className="px-4 pt-2 pb-2 space-y-2">
        {allDayTasks.map((t) => (
          <div
            key={t.id}
            onClick={() => { setEditingTask(t); setShowForm(true); }}
            className="flex items-center gap-2 px-3 py-2 rounded-xl bg-gray-800/50 border border-gray-700/40"
          >
            <button
              onClick={(e) => { e.stopPropagation(); handleComplete(t.id); }}
              className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                ${t.isComplete ? "bg-emerald-500 border-emerald-500" : "border-gray-500"}`}
            >
              {t.isComplete && (
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <span className={`text-xs ${t.isComplete ? "line-through text-gray-500" : "text-gray-300"}`}>
              {t.title}
            </span>
            <span className="ml-auto text-xs text-gray-700">dia inteiro</span>
          </div>
        ))}

        {total > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.round((completed / total) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-700 tabular-nums">{completed}/{total}</span>
          </div>
        )}
      </div>

      {/* Timeline */}
      <div
        ref={timelineRef}
        className="overflow-y-auto"
        style={{ height: "calc(100svh - 148px)" }}
      >
        <div
          className="relative"
          style={{
            height: `${(DAY_END - DAY_START + 1) * HOUR_PX}px`,
            marginLeft: "44px",
            marginRight: "16px",
          }}
        >
          {/* Grid de horas */}
          {HOURS.map((hour) => (
            <div
              key={hour}
              className="absolute left-0 right-0"
              style={{ top: `${(hour - DAY_START) * HOUR_PX}px` }}
            >
              <span className="absolute -left-10 -top-2.5 text-[11px] text-gray-700 w-8 text-right tabular-nums select-none">
                {String(hour).padStart(2, "0")}
              </span>
              <div className="w-full h-px bg-gray-800/60" />
            </div>
          ))}

          {/* Linha do tempo atual */}
          {isCurrentDay && nowY >= 0 && nowY <= (DAY_END - DAY_START) * HOUR_PX && (
            <div
              className="absolute left-0 right-0 flex items-center z-20 pointer-events-none"
              style={{ top: `${nowY}px` }}
            >
              <div className="w-2 h-2 rounded-full bg-red-500 -ml-1 flex-shrink-0" />
              <div className="flex-1 h-px bg-red-500/80" />
            </div>
          )}

          {/* Blocos de eventos */}
          {timedTasks.map((task) => (
            <TaskBlock
              key={task.id}
              task={task}
              top={timeToY(task.startTime)}
              height={durationToPx(task.startTime, task.endTime)}
              onComplete={() => handleComplete(task.id)}
              onEdit={() => { setEditingTask(task); setShowForm(true); }}
              onDelete={() => handleDelete(task.id)}
              isPending={pendingIds.has(task.id)}
            />
          ))}
        </div>
      </div>

      {/* FAB */}
      <button
        onClick={() => { setEditingTask(null); setShowForm(true); }}
        className="fixed bottom-6 right-4 w-14 h-14 bg-emerald-500 rounded-full shadow-lg shadow-emerald-500/20 flex items-center justify-center active:scale-95 transition-transform z-30"
        aria-label="Nova tarefa"
      >
        <svg viewBox="0 0 24 24" className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
        </svg>
      </button>

      {/* Sign out */}
      <button
        onClick={() => signOut({ callbackUrl: "/sign-in" })}
        className="fixed top-[72px] right-4 text-gray-700 hover:text-gray-400 z-20"
        aria-label="Sair"
      >
        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
        </svg>
      </button>

      {showForm && (
        <TaskForm
          task={editingTask}
          currentDate={currentDate}
          onClose={() => { setShowForm(false); setEditingTask(null); }}
          onSave={handleSave}
        />
      )}
    </>
  );
}
