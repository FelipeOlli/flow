import { auth } from "@/auth";
import { getFrequentAttendees, FrequentAttendee } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextResponse } from "next/server";

const CACHE_TTL_MS = 10 * 60 * 1000;
let cache: { data: FrequentAttendee[]; ts: number } | null = null;

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json(cache.data);
  }

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  try {
    const attendees = await getFrequentAttendees(accessToken);
    cache = { data: attendees, ts: Date.now() };
    return NextResponse.json(attendees);
  } catch (err) {
    console.error("[API attendees/frequent GET]", err);
    return NextResponse.json({ error: "Failed to fetch frequent attendees" }, { status: 500 });
  }
}
