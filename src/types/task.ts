export interface FlowTask {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isComplete: boolean;
  isImportant?: boolean;
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
}

export interface UpdateTaskInput {
  title?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  isComplete?: boolean;
  isImportant?: boolean;
  calendarId?: string;
  targetCalendarId?: string;
  attendanceStatus?: Exclude<AttendanceStatus, "needsAction">;
}

export interface CalendarOption {
  id: string;
  name: string;
  bgColor?: string;
}
