// Store em memória pra /undo (TTL 60s) e pendingCreates (TTL 5min).
// Restart do container perde — aceitável, documentado.

import type { PendingCreate, UndoBatch } from "./types";

const UNDO_TTL_MS = 60_000;
const UNDO_MAX = 50;
const PENDING_TTL_MS = 5 * 60_000;
const PENDING_MAX = 50;
const CONTEXT_TTL_MS = 5 * 60_000; // 5min — janela pra responder "feito" à notificação
const CONTEXT_MAX = 100;

const undoByChat = new Map<number, UndoBatch>();
const pendingByHash = new Map<string, PendingCreate>();

/** Contexto do último lembrete enviado por chat. Sobrepõe em cada nova notificação. */
export interface EventContext {
  eventId: string;
  calendarId: string;
  title: string;
  startTime: string;
  notifiedAt: number;
  expiresAt: number;
}

const contextByChat = new Map<number, EventContext>();

let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    undoByChat.forEach((batch, chatId) => {
      if (batch.expiresAt <= now) undoByChat.delete(chatId);
    });
    pendingByHash.forEach((pending, hash) => {
      if (pending.expiresAt <= now) pendingByHash.delete(hash);
    });
    contextByChat.forEach((ctx, chatId) => {
      if (ctx.expiresAt <= now) contextByChat.delete(chatId);
    });
  }, 30_000);
  // Não bloqueia o shutdown.
  cleanupTimer.unref?.();
}

function pruneIfFull<K, V>(map: Map<K, V>, max: number): void {
  if (map.size <= max) return;
  const dropCount = map.size - max;
  let dropped = 0;
  map.forEach((_v, k) => {
    if (dropped >= dropCount) return;
    map.delete(k);
    dropped++;
  });
}

// ─── Undo ───────────────────────────────────────────────

export function pushUndo(chatId: number, events: UndoBatch["events"]): UndoBatch {
  ensureCleanup();
  const now = Date.now();
  const batch: UndoBatch = {
    batchId: `b_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    expiresAt: now + UNDO_TTL_MS,
    events,
  };
  undoByChat.set(chatId, batch);
  pruneIfFull(undoByChat, UNDO_MAX);
  return batch;
}

export function popUndo(chatId: number): UndoBatch | null {
  const batch = undoByChat.get(chatId);
  if (!batch) return null;
  if (batch.expiresAt <= Date.now()) {
    undoByChat.delete(chatId);
    return null;
  }
  undoByChat.delete(chatId);
  return batch;
}

// ─── Pending creates (preview) ──────────────────────────

export function pushPending(pending: PendingCreate): void {
  ensureCleanup();
  pendingByHash.set(pending.hash, pending);
  pruneIfFull(pendingByHash, PENDING_MAX);
}

export function getPending(hash: string): PendingCreate | null {
  const p = pendingByHash.get(hash);
  if (!p) return null;
  if (p.expiresAt <= Date.now()) {
    pendingByHash.delete(hash);
    return null;
  }
  return p;
}

export function deletePending(hash: string): void {
  pendingByHash.delete(hash);
}

// ─── Event context (último lembrete por chat) ───────────

export function pushEventContext(chatId: number, ctx: Omit<EventContext, "notifiedAt" | "expiresAt">): void {
  ensureCleanup();
  const now = Date.now();
  contextByChat.set(chatId, { ...ctx, notifiedAt: now, expiresAt: now + CONTEXT_TTL_MS });
  pruneIfFull(contextByChat, CONTEXT_MAX);
}

export function peekEventContext(chatId: number): EventContext | null {
  const ctx = contextByChat.get(chatId);
  if (!ctx) return null;
  if (ctx.expiresAt <= Date.now()) {
    contextByChat.delete(chatId);
    return null;
  }
  return ctx;
}

export function clearEventContext(chatId: number): void {
  contextByChat.delete(chatId);
}
