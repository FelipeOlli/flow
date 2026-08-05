"use client";

import { Fragment, useEffect, useRef, useState } from "react";
import { format, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { FlowTask } from "@/types/task";
import { TaskBlock } from "@/components/tasks/TaskBlock";
import { getEventSurfaceColor } from "@/lib/colors";
import { EventAnchorPoint } from "./EventPopover";
import { computeDaysOpen, agingBadgeColor, categoryLetters } from "@/lib/aging";
import {
  CALENDAR_DIMENSIONS,
  CURRENT_TIME_LINE_Z_INDEX,
  HOURS,
  computeLayout,
  currentTimeY,
  durationToPx,
  formatHourLabel,
  snapY,
  timeToY,
  yToTime,
} from "./calendarLayout";

const CLIENT_TZ = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "America/Sao_Paulo";

function ConflictIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0 text-[#ea4335]" fill="none" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  );
}

/** Banner âmbar "N horários em conflito" — clicável quando `onClick` é passado. */
function ConflictBanner({ count, onClick, className = "" }: { count: number; onClick?: () => void; className?: string }) {
  if (count === 0) return null;
  const label = count === 1 ? "1 horário em conflito neste dia" : `${count} horários em conflito neste dia`;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2 w-full text-left rounded-lg border border-[#fbbc04]/40 bg-[#fbbc04]/10 px-3 py-1.5 hover:bg-[#fbbc04]/20 transition-colors cursor-pointer ${className}`}
    >
      <ConflictIcon />
      <p className="text-xs text-[#fbbc04]">{label}</p>
      <span className="ml-auto text-[#fbbc04]/70 text-xs">ver ›</span>
    </button>
  );
}

function AgendaView({ tasks, currentDate, conflictIds, onConflictClick, onComplete, onEdit, onImportant, getAnchorFromElement }: {
  tasks: FlowTask[];
  currentDate: Date;
  conflictIds?: Set<string>;
  onConflictClick?: () => void;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onImportant?: (task: FlowTask) => void;
  getAnchorFromElement: (el: HTMLElement) => EventAnchorPoint;
}) {
  const calendarMap = new Map<string, { name: string; color: string; tasks: FlowTask[] }>();
  for (const task of tasks) {
    const key = task.calendarId ?? "primary";
    if (!calendarMap.has(key)) {
      calendarMap.set(key, { name: task.calendarName || key, color: task.calendarBgColor || "#4285f4", tasks: [] });
    }
    calendarMap.get(key)!.tasks.push(task);
  }
  calendarMap.forEach((entry) => {
    entry.tasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  });
  const calendars = Array.from(calendarMap.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name));

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  function toggle(calId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(calId) ? next.delete(calId) : next.add(calId);
      return next;
    });
  }

  const dayConflictCount = conflictIds
    ? tasks.filter((t) => !t.isAllDay && conflictIds.has(t.id)).length
    : 0;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto px-3 pb-20 pt-2 space-y-3">
      <div className="rounded-lg border border-[#3c4043] bg-[#2a2b2e] px-3 py-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#e8eaed]">{calendars.length} calendário(s)</p>
        <span className="text-xs text-[#9aa0a6] capitalize">
          {format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </span>
      </div>

      <ConflictBanner count={dayConflictCount} onClick={onConflictClick} />

      {calendars.length === 0 && (
        <p className="text-sm text-[#9aa0a6] text-center py-6">Nenhum evento para este dia.</p>
      )}

      {calendars.map(([calId, cal]) => {
        const isCollapsed = collapsed.has(calId);
        return (
          <div key={calId}>
            {/* Calendar header — clickable to collapse/expand */}
            <button
              type="button"
              onClick={() => toggle(calId)}
              className="w-full flex items-center gap-2 mb-2 group"
            >
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cal.color }} />
              <p className="text-xs font-semibold uppercase tracking-wide text-[#e8eaed] truncate">{cal.name}</p>
              <div className="flex-1 h-px bg-[#3c4043]" />
              <span className="text-xs text-[#9aa0a6]">{cal.tasks.length}</span>
              <svg
                viewBox="0 0 24 24"
                className={`w-3.5 h-3.5 text-[#9aa0a6] flex-shrink-0 transition-transform duration-200 ${isCollapsed ? "-rotate-90" : ""}`}
                fill="none" stroke="currentColor" strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {/* Events */}
            {!isCollapsed && (
              <div className="space-y-1.5 pl-5">
                {cal.tasks.map((task, idx) => {
                  const taskHour = task.isAllDay ? -1 : new Date(task.startTime).getHours();
                  const prevHour = idx > 0 && !cal.tasks[idx - 1].isAllDay ? new Date(cal.tasks[idx - 1].startTime).getHours() : -1;
                  const showNoonSep = taskHour >= 12 && prevHour >= 0 && prevHour < 12;
                  return (
                  <div key={task.id}>
                  {showNoonSep && (
                    <div className="flex items-center gap-2 my-1.5 pointer-events-none select-none">
                      <div className="flex-1 h-px bg-[#5f6368]" />
                      <span className="text-[10px] text-[#9aa0a6] font-semibold tracking-wide">12:00</span>
                      <div className="flex-1 h-px bg-[#5f6368]" />
                    </div>
                  )}
                  <div
                    key={task.id}
                    onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                    className="rounded-lg border px-3 py-2 cursor-pointer"
                    style={{
                      backgroundColor: getEventSurfaceColor(task.calendarBgColor, task.isComplete, task.selfResponseStatus, task.isCancelled, task.isImportant),
                      borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onComplete(task); }}
                        className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                          ${task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"}`}
                      >
                        {task.isComplete && (
                          <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                      <div className="min-w-0 flex-1">
                        {(() => { const cats = categoryLetters(task); return cats.length > 0 ? <div className="flex gap-1 mb-0.5">{cats.map(({letter,color}) => <span key={letter} className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded bg-black/20 ${color}`}>{letter}</span>)}</div> : null; })()}
                        <div className={`flex items-center gap-1.5 text-sm font-semibold leading-tight text-[#e8eaed] ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>
                          <span className="truncate">{task.title}</span>
                          {task.attendees && task.attendees.length > 0 && (
                            <svg viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0 text-white" fill="currentColor">
                              <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                            </svg>
                          )}
                          {task.isRecurring && (
                            <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                              <svg viewBox="0 0 24 24" className="w-3 h-3 text-white/70" fill="currentColor">
                                <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                              </svg>
                              {task.recurrenceCode && (
                                <span className="text-[8px] font-bold leading-none text-white/70">{task.recurrenceCode}</span>
                              )}
                            </span>
                          )}
                          {conflictIds?.has(task.id) && <ConflictIcon />}
                        </div>
                        <p className={`text-xs text-[#d2d6da] mt-0.5 ${task.isCancelled ? "line-through" : ""}`}>
                          {task.isAllDay ? "Dia inteiro" : `${format(new Date(task.startTime), "HH:mm")} - ${format(new Date(task.endTime), "HH:mm")}`}
                        </p>
                        {(() => { const d = computeDaysOpen(task, CLIENT_TZ); return d >= 1 ? <p className={`text-xs mt-0.5 ${agingBadgeColor(d)}`}>{d === 1 ? "1 dia em aberto" : `${d} dias em aberto`}</p> : null; })()}
                      </div>
                      {onImportant && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onImportant(task); }}
                          className={`flex-shrink-0 transition-colors ${task.isImportant ? "text-white" : "text-white/30 hover:text-white/60"}`}
                          aria-label={task.isImportant ? "Remover destaque" : "Marcar como importante"}
                        >
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={task.isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={task.isImportant ? 0 : 1.5}>
                            {task.isImportant
                              ? <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                              : <path d="M22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                            }
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PriorityView({ tasks, currentDate, conflictIds, onConflictClick, onComplete, onEdit, onImportant, getAnchorFromElement }: {
  tasks: FlowTask[];
  currentDate: Date;
  conflictIds?: Set<string>;
  onConflictClick?: () => void;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onImportant?: (task: FlowTask) => void;
  getAnchorFromElement: (el: HTMLElement) => EventAnchorPoint;
}) {
  const open = tasks
    .filter((t) => !t.isComplete && !t.isCancelled)
    .map((t) => ({ task: t, days: computeDaysOpen(t, CLIENT_TZ) }))
    .sort((a, b) => b.days - a.days || new Date(a.task.startTime).getTime() - new Date(b.task.startTime).getTime());

  const dayConflictCount = conflictIds
    ? tasks.filter((t) => !t.isAllDay && conflictIds.has(t.id)).length
    : 0;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto px-3 pb-20 pt-2 space-y-3">
      <div className="rounded-lg border border-[#3c4043] bg-[#2a2b2e] px-3 py-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#e8eaed]">{open.length} tarefa(s) em aberto</p>
        <span className="text-xs text-[#9aa0a6] capitalize">
          {format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </span>
      </div>

      <ConflictBanner count={dayConflictCount} onClick={onConflictClick} />

      {open.length === 0 && (
        <p className="text-sm text-[#9aa0a6] text-center py-6">Nenhuma tarefa em aberto para este dia.</p>
      )}

      <div className="space-y-1.5">
        {open.map(({ task, days }) => (
          <div
            key={task.id}
            onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
            className="rounded-lg border px-3 py-2 cursor-pointer"
            style={{
              backgroundColor: getEventSurfaceColor(task.calendarBgColor, task.isComplete, task.selfResponseStatus, task.isCancelled, task.isImportant),
              borderColor: "rgba(12,14,16,0.56)",
            }}
          >
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onComplete(task); }}
                className="mt-0.5 w-4 h-4 rounded-full border border-white/85 flex-shrink-0 flex items-center justify-center"
              />
              <div className="min-w-0 flex-1">
                {(() => { const cats = categoryLetters(task); return cats.length > 0 ? <div className="flex gap-1 mb-0.5">{cats.map(({letter,color}) => <span key={letter} className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded bg-black/20 ${color}`}>{letter}</span>)}</div> : null; })()}
                <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-[#e8eaed]">
                  <span className="truncate">{task.title}</span>
                  {task.attendees && task.attendees.length > 0 && (
                    <svg viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0 text-white" fill="currentColor">
                      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                    </svg>
                  )}
                  {task.isRecurring && (
                    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                      <svg viewBox="0 0 24 24" className="w-3 h-3 text-white/70" fill="currentColor">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                      </svg>
                      {task.recurrenceCode && (
                        <span className="text-[8px] font-bold leading-none text-white/70">{task.recurrenceCode}</span>
                      )}
                    </span>
                  )}
                  {conflictIds?.has(task.id) && <ConflictIcon />}
                </div>
                <p className="text-xs text-[#d2d6da] mt-0.5">
                  {task.isAllDay ? "Dia inteiro" : `${format(new Date(task.startTime), "HH:mm")} - ${format(new Date(task.endTime), "HH:mm")}`}
                </p>
                {task.calendarName && (
                  <p className="text-xs mt-0.5 truncate text-white/70">{task.calendarName}</p>
                )}
                {days >= 1 && (
                  <p className={`text-xs font-semibold mt-0.5 ${agingBadgeColor(days)}`}>
                    {days === 1 ? "1 dia em aberto" : `${days} dias em aberto`}
                  </p>
                )}
              </div>
              {onImportant && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onImportant(task); }}
                  className={`flex-shrink-0 transition-colors ${task.isImportant ? "text-white" : "text-white/30 hover:text-white/60"}`}
                  aria-label={task.isImportant ? "Remover destaque" : "Marcar como importante"}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={task.isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={task.isImportant ? 0 : 1.5}>
                    {task.isImportant
                      ? <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                      : <path d="M22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                    }
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FavoritesView({ tasks, currentDate, conflictIds, onConflictClick, onComplete, onEdit, onImportant, getAnchorFromElement }: {
  tasks: FlowTask[];
  currentDate: Date;
  conflictIds?: Set<string>;
  onConflictClick?: () => void;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onImportant?: (task: FlowTask) => void;
  getAnchorFromElement: (el: HTMLElement) => EventAnchorPoint;
}) {
  const open = tasks
    .filter((t) => t.isImportant && !t.isComplete && !t.isCancelled)
    .map((t) => ({ task: t, days: computeDaysOpen(t, CLIENT_TZ) }))
    .sort((a, b) => b.days - a.days || new Date(a.task.startTime).getTime() - new Date(b.task.startTime).getTime());

  const dayConflictCount = conflictIds
    ? tasks.filter((t) => !t.isAllDay && conflictIds.has(t.id)).length
    : 0;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto px-3 pb-20 pt-2 space-y-3">
      <div className="rounded-lg border border-[#3c4043] bg-[#2a2b2e] px-3 py-2 flex items-center justify-between">
        <p className="text-sm font-semibold text-[#e8eaed]">{open.length} favorito(s)</p>
        <span className="text-xs text-[#9aa0a6] capitalize">
          {format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
        </span>
      </div>

      <ConflictBanner count={dayConflictCount} onClick={onConflictClick} />

      {open.length === 0 && (
        <p className="text-sm text-[#9aa0a6] text-center py-6">Nenhum evento favoritado para este dia.</p>
      )}

      <div className="space-y-1.5">
        {open.map(({ task, days }) => (
          <div
            key={task.id}
            onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
            className="rounded-lg border px-3 py-2 cursor-pointer"
            style={{
              backgroundColor: getEventSurfaceColor(task.calendarBgColor, task.isComplete, task.selfResponseStatus, task.isCancelled, task.isImportant),
              borderColor: "rgba(12,14,16,0.56)",
            }}
          >
            <div className="flex items-start gap-2">
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onComplete(task); }}
                className="mt-0.5 w-4 h-4 rounded-full border border-white/85 flex-shrink-0 flex items-center justify-center"
              />
              <div className="min-w-0 flex-1">
                {(() => { const cats = categoryLetters(task); return cats.length > 0 ? <div className="flex gap-1 mb-0.5">{cats.map(({letter,color}) => <span key={letter} className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded bg-black/20 ${color}`}>{letter}</span>)}</div> : null; })()}
                <div className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-[#e8eaed]">
                  <span className="truncate">{task.title}</span>
                  {task.attendees && task.attendees.length > 0 && (
                    <svg viewBox="0 0 24 24" className="w-3 h-3 flex-shrink-0 text-white" fill="currentColor">
                      <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                    </svg>
                  )}
                  {task.isRecurring && (
                    <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                      <svg viewBox="0 0 24 24" className="w-3 h-3 text-white/70" fill="currentColor">
                        <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                      </svg>
                      {task.recurrenceCode && (
                        <span className="text-[8px] font-bold leading-none text-white/70">{task.recurrenceCode}</span>
                      )}
                    </span>
                  )}
                  {conflictIds?.has(task.id) && <ConflictIcon />}
                </div>
                <p className="text-xs text-[#d2d6da] mt-0.5">
                  {task.isAllDay ? "Dia inteiro" : `${format(new Date(task.startTime), "HH:mm")} - ${format(new Date(task.endTime), "HH:mm")}`}
                </p>
                {task.calendarName && (
                  <p className="text-xs mt-0.5 truncate text-white/70">{task.calendarName}</p>
                )}
                {days >= 1 && (
                  <p className={`text-xs font-semibold mt-0.5 ${agingBadgeColor(days)}`}>
                    {days === 1 ? "1 dia em aberto" : `${days} dias em aberto`}
                  </p>
                )}
              </div>
              {onImportant && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onImportant(task); }}
                  className={`flex-shrink-0 transition-colors ${task.isImportant ? "text-white" : "text-white/30 hover:text-white/60"}`}
                  aria-label={task.isImportant ? "Remover destaque" : "Marcar como importante"}
                >
                  <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill={task.isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={task.isImportant ? 0 : 1.5}>
                    {task.isImportant
                      ? <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                      : <path d="M22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                    }
                  </svg>
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface DayViewProps {
  tasks: FlowTask[];
  currentDate: Date;
  pendingIds: Set<string>;
  displayMode?: "grid" | "list" | "calendar" | "priority" | "favorites";
  conflictIds?: Set<string>;
  onConflictClick?: () => void;
  onComplete: (task: FlowTask) => void;
  onEdit: (task: FlowTask, anchor: EventAnchorPoint) => void;
  onDelete: (task: FlowTask) => void;
  onTimeClick: (time: Date) => void;
  onMove?: (task: FlowTask, newStart: Date, newEnd: Date) => void;
  onImportant?: (task: FlowTask) => void;
}

export function DayView({ tasks, currentDate, pendingIds, displayMode = "grid", conflictIds, onConflictClick, onComplete, onEdit, onDelete, onTimeClick, onMove, onImportant }: DayViewProps) {
  const [nowY, setNowY] = useState(currentTimeY());
  const scrollRef = useRef<HTMLDivElement>(null);
  const listScrollRef = useRef<HTMLDivElement>(null);
  const listNowSepRef = useRef<HTMLDivElement>(null);
  const isCurrentDay = isToday(currentDate);

  // Drag state
  const dragRef = useRef<{
    task: FlowTask;
    startClientY: number;
    originalTop: number;
    moved: boolean;
  } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragTop, setDragTop] = useState(0);
  const justDraggedRef = useRef(false);
  const onMoveRef = useRef(onMove);
  const currentDateRef = useRef(currentDate);
  useEffect(() => { onMoveRef.current = onMove; }, [onMove]);
  useEffect(() => { currentDateRef.current = currentDate; }, [currentDate]);

  useEffect(() => {
    if (!isCurrentDay) return;
    const t = setInterval(() => setNowY(currentTimeY()), 30000);
    return () => clearInterval(t);
  }, [isCurrentDay]);

  useEffect(() => {
    if (displayMode !== "grid" || !isCurrentDay) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, nowY - 120);
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode, isCurrentDay]);

  const listScrolledKeyRef = useRef<string>("");
  useEffect(() => {
    if (displayMode !== "list" || !isCurrentDay) return;
    const key = `${displayMode}|${currentDate.toISOString().slice(0, 10)}`;
    const scroll = () => {
      const sep = listNowSepRef.current;
      if (!sep) return false;
      sep.scrollIntoView({ block: "start", behavior: "auto" });
      listScrolledKeyRef.current = key;
      return true;
    };
    if (listScrolledKeyRef.current !== key || tasks.length > 0) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        scroll();
        setTimeout(scroll, 250);
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayMode, isCurrentDay, currentDate, tasks.length]);

  // Global pointer events for drag
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const dr = dragRef.current;
      if (!dr) return;
      const delta = e.clientY - dr.startClientY;
      if (Math.abs(delta) > 5) dr.moved = true;
      if (dr.moved) {
        const raw = Math.max(0, dr.originalTop + delta);
        setDragId(dr.task.id);
        setDragTop(snapY(raw));
      }
    }
    function onPointerUp(e: PointerEvent) {
      const dr = dragRef.current;
      if (!dr) return;
      dragRef.current = null;
      if (dr.moved) {
        justDraggedRef.current = true;
        setTimeout(() => { justDraggedRef.current = false; }, 100);
        const delta = e.clientY - dr.startClientY;
        const raw = Math.max(0, dr.originalTop + delta);
        const newStart = yToTime(snapY(raw), currentDateRef.current);
        const duration = new Date(dr.task.endTime).getTime() - new Date(dr.task.startTime).getTime();
        const newEnd = new Date(newStart.getTime() + duration);
        onMoveRef.current?.(dr.task, newStart, newEnd);
      }
      setDragId(null);
    }
    function onPointerCancel() {
      dragRef.current = null;
      setDragId(null);
    }
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, []);

  const timedTasks = tasks.filter((t) => !t.isAllDay);
  const allDayTasks = tasks.filter((t) => t.isAllDay);
  const orderedTimedTasks = [...timedTasks].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
  const completed = timedTasks.filter((t) => t.isComplete).length;
  const total = timedTasks.length;
  const layout = computeLayout(timedTasks);

  function handleTaskPointerDown(e: React.PointerEvent<HTMLDivElement>, task: FlowTask) {
    if ((e.target as HTMLElement).closest("button")) return;
    e.stopPropagation();
    dragRef.current = {
      task,
      startClientY: e.clientY,
      originalTop: timeToY(task.startTime),
      moved: false,
    };
  }

  function handleTimelineClick(e: React.MouseEvent<HTMLDivElement>) {
    if (justDraggedRef.current) return;
    if ((e.target as HTMLElement).closest("[data-task-block]")) return;
    const y = e.nativeEvent.offsetY;
    onTimeClick(yToTime(y, currentDate));
  }

  function getAnchorFromElement(el: HTMLElement): EventAnchorPoint {
    const rect = el.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  if (displayMode === "list") {
    const pendingCount = Math.max(0, total - completed);
    const nowTs = Date.now();
    const nowSeparatorIndex = isCurrentDay
      ? orderedTimedTasks.findIndex((task) => new Date(task.startTime).getTime() > nowTs)
      : -1;
    const separatorInsertIndex = nowSeparatorIndex === -1 ? orderedTimedTasks.length : nowSeparatorIndex;

    const noonTs = new Date(currentDate).setHours(12, 0, 0, 0);
    const noonRawIndex = orderedTimedTasks.findIndex((task) => new Date(task.startTime).getTime() >= noonTs);
    const noonInsertIndex = noonRawIndex > 0 ? noonRawIndex : -1; // só mostra se há eventos antes das 12h

    const renderNoonSeparator = (key: string) => (
      <div key={key} className="flex items-center gap-2 px-1 py-1 pointer-events-none select-none">
        <div className="flex-1 h-px bg-[#5f6368]" />
        <span className="text-[10px] text-[#9aa0a6] font-semibold tracking-wide">12:00</span>
        <div className="flex-1 h-px bg-[#5f6368]" />
      </div>
    );

    const renderNowSeparator = (key: string) => (
      <div ref={listNowSepRef} key={key} style={{ scrollMarginTop: "80px" }} className="flex items-center gap-2 px-1 py-1">
        <div className="h-[2px] w-3 rounded bg-[#ea4335]" />
        <p className="text-[11px] font-medium text-[#ea4335]">
          Agora {format(new Date(), "HH:mm")}
        </p>
        <div className="h-px flex-1 bg-[#ea4335]/50" />
      </div>
    );
    const listConflictCount = conflictIds
      ? timedTasks.filter((t) => conflictIds.has(t.id)).length
      : 0;

    return (
      <div ref={listScrollRef} className="flex flex-col flex-1 overflow-y-auto px-3 pb-20 pt-2">
        <div className="mb-2 rounded-lg border border-[#3c4043] bg-[#2a2b2e] px-3 py-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-[#e8eaed]">
            {pendingCount} tarefa(s) pendente(s)
          </p>
          <span className="text-xs text-[#9aa0a6] capitalize">
            {format(currentDate, "EEEE, d 'de' MMMM", { locale: ptBR })}
          </span>
        </div>

        <ConflictBanner count={listConflictCount} onClick={onConflictClick} className="mb-2" />

        {allDayTasks.length > 0 && (
          <div className="space-y-2 mb-3">
            {allDayTasks.map((task) => (
              <div
                key={task.id}
                onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                className="rounded-lg border px-3 py-2 cursor-pointer"
                style={{
                  backgroundColor: getEventSurfaceColor(
                    task.calendarBgColor,
                    task.isComplete,
                    task.selfResponseStatus,
                    task.isCancelled,
                    task.isImportant
                  ),
                  borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
                }}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onComplete(task); }}
                    className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                      ${task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"}`}
                  >
                    {task.isComplete && (
                      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="min-w-0">
                    <p className={`text-base font-semibold leading-tight text-[#e8eaed] truncate ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>
                      {task.title}
                    </p>
                    <p className={`text-sm text-[#d2d6da] mt-0.5 ${task.isCancelled ? "line-through" : ""}`}>Dia inteiro</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-2">
          {isCurrentDay && orderedTimedTasks.length === 0 && renderNowSeparator("now-separator-empty")}
          {orderedTimedTasks.map((task, index) => (
            <Fragment key={`${task.calendarId ?? "primary"}:${task.id}:${task.startTime}`}>
              {noonInsertIndex !== -1 && index === noonInsertIndex && renderNoonSeparator(`noon-separator-${index}`)}
              {isCurrentDay && index === separatorInsertIndex && renderNowSeparator(`now-separator-${index}`)}
              <div
                onClick={(e) => onEdit(task, getAnchorFromElement(e.currentTarget))}
                className="rounded-lg border px-3 py-2 cursor-pointer"
                style={{
                  backgroundColor: getEventSurfaceColor(
                    task.calendarBgColor,
                    task.isComplete,
                    task.selfResponseStatus,
                    task.isCancelled,
                    task.isImportant
                  ),
                  borderColor: task.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
                }}
              >
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={(event) => { event.stopPropagation(); onComplete(task); }}
                    className={`mt-0.5 w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                      ${task.isComplete ? "bg-emerald-500 border-emerald-500" : "border-white/85"}`}
                  >
                    {task.isComplete && (
                      <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    {(() => { const cats = categoryLetters(task); return cats.length > 0 ? <div className="flex gap-1 mb-0.5">{cats.map(({letter,color}) => <span key={letter} className={`text-[9px] font-bold leading-none px-1 py-0.5 rounded bg-black/20 ${color}`}>{letter}</span>)}</div> : null; })()}
                    <div className={`flex items-center gap-1.5 text-base font-semibold leading-tight text-[#e8eaed] ${task.isComplete || task.isCancelled ? "line-through opacity-80" : ""}`}>
                      <span className="truncate">{task.title}</span>
                      {task.attendees && task.attendees.length > 0 && (
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 flex-shrink-0 text-white" fill="currentColor">
                          <path d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                        </svg>
                      )}
                      {task.isRecurring && (
                        <span className="inline-flex items-center gap-0.5 flex-shrink-0">
                          <svg viewBox="0 0 24 24" className="w-3.5 h-3.5 text-white/70" fill="currentColor">
                            <path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>
                          </svg>
                          {task.recurrenceCode && (
                            <span className="text-[9px] font-bold leading-none text-white/70">{task.recurrenceCode}</span>
                          )}
                        </span>
                      )}
                      {conflictIds?.has(task.id) && <ConflictIcon />}
                    </div>
                    <p className={`text-sm text-[#d2d6da] mt-0.5 ${task.isCancelled ? "line-through" : ""}`}>
                      {format(new Date(task.startTime), "HH:mm")} - {format(new Date(task.endTime), "HH:mm")}
                    </p>
                    {task.calendarName && (
                      <p className="text-xs mt-0.5 truncate text-white/70">{task.calendarName}</p>
                    )}
                    {(() => { const d = computeDaysOpen(task, CLIENT_TZ); return d >= 1 ? <p className={`text-xs mt-0.5 ${agingBadgeColor(d)}`}>{d === 1 ? "1 dia em aberto" : `${d} dias em aberto`}</p> : null; })()}
                  </div>
                  {onImportant && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onImportant(task); }}
                      className={`flex-shrink-0 mt-0.5 transition-colors ${task.isImportant ? "text-white" : "text-white/30 hover:text-white/60"}`}
                      aria-label={task.isImportant ? "Remover destaque" : "Marcar como importante"}
                    >
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill={task.isImportant ? "currentColor" : "none"} stroke="currentColor" strokeWidth={task.isImportant ? 0 : 1.5}>
                        {task.isImportant
                          ? <path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/>
                          : <path d="M22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z"/>
                        }
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </Fragment>
          ))}
          {isCurrentDay && orderedTimedTasks.length > 0 && separatorInsertIndex === orderedTimedTasks.length &&
            renderNowSeparator("now-separator-end")}
        </div>
      </div>
    );
  }

  if (displayMode === "calendar") {
    return <AgendaView tasks={tasks} currentDate={currentDate} conflictIds={conflictIds} onConflictClick={onConflictClick} onComplete={onComplete} onEdit={onEdit} onImportant={onImportant} getAnchorFromElement={getAnchorFromElement} />;
  }

  if (displayMode === "priority") {
    return <PriorityView tasks={tasks} currentDate={currentDate} conflictIds={conflictIds} onConflictClick={onConflictClick} onComplete={onComplete} onEdit={onEdit} onImportant={onImportant} getAnchorFromElement={getAnchorFromElement} />;
  }

  if (displayMode === "favorites") {
    return <FavoritesView tasks={tasks} currentDate={currentDate} conflictIds={conflictIds} onConflictClick={onConflictClick} onComplete={onComplete} onEdit={onEdit} onImportant={onImportant} getAnchorFromElement={getAnchorFromElement} />;
  }

  return (
    <div className="flex flex-col flex-1">
      {/* All-day + progress */}
      <div className="px-4 pt-2 pb-2 space-y-2">
        {allDayTasks.map((t) => (
          <div key={t.id} onClick={(e) => onEdit(t, getAnchorFromElement(e.currentTarget))}
            className="flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer"
            style={{
              backgroundColor: getEventSurfaceColor(
                t.calendarBgColor,
                t.isComplete,
                t.selfResponseStatus,
                t.isCancelled,
                t.isImportant
              ),
              borderColor: t.isCancelled ? "rgba(95,99,104,0.75)" : "rgba(12,14,16,0.56)",
            }}>
            <button onClick={(e) => { e.stopPropagation(); onComplete(t); }}
              type="button"
              className={`w-4 h-4 rounded-full border flex-shrink-0 flex items-center justify-center transition-colors
                ${t.isComplete ? "bg-emerald-500 border-emerald-500" : "border-[#5f6368]"}`}>
              {t.isComplete && <svg viewBox="0 0 24 24" className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
            </button>
            <span className={`text-xs font-medium truncate ${t.isComplete || t.isCancelled ? "line-through text-[#9aa0a6]" : "text-[#e8eaed] drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]"}`}>{t.title}</span>
            <span className={`ml-auto text-xs text-[#9aa0a6] flex-shrink-0 ${t.isCancelled ? "line-through" : ""}`}>dia inteiro</span>
          </div>
        ))}
        {total > 0 && (
          <div className="flex items-center gap-3">
            <div className="flex-1 h-1.5 bg-[#3c4043] overflow-hidden rounded-full">
              <div className="h-full bg-emerald-500 rounded-full transition-all duration-700"
                style={{ width: `${Math.round((completed / total) * 100)}%` }} />
            </div>
            <span className="text-xs text-[#9aa0a6] tabular-nums">{completed}/{total}</span>
          </div>
        )}
      </div>

      {/* Conflict banner — grid mode */}
      <ConflictBanner
        count={conflictIds ? timedTasks.filter((t) => conflictIds.has(t.id)).length : 0}
        onClick={onConflictClick}
        className="mx-4 mb-1"
      />

      {/* Timeline */}
      <div ref={scrollRef} className="overflow-y-auto flex-1">
        <div
          className="relative cursor-pointer"
          style={{
            height: `${(CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START + 1) * CALENDAR_DIMENSIONS.HOUR_PX}px`,
            marginLeft: `${CALENDAR_DIMENSIONS.TIME_GUTTER_WIDTH}px`,
            marginRight: `${CALENDAR_DIMENSIONS.GRID_SIDE_PADDING}px`,
          }}
          onClick={handleTimelineClick}
        >
          {HOURS.map((h) => (
            <div key={h} className="absolute left-0 right-0 pointer-events-none"
              style={{ top: `${(h - CALENDAR_DIMENSIONS.DAY_START) * CALENDAR_DIMENSIONS.HOUR_PX}px` }}>
              <span className={`absolute -left-10 -top-2.5 w-8 text-right tabular-nums select-none ${h === 12 ? "text-[11px] text-[#e8eaed] font-semibold" : "text-[11px] text-[#9aa0a6]"}`}>
                {formatHourLabel(h)}
              </span>
              <div className={`w-full ${h === 12 ? "h-px bg-[#5f6368]" : "h-px bg-[#3c4043]"}`} />
            </div>
          ))}

          {isCurrentDay && nowY >= 0 && nowY <= (CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START) * CALENDAR_DIMENSIONS.HOUR_PX && (
            <div className="absolute left-0 right-0 flex items-center pointer-events-none"
              style={{ top: `${nowY}px`, zIndex: CURRENT_TIME_LINE_Z_INDEX }}>
              <div className="w-2.5 h-2.5 rounded-full bg-[#ea4335] -ml-1.5 flex-shrink-0" />
              <div className="flex-1 h-[2px] bg-[#ea4335]" />
            </div>
          )}

          {layout.map(({ task, colStart, colSpan, totalCols, ghost }) => {
            const isBeingDragged = dragId === task.id;
            const top = isBeingDragged ? dragTop : timeToY(task.startTime);
            return (
              <TaskBlock
                key={task.id}
                task={task}
                top={top}
                height={durationToPx(task.startTime, task.endTime)}
                isPending={pendingIds.has(task.id)}
                hasConflict={conflictIds?.has(task.id)}
                colStart={colStart}
                colSpan={colSpan}
                totalCols={totalCols}
                ghost={ghost}
                isDragging={isBeingDragged}
                onTaskPointerDown={(e) => handleTaskPointerDown(e, task)}
                onComplete={() => onComplete(task)}
                onEdit={(e) => { if (!justDraggedRef.current) onEdit(task, { x: e.clientX, y: e.clientY }); }}
                onDelete={() => onDelete(task)}
                onImportant={() => onImportant?.(task)}
              />
            );
          })}
        </div>
        <div style={{ height: `${CALENDAR_DIMENSIONS.BOTTOM_SPACER_PX}px` }} />
      </div>
    </div>
  );
}
