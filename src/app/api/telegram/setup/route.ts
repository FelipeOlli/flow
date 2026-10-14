// Endpoint one-shot pra registrar/refresh do webhook do Telegram.
// Acessível via CRON_SECRET no header (mesmo padrão de /api/cron/migrate).
// Usar quando o auto-registro no boot falhar (envs chegaram tarde, container
// subiu antes do setWebhook completar, etc).

import { NextRequest, NextResponse } from "next/server";
import { ensureTelegramWebhook, ensureMyCommands } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.TELEGRAM_WEBHOOK_URL;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!url || !secret) {
    return NextResponse.json(
      { error: "TELEGRAM_WEBHOOK_URL e TELEGRAM_WEBHOOK_SECRET precisam estar setadas" },
      { status: 500 },
    );
  }

  await ensureTelegramWebhook({ url, secret });
  await ensureMyCommands();

  return NextResponse.json({ ok: true, url });
}

// GET só pra health check com o secret.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({
    webhookUrl: process.env.TELEGRAM_WEBHOOK_URL ?? null,
    hasSecret: !!process.env.TELEGRAM_WEBHOOK_SECRET,
    hasToken: !!process.env.TELEGRAM_BOT_TOKEN,
    hasChatId: !!process.env.TELEGRAM_CHAT_ID,
  });
}
