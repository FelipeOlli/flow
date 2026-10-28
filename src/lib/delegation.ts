import { FlowTask, TaskDelegate } from "@/types/task";
import { diffDateKeysInDays, getDateKeyInTimeZone, getTaskGridDateKey } from "./timezone";

/** Chave de comparação de nomes: sem acento, minúscula. */
export function normalizeDelegateName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

export type DelegationStatus = "overdue" | "today" | "upcoming";

export interface DelegationItem {
  task: FlowTask;
  /** DateKey (YYYY-MM-DD) do prazo — dia do início do evento. */
  dueDateKey: string;
  status: DelegationStatus;
  /** Dias de atraso (0 quando não está atrasado). */
  daysLate: number;
}

export interface DelegationGroup {
  /** Chave de agrupamento: nome normalizado (fallback: e-mail). */
  key: string;
  email?: string;
  name: string;
  items: DelegationItem[];
  overdue: DelegationItem[];
  today: DelegationItem[];
  upcoming: DelegationItem[];
}

/**
 * Identidade do responsável: o nome é a chave. O e-mail só entra como
 * informação extra (quando o responsável é um convidado do evento).
 */
export function getDelegateKey(delegate: TaskDelegate): string {
  const name = delegate.name?.trim();
  if (name) return normalizeDelegateName(name);
  return delegate.email?.trim().toLowerCase() ?? "";
}

export function getDelegateLabel(delegate: TaskDelegate): string {
  return delegate.name?.trim() || delegate.email?.trim() || "";
}

/**
 * Prazo do evento = dia do seu início.
 * Evento de dia inteiro usa o prefixo literal da data (evita o drift de UTC);
 * evento com hora usa o timezone do app.
 */
export function getDelegationDueDateKey(task: FlowTask, timeZone: string): string | null {
  if (!task.startTime) return null;
  try {
    return getTaskGridDateKey(task.startTime, task.isAllDay, timeZone);
  } catch {
    return null;
  }
}

/** Classifica o evento em atraso / vence hoje / futuro. */
export function getDelegationStatus(
  task: FlowTask,
  todayKey: string,
  timeZone: string
): DelegationItem | null {
  const dueDateKey = getDelegationDueDateKey(task, timeZone);
  if (!dueDateKey) return null;
  const status: DelegationStatus =
    dueDateKey < todayKey ? "overdue" : dueDateKey === todayKey ? "today" : "upcoming";
  const daysLate = status === "overdue" ? diffDateKeysInDays(dueDateKey, todayKey) : 0;
  return { task, dueDateKey, status, daysLate };
}

/** Agrupa eventos delegados por responsável, ordenando o mais atrasado primeiro. */
export function groupDelegations(tasks: FlowTask[], timeZone: string): DelegationGroup[] {
  const todayKey = getDateKeyInTimeZone(new Date(), timeZone);
  const groups = new Map<string, DelegationGroup>();

  for (const task of tasks) {
    const delegate = task.delegateTo;
    if (!delegate?.name?.trim() && !delegate?.email?.trim()) continue;
    const item = getDelegationStatus(task, todayKey, timeZone);
    if (!item) continue;

    const key = getDelegateKey(delegate);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        email: delegate.email,
        name: getDelegateLabel(delegate),
        items: [],
        overdue: [],
        today: [],
        upcoming: [],
      };
      groups.set(key, group);
    }
    // Um nome mais completo registrado depois substitui o que estava no grupo.
    if (delegate.name?.trim() && (!group.name || group.name === group.email)) {
      group.name = delegate.name.trim();
    }
    if (!group.email && delegate.email) group.email = delegate.email;

    group.items.push(item);
    if (item.status === "overdue") group.overdue.push(item);
    else if (item.status === "today") group.today.push(item);
    else group.upcoming.push(item);
  }

  const byDueDate = (a: DelegationItem, b: DelegationItem) => a.dueDateKey.localeCompare(b.dueDateKey);
  const result = Array.from(groups.values());
  for (const group of result) {
    group.items.sort(byDueDate);
    group.overdue.sort(byDueDate);
    group.today.sort(byDueDate);
    group.upcoming.sort(byDueDate);
  }
  result.sort((a, b) => {
    if (b.overdue.length !== a.overdue.length) return b.overdue.length - a.overdue.length;
    if (b.today.length !== a.today.length) return b.today.length - a.today.length;
    return a.name.localeCompare(b.name, "pt-BR");
  });
  return result;
}

/** Total de delegações atrasadas — usado no badge do header. */
export function countOverdue(tasks: FlowTask[], timeZone: string): number {
  const todayKey = getDateKeyInTimeZone(new Date(), timeZone);
  let count = 0;
  for (const task of tasks) {
    if (!task.delegateTo?.name?.trim() && !task.delegateTo?.email?.trim()) continue;
    const item = getDelegationStatus(task, todayKey, timeZone);
    if (item?.status === "overdue") count++;
  }
  return count;
}
