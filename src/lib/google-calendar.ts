import { google, calendar_v3 } from "googleapis";
import { FlowTask, CreateTaskInput, UpdateTaskInput, CalendarOption } from "@/types/task";
import { getDateKeyInTimeZone, getUtcRangeForDateKey } from "./timezone";

const COMPLETE_COLOR_ID = "2";

// Sobrescreve a cor de calendários específicos pelo nome
const CALENDAR_COLOR_OVERRIDES: Record<string, string> = {
  "TI CF Contabilidade": "#1e3a5f",
};

function getClient(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return google.calendar({ version: "v3", auth });
}

function mapEvent(
  event: calendar_v3.Schema$Event,
  calendarId = "primary",
  calendarName = "",
  calendarBgColor = "#4285f4"
): FlowTask {
  return {
    id: event.id!,
    title: event.summary ?? "Sem título",
    startTime: event.start?.dateTime ?? event.start?.date ?? "",
    endTime: event.end?.dateTime ?? event.end?.date ?? "",
    isComplete: event.colorId === COMPLETE_COLOR_ID,
    colorId: event.colorId ?? undefined,
    description: event.description ?? undefined,
    isAllDay: !event.start?.dateTime,
    calendarId,
    calendarName,
    calendarBgColor,
  };
}

async function fetchAllCalendarsEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  timeZone: string,
  options?: { q?: string; maxResults?: number }
): Promise<FlowTask[]> {
  const calendar = getClient(accessToken);

  const { data: calListData } = await calendar.calendarList.list({
    minAccessRole: "reader",
  });
  const calendarItems = calListData.items ?? [];

  const results = await Promise.allSettled(
    calendarItems.map(async (cal) => {
      const { data } = await calendar.events.list({
        calendarId: cal.id!,
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        timeZone,
        q: options?.q,
        maxResults: options?.maxResults ?? 250,
      });
      const calName = cal.summary ?? "";
      const calColor = CALENDAR_COLOR_OVERRIDES[calName] ?? cal.backgroundColor ?? "#4285f4";
      return (data.items ?? []).map((e) => mapEvent(e, cal.id!, calName, calColor));
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<FlowTask[]> => r.status === "fulfilled")
    .flatMap((r) => r.value)
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

export async function getEventsForDay(
  accessToken: string,
  date: Date,
  timeZone: string
): Promise<FlowTask[]> {
  const dayKey = getDateKeyInTimeZone(date, timeZone);
  return getEventsForDateKey(accessToken, dayKey, timeZone);
}

export async function getEventsForDateKey(
  accessToken: string,
  dateKey: string,
  timeZone: string
): Promise<FlowTask[]> {
  const { startUtc, endUtc } = getUtcRangeForDateKey(dateKey, timeZone);
  return fetchAllCalendarsEvents(accessToken, startUtc, endUtc, timeZone);
}

export async function getEventsInRange(
  accessToken: string,
  startDate: Date,
  endDate: Date,
  timeZone: string,
  options?: { q?: string; maxResults?: number }
): Promise<FlowTask[]> {
  return fetchAllCalendarsEvents(accessToken, startDate, endDate, timeZone, options);
}

export async function createEvent(
  accessToken: string,
  input: CreateTaskInput,
  timeZone: string
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const calendarId = input.calendarId ?? "primary";
  const { data } = await calendar.events.insert({
    calendarId,
    requestBody: {
      summary: input.title,
      description: input.description,
      start: { dateTime: input.startTime, timeZone },
      end: { dateTime: input.endTime, timeZone },
    },
  });
  return mapEvent(data, calendarId);
}

export async function listWritableCalendars(accessToken: string): Promise<CalendarOption[]> {
  const calendar = getClient(accessToken);
  const { data } = await calendar.calendarList.list({
    minAccessRole: "writer",
  });

  return (data.items ?? [])
    .filter((cal) => !!cal.id)
    .map((cal) => ({
      id: cal.id!,
      name: cal.summary ?? "Sem nome",
      bgColor: CALENDAR_COLOR_OVERRIDES[cal.summary ?? ""] ?? cal.backgroundColor ?? undefined,
    }));
}

export async function updateEvent(
  accessToken: string,
  eventId: string,
  updates: UpdateTaskInput,
  timeZone: string,
  calendarId = "primary"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const requestBody: calendar_v3.Schema$Event = {};
  if (updates.title !== undefined) requestBody.summary = updates.title;
  if (updates.description !== undefined) requestBody.description = updates.description;
  if (updates.startTime !== undefined) requestBody.start = { dateTime: updates.startTime, timeZone };
  if (updates.endTime !== undefined) requestBody.end = { dateTime: updates.endTime, timeZone };
  const { data } = await calendar.events.patch({ calendarId, eventId, requestBody });
  return mapEvent(data, calendarId);
}

export async function markEventComplete(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const { data } = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { colorId: COMPLETE_COLOR_ID },
  });
  return mapEvent(data, calendarId);
}

export async function markEventIncomplete(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const { data } = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: { colorId: null },
  });
  return mapEvent(data, calendarId);
}

export async function moveEventToCalendar(
  accessToken: string,
  eventId: string,
  fromCalendarId: string,
  toCalendarId: string
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const { data } = await calendar.events.move({
    calendarId: fromCalendarId,
    eventId,
    destination: toCalendarId,
  });
  return mapEvent(data, toCalendarId);
}

export async function deleteEvent(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
): Promise<void> {
  const calendar = getClient(accessToken);
  await calendar.events.delete({ calendarId, eventId });
}

// Used only by migration (primary calendar only)
export async function getRawEventsForDay(
  accessToken: string,
  date: Date,
  timeZone: string
): Promise<calendar_v3.Schema$Event[]> {
  const calendar = getClient(accessToken);
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);
  const { data } = await calendar.events.list({
    calendarId: "primary",
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    timeZone,
  });
  return data.items ?? [];
}

export async function moveEvent(
  accessToken: string,
  eventId: string,
  newStart: Date,
  newEnd: Date,
  timeZone: string,
  calendarId = "primary"
): Promise<void> {
  const calendar = getClient(accessToken);
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      start: { dateTime: newStart.toISOString(), timeZone },
      end: { dateTime: newEnd.toISOString(), timeZone },
      colorId: null,
    },
  });
}
