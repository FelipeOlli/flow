// Dispatcher principal do bot. Recebe um TgUpdate já autorizado e:
// - encaminha message/texto pro handler certo (comando literal ou NLP)
// - resolve callback_query de botões inline do preview de criação
// - empurra o batch criado pro undoStore (pra /undo)

import {
  sendTelegramMessage,
  sendTelegramChatAction,
  editTelegramMessage,
  answerTelegramCallbackQuery,
} from "@/lib/telegram";
import {
  cmdHoje,
  cmdAmanha,
  cmdSemana,
  cmdBuscar,
  cmdCriar,
  cmdConcluir,
  cmdCancelar,
  cmdUndo,
  cmdHelp,
  cmdStart,
  findEventsForTarget,
  listCalendarsForBot,
  HELP_TEXT,
} from "./commands";
import { parseChatIntent } from "./intent";
import { pushUndo, pushPending, getPending, deletePending, pushEventContext, peekEventContext, clearEventContext } from "./undo";
import { formatDateBr, formatTimeRange, escapeHtml } from "./formatter";
import { getValidAccessToken } from "@/lib/token-store";
import { createEvent, getEventById, deleteEvent, markEventComplete } from "@/lib/google-calendar";
import { getDateKeyInTimeZone, shiftDateKey } from "@/lib/timezone";
import type {
  TgUpdate,
  TgMessage,
  TgCallbackQuery,
  TgInlineKeyboardMarkup,
  PendingCreate,
} from "./types";
import type { CreateTaskInput, FlowTask } from "@/types/task";
import type { ParsedEvent } from "@/lib/openai-event-parser";

const MAX_EVENTS_PER_BATCH = 10;
const PENDING_TTL_MS = 5 * 60_000;

/** Match da hashtag invisível que o notifier embute na notificação. */
const EVENT_TAG_RE = /#ev_([A-Za-z0-9_-]{16,})/;

interface EventRef {
  eventId: string;
  calendarId: string;
  title: string;
}

/**
 * Tenta resolver um evento a partir de uma hashtag #ev_<id> no texto ou do
 * contexto do último lembrete enviado pra esse chat. Retorna null se nada bate.
 */
function resolveEventRef(text: string, chatId: number): EventRef | null {
  const match = text.match(EVENT_TAG_RE);
  if (match) {
    const ctx = peekEventContext(chatId);
    if (ctx && ctx.eventId === match[1]) {
      return { eventId: ctx.eventId, calendarId: ctx.calendarId, title: ctx.title };
    }
    // Hashtag conhecida mas sem contexto local — recupera via getEventById
    // (feito lazy no caller porque precisa de access token).
    return { eventId: match[1], calendarId: "primary", title: "" };
  }
  const ctx = peekEventContext(chatId);
  if (ctx) {
    return { eventId: ctx.eventId, calendarId: ctx.calendarId, title: ctx.title };
  }
  return null;
}

/** Frases curtas que o usuário pode mandar como resposta à notificação. */
const QUICK_COMPLETE_RE = /^(feito|conclu[ií]do|conclu[ií]|j[aá]\s*fiz|terminei|ok|pronto|finalizei|mark\s*done)/i;
const QUICK_DELETE_RE = /^(cancelar|cancela|apaga|remove|desmarca|esquece|delete)/i;

function getTimeZone(): string {
  return process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
}

function shortHash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}

function previewText(events: ParsedEvent[], timeZone: string): string {
  const lines: string[] = ["<b>Confirme o(s) evento(s):</b>"];
  for (const ev of events) {
    const dateKey = ev.startTime.slice(0, 10);
    const date = formatDateBr(dateKey, timeZone);
    const time = ev.isAllDay
      ? "(dia inteiro)"
      : formatTimeRange(ev.startTime, ev.endTime, timeZone);
    const cal = ev.calendarId ? ` <i>· ${escapeHtml(ev.calendarId)}</i>` : "";
    const imp = ev.isImportant ? " ⭐" : "";
    lines.push(`📌 <b>${escapeHtml(ev.title)}</b>${imp}`);
    lines.push(`   📅 ${date} · ${time}${cal}`);
    if (ev.attendees?.length) {
      lines.push(`   👥 ${escapeHtml(ev.attendees.join(", "))}`);
    }
  }
  return lines.join("\n");
}

