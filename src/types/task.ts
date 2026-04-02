export interface FlowTask {
  id: string;
  title: string;
  startTime: string;
  endTime: string;
  isComplete: boolean;
  colorId?: string;
  description?: string;
  isAllDay: boolean;
  calendarId?: string;
  calendarName?: string;
  calendarBgColor?: string;
  attendees?: TaskAttendee[];
  selfResponseStatus?: AttendanceStatus;
  meetingUrl?: string;
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
}

export interface UpdateTaskInput {
  title?: string;
  startTime?: string;
  endTime?: string;
  description?: string;
  isComplete?: boolean;
  calendarId?: string;
  targetCalendarId?: string;
  attendanceStatus?: Exclude<AttendanceStatus, "needsAction">;
}

export interface CalendarOption {
  id: string;
  name: string;
  bgColor?: string;
}
