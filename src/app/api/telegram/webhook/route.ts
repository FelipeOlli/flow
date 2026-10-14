// Webhook do Telegram. Valida secret + user_id, despacha handler em background.
// Responde 200 imediatamente pra evitar reentrega do Telegram (<60s timeout).

import { NextRequest } from "next/server";
import { isAuthorizedUpdate } from "@/lib/telegram-bot/security";
import { handleUpdate } from "@/lib/telegram-bot";
import { ensureMyCommands } from "@/lib/telegram";
import type { TgUpdate } from "@/lib/telegram-bot/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<Response> {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  const providedSecret = req.headers.get("X-Telegram-Bot-Api-Secret-Token");

  if (!expectedSecret) {
    console.error("[TELEGRAM-WEBHOOK] TELEGRAM_WEBHOOK_SECRET ausente no servidor");
    return new Response("unauthorized", { status: 401 });
  }
  if (providedSecret !== expectedSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return new Response("bad request", { status: 400 });
  }

  if (!isAuthorizedUpdate(update)) {
    // Resposta silenciosa — não vaza info pra quem escaneia.
    return new Response("ok", { status: 200 });
  }

  // Garante menu de comandos registrado na primeira execução.
  ensureMyCommands().catch(() => undefined);

  // Processa em background. Telegram reentrega se não receber 200 em ~60s,
  // mas o dedup em security.ts evita duplo processamento.
  handleUpdate(update).catch((err) => {
    console.error("[TELEGRAM-WEBHOOK] handleUpdate background error:", err);
  });

  return new Response("ok", { status: 200 });
}

// Rejeita GET/HEAD explicitamente pra não expor info.
export async function GET(): Promise<Response> {
  return new Response("method not allowed", { status: 405 });
}
