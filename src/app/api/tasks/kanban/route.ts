import { auth } from "@/auth";
import { getEventsInRange } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const tz = req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  // Range amplo: 2 anos atrás até 2 anos à frente — captura qualquer tarefa pendente
  const now = new Date();
  const startDate = new Date(now);
  startDate.setFullYear(now.getFullYear() - 2);
  const endDate = new Date(now);
  endDate.setFullYear(now.getFullYear() + 2);

  const tasks = await getEventsInRange(accessToken, startDate, endDate, tz);

  const open = tasks.filter((t) => !t.isComplete && !t.isCancelled);

  return NextResponse.json(open, {
    headers: { "Cache-Control": "no-store" },
  });
}
