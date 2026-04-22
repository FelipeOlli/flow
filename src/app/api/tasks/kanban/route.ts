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

  // Busca eventos de 2026 até o momento exato da consulta
  const startDate = new Date("2026-01-01T00:00:00Z");
  const endDate = new Date();

  const tasks = await getEventsInRange(accessToken, startDate, endDate, tz);

  const open = tasks.filter((t) => !t.isComplete && !t.isCancelled);

  return NextResponse.json(open, {
    headers: { "Cache-Control": "no-store" },
  });
}
