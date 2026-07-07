const TZ_NEW_JERSEY = "America/New_York";

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
