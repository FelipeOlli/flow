"use client";

import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";

type DayStats = { total: number; completed: number };
type MonthStats = { month: number; label: string; total: number; completed: number };

type StatsData = {
  year: number;
  byDay: Record<string, DayStats>;
  byMonth: MonthStats[];
  totals: { total: number; completed: number; rate: number };
  streak: { current: number; best: number };
  bestDay: { date: string; completed: number } | null;
};

interface DashboardViewProps {
  onBack: () => void;
}

/** Returns 53 weeks as arrays of YYYY-MM-DD strings (Mon–Sun), starting from
 *  the Monday on or before Jan 1 of the given year. */
function getHeatmapWeeks(year: number): string[][] {
  const jan1 = new Date(year, 0, 1);
  const dow = jan1.getDay(); // 0=Sun … 6=Sat
  const daysToMonday = dow === 0 ? 6 : dow - 1;
  const start = new Date(jan1);
  start.setDate(jan1.getDate() - daysToMonday);

  const weeks: string[][] = [];
  const d = new Date(start);
  for (let w = 0; w < 53; w++) {
    const week: string[] = [];
    for (let day = 0; day < 7; day++) {
      week.push(d.toISOString().slice(0, 10));
      d.setDate(d.getDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function getHeatColor(completed: number, inYear: boolean): string {
  if (!inYear) return "bg-[#252628]";
  if (completed === 0) return "bg-[#2f3133]";
  if (completed === 1) return "bg-[#a78bfa]/30";
  if (completed <= 3) return "bg-[#a78bfa]/55";
  if (completed <= 5) return "bg-[#a78bfa]/80";
  return "bg-[#a78bfa]";
}

const DAY_INITIALS = ["S", "T", "Q", "Q", "S", "S", "D"]; // Seg–Dom

export function DashboardView({ onBack }: DashboardViewProps) {
  const year = 2026;
  const weeks = getHeatmapWeeks(year);

  const [data, setData] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  useEffect(() => {
    const tz =
      typeof Intl !== "undefined"
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : "America/Sao_Paulo";
    fetch(`/api/stats?year=${year}&tz=${encodeURIComponent(tz)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: StatsData) => {
        setData(d);
        setLoading(false);
      })
      .catch(() => {
        setError("Não foi possível carregar as estatísticas.");
        setLoading(false);
      });
  }, []);

  // Month labels: first column where that month appears inside the year
  const monthLabels: { col: number; label: string }[] = [];
  {
    let lastMonth = -1;
    weeks.forEach((week, col) => {
      // Use Monday (index 0) of the week to determine the month
      const monthStr = week[0].slice(5, 7);
      const month = parseInt(monthStr, 10) - 1;
      if (week[0].startsWith(`${year}-`) && month !== lastMonth) {
        const LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
        monthLabels.push({ col, label: LABELS[month] });
        lastMonth = month;
      }
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const maxMonthTotal = data ? Math.max(...data.byMonth.map((m) => m.total), 1) : 1;
  const currentMonthIndex = new Date().getMonth(); // 0-indexed
  const currentYear = new Date().getFullYear();

  const bestDayLabel =
    data?.bestDay
      ? format(parseISO(data.bestDay.date), "d 'de' MMM", { locale: ptBR })
      : "—";

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-[#202124]">
      {/* Dashboard header */}
      <div className="flex-shrink-0 px-3 py-3 border-b border-[#3c4043] bg-[#202124]">
        <p className="text-sm font-semibold text-[#e8eaed]">Desempenho {year}</p>
        <p className="text-xs text-[#9aa0a6]">Eventos concluídos</p>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-3 space-y-3 pb-8">

          {/* Loading */}
          {loading && (
            <div className="flex justify-center items-center py-20">
              <div className="w-6 h-6 border-2 border-[#8ab4f8]/30 border-t-[#8ab4f8] rounded-full animate-spin" />
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="flex justify-center items-center py-20">
              <p className="text-sm text-[#f28b82]">{error}</p>
            </div>
          )}

          {/* Content */}
          {!loading && data && (
            <>
              {/* Summary Cards — 2 cols on mobile, 4 on sm+ */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {/* Completed */}
                <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-3">
                  <p className="text-[11px] text-[#9aa0a6] mb-1.5">Concluídos</p>
                  <p className="text-3xl font-bold text-white leading-none">{data.totals.completed}</p>
                  <p className="text-[11px] text-[#9aa0a6] mt-1.5">
                    de {data.totals.total} evento{data.totals.total !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Rate */}
                <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-3">
                  <p className="text-[11px] text-[#9aa0a6] mb-1.5">Taxa</p>
                  <p className="text-3xl font-bold text-white leading-none">{data.totals.rate}%</p>
                  <div className="mt-2 h-1.5 rounded-full bg-[#3c4043] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#8ab4f8] transition-all"
                      style={{ width: `${data.totals.rate}%` }}
                    />
                  </div>
                </div>

                {/* Streak */}
                <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-3">
                  <p className="text-[11px] text-[#9aa0a6] mb-1.5">Sequência</p>
                  <p className="text-3xl font-bold text-white leading-none">{data.streak.current}</p>
                  <p className="text-[11px] text-[#9aa0a6] mt-1.5">
                    melhor: {data.streak.best} dia{data.streak.best !== 1 ? "s" : ""}
                  </p>
                </div>

                {/* Best day */}
                <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-3">
                  <p className="text-[11px] text-[#9aa0a6] mb-1.5">Melhor dia</p>
                  <p className="text-3xl font-bold text-[#e8eaed] leading-none">
                    {data.bestDay?.completed ?? 0}
                  </p>
                  <p className="text-[11px] text-[#9aa0a6] mt-1.5">{bestDayLabel}</p>
                </div>
              </div>

              {/* Heatmap */}
              <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-3">
                <p className="text-xs font-medium text-[#9aa0a6] mb-3">Atividade diária</p>
                <div className="overflow-x-auto">
                  <div className="inline-block">
                    {/* Month labels row */}
                    <div className="flex mb-1 ml-6">
                      {weeks.map((week, col) => {
                        const lbl = monthLabels.find((m) => m.col === col);
                        return (
                          <div key={col} className="w-3.5 mr-[3px] text-[9px] text-[#9aa0a6]">
                            {lbl ? lbl.label : ""}
                          </div>
                        );
                      })}
                    </div>

                    {/* Grid */}
                    <div className="flex gap-[3px]">
                      {/* Day-of-week labels */}
                      <div className="flex flex-col gap-[3px] mr-1 w-4">
                        {DAY_INITIALS.map((lbl, i) => (
                          <div
                            key={i}
                            className={`h-3.5 flex items-center text-[9px] text-[#9aa0a6] ${
                              i % 2 === 0 ? "opacity-100" : "opacity-0"
                            }`}
                          >
                            {lbl}
                          </div>
                        ))}
                      </div>

                      {/* Week columns */}
                      {weeks.map((week, col) => (
                        <div key={col} className="flex flex-col gap-[3px]">
                          {week.map((dateKey) => {
                            const inYear = dateKey.startsWith(`${year}-`);
                            const dayData = data.byDay[dateKey];
                            const completed = dayData?.completed ?? 0;
                            const total = dayData?.total ?? 0;
                            const isToday = dateKey === today;

                            return (
                              <div
                                key={dateKey}
                                className={[
                                  "w-3.5 h-3.5 rounded-sm cursor-pointer",
                                  getHeatColor(completed, inYear),
                                  !inYear ? "opacity-25" : "",
                                  isToday ? "ring-1 ring-[#8ab4f8] ring-offset-1 ring-offset-[#2a2b2e]" : "",
                                ].join(" ")}
                                onMouseEnter={(e) => {
                                  if (!inYear) return;
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  const d = parseISO(dateKey);
                                  setTooltip({
                                    x: rect.left + rect.width / 2,
                                    y: rect.top,
                                    text: `${format(d, "d MMM", { locale: ptBR })} · ${completed} concluído${completed !== 1 ? "s" : ""} / ${total} total`,
                                  });
                                }}
                                onMouseLeave={() => setTooltip(null)}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>

                    {/* Legend */}
                    <div className="flex items-center gap-1.5 mt-3 ml-6">
                      <span className="text-[9px] text-[#9aa0a6]">Menos</span>
                      {[0, 1, 2, 4, 6].map((n) => (
                        <div key={n} className={`w-3 h-3 rounded-sm ${getHeatColor(n, true)}`} />
                      ))}
                      <span className="text-[9px] text-[#9aa0a6]">Mais</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Monthly Bar Chart */}
              <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-3">
                <p className="text-xs font-medium text-[#9aa0a6] mb-3">Conclusões por mês</p>

                {/* Bars — pixel heights to avoid % issues inside flex containers */}
                <div className="flex items-end gap-1">
                  {data.byMonth.map((m) => {
                    const BAR_MAX_PX = 96;
                    const isPastOrCurrent =
                      year < currentYear ||
                      (year === currentYear && m.month <= currentMonthIndex + 1);
                    const isCurrent = year === currentYear && m.month === currentMonthIndex + 1;
                    const totalPx = m.total > 0
                      ? Math.max(Math.round((m.total / maxMonthTotal) * BAR_MAX_PX), 4)
                      : 0;
                    const completedPx = m.completed > 0 && totalPx > 0
                      ? Math.max(Math.round((m.completed / m.total) * totalPx), 2)
                      : 0;

                    return (
                      <div key={m.month} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                        {/* Fixed-height bar area so all columns align at bottom */}
                        <div className="w-full flex items-end" style={{ height: BAR_MAX_PX }}>
                          {isPastOrCurrent && totalPx > 0 ? (
                            <div
                              className="w-full relative rounded-t-sm overflow-hidden"
                              style={{ height: totalPx }}
                            >
                              {/* Total (background) */}
                              <div className="absolute inset-0 bg-[#3c4043]" />
                              {/* Completed (foreground from bottom) */}
                              {completedPx > 0 && (
                                <div
                                  className="absolute bottom-0 left-0 right-0 bg-[#a78bfa]/85"
                                  style={{ height: completedPx }}
                                />
                              )}
                            </div>
                          ) : !isPastOrCurrent ? (
                            <div className="w-full border-t border-dashed border-[#3c4043]/50" />
                          ) : null}
                        </div>

                        {/* Labels */}
                        <p className={`text-[9px] font-medium leading-none ${isCurrent ? "text-[#8ab4f8]" : "text-[#9aa0a6]"}`}>
                          {m.label}
                        </p>
                        {m.completed > 0 ? (
                          <p className="text-[8px] text-[#a78bfa]/90 leading-none">{m.completed}</p>
                        ) : (
                          <p className="text-[8px] leading-none opacity-0">0</p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex items-center gap-4 mt-3 text-[10px] text-[#9aa0a6]">
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-[#3c4043]" />
                    <span>Total</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm bg-[#a78bfa]/85" />
                    <span>Concluídos</span>
                  </div>
                </div>
              </div>

              {/* Monthly breakdown table — visible on md+ */}
              <div className="rounded-xl border border-[#3c4043] bg-[#2a2b2e] p-3 hidden sm:block">
                <p className="text-xs font-medium text-[#9aa0a6] mb-3">Detalhamento mensal</p>
                <div className="space-y-1.5">
                  {data.byMonth.filter((m) => m.total > 0).map((m) => {
                    const rate = m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0;
                    const isCurrent = year === currentYear && m.month === currentMonthIndex + 1;
                    return (
                      <div key={m.month} className="flex items-center gap-3">
                        <span
                          className={`text-xs w-7 flex-shrink-0 ${
                            isCurrent ? "text-[#8ab4f8] font-medium" : "text-[#9aa0a6]"
                          }`}
                        >
                          {m.label}
                        </span>
                        <div className="flex-1 h-1.5 rounded-full bg-[#3c4043] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[#a78bfa]/80"
                            style={{ width: `${rate}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-[#9aa0a6] w-20 text-right flex-shrink-0">
                          {m.completed}/{m.total} ({rate}%)
                        </span>
                      </div>
                    );
                  })}
                  {data.byMonth.every((m) => m.total === 0) && (
                    <p className="text-xs text-[#9aa0a6]">Nenhum dado disponível.</p>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div
          className="fixed z-[9999] px-2 py-1 rounded bg-[#3c4043] text-[10px] text-[#e8eaed] pointer-events-none whitespace-nowrap shadow-lg"
          style={{
            left: tooltip.x,
            top: tooltip.y - 6,
            transform: "translate(-50%, -100%)",
          }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
