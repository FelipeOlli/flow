"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";

interface KanbanColumn {
  calendarId: string;
  calendarName: string;
  calendarBgColor: string;
  tasks: FlowTask[];
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

  // Ordena tarefas dentro de cada coluna: mais antiga primeiro (maior tempo em aberto)
  for (const col of cols) {
    col.tasks.sort((a: FlowTask, b: FlowTask) => timeOpen(b) - timeOpen(a));
  }

  return cols.sort((a: KanbanColumn, b: KanbanColumn) =>
    a.calendarName.localeCompare(b.calendarName, "pt-BR")
  );
}

function KanbanCard({ task }: { task: FlowTask }) {
  const ms = timeOpen(task);
  const openLabel = formatTimeOpen(ms);
  const isOld = ms > 7 * 86_400_000; // mais de 7 dias

  let dateLabel = "";
  if (!task.isAllDay && task.startTime) {
    try {
      const d = parseISO(task.startTime);
      dateLabel = format(d, "HH:mm · dd/MM", { locale: ptBR });
    } catch {
      // silencioso
    }
  } else if (task.isAllDay && task.startTime) {
    try {
      const d = parseISO(task.startTime.slice(0, 10) + "T00:00:00");
      dateLabel = format(d, "dd/MM", { locale: ptBR });
    } catch {
      // silencioso
    }
  }

  return (
    <div
      className="bg-[#2a2b2e] rounded-lg p-3 border-l-4 shadow-sm"
      style={{ borderLeftColor: task.calendarBgColor ?? "#4285f4" }}
    >
      <p className="text-[#e8eaed] text-sm font-medium leading-snug line-clamp-2">
        {task.title}
      </p>

      <div className="mt-1.5 flex items-center gap-2">
        <span
          className={`text-[11px] font-medium ${isOld ? "text-red-400" : "text-[#9aa0a6]"}`}
        >
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

export function ProjectsView() {
  const [columns, setColumns] = useState<KanbanColumn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <div className="flex gap-4 p-4 h-full items-start">
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
              <div key={col.calendarId} className="shrink-0 w-72 flex flex-col gap-2 max-h-full">
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
                    <KanbanCard key={task.id} task={task} />
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
