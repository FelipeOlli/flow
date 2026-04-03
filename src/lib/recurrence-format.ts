/**
 * Formata regras RRULE do Google Calendar para exibição em português.
 * Instâncias expandidas (singleEvents: true) costumam trazer só recurringEventId, sem o RRULE.
 */

const WEEKDAY_PT: Record<string, string> = {
  SU: "dom",
  MO: "seg",
  TU: "ter",
  WE: "qua",
  TH: "qui",
  FR: "sex",
  SA: "sáb",
};

function parseRruleParams(rruleLine: string): Record<string, string> {
  const raw = rruleLine.replace(/^RRULE:/i, "").trim();
  const params: Record<string, string> = {};
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim().toUpperCase();
    const v = part.slice(eq + 1).trim();
    params[k] = v;
  }
  return params;
}

function freqBaseLabel(freq: string, interval: number): string {
  const n = interval > 1 ? interval : 1;
  const every = n > 1 ? `A cada ${n} ` : "";
  const plural = n > 1;

  switch (freq.toUpperCase()) {
    case "DAILY":
      return plural ? `${every}dias` : "Diariamente";
    case "WEEKLY":
      return plural ? `${every}semanas` : "Semanalmente";
    case "MONTHLY":
      return plural ? `${every}meses` : "Mensalmente";
    case "YEARLY":
      return plural ? `${every}anos` : "Anualmente";
    default:
      return "Recorrente";
  }
}

function formatByDay(byDay: string): string {
  const days = byDay.split(",").map((d) => {
    const letters = d.trim().toUpperCase().replace(/^[-+]?\d+/, "");
    return WEEKDAY_PT[letters] ?? letters.toLowerCase();
  });
  return days.join(", ");
}

function parseUntil(untilRaw: string): Date | null {
  const u = untilRaw.trim();
  if (/^\d{8}T\d{6}Z?$/i.test(u)) {
    const y = u.slice(0, 4);
    const mo = u.slice(4, 6);
    const day = u.slice(6, 8);
    const time = u.slice(9).replace(/Z$/i, "");
    const h = time.slice(0, 2);
    const min = time.slice(2, 4);
    const s = time.slice(4, 6);
    const d = new Date(`${y}-${mo}-${day}T${h}:${min}:${s}Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{8}$/.test(u)) {
    const y = u.slice(0, 4);
    const mo = u.slice(4, 6);
    const day = u.slice(6, 8);
    const d = new Date(`${y}-${mo}-${day}T23:59:59Z`);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(u);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface RecurrenceDisplay {
  isRecurring: boolean;
  /** Linha principal: "Semanalmente (seg, qua)" */
  summary: string;
  /** "Termina em 31/12/2027" ou "Termina após 10 ocorrências" */
  endHint?: string;
}

export function formatGoogleRecurrence(
  recurrence: string[] | null | undefined,
  recurringEventId?: string | null
): RecurrenceDisplay {
  const rruleLine = recurrence?.find((r) => r.trim().toUpperCase().startsWith("RRULE"));
  const isSeriesMaster = Boolean(rruleLine);
  const isInstance = Boolean(recurringEventId);
  const isRecurring = isSeriesMaster || isInstance;

  if (!isRecurring) {
    return { isRecurring: false, summary: "" };
  }

  if (!rruleLine) {
    return {
      isRecurring: true,
      summary: "Evento recorrente",
      endHint: "Esta é uma ocorrência da série. A regra completa está no Google Agenda.",
    };
  }

  const p = parseRruleParams(rruleLine);
  const freq = p.FREQ ?? "WEEKLY";
  const interval = Math.max(1, parseInt(p.INTERVAL ?? "1", 10) || 1);
  let summary = freqBaseLabel(freq, interval);
  if (p.BYDAY) {
    summary += ` (${formatByDay(p.BYDAY)})`;
  }

  let endHint: string | undefined;
  if (p.UNTIL) {
    const untilDate = parseUntil(p.UNTIL);
    if (untilDate) {
      endHint = `Termina em ${untilDate.toLocaleDateString("pt-BR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })}`;
    } else {
      endHint = "Tem data de término definida (UNTIL)";
    }
  } else if (p.COUNT) {
    const c = parseInt(p.COUNT, 10);
    if (!Number.isNaN(c) && c > 0) {
      endHint = `Termina após ${c} ocorrência${c === 1 ? "" : "s"}`;
    }
  } else {
    endHint = "Sem data de término (série contínua)";
  }

  return { isRecurring: true, summary, endHint };
}
