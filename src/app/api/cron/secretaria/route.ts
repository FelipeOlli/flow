import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidAccessToken } from "@/lib/token-store";
import { dispararLembretesDeProximidade, rodarMensagemDiaria } from "@/lib/secretaria-monitor";

/**
 * Disparo manual das mensagens da secretária — pra testar sem esperar o
 * horário agendado.
 *
 * POST /api/cron/secretaria  { "qual": "resumo" | "cobranca" | "fechamento" | "proximidade" }
 *
 * Autorizado pelo CRON_SECRET (Authorization: Bearer) ou pela sessão do app.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("Authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCronCall = !!cronSecret && authHeader === `Bearer ${cronSecret}`;

  if (!isCronCall) {
    const session = await auth();
    if (!session) return NextResponse.json({ erro: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const qual = String(body?.qual ?? "proximidade");
  const dryRun = body?.dryRun === true || body?.dryRun === "true";
  const timeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ erro: "GoogleCalendarNotConnected" }, { status: 503 });
  }

  try {
    if (qual === "proximidade") {
      await dispararLembretesDeProximidade(accessToken, timeZone);
    } else if (qual === "resumo" || qual === "cobranca" || qual === "fechamento") {
      const texto = await rodarMensagemDiaria(accessToken, timeZone, qual, dryRun);
      return NextResponse.json({ success: true, qual, dryRun, texto });
    } else {
      return NextResponse.json(
        { erro: "`qual` deve ser: proximidade, resumo, cobranca ou fechamento" },
        { status: 400 }
      );
    }
    return NextResponse.json({ success: true, qual, dryRun });
  } catch (err) {
    console.error("[SECRETARIA] Erro no disparo manual:", err);
    return NextResponse.json({ erro: "Falha ao disparar a mensagem" }, { status: 500 });
  }
}
