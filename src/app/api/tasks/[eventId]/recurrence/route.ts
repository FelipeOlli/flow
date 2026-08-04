import { auth } from "@/auth";
import { getEventRecurrenceRule } from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextRequest, NextResponse } from "next/server";

type Params = Promise<{ eventId: string }>;

export async function GET(req: NextRequest, context: { params: Params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const { eventId } = await context.params;
  const calendarId = req.nextUrl.searchParams.get("calendarId") ?? "primary";

  try {
    const recurrence = await getEventRecurrenceRule(accessToken, eventId, calendarId);
    return NextResponse.json({ recurrence });
  } catch (err) {
    console.error("[API tasks recurrence GET]", err);
    return NextResponse.json({ error: "Failed to load recurrence" }, { status: 500 });
  }
}
