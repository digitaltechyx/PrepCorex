export function reportToMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.toDate === "function") {
      const t = (record.toDate as () => Date)().getTime();
      return Number.isNaN(t) ? 0 : t;
    }
    if (typeof record.seconds === "number") {
      return record.seconds * 1000;
    }
    if (typeof record._seconds === "number") {
      return record._seconds * 1000;
    }
  }
  return 0;
}

/** Pick the first valid timestamp from a Firestore document using preferred field order. */
export function pickReportDateMs(data: Record<string, unknown>, fields: string[]): number {
  for (const field of fields) {
    const ms = reportToMs(data[field]);
    if (ms > 0) return ms;
  }
  return 0;
}

export function reportStartOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function reportEndOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function isInReportRange(date: Date | null, from: Date, to: Date): boolean {
  if (!date || Number.isNaN(date.getTime())) return false;
  return date.getTime() >= reportStartOfDay(from).getTime() && date.getTime() <= reportEndOfDay(to).getTime();
}

export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function formatReportMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function pctChange(current: number, prior: number): number | null {
  if (prior === 0) return current > 0 ? 100 : null;
  return ((current - prior) / prior) * 100;
}

export function uidFromFirestorePath(path: string): string {
  return path.split("/")[1] || "";
}
