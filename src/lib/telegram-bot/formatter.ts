// Formatadores para mensagens do Telegram. Tudo que vai pra `parse_mode: "HTML"`
// precisa passar por escapeHtml() — a API do Telegram rejeita 400 com `<`/`>`/`&` crus.

import type { FlowTask } from "@/types/task";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatDateBr(dateKey: string, timeZone: string): string {
  // dateKey = "YYYY-MM-DD" — meio-dia UTC evita drift de fuso.
  const [y, m, d] = dateKey.split("-").map(Number);
  const sample = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone,
  }).format(sample);
}

export function formatTimeRange(startIso: string, endIso: string, timeZone: string): string {
  const start = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    hour12: false,
  }).format(new Date(startIso));
  const end = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
    hour12: false,
  }).format(new Date(endIso));
  return `${start}–${end}`;
}

export function formatTaskLine(task: FlowTask, timeZone: string): string {
  const title = escapeHtml(task.title);
  const cal = task.calendarName && task.calendarName.toLowerCase() !== "primary"
    ? ` <i>· ${escapeHtml(task.calendarName)}</i>`
    : "";
  if (task.isAllDay) {
    return `• <b>${title}</b> (dia inteiro)${cal}`;
  }
  const time = formatTimeRange(task.startTime, task.endTime, timeZone);
  return `• <b>${time}</b>  ${title}${cal}`;
}

const TELEGRAM_MAX = 4096;
const SAFE_LIMIT = 4000; // margem para prefixo e sufixo

export function formatTaskList(tasks: FlowTask[], timeZone: string, header: string): string {
  if (tasks.length === 0) return `${header}\nNada na agenda.`;
  const lines = tasks.map((t) => formatTaskLine(t, timeZone));
  let body = lines.join("\n");
  if (body.length > SAFE_LIMIT) {
    const truncated: string[] = [];
    let used = 0;
    for (const line of lines) {
      if (used + line.length + 1 > SAFE_LIMIT) break;
      truncated.push(line);
      used += line.length + 1;
    }
    const remaining = tasks.length - truncated.length;
    body = truncated.join("\n") + `\n<i>(+${remaining} outros — use /buscar para filtrar)</i>`;
  }
  return `${header}\n${body}`;
}
