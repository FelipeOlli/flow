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

export function WeeklyReviewView() {
  const [data, setData] = useState<WeeklyReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

  // Destaque na sexta-feira
  const isFriday = new Date().getDay() === 5;

  const total = (data?.strategic ?? 0) + (data?.operational ?? 0);
  const strategicPct = total > 0 ? Math.round(((data?.strategic ?? 0) / total) * 100) : 0;
  const operationalPct = total > 0 ? 100 - strategicPct : 0;
  const belowTarget = strategicPct < 30 && total > 0;

  // SVG donut
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  const strategicArc = (strategicPct / 100) * circumference;

  return (
    <div className="flex flex-col flex-1 overflow-y-auto px-4 pb-20 pt-3 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-[#e8eaed]">Revisão Semanal</h2>
        {isFriday && (
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#a78bfa]/20 text-[#a78bfa] border border-[#a78bfa]/40 animate-pulse">
            Hoje é sexta!
          </span>
        )}
      </div>

      {loading && (
        <p className="text-sm text-[#9aa0a6]">Carregando...</p>
      )}
      {error && (
        <p className="text-sm text-[#f28b82]">{error}</p>
      )}

      {data && (
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
                      fill="none"
                      stroke="#9aa0a6"
                      strokeWidth="14"
                      strokeDasharray={`${circumference} ${circumference}`}
                    />
                    <circle
                      cx="50" cy="50" r={radius}
                      fill="none"
                      stroke="#a78bfa"
                      strokeWidth="14"
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
                    ? `Abaixo da meta de 30% estratégico`
                    : `Meta ≥30% estratégico atingida`}
                </div>
              </div>
            </div>
          </div>

          {/* Lista de delegáveis */}
          <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-4">
            <p className="text-xs uppercase tracking-wide text-[#9aa0a6] mb-3">
              Tarefas delegáveis ({data.delegableList.length})
            </p>
            {data.delegableList.length === 0 ? (
              <p className="text-sm text-[#9aa0a6]">Nenhuma tarefa marcada como delegável esta semana.</p>
            ) : (
              <div className="space-y-2">
                {data.delegableList.map((item, i) => (
                  <div key={i} className="flex items-center justify-between gap-3 py-1.5 border-b border-[#3c4043] last:border-0">
                    <div className="min-w-0">
                      <p className="text-sm text-[#e8eaed] truncate">{item.title}</p>
                      {item.calendarName && (
                        <p className="text-xs text-[#9aa0a6] truncate">{item.calendarName}</p>
                      )}
                    </div>
                    {item.count > 1 && (
                      <span className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#4dd0e1]/15 text-[#4dd0e1] border border-[#4dd0e1]/30">
                        {item.count}× esta semana
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
