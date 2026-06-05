import { auth } from "@/auth";
import { getEventsInRange, normalizeForSearch } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const tz = req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    const tasks = await getEventsInRange(accessToken, startDate, endDate, tz);

    // Delegáveis não concluídos
    const delegable = tasks.filter((t) => t.isDelegable && !t.isComplete && !t.isCancelled);

    // Agrupar por título normalizado e contar repetições
    const countMap = new Map<string, { title: string; calendarName: string; count: number }>();
    for (const t of delegable) {
      const key = normalizeForSearch(t.title);
      const existing = countMap.get(key);
      if (existing) {
        existing.count++;
      } else {
        countMap.set(key, { title: t.title, calendarName: t.calendarName ?? "", count: 1 });
      }
    }
    const delegableList = Array.from(countMap.values()).sort((a, b) => b.count - a.count);

    // Contagem estratégico vs operacional (semana toda, incluindo concluídos)
    let strategic = 0;
    let operational = 0;
    for (const t of tasks) {
      if (t.isCancelled) continue;
      if (t.category === "strategic") strategic++;
      else if (t.category === "operational") operational++;
    }

    return NextResponse.json(
      { delegableList, strategic, operational },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[API weekly-review GET]", err);
    return NextResponse.json({ error: "Failed to fetch weekly review" }, { status: 500 });
  }
}
