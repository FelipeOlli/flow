import { auth } from "@/auth";
import { getEventsInRange } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { getDateKeyInTimeZone } from "@/lib/timezone";
import { NextRequest, NextResponse } from "next/server";

const MONTH_LABELS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const tz = req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();

  if (!Number.isFinite(year) || year < 2020 || year > 2035) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  try {
    const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
    const endDate = new Date(`${year + 1}-01-01T00:00:00.000Z`);

    const tasks = await getEventsInRange(accessToken, startDate, endDate, tz);

    // Aggregate by day
    const byDay: Record<string, { total: number; completed: number }> = {};

    for (const task of tasks) {
      if (!task.startTime || task.isCancelled) continue;

      let dateKey: string;
      if (task.isAllDay) {
        dateKey = task.startTime.slice(0, 10);
      } else {
        dateKey = getDateKeyInTimeZone(new Date(task.startTime), tz);
      }

      if (!dateKey.startsWith(`${year}-`)) continue;

      if (!byDay[dateKey]) byDay[dateKey] = { total: 0, completed: 0 };
      byDay[dateKey].total++;
      if (task.isComplete) byDay[dateKey].completed++;
    }

    // Aggregate by month
    const byMonth = Array.from({ length: 12 }, (_, i) => ({
      month: i + 1,
      label: MONTH_LABELS[i],
      total: 0,
      completed: 0,
    }));

    for (const [dateKey, stats] of Object.entries(byDay)) {
      const monthIndex = parseInt(dateKey.slice(5, 7), 10) - 1;
      if (monthIndex >= 0 && monthIndex < 12) {
        byMonth[monthIndex].total += stats.total;
        byMonth[monthIndex].completed += stats.completed;
      }
    }

    // Average days to complete
    let avgSumDays = 0;
    let avgCount = 0;
    for (const task of tasks) {
      if (task.isComplete && task.createdAt && task.completedAt) {
        const days = (new Date(task.completedAt).getTime() - new Date(task.createdAt).getTime()) / 86400000;
        if (days >= 0) { avgSumDays += days; avgCount++; }
      }
    }
    const avgDaysToComplete = avgCount > 0 ? Math.round((avgSumDays / avgCount) * 10) / 10 : null;

    // Totals
    const totalCompleted = Object.values(byDay).reduce((s, d) => s + d.completed, 0);
    const totalEvents = Object.values(byDay).reduce((s, d) => s + d.total, 0);

    // Best day
    let bestDay: { date: string; completed: number } | null = null;
    for (const [date, stats] of Object.entries(byDay)) {
      if (!bestDay || stats.completed > bestDay.completed) {
        bestDay = { date, completed: stats.completed };
      }
    }

    // Streak — iterate all days of the year up to today
    const todayKey = getDateKeyInTimeZone(new Date(), tz);
    let currentStreak = 0;
    let bestStreak = 0;
    let tempStreak = 0;

    const cursor = new Date(`${year}-01-01`);
    const yearEnd = new Date(`${year}-12-31`);
    while (cursor <= yearEnd) {
      const key = cursor.toISOString().slice(0, 10);
      if (key > todayKey) break;
      if ((byDay[key]?.completed ?? 0) > 0) {
        tempStreak++;
        bestStreak = Math.max(bestStreak, tempStreak);
        currentStreak = tempStreak;
      } else {
        tempStreak = 0;
        currentStreak = 0;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    return NextResponse.json(
      {
        year,
        byDay,
        byMonth,
        totals: {
          total: totalEvents,
          completed: totalCompleted,
          rate: totalEvents > 0 ? Math.round((totalCompleted / totalEvents) * 100) : 0,
        },
        streak: { current: currentStreak, best: bestStreak },
        bestDay,
        avgDaysToComplete,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[API stats GET]", err);
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 });
  }
}
