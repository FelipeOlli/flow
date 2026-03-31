import { auth } from "@/auth";
import { updateEvent, markEventComplete, markEventIncomplete, deleteEvent } from "@/lib/google-calendar";
import { NextRequest, NextResponse } from "next/server";
import { UpdateTaskInput } from "@/types/task";

type Params = Promise<{ eventId: string }>;

export async function PATCH(req: NextRequest, context: { params: Params }) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await context.params;

  try {
    const body: UpdateTaskInput = await req.json();
    const calendarId = body.calendarId ?? "primary";
    const tz = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";

    let task;
    if (body.isComplete === true) {
      task = await markEventComplete(session.accessToken, eventId, calendarId);
    } else if (body.isComplete === false) {
      task = await markEventIncomplete(session.accessToken, eventId, calendarId);
    } else {
      task = await updateEvent(session.accessToken, eventId, body, tz, calendarId);
    }
    return NextResponse.json(task);
  } catch (err) {
    console.error("[API tasks PATCH]", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Params }) {
  const session = await auth();
  if (!session?.accessToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { eventId } = await context.params;
  const calendarId = req.nextUrl.searchParams.get("calendarId") ?? "primary";

  try {
    await deleteEvent(session.accessToken, eventId, calendarId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[API tasks DELETE]", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
