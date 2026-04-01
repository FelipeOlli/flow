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
}

export interface CalendarOption {
  id: string;
  name: string;
  bgColor?: string;
}
