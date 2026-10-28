import { auth } from "@/auth";
import { getEventsInRange } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextRequest, NextResponse } from "next/server";

// Janela de busca do painel de cobrança: 6 meses atrás (atrasos antigos ainda
// importam) até 2 meses à frente (prazo já delegando).
const BACK_DAYS = 180;
const FORWARD_DAYS = 60;

/** Eventos com responsável definido, agrupáveis por pessoa — base do painel de cobrança. */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const tz = req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - BACK_DAYS);
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + FORWARD_DAYS);

    const tasks = await getEventsInRange(accessToken, startDate, endDate, tz);

    const delegated = tasks.filter(
      (t) => !t.isCancelled && !t.isComplete && !!(t.delegateTo?.name?.trim() || t.delegateTo?.email?.trim())
    );

    return NextResponse.json(delegated, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[API tasks/delegated GET]", err);
    return NextResponse.json({ error: "Failed to fetch delegated tasks" }, { status: 500 });
  }
}
