import type { FlowTask } from "@/types/task";
import { computeDaysOpen } from "./aging";
import { getDelegateKey } from "./delegation";
import { getTaskGridDateKey } from "./timezone";
import { normalizeText } from "./text";

/**
 * Lógica da API da secretária — funções puras sobre `FlowTask`.
 * Mantida sem I/O pra ser testável de forma isolada.
 */

export type EventStatus = "aberto" | "concluido" | "cancelado" | "recusado";

export const EVENT_STATUSES: EventStatus[] = ["aberto", "concluido", "cancelado", "recusado"];

/** Limite máximo de itens por página. */
export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 100;
/** Janela máxima de uma consulta de listagem (dias). */
export const MAX_RANGE_DAYS = 366;

/**
 * Calendários que não são tarefas — feriados e datas comemorativas.
 * Entram na lista só com `?incluir_feriados=true`.
 * Mesmo critério já usado em /api/tasks/kanban.
 */
export const EXCLUDED_CALENDAR_NAMES = ["feriado"];

export function isExcludedCalendar(task: FlowTask): boolean {
  const name = (task.calendarName ?? "").toLowerCase();
  return EXCLUDED_CALENDAR_NAMES.some((ex) => name.includes(ex));
}

export interface SecretariaEvent {
  id: string;
  titulo: string;
  agenda: string;
  agenda_id: string;
  /** ISO 8601 com offset (-03:00). Em dia inteiro, só a data (YYYY-MM-DD). */
  inicio: string;
  fim: string;
  /** DateKey YYYY-MM-DD do dia do evento. */
  dia: string;
  dia_inteiro: boolean;
  status: EventStatus;
  /** Nome de quem foi responsável (delegação). */
  responsavel?: string;
  responsavel_email?: string;
  /** ISO 8601 — última modificação no Google Calendar. */
  atualizado_em?: string;
  dias_em_aberto: number;
  descricao?: string;
  local?: string;
  importante: boolean;
  delegavel: boolean;
  recorrente: boolean;
  categoria?: string;
  pilar?: string;
  convidados: string[];
}

export interface EventFilters {
  /** Nome da agenda (parcial, sem acento) ou id do calendário. */
  agenda?: string;
  /** DateKey YYYY-MM-DD inicial. */
  de?: string;
  /** DateKey YYYY-MM-DD final. */
  ate?: string;
  status?: EventStatus[];
  /** Inclui feriados e datas comemorativas (padrão: não). */
  incluirFeriados?: boolean;
  timeZone: string;
}

/** Status derivado — o Google não tem um campo "status" único (conclusão e cancelamento são flags). */
export function deriveStatus(task: FlowTask): EventStatus {
  if (task.isCancelled) return "cancelado";
  if (task.isComplete) return "concluido";
  if (task.selfResponseStatus === "declined") return "recusado";
  return "aberto";
}

export function toSecretariaEvent(task: FlowTask, timeZone: string): SecretariaEvent {
  return {
    id: task.id,
    titulo: task.title,
    agenda: task.calendarName?.trim() || "primário",
    agenda_id: task.calendarId ?? "primary",
    inicio: task.startTime,
    fim: task.endTime,
    dia: task.startTime ? getTaskGridDateKey(task.startTime, task.isAllDay, timeZone) : "",
    dia_inteiro: task.isAllDay,
    status: deriveStatus(task),
    responsavel: task.delegateTo?.name?.trim() || undefined,
    responsavel_email: task.delegateTo?.email || undefined,
    atualizado_em: task.updatedAt,
    dias_em_aberto: computeDaysOpen(task, timeZone),
    descricao: task.description,
    local: task.meetingUrl,
    importante: !!task.isImportant,
    delegavel: !!task.isDelegable,
    recorrente: !!task.isRecurring,
    categoria: task.category,
    pilar: task.pillar,
    convidados: (task.attendees ?? [])
      .map((a) => a.name?.trim() || a.email || "Convidado")
      .filter(Boolean),
  };
}

export function matchesAgenda(task: FlowTask, agenda: string): boolean {
  const query = normalizeText(agenda);
  if (!query) return true;
  const name = normalizeText(task.calendarName ?? "");
  const id = (task.calendarId ?? "").toLowerCase();
  const rawId = agenda.trim().toLowerCase();
  return name.includes(query) || id === rawId || id.includes(query);
}

export function matchesStatus(task: FlowTask, status: EventStatus[]): boolean {
  if (!status.length) return true;
  return status.includes(deriveStatus(task));
}

