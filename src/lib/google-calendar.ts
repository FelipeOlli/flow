import { google, calendar_v3 } from "googleapis";
import { FlowTask, CreateTaskInput, UpdateTaskInput, CalendarOption, AttendanceStatus, Pillar } from "@/types/task";
import { getDateKeyInTimeZone, getUtcRangeForDateKey, shiftDateKey } from "./timezone";
import { formatGoogleRecurrence } from "./recurrence-format";
import { CALENDAR_PILLAR_OVERRIDES } from "./pillar-config";

const COMPLETE_COLOR_ID = "2";
const IMPORTANT_COLOR_ID = "5";

// Sobrescreve a cor de calendários específicos pelo nome
const CALENDAR_COLOR_OVERRIDES: Record<string, string> = {
  "TI CF Contabilidade": "#1e3a5f",
  "DevPoint": "#18c4c4",
};

export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

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
  const selfAttendee = (event.attendees ?? []).find((att) => att.self);
  const conferenceUri =
    event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri ??
    event.conferenceData?.entryPoints?.[0]?.uri;
  const meetingUrl = event.hangoutLink ?? conferenceUri ?? undefined;
  const attendees = (event.attendees ?? [])
    .filter((att) => !!att.email || !!att.displayName)
    .map((att) => ({
      name: att.displayName ?? undefined,
      email: att.email ?? undefined,
      responseStatus: att.responseStatus as AttendanceStatus | undefined,
    }));

  const recurrenceDisplay = formatGoogleRecurrence(
    event.recurrence ?? undefined,
    event.recurringEventId
  );

  return {
    id: event.id!,
    title: event.summary ?? "Sem título",
    startTime: event.start?.dateTime ?? event.start?.date ?? "",
    endTime: event.end?.dateTime ?? event.end?.date ?? "",
    isComplete: (() => {
      const flowCompleted = event.extendedProperties?.private?.["flowCompleted"];
      if (flowCompleted !== undefined) return flowCompleted === "true";
      return event.colorId === COMPLETE_COLOR_ID; // backward compat
    })(),
    isImportant: event.extendedProperties?.private?.["flowImportant"] === "true",
    isDelegable: event.extendedProperties?.private?.["flowDelegable"] === "true",
    category: (event.extendedProperties?.private?.["flowCategory"] as "operational" | "strategic" | undefined) || undefined,
    pillar: ((event.extendedProperties?.private?.["flowPillar"] || CALENDAR_PILLAR_OVERRIDES[calendarName]) as Pillar | undefined) || undefined,
    colorId: event.colorId ?? undefined,
    description: event.description ?? undefined,
    isAllDay: !event.start?.dateTime,
    calendarId,
    calendarName,
    calendarBgColor,
    attendees: attendees.length > 0 ? attendees : undefined,
    selfResponseStatus: selfAttendee?.responseStatus as AttendanceStatus | undefined,
    meetingUrl,
    isCancelled: event.status === "cancelled",
    isRecurring: recurrenceDisplay.isRecurring,
    recurrenceSummary: recurrenceDisplay.summary || undefined,
    recurrenceEndHint: recurrenceDisplay.endHint,
    createdAt: event.created ?? undefined,
    completedAt: event.extendedProperties?.private?.["flowCompletedAt"] || undefined,
    openSince: event.extendedProperties?.private?.["flowOpenSince"] || undefined,
  };
}

async function listCalendarEntries(
  client: ReturnType<typeof getClient>,
  minAccessRole: "reader" | "writer"
): Promise<calendar_v3.Schema$CalendarListEntry[]> {
  const entries: calendar_v3.Schema$CalendarListEntry[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await client.calendarList.list({
      minAccessRole,
      maxResults: 250,
      pageToken,
    });
    entries.push(...(data.items ?? []));
    pageToken = data.nextPageToken ?? undefined;
  } while (pageToken);
  return entries;
}

