import { auth } from "@/auth";
import {
  updateEvent,
  markEventComplete,
  markEventIncomplete,
  markEventImportant,
  markEventUnimportant,
  deleteEvent,
  moveEventToCalendar,
  updateEventRsvp,
  getEventById,
} from "@/lib/google-calendar";
import { getValidAccessToken } from "@/lib/token-store";
import { NextRequest, NextResponse } from "next/server";
import { UpdateTaskInput } from "@/types/task";

type Params = Promise<{ eventId: string }>;

export async function PATCH(req: NextRequest, context: { params: Params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const { eventId } = await context.params;

  try {
    const body: UpdateTaskInput = await req.json();
    const calendarId = body.calendarId ?? "primary";
    const targetCalendarId = body.targetCalendarId ?? calendarId;
    const attendanceStatus = body.attendanceStatus;
    const tz = process.env.DEFAULT_TIMEZONE ?? "America/Sao_Paulo";
    const userEmail = process.env.AUTH_USER_EMAIL ?? undefined;

    let task;
    if (body.isComplete === true) {
      task = await markEventComplete(accessToken, eventId, calendarId);
    } else if (body.isComplete === false) {
      task = await markEventIncomplete(accessToken, eventId, calendarId);
    } else if (body.isImportant === true) {
      task = await markEventImportant(accessToken, eventId, calendarId);
    } else if (body.isImportant === false) {
      task = await markEventUnimportant(accessToken, eventId, calendarId);
    } else {
      const hasUpdateFields =
        body.title !== undefined ||
        body.startTime !== undefined ||
        body.endTime !== undefined ||
        body.description !== undefined;

      if (targetCalendarId !== calendarId) {
        const moved = await moveEventToCalendar(
          accessToken,
          eventId,
          calendarId,
          targetCalendarId
        );
        const edited = hasUpdateFields
          ? await updateEvent(accessToken, moved.id, body, tz, targetCalendarId)
          : moved;
        task = attendanceStatus
          ? await updateEventRsvp(
              accessToken,
              edited.id,
              targetCalendarId,
              attendanceStatus,
              userEmail
            )
          : edited;
      } else {
        const edited = hasUpdateFields
          ? await updateEvent(accessToken, eventId, body, tz, calendarId)
          : null;
        if (attendanceStatus) {
          task = await updateEventRsvp(
            accessToken,
            edited?.id ?? eventId,
            calendarId,
            attendanceStatus,
            userEmail
          );
        } else {
          task = edited ?? (await getEventById(accessToken, eventId, calendarId));
        }
      }
    }
    return NextResponse.json(task);
  } catch (err) {
    console.error("[API tasks PATCH]", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, context: { params: Params }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const accessToken = await getValidAccessToken();
  if (!accessToken) return NextResponse.json({ error: "GoogleCalendarNotConnected" }, { status: 503 });

  const { eventId } = await context.params;
  const calendarId = req.nextUrl.searchParams.get("calendarId") ?? "primary";

  try {
    await deleteEvent(accessToken, eventId, calendarId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[API tasks DELETE]", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
