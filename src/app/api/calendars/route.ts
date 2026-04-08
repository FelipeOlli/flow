import { auth } from "@/auth";
import { listWritableCalendars } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  try {
    const calendars = await listWritableCalendars(accessToken);
    return NextResponse.json(calendars);
  } catch (err) {
    console.error("[API calendars GET]", err);
    return NextResponse.json({ error: "Failed to fetch calendars" }, { status: 500 });
  }
}