async function listEventsExpandedPage(
  client: ReturnType<typeof getClient>,
  calendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
  timeZone: string,
  q?: string,
  /** Quando definido (ex.: busca global), para após N eventos neste calendário. */
  maxItemsPerCalendar?: number
): Promise<calendar_v3.Schema$Event[]> {
  const items: calendar_v3.Schema$Event[] = [];
  let pageToken: string | undefined;
  do {
    const { data } = await client.events.list({
      calendarId,
      timeMin: timeMinIso,
      timeMax: timeMaxIso,
      singleEvents: true,
      orderBy: "startTime",
      timeZone,
      q,
      maxResults: 250,
      pageToken,
      showHiddenInvitations: true,
    });
    const batch = data.items ?? [];
    if (maxItemsPerCalendar !== undefined) {
      const room = maxItemsPerCalendar - items.length;
      if (room > 0) items.push(...batch.slice(0, room));
    } else {
      items.push(...batch);
    }
    pageToken = data.nextPageToken ?? undefined;
    if (maxItemsPerCalendar !== undefined && items.length >= maxItemsPerCalendar) break;
  } while (pageToken);
  return items;
}

async function fetchAllCalendarsEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  timeZone: string,
  options?: { q?: string; maxResults?: number; writableOnly?: boolean }
): Promise<FlowTask[]> {
  const calendar = getClient(accessToken);

  const calendarItems = (await listCalendarEntries(
    calendar,
    options?.writableOnly ? "writer" : "reader"
  )).filter((c) => Boolean(c.id));

  const timeMinIso = timeMin.toISOString();
  const timeMaxIso = timeMax.toISOString();

  console.log(
    `[FLOW CAL] Consultando ${calendarItems.length} calendário(s) entre ${timeMinIso} e ${timeMaxIso}:`,
    calendarItems.map((c) => c.id).join(", ")
  );

  type RawItem = { event: calendar_v3.Schema$Event; calId: string; calName: string; calColor: string };

  const results = await Promise.allSettled(
    calendarItems.map(async (cal): Promise<RawItem[]> => {
      const id = cal.id!;
      const rawEvents = await listEventsExpandedPage(
        calendar,
        id,
        timeMinIso,
        timeMaxIso,
        timeZone,
        options?.q,
        options?.maxResults
      );
      const calName = cal.summary ?? "";
      const calColor = CALENDAR_COLOR_OVERRIDES[calName] ?? cal.backgroundColor ?? "#4285f4";
      return rawEvents.map((e) => ({ event: e, calId: id, calName, calColor }));
    })
  );

  const allRaw: RawItem[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const cal = calendarItems[i];
    if (r.status === "fulfilled") {
      allRaw.push(...r.value);
    } else {
      console.error(
        `[FLOW CAL] Falha ao listar eventos do calendário "${cal.summary ?? cal.id}" (${cal.id}):`,
        r.reason
      );
    }
  }

  // Deduplicar pelo iCalUID — com showHiddenInvitations:true o mesmo convite pode
  // aparecer em múltiplos calendários (ex.: original + cópia sombra no calendário pessoal).
  // O status RSVP do usuário é refletido com mais precisão na cópia sombra do calendário
  // pessoal do que na cópia do calendário compartilhado, então priorizamos pelo status
  // mais específico: declined > tentative > accepted > needsAction > ausente.
  const rsvpPriority: Record<string, number> = {
    declined: 4, tentative: 3, accepted: 2, needsAction: 1,
  };
  const selfStatus = (item: RawItem) => {
    const status = item.event.attendees?.find((a) => a.self)?.responseStatus ?? "";
    return rsvpPriority[status] ?? 0;
  };
  const seenUIDs = new Map<string, RawItem>();
  const tasks: FlowTask[] = [];
  for (const item of allRaw) {
    const uid = item.event.iCalUID;
    if (!uid) {
      tasks.push(mapEvent(item.event, item.calId, item.calName, item.calColor));
      continue;
    }
    const existing = seenUIDs.get(uid);
    if (!existing || selfStatus(item) > selfStatus(existing)) {
      seenUIDs.set(uid, item);
    }
  }
  seenUIDs.forEach((item) => {
    tasks.push(mapEvent(item.event, item.calId, item.calName, item.calColor));
  });

  return tasks.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
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
  timeZone: string,
  options?: { writableOnly?: boolean }
): Promise<FlowTask[]> {
  const { startUtc, endUtc } = getUtcRangeForDateKey(dateKey, timeZone);
  return fetchAllCalendarsEvents(accessToken, startUtc, endUtc, timeZone, {
    writableOnly: options?.writableOnly,
  });
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
  const requestBody: calendar_v3.Schema$Event = {
    summary: input.title,
    description: input.description,
    start: { dateTime: input.startTime, timeZone },
    end: { dateTime: input.endTime, timeZone },
    recurrence: input.recurrence?.length ? input.recurrence : undefined,
  };

  if (input.isImportant) {
    requestBody.colorId = "5";
    requestBody.extendedProperties = {
      private: { flowImportant: "true", flowOriginalImportantColorId: "" },
    };
  }

  const extraPrivate: Record<string, string> = {};
  if (input.isDelegable) extraPrivate.flowDelegable = "true";
  if (input.category) extraPrivate.flowCategory = input.category;
  if (input.pillar) extraPrivate.flowPillar = input.pillar;
  if (Object.keys(extraPrivate).length > 0) {
    requestBody.extendedProperties = {
      private: { ...(requestBody.extendedProperties?.private ?? {}), ...extraPrivate },
    };
  }

  if (input.attendees?.length) {
    requestBody.attendees = input.attendees.map((email) => ({ email }));
  }

  const { data } = await calendar.events.insert({ calendarId, requestBody });
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
  calendarId = "primary",
  scope: "this" | "thisAndFollowing" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);

  function buildRequestBody(startISO?: string, endISO?: string): calendar_v3.Schema$Event {
    const body: calendar_v3.Schema$Event = {};
    if (updates.title !== undefined) body.summary = updates.title;
    if (updates.description !== undefined) body.description = updates.description;
    if (startISO !== undefined) body.start = { dateTime: startISO, timeZone };
    if (endISO !== undefined) body.end = { dateTime: endISO, timeZone };
    if (updates.attendees !== undefined) body.attendees = updates.attendees.map((email) => ({ email }));
    if (updates.recurrence !== undefined) body.recurrence = updates.recurrence;
    return body;
  }

  if (updates.removeRecurrence) {
    const { data: instance } = await calendar.events.get({ calendarId, eventId });
    const masterId = instance.recurringEventId ?? eventId;
    const { data: master } = await calendar.events.get({ calendarId, eventId: masterId });
    const originalStart =
      instance.originalStartTime?.dateTime ??
      instance.originalStartTime?.date ??
      instance.start?.dateTime ??
      instance.start?.date;

    if (originalStart && master.recurrence?.length) {
      // UNTIL inclusivo no início desta ocorrência — ela vira a última da série,
      // preservando as ocorrências passadas (e seu histórico de conclusão)
      const pad = (n: number) => String(n).padStart(2, "0");
      const cutoff = new Date(originalStart);
      const untilUtc =
        `${cutoff.getUTCFullYear()}${pad(cutoff.getUTCMonth() + 1)}${pad(cutoff.getUTCDate())}` +
        `T${pad(cutoff.getUTCHours())}${pad(cutoff.getUTCMinutes())}${pad(cutoff.getUTCSeconds())}Z`;
      const truncatedRecurrence = master.recurrence.map((line) => {
        if (line.startsWith("RRULE:")) {
          return "RRULE:" + line
            .slice(6)
            .split(";")
            .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
            .concat(`UNTIL=${untilUtc}`)
            .join(";");
        }
        return line;
      });
      await calendar.events.patch({ calendarId, eventId: masterId, requestBody: { recurrence: truncatedRecurrence } });
    }

    const requestBody = buildRequestBody(updates.startTime, updates.endTime);
    const { data } = await calendar.events.patch({ calendarId, eventId, requestBody });
    return mapEvent(data, calendarId);
  }

  if (scope === "this") {
    const requestBody = buildRequestBody(updates.startTime, updates.endTime);
    const { data } = await calendar.events.patch({ calendarId, eventId, requestBody });
    return mapEvent(data, calendarId);
  }

  const { data: instance } = await calendar.events.get({ calendarId, eventId });
  const masterId = instance.recurringEventId ?? eventId;

  if (scope === "all") {
    const requestBody = buildRequestBody(updates.startTime, updates.endTime);
    const { data } = await calendar.events.patch({ calendarId, eventId: masterId, requestBody });
    return mapEvent(data, calendarId);
  }

  // thisAndFollowing
  const { data: master } = await calendar.events.get({ calendarId, eventId: masterId });
  const originalStart =
    instance.originalStartTime?.dateTime ??
    instance.originalStartTime?.date ??
    instance.start?.dateTime ??
    instance.start?.date;

  if (!originalStart) {
    const requestBody = buildRequestBody(updates.startTime, updates.endTime);
    const { data } = await calendar.events.patch({ calendarId, eventId, requestBody });
    return mapEvent(data, calendarId);
  }

  const masterStart = master.start?.dateTime ?? master.start?.date ?? "";
  if (masterStart && new Date(originalStart) <= new Date(masterStart)) {
    // editing from the first occurrence — just patch master
    const requestBody = buildRequestBody(updates.startTime, updates.endTime);
    const { data } = await calendar.events.patch({ calendarId, eventId: masterId, requestBody });
    return mapEvent(data, calendarId);
  }

  // Truncate master RRULE at originalStart - 1s
  const pad = (n: number) => String(n).padStart(2, "0");
  const cutoffMs = new Date(originalStart).getTime() - 1000;
  const cutoffDate = new Date(cutoffMs);
  const untilUtc =
    `${cutoffDate.getUTCFullYear()}${pad(cutoffDate.getUTCMonth() + 1)}${pad(cutoffDate.getUTCDate())}` +
    `T${pad(cutoffDate.getUTCHours())}${pad(cutoffDate.getUTCMinutes())}${pad(cutoffDate.getUTCSeconds())}Z`;

  const truncatedRecurrence = (master.recurrence ?? []).map((line) => {
    if (line.startsWith("RRULE:")) {
      return "RRULE:" + line
        .slice(6)
        .split(";")
        .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
        .concat(`UNTIL=${untilUtc}`)
        .join(";");
    }
    return line;
  });
  await calendar.events.patch({ calendarId, eventId: masterId, requestBody: { recurrence: truncatedRecurrence } });

  // Original RRULE without UNTIL/COUNT — for the new series
  const originalRRule = (master.recurrence ?? []).map((line) => {
    if (line.startsWith("RRULE:")) {
      return "RRULE:" + line
        .slice(6)
        .split(";")
        .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
        .join(";");
    }
    return line;
  });

  // Duration from original series
  const masterStartMs = new Date(master.start?.dateTime ?? master.start?.date ?? originalStart).getTime();
  const masterEndMs = new Date(master.end?.dateTime ?? master.end?.date ?? originalStart).getTime();
  const durationMs = masterEndMs - masterStartMs;

  const newStart = updates.startTime ?? instance.start?.dateTime ?? originalStart;
  const newEnd = updates.endTime ?? (() => {
    const d = new Date(new Date(newStart).getTime() + durationMs);
    return d.toISOString();
  })();

  const newEventBody: calendar_v3.Schema$Event = {
    summary: updates.title !== undefined ? updates.title : (master.summary ?? ""),
    start: { dateTime: newStart, timeZone },
    end: { dateTime: newEnd, timeZone },
    recurrence: originalRRule,
    attendees: updates.attendees !== undefined
      ? updates.attendees.map((email) => ({ email }))
      : (master.attendees ?? undefined),
    extendedProperties: master.extendedProperties,
  };
  if (updates.description !== undefined) {
    newEventBody.description = updates.description;
  } else if (master.description) {
    newEventBody.description = master.description;
  }

  const { data: newEvent } = await calendar.events.insert({ calendarId, requestBody: newEventBody });
  return mapEvent(newEvent, calendarId);
}

