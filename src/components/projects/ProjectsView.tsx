"use client";

import { useEffect, useState, useCallback } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { EventAnchorPoint } from "@/components/calendar/EventPopover";

interface KanbanColumn {
  calendarId: string;
  calendarName: string;
  calendarBgColor: string;
  tasks: FlowTask[];
}

interface ProjectsViewProps {
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onComplete: (task: FlowTask) => Promise<void>;
}

function timeOpen(task: FlowTask): number {
  const ref = task.createdAt ?? task.startTime;
  if (!ref) return 0;
  return Date.now() - new Date(ref).getTime();
}

function formatTimeOpen(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes}min em aberto`;
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${hours}h em aberto`;
  const days = Math.floor(ms / 86_400_000);
  if (days < 7) return `${days}d em aberto`;
  const weeks = Math.floor(days / 7);
  return `${weeks}sem em aberto`;
}

function groupByCalendar(tasks: FlowTask[]): KanbanColumn[] {
  const map = new Map<string, KanbanColumn>();

  for (const task of tasks) {
    const key = task.calendarId ?? "primary";
    if (!map.has(key)) {
      map.set(key, {
        calendarId: key,
        calendarName: task.calendarName ?? "Principal",
        calendarBgColor: task.calendarBgColor ?? "#4285f4",
        tasks: [],
      });
    }
    map.get(key)!.tasks.push(task);
  }

  const cols = Array.from(map.values());

  for (const col of cols) {
    col.tasks.sort((a: FlowTask, b: FlowTask) => timeOpen(b) - timeOpen(a));
  }

  return cols.sort((a: KanbanColumn, b: KanbanColumn) =>
    a.calendarName.localeCompare(b.calendarName, "pt-BR")
  );
}

interface KanbanCardProps {
  task: FlowTask;
  pending: boolean;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
}

function KanbanCard({ task, pending, onComplete, onEdit }: KanbanCardProps) {
  const ms = timeOpen(task);
  const openLabel = formatTimeOpen(ms);
  const isOld = ms > 7 * 86_400_000;

  let dateLabel = "";
  if (!task.isAllDay && task.startTime) {
    try {
      dateLabel = format(parseISO(task.startTime), "HH:mm · dd/MM", { locale: ptBR });
    } catch { /* silencioso */ }
  } else if (task.isAllDay && task.startTime) {
    try {
      dateLabel = format(parseISO(task.startTime.slice(0, 10) + "T00:00:00"), "dd/MM", { locale: ptBR });
    } catch { /* silencioso */ }
  }

  return (
    <div
      className="bg-[#2a2b2e] rounded-lg border-l-4 shadow-sm"
      style={{ borderLeftColor: task.calendarBgColor ?? "#4285f4" }}
    >
      <div className="flex items-start">
        {/* Bullet de conclusão */}
        <button
          onClick={(e) => { e.stopPropagation(); onComplete(task); }}
          disabled={pending}
          className="flex items-start justify-center pt-3.5 px-3 shrink-0 group"
          aria-label="Marcar como concluído"
          title="Marcar como concluído"
        >
          <span
            className="w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors shrink-0"
            style={{ borderColor: task.calendarBgColor ?? "#4285f4", opacity: pending ? 0.5 : 1 }}
          >
            {pending && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#9aa0a6] animate-pulse" />
            )}
          </span>
        </button>

        {/* Corpo clicável — abre o evento */}
        <button
          onClick={(e) => {
            onEdit(task, { x: e.clientX, y: e.clientY });
          }}
          className="flex-1 text-left py-3 pr-3 min-w-0 w-0"
        >
        <p className="text-[#e8eaed] text-sm font-medium leading-snug line-clamp-2">
          {task.title}
        </p>

        <div className="mt-1.5 flex items-center gap-2">
          <span className={`text-[11px] font-medium ${isOld ? "text-red-400" : "text-[#9aa0a6]"}`}>
            {openLabel}
          </span>
          {task.isImportant && (
            <svg viewBox="0 0 24 24" className="w-3 h-3 fill-white shrink-0" aria-label="Importante">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
          )}
        </div>

        {dateLabel && (
          <p className="mt-1 text-[11px] text-[#9aa0a6]">{dateLabel}</p>
        )}
        </button>
      </div>
    </div>
  );
}

function ColumnSkeleton() {
  return (
    <div className="shrink-0 w-72 flex flex-col gap-2">
      <div className="h-8 bg-[#3c4043] rounded-lg animate-pulse" />
      {[1, 2, 3].map((i) => (
        <div key={i} className="h-20 bg-[#2a2b2e] rounded-lg animate-pulse" />
      ))}
    </div>
  );
}

export function ProjectsView({ onEdit, onComplete }: ProjectsViewProps) {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`/api/tasks/kanban?tz=${encodeURIComponent(tz)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Erro ao carregar projetos");
        return r.json() as Promise<FlowTask[]>;
      })
      .then((tasks) => {
        setColumns(groupByCalendar(tasks));
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  const handleComplete = useCallback(async (task: FlowTask) => {
    // Remove otimisticamente do kanban (só exibe abertos)
    setPendingIds((p) => new Set(p).add(task.id));
    setColumns((prev) =>
      prev
        .map((col) => ({ ...col, tasks: col.tasks.filter((t) => t.id !== task.id) }))
        .filter((col) => col.tasks.length > 0)
    );

    try {
      // Delega a chamada API ao CalendarView para que o estado do calendário também seja atualizado
      await onComplete(task);
    } catch {
      // Revert: re-insere o card na coluna
      setColumns((prev) => {
        const key = task.calendarId ?? "primary";
        const exists = prev.find((c) => c.calendarId === key);
        if (exists) {
          return prev.map((col) =>
            col.calendarId === key
              ? { ...col, tasks: [...col.tasks, task].sort((a, b) => timeOpen(b) - timeOpen(a)) }
              : col
          );
        }
        return groupByCalendar([...prev.flatMap((c) => c.tasks), task]);
      });
    } finally {
      setPendingIds((p) => { const n = new Set(p); n.delete(task.id); return n; });
    }
  }, [onComplete]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center text-[#9aa0a6] text-sm">
        {error}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <div className="px-4 py-3 border-b border-[#3c4043]">
        <h2 className="text-[#e8eaed] font-semibold text-base">Projetos</h2>
        <p className="text-[#9aa0a6] text-xs mt-0.5">Eventos em aberto por calendário</p>
      </div>

      <div className="flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex gap-4 p-4 items-start">
          {loading ? (
            <>
              <ColumnSkeleton />
              <ColumnSkeleton />
              <ColumnSkeleton />
            </>
          ) : columns.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-[#9aa0a6] text-sm">
              Nenhum evento em aberto
            </div>
          ) : (
            columns.map((col) => (
              <div
                key={col.calendarId}
                className="shrink-0 w-72 flex flex-col gap-2"
                style={{ maxHeight: "calc(100svh - 160px)" }}
              >
                {/* Header da coluna */}
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ backgroundColor: col.calendarBgColor + "22" }}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: col.calendarBgColor }}
                  />
                  <span className="text-[#e8eaed] text-sm font-medium truncate flex-1">
                    {col.calendarName}
                  </span>
                  <span className="text-[#9aa0a6] text-xs shrink-0">{col.tasks.length}</span>
                </div>

                {/* Cards */}
                <div className="flex flex-col gap-2 overflow-y-auto pr-1">
                  {col.tasks.map((task) => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      pending={pendingIds.has(task.id)}
                      onComplete={handleComplete}
                      onEdit={onEdit}
                    />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
