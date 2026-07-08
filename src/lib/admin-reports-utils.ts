export function reportToMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    return (value as { seconds: number }).seconds * 1000;
  }
  if (value instanceof Date) return value.getTime();
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