export async function markEventComplete(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
  scope: "this" | "thisAndFollowing" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);

  if (scope === "thisAndFollowing") {
    const { data: instance } = await calendar.events.get({ calendarId, eventId });
    const masterId = instance.recurringEventId ?? eventId;
    const originalStart =
      instance.originalStartTime?.dateTime ??
      instance.originalStartTime?.date ??
      instance.start?.dateTime ??
      instance.start?.date;

    if (originalStart) {
      const { data: master } = await calendar.events.get({ calendarId, eventId: masterId });
      const masterStart = master.start?.dateTime ?? master.start?.date ?? "";
      const isFirstOrBefore = masterStart && new Date(originalStart) <= new Date(masterStart);

      if (!isFirstOrBefore) {
        // Truncar RRULE: UNTIL = originalStart (inclusive — esta instância continua existindo)
        const untilDate = new Date(originalStart);
        const pad = (n: number) => String(n).padStart(2, "0");
        const untilUtc =
          `${untilDate.getUTCFullYear()}${pad(untilDate.getUTCMonth() + 1)}${pad(untilDate.getUTCDate())}` +
          `T${pad(untilDate.getUTCHours())}${pad(untilDate.getUTCMinutes())}${pad(untilDate.getUTCSeconds())}Z`;

        const recurrence = (master.recurrence ?? []).map((line) => {
          if (line.startsWith("RRULE:")) {
            return "RRULE:" + line
              .slice(6)
              .split(";")
              .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
              .concat(`UNTIL=${untilUtc}`)
              .join(";");
          }
          return line;
        });
        await calendar.events.patch({ calendarId, eventId: masterId, requestBody: { recurrence } });
      }
    }
    // Marcar esta instância como concluída
  }

  if (scope === "all") {
    const { data: instance } = await calendar.events.get({ calendarId, eventId });
    const masterId = instance.recurringEventId ?? eventId;
    const originalStart =
      instance.originalStartTime?.dateTime ??
      instance.originalStartTime?.date ??
      instance.start?.dateTime ??
      instance.start?.date;

    // Truncar RRULE no master com UNTIL = originalStart - 1s (esta instância é a última)
    // e marcar o master como concluído (todas as instâncias herdam via extendedProperties)
    const { data: master } = await calendar.events.get({ calendarId, eventId: masterId });
    const masterOriginalColorId =
      master.colorId && master.colorId !== COMPLETE_COLOR_ID ? master.colorId : "";

    let recurrence = master.recurrence;
    if (originalStart) {
      const cutoffMs = new Date(originalStart).getTime() - 1000;
      const cutoffDate = new Date(cutoffMs);
      const pad = (n: number) => String(n).padStart(2, "0");
      const untilUtc =
        `${cutoffDate.getUTCFullYear()}${pad(cutoffDate.getUTCMonth() + 1)}${pad(cutoffDate.getUTCDate())}` +
        `T${pad(cutoffDate.getUTCHours())}${pad(cutoffDate.getUTCMinutes())}${pad(cutoffDate.getUTCSeconds())}Z`;

      recurrence = (master.recurrence ?? []).map((line) => {
        if (line.startsWith("RRULE:")) {
          return "RRULE:" + line
            .slice(6)
            .split(";")
            .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
            .concat(`UNTIL=${untilUtc}`)
            .join(";");
        }
        return line;
      });
    }

    const masterPatch: Record<string, unknown> = {
      colorId: COMPLETE_COLOR_ID,
      extendedProperties: {
        private: {
          flowCompleted: "true",
          flowOriginalColorId: masterOriginalColorId,
          flowCompletedAt: new Date().toISOString(),
        },
      },
    };
    if (recurrence) masterPatch.recurrence = recurrence;
    const { data } = await calendar.events.patch({ calendarId, eventId: masterId, requestBody: masterPatch });
    return mapEvent(data, calendarId);
  }

  // scope === "this" (ou pós-truncate de "thisAndFollowing"): marcar instância
  const { data: current } = await calendar.events.get({ calendarId, eventId });
  // Salva a cor original apenas se não for já a cor de "completo"
  const originalColorId =
    current.colorId && current.colorId !== COMPLETE_COLOR_ID ? current.colorId : "";
  const { data } = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      colorId: COMPLETE_COLOR_ID,
      extendedProperties: {
        private: {
          flowCompleted: "true",
          flowOriginalColorId: originalColorId,
          flowCompletedAt: new Date().toISOString(),
        },
      },
    },
  });
  return mapEvent(data, calendarId);
}

