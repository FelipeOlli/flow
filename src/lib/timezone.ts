const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isDateKey(value: string): boolean {
  return DATE_KEY_RE.test(value);
}

export function getDateKeyInTimeZone(date: Date, timeZone: string): string {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  const parts = dtf.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = parseDateKey(dateKey);
  const shifted = new Date(Date.UTC(y, m - 1, d + days, 12, 0, 0, 0));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** 0 = domingo … 6 = sábado. dateKey é literal, independe de timezone. */
export function getWeekdayForDateKey(dateKey: string): number {
  const [y, m, d] = parseDateKey(dateKey);
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay();
}

export function isWeekendDateKey(dateKey: string): boolean {
  const weekday = getWeekdayForDateKey(dateKey);
  return weekday === 0 || weekday === 6;
}

/** Se cair em sáb/dom, avança para a segunda seguinte; senão devolve igual. */
export function toNextBusinessDateKey(dateKey: string): string {
  const weekday = getWeekdayForDateKey(dateKey);
  if (weekday === 6) return shiftDateKey(dateKey, 2); // sábado → segunda
  if (weekday === 0) return shiftDateKey(dateKey, 1); // domingo → segunda
  return dateKey;
}

/** toKey minus fromKey in calendar days (e.g. 2026-04-03 vs 2026-04-04 → -1). */
export function diffDateKeysInDays(fromKey: string, toKey: string): number {
  if (!isDateKey(fromKey) || !isDateKey(toKey)) return 0;
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const [ty, tm, td] = toKey.split("-").map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000);
}

export function getTimePartsInTimeZone(date: Date, timeZone: string): { hour: number; minute: number } {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  return {
    hour: Number(parts.find((p) => p.type === "hour")?.value ?? "0"),
    minute: Number(parts.find((p) => p.type === "minute")?.value ?? "0"),
  };
}

export function getUtcRangeForDateKey(dateKey: string, timeZone: string): { startUtc: Date; endUtc: Date } {
  return {
    startUtc: zonedDateTimeToUtc(dateKey, timeZone, 0, 0, 0, 0),
    endUtc: zonedDateTimeToUtc(dateKey, timeZone, 23, 59, 59, 999),
  };
}

export function getReferenceDateForDateKey(dateKey: string, timeZone: string): Date {
  return zonedDateTimeToUtc(dateKey, timeZone, 12, 0, 0, 0);
}

export function zonedDateTimeToUtc(
  dateKey: string,
  timeZone: string,
  hour: number,
  minute: number,
  second: number,
  millisecond: number
): Date {
  const [y, m, d] = parseDateKey(dateKey);
  let utcTs = Date.UTC(y, m - 1, d, hour, minute, second, millisecond);
  let offset = getTimeZoneOffsetMs(new Date(utcTs), timeZone);
  utcTs -= offset;
  const offsetAfter = getTimeZoneOffsetMs(new Date(utcTs), timeZone);
  if (offsetAfter !== offset) utcTs -= (offsetAfter - offset);
  return new Date(utcTs);
}

function parseDateKey(dateKey: string): [number, number, number] {
  if (!isDateKey(dateKey)) throw new Error(`Invalid date key: ${dateKey}`);
  const [year, month, day] = dateKey.split("-").map(Number);
  return [year, month, day];
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const year = Number(parts.find((p) => p.type === "year")?.value ?? "0");
  const month = Number(parts.find((p) => p.type === "month")?.value ?? "1");
  const day = Number(parts.find((p) => p.type === "day")?.value ?? "1");
  // Some Intl implementations return "24" for midnight instead of "0" — normalise.
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const second = Number(parts.find((p) => p.type === "second")?.value ?? "0");
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - date.getTime();
}

/**
 * yyyy-MM-dd for placing a task in a calendar column. All-day events prefer the
 * literal `date` prefix from Google so `new Date("yyyy-MM-dd")` UTC drift does
 * not shift the chip to the wrong day in America/Sao_Paulo and similar zones.
 */
export function getTaskGridDateKey(startTime: string, isAllDay: boolean, timeZone: string): string {
  if (isAllDay && startTime) {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(startTime.trim());
    if (m) return m[1];
  }
  return getDateKeyInTimeZone(new Date(startTime), timeZone);
}
