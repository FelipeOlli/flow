"use client";

import { FlowTask } from "@/types/task";

export const CALENDAR_DIMENSIONS = {
  DAY_START: 0,
  DAY_END: 23,
  HOUR_PX: 56,
  MIN_EVENT_HEIGHT: 20,
  TIME_GUTTER_WIDTH: 44,
  GRID_SIDE_PADDING: 12,
  BOTTOM_SPACER_PX: 96,
} as const;

/** Above TaskBlock stacking (100 + minutes-in-day; see TaskBlock.tsx). */
export const CURRENT_TIME_LINE_Z_INDEX = 2000;

export const HOURS = Array.from(
  { length: CALENDAR_DIMENSIONS.DAY_END - CALENDAR_DIMENSIONS.DAY_START + 1 },
  (_, i) => i + CALENDAR_DIMENSIONS.DAY_START
);

export function formatHourLabel(hour: number): string {
  return String(hour).padStart(2, "0");
}

export function timeToY(iso: string): number {
  const d = new Date(iso);
  const raw =
    (d.getHours() - CALENDAR_DIMENSIONS.DAY_START + d.getMinutes() / 60) * CALENDAR_DIMENSIONS.HOUR_PX;
  return Math.max(0, raw);
}

export function durationToPx(start: string, end: string): number {
  const mins = (new Date(end).getTime() - new Date(start).getTime()) / 60000;
  return Math.max((mins / 60) * CALENDAR_DIMENSIONS.HOUR_PX, CALENDAR_DIMENSIONS.MIN_EVENT_HEIGHT);
}

export function currentTimeY(): number {
  const now = new Date();
  return ((now.getHours() - CALENDAR_DIMENSIONS.DAY_START) + now.getMinutes() / 60) * CALENDAR_DIMENSIONS.HOUR_PX;
}

export function yToTime(y: number, baseDate: Date): Date {
  const totalMins = Math.round((y / CALENDAR_DIMENSIONS.HOUR_PX) * 60 / 30) * 30;
  const time = new Date(baseDate);
  time.setHours(CALENDAR_DIMENSIONS.DAY_START + Math.floor(totalMins / 60), totalMins % 60, 0, 0);
  return time;
}

export function snapY(y: number): number {
  return Math.round(y / (CALENDAR_DIMENSIONS.HOUR_PX / 2)) * (CALENDAR_DIMENSIONS.HOUR_PX / 2);
}

/** Durações padrão de slot para sugestão de horário livre (conflitos). */
export const SLOT_DURATIONS = [
  { mins: 5, label: "5m" },
  { mins: 10, label: "10m" },
  { mins: 15, label: "15m" },
  { mins: 30, label: "30m" },
  { mins: 60, label: "1h" },
  { mins: 90, label: "1,5h" },
  { mins: 120, label: "2h" },
];

/** Retorna true se os dois intervalos se sobrepõem (extremidades exclusivas). */
export function eventsConflict(
  startA: number, endA: number,
  startB: number, endB: number,
): boolean {
  return startA < endB && endA > startB;
}

/** Evento que não ocupa mais o horário: cancelado pelo organizador ou recusado por mim. */
export function isFreedSlot(task: FlowTask): boolean {
  const t = task as FlowTask & { selfResponseStatus?: string };
  return Boolean(t.isCancelled) || t.selfResponseStatus === "declined";
}

/**
 * Retorna os eventos de `tasks` que conflitam com o intervalo [startIso, endIso].
 * Ignora all-day, cancelados, recusados, concluídos e eventos de outros dias.
 * `excludeId` permite ignorar o próprio evento (útil na edição).
 */
export function findConflicts(
  startIso: string,
  endIso: string,
  tasks: FlowTask[],
  excludeId?: string,
): FlowTask[] {
  const start = new Date(startIso).getTime();
  const end   = new Date(endIso).getTime();
  const dayKey = startIso.slice(0, 10); // YYYY-MM-DD

  return tasks.filter((t) => {
    if (t.isAllDay) return false;
    if (isFreedSlot(t)) return false;
    if (t.isComplete) return false;
    if (excludeId && t.id === excludeId) return false;
    if (!t.startTime.startsWith(dayKey)) return false;
    const s = new Date(t.startTime).getTime();
    const e = new Date(t.endTime).getTime();
    return eventsConflict(start, end, s, e);
  });
}