export async function markEventIncomplete(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const { data: current } = await calendar.events.get({ calendarId, eventId });
  // Restaura a cor que o evento tinha antes de ser marcado como concluído
  const restoredColorId =
    current.extendedProperties?.private?.["flowOriginalColorId"] || null;
  const { data } = await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      colorId: restoredColorId,
      extendedProperties: {
        private: {
          flowCompleted: "false",
          flowOriginalColorId: "",
          flowCompletedAt: "",
        },
      },
    },
  });
  return mapEvent(data, calendarId);
}

async function resolveEventId(
  calendar: ReturnType<typeof getClient>,
  eventId: string,
  calendarId: string,
  scope: "this" | "all"
): Promise<string> {
  if (scope === "this") return eventId;
  const { data: instance } = await calendar.events.get({ calendarId, eventId });
  return instance.recurringEventId ?? eventId;
}

export async function markEventImportant(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
  scope: "this" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const targetId = await resolveEventId(calendar, eventId, calendarId, scope);
  const { data: current } = await calendar.events.get({ calendarId, eventId: targetId });
  const originalColorId =
    current.colorId && current.colorId !== IMPORTANT_COLOR_ID ? current.colorId : "";
  const { data } = await calendar.events.patch({
    calendarId,
    eventId: targetId,
    requestBody: {
      colorId: IMPORTANT_COLOR_ID,
      extendedProperties: {
        private: {
          flowImportant: "true",
          flowOriginalImportantColorId: originalColorId,
        },
      },
    },
  });
  return mapEvent(data, calendarId);
}

