// Comandos literais do bot. Cada handler recebe chatId + texto após o comando
// e devolve a string HTML a ser enviada. Erros são capturados no dispatcher.

import {
  getEventsForDateKey,
  getEventsInRange,
  createEvent,
  getEventById,
  markEventComplete,
  deleteEvent,
  listWritableCalendars,
} from "@/lib/google-calendar";
import type { FlowTask, CreateTaskInput } from "@/types/task";
import { getDateKeyInTimeZone, shiftDateKey } from "@/lib/timezone";
import { formatTaskList, formatTaskLine, escapeHtml } from "./formatter";
import { getValidAccessToken } from "@/lib/token-store";
import { popUndo } from "./undo";

export type CommandResult = { text: string; silent?: boolean };

export const HELP_TEXT = `🤖 <b>Flow no Telegram</b>

Comandos:
/hoje — eventos de hoje
/amanha — eventos de amanhã
/semana — próximos 7 dias
/buscar <texto> — busca por palavra-chave
/criar <título> | <YYYY-MM-DD HH:mm> [duração min]
/concluir <id|índice> — marcar como feito
/cancelar <id|índice> — apagar
/undo — desfaz última criação (60s)
/help — esta mensagem

Você também pode mandar frase solta: <i>"reunião João amanhã 15h"</i>, <i>"o que tenho quinta?"</i>, <i>"cancela a call das 10"</i>.`;

const MAX_LIST_FOR_INDEX = 30; // pra /concluir e /cancelar com índice

export async function getAccessTokenOrError(): Promise<
  { ok: true; token: string } | { ok: false; error: string }
> {
  const token = await getValidAccessToken();
  if (!token) {
    return {
      ok: false,
      error: "Google não autorizado. Abra o Flow e reautorize em /today.",
    };
  }
  return { ok: true, token };
}

async function listEventsByDateKey(
  token: string,
  dateKey: string,
  timeZone: string,
): Promise<FlowTask[]> {
  return getEventsForDateKey(token, dateKey, timeZone);
}

export async function cmdHoje(
  _args: string,
  chatId: number,
  timeZone: string,
): Promise<CommandResult> {
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const now = new Date();
  const dateKey = getDateKeyInTimeZone(now, timeZone);
  const tasks = await listEventsByDateKey(auth.token, dateKey, timeZone);
  return { text: formatTaskList(tasks, timeZone, `📅 <b>Hoje (${dateKey})</b>`) };
}

export async function cmdAmanha(
  _args: string,
  _chatId: number,
  timeZone: string,
): Promise<CommandResult> {
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const now = new Date();
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const tasks = await listEventsByDateKey(auth.token, tomorrowKey, timeZone);
  return { text: formatTaskList(tasks, timeZone, `📅 <b>Amanhã (${tomorrowKey})</b>`) };
}

