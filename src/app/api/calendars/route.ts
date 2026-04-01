import { auth } from "@/auth";
import { listWritableCalendars } from "@/lib/google-calendar";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.error === "RefreshAccessTokenError") return NextResponse.json({ error: "TokenExpired" }, { status: 401 });

  try {
    const calendars = await listWritableCalendars(session.accessToken);
    return NextResponse.json(calendars);
  } catch (err) {
    console.error("[API calendars GET]", err);
    return NextResponse.json({ error: "Failed to fetch calendars" }, { status: 500 });
  }
}
