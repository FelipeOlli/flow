import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Autenticação e proteção da API da secretária.
 * Token único de leitura, em variável de ambiente (FLOW_API_TOKEN).
 * O token do Google nunca sai do servidor — a API usa o token store interno.
 */

const RATE_LIMIT_MAX = 120; // requisições
const RATE_LIMIT_WINDOW_MS = 60_000; // por minuto

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function getClientKey(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "local";
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compara mesmo assim pra não vazar o tamanho por tempo.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export interface TokenCheck {
  ok: boolean;
  status: number;
  erro?: string;
}

export function checkToken(req: NextRequest): TokenCheck {
  const configured = process.env.FLOW_API_TOKEN?.trim();
  if (!configured) {
    return { ok: false, status: 503, erro: "FLOW_API_TOKEN não configurado no servidor" };
  }
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    return { ok: false, status: 401, erro: "Token ausente. Use: Authorization: Bearer <FLOW_API_TOKEN>" };
  }
  if (!timingSafeEqual(token, configured)) {
    return { ok: false, status: 401, erro: "Token inválido" };
  }
  return { ok: true, status: 200 };
}

export interface RateLimitResult {
  ok: boolean;
  restante: number;
  resetAt: number;
}

export function checkRateLimit(key: string): RateLimitResult {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    const fresh = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    buckets.set(key, fresh);
    return { ok: true, restante: RATE_LIMIT_MAX - 1, resetAt: fresh.resetAt };
  }
  bucket.count += 1;
  if (bucket.count > RATE_LIMIT_MAX) {
    return { ok: false, restante: 0, resetAt: bucket.resetAt };
  }
  return { ok: true, restante: RATE_LIMIT_MAX - bucket.count, resetAt: bucket.resetAt };
}

/** Log de acesso da API — quem chamou, o quê e quanto tempo levou. */
export function logAccess(
  req: NextRequest,
  status: number,
  startedAt: number,
  extra?: Record<string, unknown>
): void {
  const durMs = Date.now() - startedAt;
  const path = req.nextUrl.pathname;
  const query = req.nextUrl.search;
  console.log(
    `[SECRETARIA] ${new Date().toISOString()} ${req.method} ${path}${query} ` +
      `${status} ${durMs}ms ip=${getClientKey(req)}${extra ? ` ${JSON.stringify(extra)}` : ""}`
  );
}

export type GuardResult =
  | { ok: true }
  | { ok: false; response: NextResponse };

/**
 * Guarda comum das rotas: token + rate limit. Devolve a resposta de erro
 * pronta (401/429/503) quando o acesso não é permitido.
 */
export function guardSecretaria(req: NextRequest, startedAt: number): GuardResult {
  const token = checkToken(req);
  if (!token.ok) {
    const res = NextResponse.json({ erro: token.erro }, { status: token.status });
    logAccess(req, token.status, startedAt, { motivo: "token" });
    return { ok: false, response: res };
  }

  const limit = checkRateLimit(getClientKey(req));
  if (!limit.ok) {
    const res = NextResponse.json(
      { erro: "Limite de requisições excedido. Tente em instantes." },
      { status: 429, headers: { "Retry-After": String(Math.ceil((limit.resetAt - Date.now()) / 1000)) } }
    );
    logAccess(req, 429, startedAt, { motivo: "rate_limit" });
    return { ok: false, response: res };
  }

  return { ok: true };
}
