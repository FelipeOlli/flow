// Funções de envio pra API do Telegram Bot. fetch nativo, sem dependência externa.
// sendTelegramMessage mantém a assinatura original (chamada pelo notifier) e
// aceita reply_markup opcional. Demais helpers são novos (bot entrada).

import type { TgInlineKeyboardMarkup } from "./telegram-bot/types";

const API = (token: string) => `https://api.telegram.org/bot${token}`;

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  return { token, api: API(token) };
}

async function callTelegram(method: string, body: Record<string, unknown>): Promise<unknown> {
  const cfg = getConfig();
  if (!cfg) return null;
  try {
    const res = await fetch(`${cfg.api}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[TELEGRAM] ${method} falhou (${res.status}): ${text}`);
      return null;
    }
    return res.json();
  } catch (err) {
    console.error(`[TELEGRAM] ${method} erro de rede:`, err);
    return null;
  }
}

export interface SendMessageOptions {
  chatId?: number | string;
  replyMarkup?: TgInlineKeyboardMarkup;
  parseMode?: "HTML" | "MarkdownV2";
}

export async function sendTelegramMessage(
  text: string,
  options: SendMessageOptions = {},
): Promise<void> {
  const chatId = options.chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!chatId) return;
  await callTelegram("sendMessage", {
    chat_id: chatId,
    text,
    parse_mode: options.parseMode ?? "HTML",
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function editTelegramMessage(
  chatId: number | string,
  messageId: number,
  text: string,
  options: { replyMarkup?: TgInlineKeyboardMarkup } = {},
): Promise<void> {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true,
    ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
  });
}

export async function answerTelegramCallbackQuery(
  callbackQueryId: string,
  text?: string,
  options: { showAlert?: boolean } = {},
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    ...(text ? { text } : {}),
    ...(options.showAlert ? { show_alert: true } : {}),
  });
}

export async function sendTelegramChatAction(
  action: "typing" | "upload_photo" | "find_location",
  chatId?: number | string,
): Promise<void> {
  const target = chatId ?? process.env.TELEGRAM_CHAT_ID;
  if (!target) return;
  await callTelegram("sendChatAction", { chat_id: target, action });
}

/** Setup do webhook (chamado pelo instrumentation.ts). Idempotente: não regista se já tá no ar. */
export async function ensureTelegramWebhook(params: {
  url: string;
  secret: string;
}): Promise<void> {
  const cfg = getConfig();
  if (!cfg) return;

  const info = await fetch(`${cfg.api}/getWebhookInfo`).then((r) => r.json()).catch(() => null);
  const current = info?.result;
  if (current?.url === params.url && !current?.has_custom_certificate) {
    return;
  }

  await callTelegram("setWebhook", {
    url: params.url,
    secret_token: params.secret,
    allowed_updates: ["message", "callback_query"],
  });
  console.log("[TELEGRAM] webhook registrado:", params.url);
}

/** Registra menu de comandos do bot (aparece no "/" do Telegram). Idempotente. */
const COMMANDS: { command: string; description: string }[] = [
  { command: "start", description: "Iniciar o bot" },
  { command: "help", description: "Lista de comandos" },
  { command: "hoje", description: "Eventos de hoje" },
  { command: "amanha", description: "Eventos de amanhã" },
  { command: "semana", description: "Próximos 7 dias" },
  { command: "buscar", description: "Buscar por texto" },
  { command: "criar", description: "Criar evento simples" },
  { command: "concluir", description: "Marcar evento como feito" },
  { command: "cancelar", description: "Apagar evento" },
  { command: "undo", description: "Desfazer última criação" },
];

let myCommandsRegistered = false;
export async function ensureMyCommands(): Promise<void> {
  if (myCommandsRegistered) return;
  const cfg = getConfig();
  if (!cfg) return;
  const result = await callTelegram("setMyCommands", { commands: COMMANDS });
  if (result) {
    myCommandsRegistered = true;
    console.log("[TELEGRAM] menu de comandos registrado");
  }
}
