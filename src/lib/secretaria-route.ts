import { NextRequest, NextResponse } from "next/server";
import { getValidAccessToken } from "./token-store";
import { guardSecretaria, logAccess } from "./secretaria-auth";

/** Erro com status HTTP próprio (usado pelas rotas pra responder 400/404). */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

export interface SecretariaContext {
  accessToken: string;
  timeZone: string;
  params: URLSearchParams;
}

/**
 * Envelope comum das rotas da secretária: guarda (token + rate limit),
 * token do Google, tratamento de erro e log de acesso.
 */
export async function secretariaRoute(
  req: NextRequest,
  handler: (ctx: SecretariaContext) => Promise<unknown>
): Promise<NextResponse> {
  const startedAt = Date.now();

  const guard = guardSecretaria(req, startedAt);
  if (!guard.ok) return guard.response;

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    const res = NextResponse.json(
      { erro: "Google Calendar não conectado" },
      { status: 503 }
    );
    logAccess(req, 503, startedAt, { motivo: "google_desconectado" });
    return res;
  }

  const timeZone =
    req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  try {
    const payload = await handler({ accessToken, timeZone, params: req.nextUrl.searchParams });
    const res = NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    logAccess(req, 200, startedAt);
    return res;
  } catch (err) {
    if (err instanceof HttpError) {
      const res = NextResponse.json({ erro: err.message }, { status: err.status });
      logAccess(req, err.status, startedAt, { motivo: "http_error" });
      return res;
    }
    console.error("[SECRETARIA] erro na rota:", err);
    const res = NextResponse.json(
      { erro: "Erro interno ao consultar a agenda" },
      { status: 500 }
    );
    logAccess(req, 500, startedAt, { motivo: "erro" });
    return res;
  }
}
