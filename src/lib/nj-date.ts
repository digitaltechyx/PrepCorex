export const TZ_NEW_JERSEY = "America/New_York";

type NjCalendarParts = {
  year: number;
  month: number;
  day: number;
};

function partNumber(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes
): number {
  return Number(parts.find((p) => p.type === type)?.value ?? NaN);
}

/** Calendar Y/M/D for an instant in America/New_York. */
export function getCalendarPartsInNJ(date: Date = new Date()): NjCalendarParts {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_NEW_JERSEY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return {
    year: partNumber(parts, "year"),
    month: partNumber(parts, "month"),
    day: partNumber(parts, "day"),
  };
}

/**
 * UTC ms for a wall-clock time on a calendar day in America/New_York.
 * month is 1–12.
 */
export function njWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): number {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  for (let i = 0; i < 3; i += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ_NEW_JERSEY,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(utc));
    const asUtc = Date.UTC(
      partNumber(parts, "year"),
      partNumber(parts, "month") - 1,
      partNumber(parts, "day"),
      partNumber(parts, "hour") % 24,
      partNumber(parts, "minute"),
      partNumber(parts, "second"),
      millisecond
    );
    const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
    utc += desired - asUtc;
  }
  return utc;
}

/** Inclusive UTC start/end for a calendar day in America/New_York. */
export function getNjDayBoundsUtc(
  year: number,
  month: number,
  day: number
): { startMs: number; endMs: number } {
  const startMs = njWallTimeToUtcMs(year, month, day, 0, 0, 0, 0);
  const endMs = njWallTimeToUtcMs(year, month, day, 23, 59, 59, 999);
  return { startMs, endMs };
}

/** Calendar day from a date-picker Date (local Y/M/D), treated as an NJ business day. */
export function getPickerCalendarParts(date: Date): NjCalendarParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/** Local Date at midnight for NJ "today" (for date pickers). */
export function getNjTodayPickerDate(): Date {
  const { year, month, day } = getCalendarPartsInNJ();
  return new Date(year, month - 1, day);
}

export function sameNjCalendarDay(a: Date, b: Date): boolean {
  const pa = getCalendarPartsInNJ(a);
  const pb = getCalendarPartsInNJ(b);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Format an instant for display in America/New_York (EST/EDT). */
export function formatDateTimeInNJ(value: Date | number): string {
  const date = typeof value === "number" ? new Date(value) : value;
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    timeZone: TZ_NEW_JERSEY,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function formatDateInputLocal(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateOnlyLocal(value?: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getTodayDateInputInNJ(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_NEW_JERSEY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return formatDateInputLocal(new Date());
  return `${year}-${month}-${day}`;
}

export function addDaysToDateInput(value: string, days: number): string {
  const base = parseDateOnlyLocal(value);
  if (!base) return value;
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return formatDateInputLocal(next);
}

export function formatDateInputForDisplay(value?: string): string {
  if (!value) return "the due date";
  const d = parseDateOnlyLocal(value);
  if (!d) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function compareDateInputs(a: string, b: string): number {
  const da = parseDateOnlyLocal(a);
  const db = parseDateOnlyLocal(b);
  if (!da || !db) return 0;
  return da.getTime() - db.getTime();
}