function previewKeyboard(hash: string): TgInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: "✅ Criar", callback_data: `create:${hash}` }],
      [
        { text: "✏ Editar título", callback_data: `edit_title:${hash}` },
        { text: "❌ Cancelar", callback_data: `cancel:${hash}` },
      ],
    ],
  };
}

function hasRequiredFields(ev: ParsedEvent): boolean {
  return !!(ev.title && ev.startTime && ev.endTime);
}

async function handleMessage(msg: TgMessage): Promise<void> {
  if (!msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const timeZone = getTimeZone();

  // Quick reply: "feito" / "cancelar" respondendo à última notificação.
  // Tem prioridade sobre NLP pra evitar ida desnecessária ao Claude.
  if (QUICK_COMPLETE_RE.test(text) || QUICK_DELETE_RE.test(text)) {
    const ref = resolveEventRef(text, chatId);
    if (ref && ref.eventId) {
      await sendTelegramChatAction("typing", chatId);
      const token = await getValidAccessToken();
      if (!token) {
        await sendTelegramMessage("Google não autorizado. Abra o Flow e reautorize.", { chatId });
        return;
      }
      // Se só temos o eventId sem título (caso da hashtag encaminhada sem
      // contexto local), recupera o evento pra validar.
      let title = ref.title;
      if (!title) {
        try {
          const ev = await getEventById(token, ref.eventId, ref.calendarId);
          title = ev.title;
        } catch {
          await sendTelegramMessage("Não achei esse evento. Pode ter sido apagado.", { chatId });
          return;
        }
      }
      if (QUICK_DELETE_RE.test(text)) {
        await deleteEvent(token, ref.eventId, ref.calendarId);
        clearEventContext(chatId);
        await sendTelegramMessage(`🗑 Removido: <b>${escapeHtml(title)}</b>`, { chatId });
      } else {
        await markEventComplete(token, ref.eventId, ref.calendarId);
        clearEventContext(chatId);
        await sendTelegramMessage(`✅ Concluído: <b>${escapeHtml(title)}</b>`, { chatId });
      }
      return;
    }
    // Sem contexto: cai pro NLP abaixo
  }

  // Comandos literais
  if (text.startsWith("/")) {
    const [cmdRaw, ...rest] = text.split(/\s+/);
    const cmd = cmdRaw.split("@")[0].toLowerCase();
    const args = rest.join(" ");
    await sendTelegramChatAction("typing", chatId);
    let result;
    switch (cmd) {
      case "/start": result = await cmdStart(); break;
      case "/help": result = await cmdHelp(); break;
      case "/hoje": result = await cmdHoje(args, chatId, timeZone); break;
      case "/amanha": result = await cmdAmanha(args, chatId, timeZone); break;
      case "/semana": result = await cmdSemana(args, chatId, timeZone); break;
      case "/buscar": result = await cmdBuscar(args, chatId, timeZone); break;
      case "/criar": result = await cmdCriar(args, chatId, timeZone); break;
      case "/concluir": result = await cmdConcluir(args, chatId, timeZone); break;
      case "/cancelar": result = await cmdCancelar(args, chatId, timeZone); break;
      case "/undo": result = await cmdUndo(args, chatId, timeZone); break;
      default: result = { text: `Comando desconhecido. ${HELP_TEXT}` };
    }
    await sendTelegramMessage(result.text, { chatId });
    return;
  }

  // Frase solta → NLP via Claude
  await sendTelegramChatAction("typing", chatId);
  const token = await getValidAccessToken();
  if (!token) {
    await sendTelegramMessage("Google não autorizado. Abra o Flow e reautorize.", { chatId });
    return;
  }
  const calendars = await listCalendarsForBot(token);
  const intent = await parseChatIntent(text, new Date(), timeZone, calendars);

  switch (intent.kind) {
    case "create": {
      const valid = intent.events.filter(hasRequiredFields).slice(0, MAX_EVENTS_PER_BATCH);
      if (valid.length === 0) {
        await sendTelegramMessage("Não consegui extrair os dados do evento.", { chatId });
        return;
      }
      // Manda preview com botões
      const hash = shortHash(JSON.stringify(valid) + Date.now());
      const sent = await sendTelegramMessage(previewText(valid, timeZone), {
        chatId,
        replyMarkup: previewKeyboard(hash),
      });
      // sendMessage retorna o JSON da API; precisamos do message_id pra editar depois.
      // Como o retorno é void no wrapper atual, recuperamos via editMessage fallback.
      // Solução prática: ignorar e confiar no callback_query.message.message_id.
      pushPending({
        hash,
        chatId,
        messageId: msg.message_id, // será sobrescrito se necessário
        events: valid,
        createdAt: Date.now(),
        expiresAt: Date.now() + PENDING_TTL_MS,
      });
      // Tenta descobrir o message_id correto via getUpdates? Não — usamos o msg_id
      // que veio no update. Telegram entrega o message_id da mensagem do BOT no
      // callback_query.message.message_id, então isso não importa aqui.
      void sent;
      return;
    }
    case "query": {
      const map: Record<typeof intent.scope, () => Promise<{ text: string }>> = {
        today: () => cmdHoje("", chatId, timeZone),
        tomorrow: () => cmdAmanha("", chatId, timeZone),
        week: () => cmdSemana("", chatId, timeZone),
        search: () => cmdBuscar(intent.q ?? "", chatId, timeZone),
      };
      const handler = map[intent.scope];
      const result = await handler();
      await sendTelegramMessage(result.text, { chatId });
      return;
    }
    case "complete": {
      const events = await findEventsForTarget(token, timeZone, intent.target);
      if (events.length === 0) {
        await sendTelegramMessage("Não achei esse evento.", { chatId });
        return;
      }
      if (events.length > 1) {
        const list = events
          .map((e, i) => `${i + 1}. ${escapeHtml(e.title)}`)
          .join("\n");
        await sendTelegramMessage(`Encontrei vários. Qual?\n${list}`, { chatId });
        return;
      }
      const ev = events[0];
      const updated = await markEventComplete(
        token,
        ev.id,
        ev.calendarId ?? "primary",
      );
      await sendTelegramMessage(
        `✅ Concluído: <b>${escapeHtml(updated.title)}</b>`,
        { chatId },
      );
      return;
    }
    case "delete": {
      const events = await findEventsForTarget(token, timeZone, intent.target);
      if (events.length === 0) {
        await sendTelegramMessage("Não achei esse evento.", { chatId });
        return;
      }
      if (events.length > 1) {
        const list = events
          .map((e, i) => `${i + 1}. ${escapeHtml(e.title)}`)
          .join("\n");
        await sendTelegramMessage(`Encontrei vários. Qual apagar?\n${list}`, { chatId });
        return;
      }
      const ev = events[0];
      await deleteEvent(token, ev.id, ev.calendarId ?? "primary");
      await sendTelegramMessage(
        `🗑 Removido: <b>${escapeHtml(ev.title)}</b>`,
        { chatId },
      );
      return;
    }
    case "unknown":
    default:
      await sendTelegramMessage(`Não entendi. ${HELP_TEXT}`, { chatId });
  }
}

async function handleCallbackQuery(cb: TgCallbackQuery): Promise<void> {
  const data = cb.data ?? "";
  const [action, hash] = data.split(":");
  const chatId = cb.message?.chat.id;
  const messageId = cb.message?.message_id;
  if (!chatId || !messageId || !hash) {
    await answerTelegramCallbackQuery(cb.id);
    return;
  }
  const pending = getPending(hash);
  const timeZone = getTimeZone();

  if (!pending) {
    await answerTelegramCallbackQuery(cb.id, "Sessão expirou, refaça o pedido.");
    await editTelegramMessage(
      chatId,
      messageId,
      "⏰ Esta confirmação expirou. Mande a mensagem de novo.",
    );
    return;
  }

  if (action === "cancel") {
    deletePending(hash);
    await answerTelegramCallbackQuery(cb.id, "Cancelado");
    await editTelegramMessage(chatId, messageId, "❌ Criação cancelada.");
    return;
  }

  if (action === "edit_title") {
    deletePending(hash);
    await answerTelegramCallbackQuery(cb.id);
    await editTelegramMessage(
      chatId,
      messageId,
      `✏️ Mande o título novo pra esses ${pending.events.length} evento(s) (uma linha por evento).`,
    );
    return;
  }

  if (action === "create") {
    const token = await getValidAccessToken();
    if (!token) {
      await answerTelegramCallbackQuery(cb.id, "Google não autorizado", { showAlert: true });
      await editTelegramMessage(chatId, messageId, "Google não autorizado. Reautorize no Flow.");
      deletePending(hash);
      return;
    }
    const created: FlowTask[] = [];
    const failed: string[] = [];
    for (const ev of pending.events) {
      const input: CreateTaskInput = {
        title: ev.title,
        startTime: ev.startTime,
        endTime: ev.endTime,
        description: ev.description ?? undefined,
        isImportant: ev.isImportant,
        pillar: ev.pillar,
        category: ev.category,
        isDelegable: ev.isDelegable,
        attendees: ev.attendees,
        calendarId: ev.calendarId ?? undefined,
      };
      try {
        const task = await createEvent(token, input, timeZone);
        created.push(task);
      } catch (err) {
        console.error("[TELEGRAM-BOT] create falhou:", err);
        failed.push(ev.title);
      }
    }
    deletePending(hash);
    await answerTelegramCallbackQuery(cb.id, "Criado!");

    if (created.length > 0) {
      pushUndo(
        chatId,
        created.map((t) => ({
          eventId: t.id,
          calendarId: t.calendarId ?? "primary",
          title: t.title,
        })),
      );
    }

    const lines: string[] = [];
    if (created.length > 0) {
      lines.push(
        `✅ <b>${created.length} criado(s):</b>`,
        ...created.map((t) => {
          const dateKey = t.isAllDay
            ? getDateKeyInTimeZone(new Date(t.startTime), timeZone)
            : t.startTime.slice(0, 10);
          const when = t.isAllDay
            ? formatDateBr(dateKey, timeZone)
            : `${formatDateBr(dateKey, timeZone)} · ${formatTimeRange(t.startTime, t.endTime, timeZone)}`;
          return `  • <b>${escapeHtml(t.title)}</b> — ${when}`;
        }),
      );
      lines.push("", "<i>Responda /undo em 60s pra desfazer.</i>");
    }
    if (failed.length > 0) {
      lines.push("", `❌ Falhou: ${escapeHtml(failed.join(", "))}`);
    }
    await editTelegramMessage(chatId, messageId, lines.join("\n"));
  }
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  try {
    if (update.message) await handleMessage(update.message);
    else if (update.callback_query) await handleCallbackQuery(update.callback_query);
  } catch (err) {
    console.error("[TELEGRAM-BOT] handleUpdate falhou:", err);
    if (update.message) {
      await sendTelegramMessage(
        "Erro interno. Tente de novo.",
        { chatId: update.message.chat.id },
      );
    } else if (update.callback_query?.message) {
      await answerTelegramCallbackQuery(update.callback_query.id, "Erro");
    }
  }
}

// Helper exportado só pra testes / debug manual
export const __testHelpers = { previewText, shortHash };
