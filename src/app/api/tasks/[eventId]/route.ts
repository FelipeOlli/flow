import { auth } from "@/auth";
import {
  updateEvent,
  markEventComplete,
  markEventIncomplete,
  markEventImportant,
  markEventUnimportant,
  markEventDelegable,
  markEventUndelegable,
  setEventCategory,
  setEventPillar,
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

    const markerScope = (body.scope === "all" ? "all" : "this") as "this" | "all";
    const updateScope = (body.scope ?? "this") as "this" | "thisAndFollowing" | "all";
    const rsvpScope = (body.scope === "all" ? "all" : "this") as "this" | "all";

    let task;
    if (body.isComplete === true) {
      const completeScope = body.completeScope ?? "this";
      task = await markEventComplete(accessToken, eventId, calendarId, completeScope);
    } else if (body.isComplete === false) {
      task = await markEventIncomplete(accessToken, eventId, calendarId);
    } else if (body.isImportant === true) {
      task = await markEventImportant(accessToken, eventId, calendarId, markerScope);
    } else if (body.isImportant === false) {
      task = await markEventUnimportant(accessToken, eventId, calendarId, markerScope);
    } else if (body.isDelegable === true) {
      task = await markEventDelegable(accessToken, eventId, calendarId, markerScope);
    } else if (body.isDelegable === false) {
      task = await markEventUndelegable(accessToken, eventId, calendarId, markerScope);
    } else if (body.category !== undefined) {
      task = await setEventCategory(accessToken, eventId, calendarId, body.category, markerScope);
    } else if (body.pillar !== undefined) {
      task = await setEventPillar(accessToken, eventId, calendarId, body.pillar, markerScope);
    } else {
      const hasUpdateFields =
        body.title !== undefined ||
        body.startTime !== undefined ||
        body.endTime !== undefined ||
        body.description !== undefined ||
        body.attendees !== undefined ||
        body.recurrence !== undefined ||
        body.removeRecurrence !== undefined;

      if (targetCalendarId !== calendarId) {
        const moved = await moveEventToCalendar(
          accessToken,
          eventId,
          calendarId,
          targetCalendarId
        );
        const edited = hasUpdateFields
          ? await updateEvent(accessToken, moved.id, body, tz, targetCalendarId, updateScope)
          : moved;
        task = attendanceStatus
          ? await updateEventRsvp(
              accessToken,
              edited.id,
              targetCalendarId,
              attendanceStatus,
              userEmail,
              rsvpScope
            )
          : edited;
      } else {
        const edited = hasUpdateFields
          ? await updateEvent(accessToken, eventId, body, tz, calendarId, updateScope)
          : null;
        if (attendanceStatus) {
          task = await updateEventRsvp(
            accessToken,
            edited?.id ?? eventId,
            calendarId,
            attendanceStatus,
            userEmail,
            rsvpScope
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
  const scopeParam = req.nextUrl.searchParams.get("deleteScope") ?? "this";
  const scope = (["this", "thisAndFollowing", "all"].includes(scopeParam)
    ? scopeParam
    : "this") as "this" | "thisAndFollowing" | "all";

  try {
    await deleteEvent(accessToken, eventId, calendarId, scope);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error("[API tasks DELETE]", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
