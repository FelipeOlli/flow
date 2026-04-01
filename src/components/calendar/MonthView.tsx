"use client";

import { format, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";

const DAY_NAMES = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

interface MonthViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  onDayClick: (date: Date) => void;
  onEventClick: (task: FlowTask) => void;
}

export function MonthView({ tasks, currentDate, onDayClick, onEventClick }: MonthViewProps) {
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
                    onClick={(e) => { e.stopPropagation(); onEventClick(task); }}
                    className="truncate rounded-md px-1.5 py-[1px] leading-4 text-[10px] text-white border"
                    style={{
                      backgroundColor: task.isComplete
                        ? "#188038"
                        : (task.calendarBgColor ?? "#4285f4"),
                      borderColor: "rgba(32,33,36,0.45)",
                    }}
                  >
                    {task.isAllDay ? "" : `${format(new Date(task.startTime), "HH:mm")} `}
                    {task.title}
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
