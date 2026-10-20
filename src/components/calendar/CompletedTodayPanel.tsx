"use client";

import { useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { EventAnchorPoint } from "./EventPopover";

interface CompletedTodayPanelProps {
  tasks: FlowTask[];
  onToggleComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  className?: string;
}

function anchorFromElement(el: HTMLElement): EventAnchorPoint {
  const rect = el.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function CompletedTodayPanel({ tasks, onToggleComplete, onEdit, className = "" }: CompletedTodayPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrolledOnceRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (tasks.length === 0) {
      scrolledOnceRef.current = false;
      return;
    }
    if (scrolledOnceRef.current) return;
    const el = containerRef.current;
    if (!el) return;
    scrolledOnceRef.current = true;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "start", behavior: "auto" });
    });
  }, [tasks.length]);

  // Sai de collapse quando a lista esvazia (todos reabertos) — nada a mostrar.
  useEffect(() => {
    if (tasks.length === 0) setCollapsed(false);
  }, [tasks.length]);

  if (tasks.length === 0) return null;

  const sorted = [...tasks].sort((a, b) => {
    if (a.isAllDay && !b.isAllDay) return -1;
    if (!a.isAllDay && b.isAllDay) return 1;
    return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
  });

  return (
    <div
      ref={containerRef}
      className={`rounded-lg border border-emerald-500/40 bg-emerald-500/5 px-3 py-2 ${className}`}
    >
      <button
        type="button"
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-2 group"
        aria-expanded={!collapsed}
      >
        <p className="text-sm font-semibold text-emerald-400">
          ✓ {tasks.length} concluído{tasks.length === 1 ? "" : "s"} hoje
        </p>
        <div className="flex-1 h-px bg-emerald-500/30" />
        <span className="text-xs text-[#9aa0a6] capitalize">
          {format(new Date(), "EEEE, d 'de' MMMM", { locale: ptBR })}
        </span>
        <svg
          viewBox="0 0 24 24"
          className={`w-3.5 h-3.5 text-emerald-400 flex-shrink-0 transition-transform duration-200 ${collapsed ? "-rotate-90" : ""}`}
          fill="none" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {!collapsed && (
        <div className="space-y-1 mt-2">
          {sorted.map((task) => (
            <div
              key={task.id}
              className="flex items-center gap-2 px-2 py-1 rounded border border-[#3c4043] bg-[#202124]/60"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleComplete(task);
                }}
                className="w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center bg-emerald-500 border-emerald-500"
                aria-label="Marcar pendente"
                title="Reabrir evento"
              >
                <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <span className="text-xs text-[#9aa0a6] font-mono w-12 flex-shrink-0">
                {task.isAllDay ? "dia inteiro" : format(new Date(task.startTime), "HH:mm")}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(task, anchorFromElement(e.currentTarget));
                }}
                className="flex-1 min-w-0 text-left text-sm text-[#e8eaed] line-through opacity-80 truncate hover:opacity-100"
                title={task.title}
              >
                {task.title}
              </button>
              {task.calendarName && (
                <span className="text-[10px] text-[#9aa0a6] truncate max-w-[120px] hidden sm:inline">
                  {task.calendarName}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
