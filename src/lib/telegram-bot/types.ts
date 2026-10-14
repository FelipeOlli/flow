// Tipos do bot Telegram. Mantidos num único arquivo porque são <3 consumidores
// e a maioria é descritor de payload da API do Telegram.

import type { ParsedEvent } from "@/lib/openai-event-parser";

/** Subconjunto de tipos da API do Telegram Bot. Só o que a gente usa. */

export interface TgUser {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  username?: string;
}

export interface TgChat {
  id: number;
  type: string;
}

export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: TgChat;
  text?: string;
  date: number;
}

export interface TgCallbackQuery {
  id: string;
  from: TgUser;
  message?: { message_id: number; chat: TgChat };
  data?: string;
}

export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
}

export interface TgInlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

export interface TgInlineKeyboardMarkup {
  inline_keyboard: TgInlineKeyboardButton[][];
}

/** Intenção retornada pelo parseChatIntent (Claude). */
export type ChatIntent =
  | { kind: "create"; events: ParsedEvent[] }
  | { kind: "query"; scope: "today" | "tomorrow" | "week" | "search"; q?: string }
  | { kind: "complete"; target: TgEventTarget }
  | { kind: "delete"; target: TgEventTarget }
  | { kind: "unknown"; reason?: string };

export type TgEventTarget =
  | { byIndex: number }
  | { byQuery: string }
  | { eventId: string };

/** Batch guardado no undoStore após uma criação confirmada. */
export interface UndoBatch {
  batchId: string;
  createdAt: number;
  expiresAt: number;
  events: { eventId: string; calendarId: string; title: string }[];
}

/** Estado de preview pendente (antes de o usuário clicar Criar). */
export interface PendingCreate {
  hash: string;
  chatId: number;
  messageId: number;
  events: ParsedEvent[];
  createdAt: number;
  expiresAt: number;
}
