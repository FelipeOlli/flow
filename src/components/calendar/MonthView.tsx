"use client";

import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { EventAnchorPoint } from "./EventPopover";
import { getEventSurfaceColor } from "@/lib/colors";

const DAY_NAMES = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

interface MonthViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  onDayClick: (date: Date) => void;
  onEventClick: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onComplete: (task: FlowTask) => void;
  onImportant?: (task: FlowTask) => void;
}

export function MonthView({ tasks, currentDate, onDayClick, onEventClick, onComplete, onImportant }: MonthViewProps) {
  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  function getTasksForDay(day: Date) {
    return tasks.filter(
      (t) => t.startTime && isSameDay(new Date(t.startTime), day)
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day name headers */}
      <div className="grid grid-cols-7 border-b border-[#3c4043] bg-[#202124]">
        {DAY_NAMES.map((name) => (
          <div key={name} className="py-2 text-center">
            <span className="text-[11px] font-medium text-[#9aa0a6]">{name}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div className="grid grid-cols-7 flex-1 overflow-y-auto">
        {days.map((day) => {
          const dayTasks = getTasksForDay(day);
          const inMonth = isSameMonth(day, currentDate);
          const today = isToday(day);

          return (
            <div
              key={day.toISOString()}
              onClick={() => onDayClick(day)}
              className={`min-h-[84px] p-1.5 border-b border-r border-[#3c4043] cursor-pointer hover:bg-[#2a2b2e] transition-colors
                ${!inMonth ? "opacity-35" : ""}`}
            >
              {/* Day number */}
              <div className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-semibold mb-1
                ${today ? "bg-[#8ab4f8] text-[#202124]" : "text-[#9aa0a6]"}`}>
                {format(day, "d")}
              </div>

              {/* Events */}
              <div className="space-y-0.5">
                {dayTasks.slice(0, 3).map((task) => (
                  <div
                    key={task.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      onEventClick(task, { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
                    }}
                    className={`rounded-md px-1.5 py-[1px] leading-4 text-[10px] border flex items-center gap-1
                      ${task.isComplete ? "text-white/90" : "text-white"}
                      ${task.isCancelled ? "text-[#9aa0a6]" : ""}
                      drop-shadow-[0_1px_1px_rgba(0,0,0,0.45)]`}
                    style={{
                      backgroundColor: getEventSurfaceColor(
                        task.calendarBgColor,
                        task.isComplete,
                        task.selfResponseStatus,
                        task.isCancelled,
                        task.isImportant
                      ),
                      borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.62)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onComplete(task);
                      }}
                      className={`w-3 h-3 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors ${
                        task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"
                      }`}
                      aria-label={task.isComplete ? "Marcar pendente" : "Marcar concluído"}
                    >
                      {task.isComplete && (
                        <svg viewBox="0 0 24 24" className="w-1.5 h-1.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </button>
                    <span className={`truncate ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>
                      {task.isAllDay ? "" : `${format(new Date(task.startTime), "HH:mm")} `}
                      {task.title}
                    </span>
                    {task.isImportant && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onImportant?.(task); }}
                        className="flex-shrink-0 text-[#F6BF26]"
                        aria-label="Remover destaque"
                      >
                        <svg viewBox="0 0 24 24" className="w-2.5 h-2.5" fill="currentColor">
                          <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                {dayTasks.length > 3 && (
                  <p className="text-[10px] text-[#9aa0a6] px-1">+{dayTasks.length - 3}</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