/**
 * Para cada duração em SLOT_DURATIONS, encontra o primeiro horário livre
 * >= desiredStartIso no mesmo dia. Retorna só as durações que cabem no dia.
 */
export function suggestFreeSlots(
  desiredStartIso: string,
  tasks: FlowTask[],
  excludeId?: string,
): { mins: number; label: string; startIso: string }[] {
  const dayKey       = desiredStartIso.slice(0, 10);
  const desiredStart = new Date(desiredStartIso).getTime();

  // Eventos ocupados do dia (sem all-day, cancelados, recusados, concluídos)
  const occupied = tasks.filter((t) => {
    if (t.isAllDay) return false;
    if (isFreedSlot(t)) return false;
    if (t.isComplete) return false;
    if (excludeId && t.id === excludeId) return false;
    return t.startTime.startsWith(dayKey);
  });

  // Fim do dia útil do grid
  const dayEndDate = new Date(desiredStartIso);
  dayEndDate.setHours(CALENDAR_DIMENSIONS.DAY_END, 0, 0, 0);
  const dayEnd = dayEndDate.getTime();

  return SLOT_DURATIONS.map(({ mins, label }) => {
    const durMs = mins * 60_000;

    // Candidatos = desiredStart + fins de eventos ocupados que começam após desiredStart
    const candidates = [
      desiredStart,
      ...occupied
        .map((t) => new Date(t.endTime).getTime())
        .filter((e) => e >= desiredStart),
    ].sort((a, b) => a - b);

    for (const candidateStart of candidates) {
      const candidateEnd = candidateStart + durMs;
      if (candidateEnd > dayEnd) break;
      const conflicts = findConflicts(
        new Date(candidateStart).toISOString(),
        new Date(candidateEnd).toISOString(),
        tasks,
        excludeId,
      );
      if (conflicts.length === 0) {
        return { mins, label, startIso: new Date(candidateStart).toISOString() };
      }
    }
    return null;
  }).filter((s): s is { mins: number; label: string; startIso: string } => s !== null);
}

/**
 * Retorna o conjunto de ids de eventos que se sobrepõem a pelo menos um outro
 * evento pendente com horário (ignora all-day, cancelados, recusados, concluídos).
 */
export function getConflictIds(tasks: FlowTask[]): Set<string> {
  const eligible = tasks.filter((t) => {
    if (t.isAllDay) return false;
    if (t.isCancelled) return false;
    if ((t as FlowTask & { selfResponseStatus?: string }).selfResponseStatus === "declined") return false;
    if (t.isComplete) return false;
    return true;
  });

  const conflictSet = new Set<string>();
  for (let i = 0; i < eligible.length; i++) {
    const s1 = new Date(eligible[i].startTime).getTime();
    const e1 = new Date(eligible[i].endTime).getTime();
    for (let j = i + 1; j < eligible.length; j++) {
      const s2 = new Date(eligible[j].startTime).getTime();
      const e2 = new Date(eligible[j].endTime).getTime();
      if (eventsConflict(s1, e1, s2, e2)) {
        conflictSet.add(eligible[i].id);
        conflictSet.add(eligible[j].id);
      }
    }
  }
  return conflictSet;
}

/** Encurtamento máximo por evento (ms), para calendários sem janela comercial. */
const MAX_SHRINK_MS = 15 * 60_000;
/** Duração mínima de um evento após encurtamento (ms). */
const MIN_DURATION_MS = 5 * 60_000;
/** Hora mínima para alocar eventos no auto-fit (não usa madrugada). */
const WORK_DAY_START_HOUR = 6;
/** Janela comercial (08h–18h) para calendários restritos, ex.: TI CF Contabilidade. */
const BUSINESS_START_HOUR = 8;
const BUSINESS_END_HOUR = 18;

/** Calendários restritos a horário comercial (08h–18h). Match case-insensitive. */
function isBusinessHoursCalendar(calendarName?: string): boolean {
  return (calendarName ?? "").toLowerCase().includes("cf contabilidade");
}

