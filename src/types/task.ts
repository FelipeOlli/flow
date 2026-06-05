export type Pillar = "trabalho" | "saude" | "familia" | "espiritualidade";

export interface FlowTask {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isComplete: boolean;
  isImportant?: boolean;
  isDelegable?: boolean;
  category?: "operational" | "strategic";
  pillar?: Pillar;
  colorId?: string;
  description?: string;
  isAllDay: boolean;
  calendarId?: string;
  calendarName?: string;
  calendarBgColor?: string;
  attendees?: TaskAttendee[];
  selfResponseStatus?: AttendanceStatus;
  meetingUrl?: string;
  isCancelled?: boolean;
  /** True se o evento tem RRULE ou é instância de série (singleEvents expandido). */
  isRecurring?: boolean;
  /** Ex.: "Semanalmente (seg, qua)" */
  recurrenceSummary?: string;
  /** Ex.: "Termina em …" ou "Termina após N ocorrências" */
  recurrenceEndHint?: string;
  /** ISO 8601 — quando o evento foi criado no Google Calendar */
  createdAt?: string;
  /** ISO 8601 — quando o evento foi marcado como concluído (via flowCompletedAt extended property) */
  completedAt?: string;
}

export type AttendanceStatus = "needsAction" | "declined" | "tentative" | "accepted";

export interface TaskAttendee {
  name?: string;
  email?: string;
  responseStatus?: AttendanceStatus;
}

export interface TimeSlot {
  start: Date;
  end: Date;
}

export interface CreateTaskInput {
  title: string;
  startTime: string;
  endTime: string;
  description?: string;
  calendarId?: string;
  /** RRULE array, ex.: ["RRULE:FREQ=WEEKLY;BYDAY=MO"] */
  recurrence?: string[];
  isImportant?: boolean;
  isDelegable?: boolean;
  category?: "operational" | "strategic";
  pillar?: Pillar;
  /** Lista de e-mails dos convidados */
  attendees?: string[];
}

export interface UpdateTaskInput {
  title?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  isComplete?: boolean;
  isImportant?: boolean;
  isDelegable?: boolean;
  category?: "operational" | "strategic" | null;
  pillar?: Pillar | null;
  calendarId?: string;
  targetCalendarId?: string;
  attendanceStatus?: Exclude<AttendanceStatus, "needsAction">;
  attendees?: string[];
}

export interface CalendarOption {
  id: string;
  name: string;
  bgColor?: string;
}
