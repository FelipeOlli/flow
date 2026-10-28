"use client";

import { useMemo, useState } from "react";
import { FlowTask } from "@/types/task";
import { groupDelegations, DelegationItem } from "@/lib/delegation";

interface CobrancaViewProps {
  tasks: FlowTask[];
  loading?: boolean;
  onRefresh: () => void;
  onOpenTask?: (task: FlowTask) => void;
  onComplete?: (task: FlowTask) => void;
}

type Tab = "atrasadas" | "todas";

function formatDue(dueDateKey: string): string {
  return `${dueDateKey.slice(8, 10)}/${dueDateKey.slice(5, 7)}`;
}

function DueLabel({ item }: { item: DelegationItem }) {
  if (item.status === "today") {
    return <span className="text-amber-300">vence hoje</span>;
  }
  if (item.status === "overdue") {
    const label = item.daysLate === 1 ? "venceu ontem" : `venceu há ${item.daysLate} dias`;
    return (
      <span className="text-[#f28b82]">
        {label} <span className="text-[#9aa0a6]">({formatDue(item.dueDateKey)})</span>
      </span>
    );
  }
  return <span className="text-[#9aa0a6]">vence {formatDue(item.dueDateKey)}</span>;
}

export function CobrancaView({ tasks, loading, onRefresh, onOpenTask, onComplete }: CobrancaViewProps) {
  const [tab, setTab] = useState<Tab>("atrasadas");
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const groups = useMemo(() => groupDelegations(tasks, tz), [tasks, tz]);

  const totalOverdue = groups.reduce((sum, g) => sum + g.overdue.length, 0);
  const totalToday = groups.reduce((sum, g) => sum + g.today.length, 0);
  const visibleGroups =
    tab === "atrasadas"
      ? groups
          .filter((g) => g.overdue.length > 0 || g.today.length > 0)
          .map((g) => ({ ...g, items: [...g.overdue, ...g.today] }))
      : groups;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="px-4 pt-3 pb-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-[#e8eaed]">Cobrança</h2>
            <p className="text-xs text-[#9aa0a6] mt-0.5">
              {totalOverdue > 0
                ? `${totalOverdue} ${totalOverdue === 1 ? "delegação atrasada" : "delegações atrasadas"}${
                    totalToday > 0 ? ` · ${totalToday} vencem hoje` : ""
                  }`
                : "Nada atrasado por enquanto."}
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="px-2.5 py-1.5 rounded-lg border border-[#3c4043] text-xs text-[#9aa0a6] hover:text-[#e8eaed] hover:bg-[#2a2b2e] transition-colors"
          >
            Atualizar
          </button>
        </div>

        <div className="flex gap-1 p-1 rounded-xl bg-[#2a2b2e] border border-[#3c4043]">
          <button
            onClick={() => setTab("atrasadas")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === "atrasadas" ? "bg-[#3c4043] text-[#e8eaed]" : "text-[#9aa0a6] hover:text-[#e8eaed]"
            }`}
          >
            Atrasadas
            {totalOverdue > 0 && (
              <span className="ml-1.5 inline-block min-w-4 px-1 rounded-full bg-[#f28b82]/20 text-[#f28b82] text-[10px] font-bold">
                {totalOverdue}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("todas")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === "todas" ? "bg-[#3c4043] text-[#e8eaed]" : "text-[#9aa0a6] hover:text-[#e8eaed]"
            }`}
          >
            Todas
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-20 pt-3 space-y-3">
        {loading && <p className="text-sm text-[#9aa0a6]">Carregando...</p>}

        {!loading && visibleGroups.length === 0 && (
          <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-6 text-center">
            <p className="text-sm text-[#e8eaed]">Nenhuma delegação atrasada 🎉</p>
            <p className="text-xs text-[#9aa0a6] mt-1">
              Marque um responsável no evento (ícone 👤 na edição) pra acompanhar a cobrança aqui.
            </p>
          </div>
        )}

        {!loading &&
          visibleGroups.map((group) => (
            <div key={group.key} className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] overflow-hidden">
              <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[#3c4043]">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      group.overdue.length > 0 ? "bg-[#f28b82]" : group.today.length > 0 ? "bg-amber-300" : "bg-emerald-400"
                    }`}
                  />
                  <p className="text-sm font-medium text-[#e8eaed] truncate">{group.name}</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {group.overdue.length > 0 && (
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#f28b82]/20 text-[#f28b82]">
                      {group.overdue.length} {group.overdue.length === 1 ? "atrasada" : "atrasadas"}
                    </span>
                  )}
                  {group.upcoming.length > 0 && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#3c4043] text-[#9aa0a6]">
                      {group.upcoming.length} em dia
                    </span>
                  )}
                </div>
              </div>

              <div className="divide-y divide-[#3c4043]/60">
                {group.items.map((item) => (
                  <div
                    key={item.task.id}
                    className="flex items-center gap-2 px-3 py-2.5 hover:bg-[#313236] transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => onOpenTask?.(item.task)}
                      className="flex-1 text-left min-w-0"
                      title={item.task.title}
                    >
                      <p className="text-sm text-[#e8eaed] truncate">{item.task.title}</p>
                      <p className="text-[11px] mt-0.5">
                        <DueLabel item={item} />
                        {item.task.calendarName && (
                          <span className="text-[#9aa0a6]"> · {item.task.calendarName}</span>
                        )}
                      </p>
                    </button>
                    {onComplete && (
                      <button
                        type="button"
                        onClick={() => onComplete(item.task)}
                        title="Marcar como concluído"
                        aria-label="Marcar como concluído"
                        className="w-7 h-7 flex-shrink-0 rounded-full border border-[#3c4043] text-[#9aa0a6] hover:text-emerald-300 hover:border-emerald-400/60 transition-colors flex items-center justify-center"
                      >
                        <svg viewBox="0 0 24 24" className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