export async function markEventUnimportant(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
  scope: "this" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const targetId = await resolveEventId(calendar, eventId, calendarId, scope);
  const { data: current } = await calendar.events.get({ calendarId, eventId: targetId });
  const restoredColorId =
    current.extendedProperties?.private?.["flowOriginalImportantColorId"] || null;
  const { data } = await calendar.events.patch({
    calendarId,
    eventId: targetId,
    requestBody: {
      colorId: restoredColorId,
      extendedProperties: {
        private: {
          flowImportant: "false",
          flowOriginalImportantColorId: "",
        },
      },
    },
  });
  return mapEvent(data, calendarId);
}

export async function markEventDelegable(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
  scope: "this" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const targetId = await resolveEventId(calendar, eventId, calendarId, scope);
  const { data } = await calendar.events.patch({
    calendarId,
    eventId: targetId,
    requestBody: {
      extendedProperties: { private: { flowDelegable: "true" } },
    },
  });
  return mapEvent(data, calendarId);
}

export async function markEventUndelegable(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
  scope: "this" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const targetId = await resolveEventId(calendar, eventId, calendarId, scope);
  const { data } = await calendar.events.patch({
    calendarId,
    eventId: targetId,
    requestBody: {
      extendedProperties: { private: { flowDelegable: "false" } },
    },
  });
  return mapEvent(data, calendarId);
}

