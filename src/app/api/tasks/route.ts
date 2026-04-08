import { auth } from "@/auth";
import { getEventsForDay, getEventsInRange, createEvent } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextRequest, NextResponse } from "next/server";
import { CreateTaskInput } from "@/types/task";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const tz = req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");
  const dateParam = req.nextUrl.searchParams.get("date");
  const query = req.nextUrl.searchParams.get("q")?.trim();
  const limitParam = Number(req.nextUrl.searchParams.get("limit") ?? "80");
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(Math.floor(limitParam), 1), 250) : 80;

  try {
    let tasks;
    if (query) {
      const now = new Date();
      const startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 5);
      const endDate = new Date(now);
      endDate.setFullYear(endDate.getFullYear() + 5);
      tasks = await getEventsInRange(accessToken, startDate, endDate, tz, {
        q: query,
        maxResults: limit,
      });
      tasks = tasks.slice(0, limit);
    } else if (startDateParam && endDateParam) {
      tasks = await getEventsInRange(accessToken, new Date(startDateParam), new Date(endDateParam), tz);
    } else {
      const date = dateParam ? new Date(dateParam) : new Date();
      tasks = await getEventsForDay(accessToken, date, tz);
    }
    return NextResponse.json(tasks);
  } catch (err) {
    console.error("[API tasks GET]", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  try {
    const body: CreateTaskInput = await req.json();
    const tz = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    const task = await createEvent(accessToken, body, tz);
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("[API tasks POST]", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
