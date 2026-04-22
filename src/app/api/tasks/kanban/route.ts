import { auth } from "@/auth";
import { getEventsInRange } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { getDateKeyInTimeZone, getUtcRangeForDateKey } from "@/lib/timezone";
import { NextRequest, NextResponse } from "next/server";

// Calendários excluídos do kanban (feriados e similares)
const EXCLUDED_CALENDAR_NAMES = ["feriados"];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const tz = req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

  // De 2026-01-01 até o fim do 7º dia a partir de hoje (atrasados + hoje + próximos 7 dias)
  const startDate = new Date("2026-01-01T00:00:00Z");
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 7);
  const futureDateKey = getDateKeyInTimeZone(futureDate, tz);
  const { endUtc: endDate } = getUtcRangeForDateKey(futureDateKey, tz);

  const tasks = await getEventsInRange(accessToken, startDate, endDate, tz);

  const open = tasks.filter((t) => {
    if (t.isComplete || t.isCancelled) return false;
    const name = (t.calendarName ?? "").toLowerCase();
    if (EXCLUDED_CALENDAR_NAMES.some((ex) => name.includes(ex))) return false;
    return true;
  });

  return NextResponse.json(open, {
    headers: { "Cache-Control": "no-store" },
  });
}