/** Piso/teto (ms) do dia de `refIso`, conforme a regra do calendário. */
function getDayBounds(refIso: string, businessHours: boolean): { floorMs: number; ceilingMs: number } {
  const floorDate = new Date(refIso);
  floorDate.setHours(businessHours ? BUSINESS_START_HOUR : WORK_DAY_START_HOUR, 0, 0, 0);
  const ceilingDate = new Date(refIso);
  ceilingDate.setHours(businessHours ? BUSINESS_END_HOUR : CALENDAR_DIMENSIONS.DAY_END, 0, 0, 0);
  return { floorMs: floorDate.getTime(), ceilingMs: ceilingDate.getTime() };
}

/**
 * Reempacota os eventos com horário de `dateKey` sem sobreposição.
 *
 * Estratégia (por conflito entre A e B):
 *  1. Tenta encurtar B (avança o início, mantém o fim) em até MAX_SHRINK_MS.
 *  2. Se ainda sobrar, tenta recuar o fim de A em até MAX_SHRINK_MS.
 *  3. Se ainda sobrar, empurra B para logo após A (mantém duração original).
 *
 * Âncora: o 1º evento do dia mantém horário original; intervalos livres são
 * preservados (eventos sem conflito ficam onde estão).
 *
 * Retorna `changes` (só os eventos cujo horário realmente mudou) e `overflow`
 * (true se o cursor final passar de DAY_END:00).
 */