/** Filtra por agenda, período e status. */
export function filterEvents(tasks: FlowTask[], filters: EventFilters): FlowTask[] {
  return tasks.filter((task) => {
    if (!filters.incluirFeriados && isExcludedCalendar(task)) return false;
    if (filters.agenda && !matchesAgenda(task, filters.agenda)) return false;
    if (!matchesStatus(task, filters.status ?? [])) return false;
    if (filters.de || filters.ate) {
      if (!task.startTime) return false;
      const dia = getTaskGridDateKey(task.startTime, task.isAllDay, filters.timeZone);
      if (filters.de && dia < filters.de) return false;
      if (filters.ate && dia > filters.ate) return false;
    }
    return true;
  });
}

/**
 * Eventos que começam dentro da janela [agora, agora + minutos].
 * Cancelados, concluídos e recusados ficam de fora — é o que a secretária precisa avisar.
 */
export function findUpcoming(
  tasks: FlowTask[],
  nowMs: number,
  minutos: number,
  timeZone: string,
  incluirFeriados = false
): FlowTask[] {
  const limitMs = nowMs + minutos * 60_000;
  return tasks
    .filter((task) => {
      if (!incluirFeriados && isExcludedCalendar(task)) return false;
      if (task.isCancelled || task.isComplete) return false;
      if (task.selfResponseStatus === "declined") return false;
      if (!task.startTime) return false;
      const start = new Date(task.startTime).getTime();
      if (Number.isNaN(start)) return false;
      return start >= nowMs && start <= limitMs;
    })
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

/**
 * Eventos em aberto: vencidos (início já passou) ou parados há X dias.
 * `diasParado` = 0 devolve só os vencidos.
 */
export function findOpenTasks(
  tasks: FlowTask[],
  nowMs: number,
  diasParado: number,
  timeZone: string,
  incluirFeriados = false
): FlowTask[] {
  return tasks
    .filter((task) => {
      if (!incluirFeriados && isExcludedCalendar(task)) return false;
      if (task.isCancelled || task.isComplete) return false;
      if (task.selfResponseStatus === "declined") return false;
      const diasEmAberto = computeDaysOpen(task, timeZone);
      const vencido = !!task.startTime && new Date(task.startTime).getTime() < nowMs;
      if (diasParado > 0) return vencido || diasEmAberto >= diasParado;
      return vencido;
    })
    .sort((a, b) => {
      const dias = computeDaysOpen(b, timeZone) - computeDaysOpen(a, timeZone);
      if (dias !== 0) return dias;
      return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
    });
}

/** Eventos delegados a uma pessoa — comparação por nome (sem acento/caixa) ou e-mail. */
export function findByResponsavel(
  tasks: FlowTask[],
  pessoa: string,
  incluirFeriados = false
): FlowTask[] {
  const query = normalizeText(pessoa);
  if (!query) return [];
  return tasks.filter((task) => {
    if (!incluirFeriados && isExcludedCalendar(task)) return false;
    const delegate = task.delegateTo;
    if (!delegate) return false;
    const name = normalizeText(delegate.name ?? "");
    const email = (delegate.email ?? "").toLowerCase();
    return (name && name.includes(query)) || (email && email.includes(query));
  });
}

/** Chave de agrupamento do responsável (nome normalizado, fallback e-mail). */
export function responsavelKey(task: FlowTask): string {
  if (!task.delegateTo) return "";
  return getDelegateKey(task.delegateTo);
}

export interface Pagination {
  total: number;
  limite: number;
  offset: number;
}

export function paginate<T>(items: T[], limite?: number, offset?: number): { dados: T[]; paginacao: Pagination } {
  const total = items.length;
  const limit = Math.min(Math.max(Math.floor(limite ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
  const off = Math.max(Math.floor(offset ?? 0), 0);
  return {
    dados: items.slice(off, off + limit),
    paginacao: { total, limite: limit, offset: off },
  };
}

/** Converte o parâmetro `status` (csv) numa lista de status válidos. */
export function parseStatusParam(raw: string | null): EventStatus[] | null {
  if (!raw) return null;
  const parts = raw
    .split(",")
    .map((s) => normalizeText(s))
    .filter(Boolean);
  const valid = parts.filter((s): s is EventStatus => (EVENT_STATUSES as string[]).includes(s));
  return valid;
}

/** Valida um DateKey YYYY-MM-DD. */
export function isDateKeyParam(value: string | null): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}
