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

/** Units actually received on an approved inbound request (warehouse v2 + legacy). */
export function inboundReceivedQuantity(data: Record<string, unknown>): number {
  const warehouseGood = Number(data.warehouseGoodReceivedQty);
  if (Number.isFinite(warehouseGood) && warehouseGood > 0) return warehouseGood;
  const received = Number(data.receivedQuantity);
  if (Number.isFinite(received) && received > 0) return received;
  return Math.max(0, Number(data.quantity) || 0);
}

export function reportStartOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function reportEndOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}

export function isInReportRange(
  date: Date | null,
  from: Date,
  to: Date,
  allTime = false
): boolean {
  if (!date || Number.isNaN(date.getTime())) return false;
  if (allTime) return true;
  return date.getTime() >= reportStartOfDay(from).getTime() && date.getTime() <= reportEndOfDay(to).getTime();
}

/** Resolve invoice date using the same field priority as the admin dashboard finance snapshot. */
export function pickInvoiceDateMs(invoice: Record<string, unknown>): number {
  const direct = pickReportDateMs(invoice, ["issuedAt", "generatedAt", "createdAt", "date"]);
  if (direct > 0) return direct;

  const rawDate = typeof invoice.date === "string" ? invoice.date.trim() : "";
  if (rawDate.includes("/")) {
    const parts = rawDate.split("/");
    if (parts.length === 3) {
      const a = Number(parts[0]);
      const b = Number(parts[1]);
      const c = Number(parts[2]);
      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) {
        const year = c < 100 ? 2000 + c : c;
        const dayFirst = a > 12;
        const month = dayFirst ? b : a;
        const day = dayFirst ? a : b;
        const parsed = new Date(year, month - 1, day);
        if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
      }
    }
  }

  return 0;
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
