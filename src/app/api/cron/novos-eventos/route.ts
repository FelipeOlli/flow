import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getValidAccessToken } from "@/lib/token-store";
import {
  monitorarNovosEventos,
  monitorarConvitesPendentes,
} from "@/lib/novos-eventos-monitor";

/**
 * Disparo manual do monitor de chegadas externas — pra testar sem esperar
 * o intervalo do cron.
 *
 * POST /api/cron/novos-eventos  { "dryRun": true }
 *
 * Com dryRun, devolve as mensagens que *seriam* enviadas, sem enviar nada
 * nem gravar o estado.
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
  const dryRun = body?.dryRun === true || body?.dryRun === "true";
  const soConvites = body?.soConvites === true || body?.soConvites === "true";
  const timeZone = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    return NextResponse.json({ erro: "GoogleCalendarNotConnected" }, { status: 503 });
  }

  try {
    const resultado = soConvites
      ? await monitorarConvitesPendentes(accessToken, timeZone, { dryRun })
      : await monitorarNovosEventos(accessToken, timeZone, { dryRun });

    return NextResponse.json({
      success: true,
      dryRun,
      soConvites,
      bootstrap: "bootstrap" in resultado ? resultado.bootstrap : false,
      chegadas: resultado.chegadas.map((c) => ({
        tipo: c.tipo,
        titulo: c.evento.summary,
        agenda: c.evento.agendaNome,
        autor: c.autorNome ?? c.autorEmail ?? null,
      })),
      mensagens: resultado.mensagens,
    });
  } catch (err) {
    console.error("[NOVOS EVENTOS] Erro no disparo manual:", err);
    return NextResponse.json({ erro: "Falha ao monitorar chegadas" }, { status: 500 });
  }
}