export async function setEventCategory(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
  category: "operational" | "strategic" | null,
  scope: "this" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const targetId = await resolveEventId(calendar, eventId, calendarId, scope);
  const { data } = await calendar.events.patch({
    calendarId,
    eventId: targetId,
    requestBody: {
      extendedProperties: { private: { flowCategory: category ?? "" } },
    },
  });
  return mapEvent(data, calendarId);
}

export async function setEventPillar(
  accessToken: string,
  eventId: string,
  calendarId = "primary",
  pillar: Pillar | null,
  scope: "this" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const targetId = await resolveEventId(calendar, eventId, calendarId, scope);
  const { data } = await calendar.events.patch({
    calendarId,
    eventId: targetId,
    requestBody: {
      extendedProperties: { private: { flowPillar: pillar ?? "" } },
    },
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
  calendarId = "primary",
  scope: "this" | "thisAndFollowing" | "all" = "this"
): Promise<void> {
  const calendar = getClient(accessToken);

  if (scope === "this") {
    await calendar.events.delete({ calendarId, eventId });
    return;
  }

  const { data: instance } = await calendar.events.get({ calendarId, eventId });
  const masterId = instance.recurringEventId ?? eventId;

  if (scope === "all") {
    await calendar.events.delete({ calendarId, eventId: masterId });
    return;
  }

  // thisAndFollowing: truncate the series at originalStartTime - 1s
  const { data: master } = await calendar.events.get({ calendarId, eventId: masterId });
  const originalStart = instance.originalStartTime?.dateTime ?? instance.originalStartTime?.date ?? instance.start?.dateTime ?? instance.start?.date;
  if (!originalStart) {
    await calendar.events.delete({ calendarId, eventId });
    return;
  }

  const cutoffMs = new Date(originalStart).getTime() - 1000;
  const cutoffDate = new Date(cutoffMs);
  const pad = (n: number) => String(n).padStart(2, "0");
  const untilUtc =
    `${cutoffDate.getUTCFullYear()}${pad(cutoffDate.getUTCMonth() + 1)}${pad(cutoffDate.getUTCDate())}` +
    `T${pad(cutoffDate.getUTCHours())}${pad(cutoffDate.getUTCMinutes())}${pad(cutoffDate.getUTCSeconds())}Z`;

  const masterStart = master.start?.dateTime ?? master.start?.date ?? "";
  if (masterStart && new Date(originalStart) <= new Date(masterStart)) {
    // Cutting at or before the first occurrence — delete entire series
    await calendar.events.delete({ calendarId, eventId: masterId });
    return;
  }

  const recurrence = (master.recurrence ?? []).map((line) => {
    if (line.startsWith("RRULE:")) {
      return "RRULE:" + line
        .slice(6)
        .split(";")
        .filter((p) => !p.startsWith("UNTIL=") && !p.startsWith("COUNT="))
        .concat(`UNTIL=${untilUtc}`)
        .join(";");
    }
    return line;
  });

  await calendar.events.patch({ calendarId, eventId: masterId, requestBody: { recurrence } });
}

export async function getEventById(
  accessToken: string,
  eventId: string,
  calendarId = "primary"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const { data } = await calendar.events.get({ calendarId, eventId });
  return mapEvent(data, calendarId);
}

export async function updateEventRsvp(
  accessToken: string,
  eventId: string,
  calendarId: string,
  attendanceStatus: Exclude<AttendanceStatus, "needsAction">,
  userEmail?: string,
  scope: "this" | "all" = "this"
): Promise<FlowTask> {
  const calendar = getClient(accessToken);
  const targetId = await resolveEventId(calendar, eventId, calendarId, scope);
  const { data: current } = await calendar.events.get({ calendarId, eventId: targetId });

  const attendees = [...(current.attendees ?? [])];
  let attendeeIndex = attendees.findIndex((att) => att.self);
  if (attendeeIndex < 0 && userEmail) {
    attendeeIndex = attendees.findIndex((att) => att.email?.toLowerCase() === userEmail.toLowerCase());
  }

  if (attendeeIndex >= 0) {
    attendees[attendeeIndex] = {
      ...attendees[attendeeIndex],
      responseStatus: attendanceStatus,
    };
  } else if (userEmail) {
    attendees.push({
      email: userEmail,
      responseStatus: attendanceStatus,
    });
  } else {
    throw new Error("Could not determine attendee to update RSVP");
  }

  const { data } = await calendar.events.patch({
    calendarId,
    eventId: targetId,
    requestBody: {
      attendees,
      attendeesOmitted: false,
    },
  });

  return mapEvent(data, calendarId);
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
  _timeZone: string,
  calendarId = "primary",
  options?: { preserveComplete?: boolean; openSince?: string }
): Promise<void> {
  const calendar = getClient(accessToken);
  const preserve = Boolean(options?.preserveComplete);
  // RFC3339 com offset/Z e sem `timeZone` no corpo evita interpretação dupla na API do Google.
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      start: { dateTime: newStart.toISOString() },
      end: { dateTime: newEnd.toISOString() },
      colorId: preserve ? COMPLETE_COLOR_ID : null,
      ...(options?.openSince
        ? { extendedProperties: { private: { flowOpenSince: options.openSince } } }
        : {}),
    },
  });
}

/** All-day events use `date` / `date` (end exclusive). Preserves completed color when requested. */
export async function moveAllDayEvent(
  accessToken: string,
  eventId: string,
  calendarId: string,
  startDateKey: string,
  endDateKeyExclusive: string,
  dayDelta: number,
  options?: { preserveComplete?: boolean; openSince?: string }
): Promise<void> {
  const calendar = getClient(accessToken);
  const preserve = Boolean(options?.preserveComplete);
  const newStart = shiftDateKey(startDateKey, dayDelta);
  const newEnd = shiftDateKey(endDateKeyExclusive, dayDelta);
  await calendar.events.patch({
    calendarId,
    eventId,
    requestBody: {
      start: { date: newStart },
      end: { date: newEnd },
      colorId: preserve ? COMPLETE_COLOR_ID : null,
      ...(options?.openSince
        ? { extendedProperties: { private: { flowOpenSince: options.openSince } } }
        : {}),
    },
  });
}
