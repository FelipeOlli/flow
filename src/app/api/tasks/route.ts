import { auth } from "@/auth";
import { getEventsForDay, getEventsInRange, createEvent } from "@/lib/google-calendar";
import { NextRequest, NextResponse } from "next/server";
import { CreateTaskInput } from "@/types/task";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.error === "RefreshAccessTokenError") return NextResponse.json({ error: "TokenExpired" }, { status: 401 });

  const tz = req.nextUrl.searchParams.get("tz") ?? process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
  const startDateParam = req.nextUrl.searchParams.get("startDate");
  const endDateParam = req.nextUrl.searchParams.get("endDate");
  const dateParam = req.nextUrl.searchParams.get("date");

  try {
    let tasks;
    if (startDateParam && endDateParam) {
      tasks = await getEventsInRange(session.accessToken, new Date(startDateParam), new Date(endDateParam), tz);
    } else {
      const date = dateParam ? new Date(dateParam) : new Date();
      tasks = await getEventsForDay(session.accessToken, date, tz);
    }
    return NextResponse.json(tasks);
  } catch (err) {
    console.error("[API tasks GET]", err);
    return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body: CreateTaskInput = await req.json();
    const tz = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    const task = await createEvent(session.accessToken, body, tz);
    return NextResponse.json(task, { status: 201 });
  } catch (err) {
    console.error("[API tasks POST]", err);
    return NextResponse.json({ error: "Failed to create task" }, { status: 500 });
  }
}