export function packDayEvents(
  tasks: FlowTask[],
  dateKey: string,
): { changes: { id: string; startIso: string; endIso: string }[]; overflow: boolean } {
  // Eventos elegíveis do dia, ordenados por início
  type Eligible = FlowTask & { selfResponseStatus?: string };
  const eligible = (tasks as Eligible[])
    .filter(
      (t) =>
        !t.isAllDay &&
        !t.isComplete &&
        !t.isCancelled &&
        t.selfResponseStatus !== "declined" &&
        t.startTime.startsWith(dateKey),
    )
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  if (eligible.length === 0) return { changes: [], overflow: false };

  // Teto geral do dia (calendários sem janela comercial)
  const dayEndDate = new Date(eligible[0].startTime);
  dayEndDate.setHours(CALENDAR_DIMENSIONS.DAY_END, 0, 0, 0);
  const dayEnd = dayEndDate.getTime();

  type Placed = { id: string; origStart: number; origEnd: number; newStart: number; newEnd: number };
  const placed: Placed[] = [];
  let overflow = false;

  /**
   * Aplica piso do calendário (desloca start, preserva duração) e, se TI CF, teto 18h.
   * Evento que estoura o teto mas começa antes dele: encurta pela cauda.
   * Evento inteiramente depois do teto (isolado, sem conflito): puxa para caber
   * antes do teto, preservando duração; se a duração não couber na janela, encurta
   * até MIN_DURATION_MS.
   */
  function clampToCalendarWindow(
    business: boolean,
    floorMs: number,
    ceilingMs: number,
    start: number,
    end: number,
  ): { start: number; end: number } {
    let newStart = start;
    let newEnd = end;
    if (newStart < floorMs) {
      const dur = newEnd - newStart;
      newStart = floorMs;
      newEnd = newStart + dur;
    }
    if (business) {
      if (newStart >= ceilingMs) {
        // Evento inteiro fora da janela: puxa para caber antes do teto
        const dur = newEnd - newStart;
        newStart = Math.max(floorMs, ceilingMs - dur);
        newEnd = newStart + dur;
        if (newEnd > ceilingMs) {
          // Duração maior que a janela inteira: encurta ao mínimo possível
          newEnd = ceilingMs;
          newStart = Math.max(floorMs, newEnd - MIN_DURATION_MS);
        }
        if (newStart > ceilingMs - MIN_DURATION_MS) overflow = true;
      } else if (newEnd > ceilingMs) {
        // Evento estoura o teto pela cauda: encurta mantendo o início
        const maxDur = Math.max(MIN_DURATION_MS, ceilingMs - newStart);
        newEnd = newStart + maxDur;
        if (newStart > ceilingMs - MIN_DURATION_MS) overflow = true;
      }
    }
    return { start: newStart, end: newEnd };
  }

  // 1º evento: âncora — respeita piso do calendário (desloca evento inteiro se necessário)
  const first = eligible[0];
  const firstBusiness = isBusinessHoursCalendar(first.calendarName);
  const { floorMs: firstFloor, ceilingMs: firstCeiling } = getDayBounds(first.startTime, firstBusiness);
  const firstOrigStart = new Date(first.startTime).getTime();
  const firstOrigEnd = new Date(first.endTime).getTime();
  const firstDur = firstOrigEnd - firstOrigStart;
  const firstClamped = clampToCalendarWindow(
    firstBusiness,
    firstFloor,
    firstCeiling,
    firstOrigStart,
    firstOrigStart + firstDur,
  );
  placed.push({
    id: first.id,
    origStart: firstOrigStart,
    origEnd: firstOrigEnd,
    newStart: firstClamped.start,
    newEnd: firstClamped.end,
  });

  for (let i = 1; i < eligible.length; i++) {
    const t = eligible[i];
    const business = isBusinessHoursCalendar(t.calendarName);
    const { floorMs, ceilingMs } = getDayBounds(t.startTime, business);
    const origStart = new Date(t.startTime).getTime();
    const origEnd = new Date(t.endTime).getTime();
    const origDur = origEnd - origStart;
    const prev = placed[placed.length - 1];
    const cursor = prev.newEnd;

    let newStart: number;
    let newEnd: number;

    if (origStart >= cursor) {
      // Sem conflito
      newStart = origStart;
      newEnd = origEnd;
    } else {
      // Há conflito: overlap = quanto B começa antes do fim de A
      const overlap = cursor - origStart;

      // Passo 1: encurtar B (avança início, mantém fim → reduz duração pelo front)
      // TI CF não usa o teto MAX_SHRINK_MS — encurta o quanto precisar até MIN_DURATION_MS
      const shrinkB = business
        ? Math.max(0, Math.min(overlap, origDur - MIN_DURATION_MS))
        : Math.max(0, Math.min(overlap, MAX_SHRINK_MS, origDur - MIN_DURATION_MS));
      let newStartB = origStart + shrinkB;
      let remainingOverlap = Math.max(0, cursor - newStartB);

      // Passo 2: encurtar A (recua fim de A)
      if (remainingOverlap > 0) {
        const aDur = prev.newEnd - prev.newStart;
        const shrinkA = Math.max(0, Math.min(remainingOverlap, MAX_SHRINK_MS, aDur - MIN_DURATION_MS));
        prev.newEnd -= shrinkA;
        remainingOverlap = Math.max(0, prev.newEnd - newStartB);
      }

      // Passo 3: empurrar B se ainda houver sobreposição
      if (remainingOverlap > 0) {
        // Empurra: mantém duração ORIGINAL (não penaliza duas vezes)
        newStartB = prev.newEnd;
        newStart = newStartB;
        newEnd = newStartB + origDur;
      } else {
        // Encurtamento suficiente: B começa em newStartB, fim inalterado
        newStart = newStartB;
        newEnd = origEnd;
      }
    }

    const clamped = clampToCalendarWindow(business, floorMs, ceilingMs, newStart, newEnd);
    placed.push({ id: t.id, origStart, origEnd, newStart: clamped.start, newEnd: clamped.end });
  }

  // Detecta overflow: cursor final passa das 23h, ou algum evento TI CF não coube na janela
  const cursor = placed[placed.length - 1].newEnd;
  overflow = overflow || cursor > dayEnd;

  // Retorna só os que mudaram
  const changes = placed
    .filter((p) => p.newStart !== p.origStart || p.newEnd !== p.origEnd)
    .map((p) => ({
      id: p.id,
      startIso: new Date(p.newStart).toISOString(),
      endIso: new Date(p.newEnd).toISOString(),
    }));

  return { changes, overflow };
}

/**
 * Modelo de layout igual ao Google Calendar:
 * 1. Agrupa eventos em clusters de sobreposição transitiva.
 * 2. Dentro de cada cluster, atribui colunas com algoritmo guloso.
 * 3. Expande cada evento para a direita quando há colunas livres.
 *
 * Eventos cancelados/recusados (`isFreedSlot`) não disputam coluna com os
 * demais — entram como `ghost` (faixa fina), pois o horário está livre.
 *
 * Retorna { task, colStart, colSpan, totalCols, ghost } para cada evento.
 */