export async function cmdSemana(
  _args: string,
  _chatId: number,
  timeZone: string,
): Promise<CommandResult> {
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const now = new Date();
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const start = new Date(`${todayKey}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const tasks = await getEventsInRange(auth.token, start, end, timeZone);
  return { text: formatTaskList(tasks, timeZone, "📅 <b>Próximos 7 dias</b>") };
}

export async function cmdBuscar(
  args: string,
  _chatId: number,
  timeZone: string,
): Promise<CommandResult> {
  const q = args.trim();
  if (!q) return { text: "Use: /buscar <texto>" };
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const now = new Date();
  const start = new Date(now);
  start.setFullYear(start.getFullYear() - 2);
  const end = new Date(now);
  end.setFullYear(end.getFullYear() + 2);
  const tasks = await getEventsInRange(auth.token, start, end, timeZone, { q, maxResults: 50 });
  if (tasks.length === 0) {
    return { text: `Nada encontrado pra "<i>${escapeHtml(q)}</i>".` };
  }
  return { text: formatTaskList(tasks, timeZone, `🔍 <b>Busca: ${escapeHtml(q)}</b>`) };
}

interface ParsedCriarArgs {
  title: string;
  date: string;
  time: string;
  durationMin?: number;
  calendarId?: string;
}

function parseCriarArgs(raw: string): ParsedCriarArgs | null {
  // Formato: <título> | <YYYY-MM-DD HH:mm> [duração] [| calendário]
  const parts = raw.split("|").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const title = parts[0];
  const dateTimeMatch = parts[1].match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/);
  if (!dateTimeMatch) return null;
  const date = dateTimeMatch[1];
  const time = dateTimeMatch[2];
  const durationMin = parts[2] ? Number(parts[2]) : undefined;
  const calendarId = parts[3] || undefined;
  return { title, date, time, durationMin, calendarId };
}

function buildIsoWithTz(date: string, time: string, timeZone: string): string {
  // Constrói ISO com offset do fuso do usuário. Usa Date c/ UTC intermediário
  // pra extrair o offset correto, depois formata.
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  // Data fictícia UTC; Intl resolve o offset real do fuso nesse instante.
  const utcGuess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0));
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    year: "numeric",
  });
  const parts = dtf.formatToParts(utcGuess);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-03:00";
  // "GMT-03:00" → "-03:00"
  const offset = offsetPart.replace(/^GMT/, "") || "-03:00";
  return `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00${offset}`;
}

export async function cmdCriar(
  args: string,
  _chatId: number,
  timeZone: string,
): Promise<CommandResult> {
  const parsed = parseCriarArgs(args);
  if (!parsed) {
    return {
      text:
        "Formato: <code>/criar Título | YYYY-MM-DD HH:mm [duração min] [| calendário]</code>\n" +
        "Ex: <code>/criar Call João | 2026-10-15 14:30 60</code>",
    };
  }
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const startIso = buildIsoWithTz(parsed.date, parsed.time, timeZone);
  const startDate = new Date(startIso);
  const durationMin = parsed.durationMin ?? 60;
  const endDate = new Date(startDate.getTime() + durationMin * 60_000);
  const endIso = endDate.toISOString();

  const input: CreateTaskInput = {
    title: parsed.title,
    startTime: startIso,
    endTime: endIso,
    calendarId: parsed.calendarId,
  };
  try {
    const task = await createEvent(auth.token, input, timeZone);
    return {
      text: `✅ Criado: <b>${escapeHtml(task.title)}</b>\n${formatTaskLine(task, timeZone)}`,
    };
  } catch (err) {
    console.error("[TELEGRAM-BOT] /criar falhou:", err);
    return { text: "Erro ao criar evento. Verifique permissão no calendário." };
  }
}

interface ResolvedEvent {
  task: FlowTask;
  index: number;
}

async function resolveEventByIndexOrId(
  token: string,
  timeZone: string,
  ref: string,
): Promise<ResolvedEvent | string> {
  // ref = "1", "2"... → pega da lista dos próximos 7 dias
  // caso contrário → tenta getEventById direto
  if (/^\d{1,3}$/.test(ref)) {
    const idx = Number(ref);
    const now = new Date();
    const todayKey = getDateKeyInTimeZone(now, timeZone);
    const start = new Date(`${todayKey}T00:00:00.000Z`);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 7);
    const tasks = await getEventsInRange(token, start, end, timeZone);
    if (idx < 1 || idx > tasks.length) {
      return `Índice fora do intervalo (1..${tasks.length}). Próximos 7 dias:`;
    }
    return { task: tasks[idx - 1], index: idx };
  }
  try {
    const task = await getEventById(token, ref);
    return { task, index: -1 };
  } catch {
    return "ID não encontrado. Use um índice (próximos 7 dias) ou ID Google válido.";
  }
}

export async function cmdConcluir(
  args: string,
  _chatId: number,
  timeZone: string,
): Promise<CommandResult> {
  const ref = args.trim();
  if (!ref) return { text: "Use: /concluir <id|índice>" };
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const resolved = await resolveEventByIndexOrId(auth.token, timeZone, ref);
  if (typeof resolved === "string") return { text: resolved };
  try {
    const updated = await markEventComplete(
      auth.token,
      resolved.task.id,
      resolved.task.calendarId ?? "primary",
    );
    return {
      text: `✅ Concluído: <b>${escapeHtml(updated.title)}</b>`,
    };
  } catch (err) {
    console.error("[TELEGRAM-BOT] /concluir falhou:", err);
    return { text: "Erro ao marcar como concluído." };
  }
}

export async function cmdCancelar(
  args: string,
  _chatId: number,
  timeZone: string,
): Promise<CommandResult> {
  const ref = args.trim();
  if (!ref) return { text: "Use: /cancelar <id|índice>" };
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const resolved = await resolveEventByIndexOrId(auth.token, timeZone, ref);
  if (typeof resolved === "string") return { text: resolved };
  try {
    const title = resolved.task.title;
    await deleteEvent(
      auth.token,
      resolved.task.id,
      resolved.task.calendarId ?? "primary",
    );
    return { text: `🗑 Removido: <b>${escapeHtml(title)}</b>` };
  } catch (err) {
    console.error("[TELEGRAM-BOT] /cancelar falhou:", err);
    return { text: "Erro ao apagar evento." };
  }
}

export async function cmdUndo(
  _args: string,
  chatId: number,
  _timeZone: string,
): Promise<CommandResult> {
  const batch = popUndo(chatId);
  if (!batch) {
    return { text: "Nada pra desfazer (ou já passou de 60s)." };
  }
  const auth = await getAccessTokenOrError();
  if (!auth.ok) return { text: auth.error };
  const removed: string[] = [];
  for (const ev of batch.events) {
    try {
      await deleteEvent(auth.token, ev.eventId, ev.calendarId);
      removed.push(ev.title);
    } catch (err) {
      console.error("[TELEGRAM-BOT] /undo falhou em", ev.eventId, err);
    }
  }
  if (removed.length === 0) return { text: "Não consegui remover nada." };
  return {
    text: `🗑 Desfeito: <b>${escapeHtml(removed.join(", "))}</b>`,
  };
}

export async function cmdStart(): Promise<CommandResult> {
  return { text: HELP_TEXT };
}

export async function cmdHelp(): Promise<CommandResult> {
  return { text: HELP_TEXT };
}

/** Helper usado pelo intent.ts pra resolver target.byIndex e byQuery. */
export async function findEventsForTarget(
  token: string,
  timeZone: string,
  target: { byIndex?: number; byQuery?: string; eventId?: string },
): Promise<FlowTask[]> {
  if (target.eventId) {
    try {
      return [await getEventById(token, target.eventId)];
    } catch {
      return [];
    }
  }
  const now = new Date();
  const todayKey = getDateKeyInTimeZone(now, timeZone);
  const start = new Date(`${todayKey}T00:00:00.000Z`);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);
  const all = await getEventsInRange(token, start, end, timeZone);
  const limited = all.slice(0, MAX_LIST_FOR_INDEX);
  if (target.byIndex !== undefined) {
    const i = target.byIndex - 1;
    return i >= 0 && i < limited.length ? [limited[i]] : [];
  }
  if (target.byQuery) {
    const q = target.byQuery.toLowerCase();
    return limited.filter((t) => t.title.toLowerCase().includes(q));
  }
  return limited;
}

/** Helper pra listar calendários (usado pelo preview de criação). */
export async function listCalendarsForBot(token: string) {
  return listWritableCalendars(token);
}
