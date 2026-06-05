"use client";

import { useEffect, useState } from "react";

interface DelegableItem {
  title: string;
  calendarName: string;
  count: number;
}

interface WeeklyReviewData {
  delegableList: DelegableItem[];
  strategic: number;
  operational: number;
}

type Tab = "revisao" | "delegacao";

export function WeeklyReviewView() {
  const [data, setData] = useState<WeeklyReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("revisao");

  useEffect(() => {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    fetch(`/api/weekly-review?tz=${encodeURIComponent(tz)}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => { setError("Erro ao carregar revisão semanal."); setLoading(false); });
  }, []);

  const isFriday = new Date().getDay() === 5;

  const total = (data?.strategic ?? 0) + (data?.operational ?? 0);
  const strategicPct = total > 0 ? Math.round(((data?.strategic ?? 0) / total) * 100) : 0;
  const operationalPct = total > 0 ? 100 - strategicPct : 0;
  const belowTarget = strategicPct < 30 && total > 0;

  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strategicArc = (strategicPct / 100) * circumference;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-3 pb-0 space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold text-[#e8eaed]">Revisão Semanal</h2>
          {isFriday && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#a78bfa]/20 text-[#a78bfa] border border-[#a78bfa]/40 animate-pulse">
              Hoje é sexta!
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 p-1 rounded-xl bg-[#2a2b2e] border border-[#3c4043]">
          <button
            onClick={() => setTab("revisao")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
              tab === "revisao"
                ? "bg-[#3c4043] text-[#e8eaed]"
                : "text-[#9aa0a6] hover:text-[#e8eaed]"
            }`}
          >
            Revisão
          </button>
          <button
            onClick={() => setTab("delegacao")}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors relative ${
              tab === "delegacao"
                ? "bg-[#3c4043] text-[#e8eaed]"
                : "text-[#9aa0a6] hover:text-[#e8eaed]"
            }`}
          >
            Delegação
            {(data?.delegableList.length ?? 0) > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#4dd0e1] text-[#202124] text-[9px] font-bold flex items-center justify-center">
                {data!.delegableList.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-4 pb-20 pt-3 space-y-4">
        {loading && <p className="text-sm text-[#9aa0a6]">Carregando...</p>}
        {error && <p className="text-sm text-[#f28b82]">{error}</p>}

        {data && tab === "revisao" && (
          <>
            {/* Razão Estratégico vs Operacional */}
            <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-4">
              <p className="text-xs uppercase tracking-wide text-[#9aa0a6] mb-3">Estratégico vs Operacional</p>
              <div className="flex items-center gap-6">
                <svg viewBox="0 0 100 100" className="w-20 h-20 flex-shrink-0 -rotate-90">
                  <circle cx="50" cy="50" r={radius} fill="none" stroke="#3c4043" strokeWidth="14" />
                  {total > 0 && (
                    <>
                      <circle
                        cx="50" cy="50" r={radius}
                        fill="none" stroke="#9aa0a6" strokeWidth="14"
                        strokeDasharray={`${circumference} ${circumference}`}
                      />
                      <circle
                        cx="50" cy="50" r={radius}
                        fill="none" stroke="#a78bfa" strokeWidth="14"
                        strokeDasharray={`${strategicArc} ${circumference}`}
                      />
                    </>
                  )}
                </svg>
                <div className="space-y-2 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#a78bfa] flex-shrink-0" />
                    <span className="text-sm text-[#e8eaed]">Estratégico: <span className="font-semibold">{strategicPct}%</span></span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#9aa0a6] flex-shrink-0" />
                    <span className="text-sm text-[#e8eaed]">Operacional: <span className="font-semibold">{operationalPct}%</span></span>
                  </div>
                  <div className={`text-xs mt-1 ${belowTarget ? "text-[#ea4335] font-medium" : "text-[#34a853]"}`}>
                    {total === 0
                      ? "Nenhuma tarefa categorizada"
                      : belowTarget
                      ? "Abaixo da meta de 30% estratégico"
                      : "Meta ≥30% estratégico atingida"}
                  </div>
                </div>
              </div>
            </div>

            {/* Resumo da semana */}
            <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-4 space-y-2">
              <p className="text-xs uppercase tracking-wide text-[#9aa0a6]">Esta semana</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="text-center">
                  <p className="text-xl font-semibold text-[#a78bfa]">{data.strategic}</p>
                  <p className="text-xs text-[#9aa0a6] mt-0.5">Estratégicos</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-semibold text-white/60">{data.operational}</p>
                  <p className="text-xs text-[#9aa0a6] mt-0.5">Operacionais</p>
                </div>
                <div className="text-center">
                  <p className="text-xl font-semibold text-[#4dd0e1]">{data.delegableList.length}</p>
                  <p className="text-xs text-[#9aa0a6] mt-0.5">Delegáveis</p>
                </div>
              </div>
            </div>
          </>
        )}

        {data && tab === "delegacao" && (
          <>
            <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs uppercase tracking-wide text-[#9aa0a6]">
                  Tarefas para delegar
                </p>
                <span className="text-xs font-medium text-[#4dd0e1]">
                  {data.delegableList.length} {data.delegableList.length === 1 ? "tarefa" : "tarefas"}
                </span>
              </div>

              {data.delegableList.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-[#9aa0a6]">Nenhuma tarefa marcada como delegável esta semana.</p>
                  <p className="text-xs text-[#5f6368] mt-1">Use o botão D no popover de um evento para marcar.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {data.delegableList.map((item, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 p-3 rounded-lg bg-[#202124] border border-[#3c4043]"
                    >
                      {/* Ícone D */}
                      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-[#4dd0e1]/15 border border-[#4dd0e1]/40 flex items-center justify-center">
                        <span className="text-[10px] font-bold text-[#4dd0e1]">D</span>
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-[#e8eaed] font-medium leading-tight">{item.title}</p>
                        {item.calendarName && (
                          <p className="text-xs text-[#9aa0a6] mt-0.5">{item.calendarName}</p>
                        )}
                        {item.count > 1 && (
                          <p className="text-xs text-[#4dd0e1] mt-1">
                            Aparece {item.count}× esta semana — candidata a delegação permanente
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Dica */}
            <div className="rounded-xl border border-[#4dd0e1]/20 bg-[#4dd0e1]/5 p-3">
              <p className="text-xs text-[#4dd0e1]/80 leading-relaxed">
                <span className="font-semibold">Dica:</span> Tarefas marcadas com <span className="font-semibold">D</span> aparecem aqui.
                Se uma tarefa operacional aparece 3+ semanas seguidas, considere delegá-la permanentemente.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
