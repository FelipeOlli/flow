import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Autenticação e proteção da API da secretária.
 *
 * Dois tokens, em variáveis de ambiente:
 * - `FLOW_API_TOKEN` — leitura.
 * - `FLOW_API_WRITE_TOKEN` — escrita (criar/editar/concluir eventos).
 *
 * O token de escrita também lê (é um superconjunto), então dá pra usar ele
 * em qualquer cliente. O token do Google nunca sai do servidor — a API usa o
 * token store interno.
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

/**
 * Token apresentado na requisição.
 *
 * A API REST exige o prefixo `Bearer ` — a rota `/mcp` é que aceita outras
 * formas, porque o conector do claude.ai só deixa usar nomes de cabeçalho
 * aprovados por ele.
 */
export function extrairToken(req: NextRequest): string {
  const header = req.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice(7).trim() : "";
}

/**
 * Confere o token da requisição.
 *
 * Sem `exigirEscrita`, aceita o token de leitura **ou** o de escrita.
 * Com `exigirEscrita`, só o token de escrita passa.
 */
export function checkToken(
  req: NextRequest,
  opts?: { exigirEscrita?: boolean }
): TokenCheck {
  const readToken = process.env.FLOW_API_TOKEN?.trim();
  const writeToken = process.env.FLOW_API_WRITE_TOKEN?.trim();
  const token = extrairToken(req);

  if (!token) {
    return {
      ok: false,
      status: 401,
      erro: "Token ausente. Use: Authorization: Bearer <FLOW_API_TOKEN>",
    };
  }

  if (opts?.exigirEscrita) {
    if (!writeToken) {
      return {
        ok: false,
        status: 503,
        erro: "FLOW_API_WRITE_TOKEN não configurado no servidor — escrita desabilitada",
      };
    }
    if (!timingSafeEqual(token, writeToken)) {
      return { ok: false, status: 401, erro: "Token sem permissão de escrita" };
    }
    return { ok: true, status: 200 };
  }

  const configured = readToken || writeToken;
  if (!configured) {
    return { ok: false, status: 503, erro: "FLOW_API_TOKEN não configurado no servidor" };
  }
  if (timingSafeEqual(token, configured)) {
    return { ok: true, status: 200 };
  }
  // Token de escrita também lê.
  if (writeToken && timingSafeEqual(token, writeToken)) {
    return { ok: true, status: 200 };
  }
  return { ok: false, status: 401, erro: "Token inválido" };
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
export function guardSecretaria(
  req: NextRequest,
  startedAt: number,
  opts?: { exigirEscrita?: boolean }
): GuardResult {
  const token = checkToken(req, opts);
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