export function computeLayout(tasks: FlowTask[]) {
  if (!tasks.length) return [];

  const ghostTasks = tasks.filter(isFreedSlot);
  const blockingTasks = tasks.filter((t) => !isFreedSlot(t));
  const ghostResults = ghostTasks.map((task) => ({
    task, colStart: 0, colSpan: 1, totalCols: 1, ghost: true as const,
  }));

  if (!blockingTasks.length) return ghostResults;

  // Ordena por início; desempate: evento mais longo primeiro (pega coluna 0)
  const sorted = [...blockingTasks].sort((a, b) => {
    const sa = new Date(a.startTime).getTime();
    const sb = new Date(b.startTime).getTime();
    if (sa !== sb) return sa - sb;
    const ea = new Date(a.endTime).getTime();
    const eb = new Date(b.endTime).getTime();
    return eb - ea; // mais longo primeiro
  });

  const starts = sorted.map((t) => new Date(t.startTime).getTime());
  const ends   = sorted.map((t) => new Date(t.endTime).getTime());

  // Resultado por índice
  const colStart = new Array<number>(sorted.length).fill(0);
  const colSpan  = new Array<number>(sorted.length).fill(1);
  const totalCols = new Array<number>(sorted.length).fill(1);

  // Processa cluster por cluster
  let clusterStart = 0;
  while (clusterStart < sorted.length) {
    // Determina o fim do cluster: varre até que nenhum evento seguinte
    // se sobreponha a qualquer evento já no cluster.
    let clusterEnd = clusterStart + 1;
    let clusterMaxEnd = ends[clusterStart];
    while (clusterEnd < sorted.length && starts[clusterEnd] < clusterMaxEnd) {
      if (ends[clusterEnd] > clusterMaxEnd) clusterMaxEnd = ends[clusterEnd];
      clusterEnd++;
    }

    const clusterIdxs = Array.from({ length: clusterEnd - clusterStart }, (_, i) => clusterStart + i);

    // Atribui colunas dentro do cluster (greedy)
    const colEnds: number[] = [];
    const assignedCol = new Array<number>(clusterIdxs.length).fill(0);
    for (let ci = 0; ci < clusterIdxs.length; ci++) {
      const idx = clusterIdxs[ci];
      const s = starts[idx];
      let col = colEnds.findIndex((e) => e <= s);
      if (col === -1) col = colEnds.length;
      colEnds[col] = ends[idx];
      assignedCol[ci] = col;
    }
    const numCols = colEnds.length;

    // Constrói mapa: coluna → lista de (start, end) dos eventos nela
    const colOccupancy: Array<Array<{ s: number; e: number }>> = Array.from(
      { length: numCols },
      () => []
    );
    for (let ci = 0; ci < clusterIdxs.length; ci++) {
      const idx = clusterIdxs[ci];
      colOccupancy[assignedCol[ci]].push({ s: starts[idx], e: ends[idx] });
    }

    // Expansão: para cada evento, estende colSpan enquanto as colunas
    // seguintes não tiverem nenhum evento que se sobreponha a ele.
    for (let ci = 0; ci < clusterIdxs.length; ci++) {
      const idx = clusterIdxs[ci];
      const s = starts[idx];
      const e = ends[idx];
      const baseCol = assignedCol[ci];
      let span = 1;
      for (let c = baseCol + 1; c < numCols; c++) {
        const blocked = colOccupancy[c].some((ev) => ev.s < e && ev.e > s);
        if (blocked) break;
        span++;
      }
      colStart[idx]  = baseCol;
      colSpan[idx]   = span;
      totalCols[idx] = numCols;
    }

    clusterStart = clusterEnd;
  }

  return [
    ...sorted.map((task, i) => ({
      task,
      colStart: colStart[i],
      colSpan: colSpan[i],
      totalCols: totalCols[i],
      ghost: false as const,
    })),
    ...ghostResults,
  ];
}
