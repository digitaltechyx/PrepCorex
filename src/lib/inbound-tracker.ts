import type { InboundTrackerEntry } from "@/types";
import { normalizeTrackingScan } from "@/lib/carrier-detect";

export const INBOUND_TRACKER_COLLECTION = "inboundTracker";
export const INBOUND_TRACKER_REFRESH_MS = 3 * 60 * 60 * 1000;

export function toMillis(value: unknown): number | null {
  if (!value) return null;
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const sec = record.seconds ?? record._seconds;
    if (sec != null) {
      const n = Number(sec);
      return Number.isFinite(n) ? n * 1000 : null;
    }
  }
  if (value instanceof Date) return value.getTime();
  return null;
}

/** Display date for when the tracking was scanned or manually added. */
export function inboundTrackerAddedDate(
  entry: Pick<InboundTrackerEntry, "addedAt">
): string {
  return formatInboundTrackerDate(entry.addedAt);
}

export function inboundTrackerAddedViaLabel(
  addedVia?: InboundTrackerEntry["addedVia"]
): string {
  return addedVia === "scan" ? "Scanned" : "Manual";
}

export type InboundTrackerStatusFilter =
  | "all"
  | "active"
  | "delivered"
  | "in_transit"
  | "pending"
  | "not_found"
  | "error";

export type InboundTrackerFilters = {
  search: string;
  carrier: string;
  status: InboundTrackerStatusFilter;
  addedVia: "all" | "scan" | "manual";
  addedBy: string;
  addedFrom?: Date;
  addedTo?: Date;
};

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Start/end of today for default date-range filter. */
export function getTodayDateRange(): { addedFrom: Date; addedTo: Date } {
  const today = new Date();
  const addedFrom = new Date(today);
  addedFrom.setHours(0, 0, 0, 0);
  const addedTo = new Date(today);
  addedTo.setHours(23, 59, 59, 999);
  return { addedFrom, addedTo };
}

export function isDefaultInboundTrackerDateRange(from?: Date, to?: Date): boolean {
  if (!from || !to) return false;
  const today = new Date();
  return sameCalendarDay(from, today) && sameCalendarDay(to, today);
}

/** Default filters: today's date range; admin can change or clear dates. */
export function getInboundTrackerDefaultFilters(): InboundTrackerFilters {
  const { addedFrom, addedTo } = getTodayDateRange();
  return {
    search: "",
    carrier: "all",
    status: "all",
    addedVia: "all",
    addedBy: "all",
    addedFrom,
    addedTo,
  };
}

export type InboundTrackerReport = {
  total: number;
  active: number;
  delivered: number;
  inTransit: number;
  pending: number;
  error: number;
  notFound: number;
  scanned: number;
  manual: number;
  byCarrier: Array<{ carrier: string; count: number; pct: number }>;
  byStatus: Array<{ status: string; count: number; pct: number }>;
  byAddedBy: Array<{ name: string; count: number; pct: number }>;
};

function pct(count: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((count / total) * 100);
}

export function matchesAddedDateRange(
  addedAt: InboundTrackerEntry["addedAt"],
  from?: Date,
  to?: Date
): boolean {
  if (!from && !to) return true;
  const ms = toMillis(addedAt);
  if (ms == null) return false;
  if (from) {
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    if (ms < start.getTime()) return false;
  }
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    if (ms > end.getTime()) return false;
  }
  return true;
}

export function buildInboundTrackerReport(entries: InboundTrackerEntry[]): InboundTrackerReport {
  const total = entries.length;
  let active = 0;
  let delivered = 0;
  let inTransit = 0;
  let pending = 0;
  let error = 0;
  let notFound = 0;
  let scanned = 0;
  let manual = 0;

  const carrierCounts = new Map<string, number>();
  const statusCounts = new Map<string, number>();
  const addedByCounts = new Map<string, number>();

  for (const entry of entries) {
    const variant = statusBadgeVariant(entry);
    if (!entry.isClosed) active += 1;
    if (entry.isDelivered || entry.isClosed) delivered += 1;
    if (!entry.isClosed && variant === "transit") inTransit += 1;
    if (variant === "pending") pending += 1;
    if (variant === "error" || entry.lastError) error += 1;
    if (variant === "unknown" || entry.lastStatusLabel === "Not found") notFound += 1;
    if (entry.addedVia === "scan") scanned += 1;
    else manual += 1;

    const carrier = (entry.carrier || "Unknown").trim();
    carrierCounts.set(carrier, (carrierCounts.get(carrier) || 0) + 1);

    const status = entry.lastStatusLabel || entry.lastStatus || "Unknown";
    statusCounts.set(status, (statusCounts.get(status) || 0) + 1);

    const name = (entry.addedByName || "Unknown").trim();
    addedByCounts.set(name, (addedByCounts.get(name) || 0) + 1);
  }

  const byCarrier = [...carrierCounts.entries()]
    .map(([carrier, count]) => ({ carrier, count, pct: pct(count, total) }))
    .sort((a, b) => b.count - a.count);

  const byStatus = [...statusCounts.entries()]
    .map(([status, count]) => ({ status, count, pct: pct(count, total) }))
    .sort((a, b) => b.count - a.count);

  const byAddedBy = [...addedByCounts.entries()]
    .map(([name, count]) => ({ name, count, pct: pct(count, total) }))
    .sort((a, b) => b.count - a.count);

  return {
    total,
    active,
    delivered,
    inTransit,
    pending,
    error,
    notFound,
    scanned,
    manual,
    byCarrier,
    byStatus,
    byAddedBy,
  };
}

export function inboundTrackerHasActiveFilters(filters: InboundTrackerFilters): boolean {
  const dateChanged =
    !filters.addedFrom ||
    !filters.addedTo ||
    !isDefaultInboundTrackerDateRange(filters.addedFrom, filters.addedTo);

  return (
    filters.search.trim() !== "" ||
    filters.carrier !== "all" ||
    filters.status !== "all" ||
    filters.addedVia !== "all" ||
    filters.addedBy !== "all" ||
    dateChanged
  );
}

function entryStatusFilterKey(
  entry: InboundTrackerEntry
): InboundTrackerStatusFilter | null {
  const variant = statusBadgeVariant(entry);
  if (entry.lastError || variant === "error") return "error";
  if (entry.isDelivered || entry.isClosed || variant === "delivered") return "delivered";
  if (entry.lastStatusLabel === "Not found" || variant === "unknown") return "not_found";
  if (variant === "pending") return "pending";
  if (variant === "transit") return "in_transit";
  if (!entry.isClosed) return "active";
  return null;
}

export function filterInboundTrackerEntries(
  entries: InboundTrackerEntry[],
  filters: InboundTrackerFilters
): InboundTrackerEntry[] {
  const q = filters.search.trim().toLowerCase();

  return entries.filter((entry) => {
    if (filters.carrier !== "all") {
      const carrier = (entry.carrier || "Unknown").trim();
      if (carrier.toLowerCase() !== filters.carrier.toLowerCase()) return false;
    }

    if (filters.addedVia !== "all" && entry.addedVia !== filters.addedVia) {
      return false;
    }

    if (filters.addedBy !== "all") {
      const name = (entry.addedByName || "Unknown").trim();
      if (name !== filters.addedBy) return false;
    }

    if (filters.status !== "all") {
      if (filters.status === "active") {
        if (entry.isClosed) return false;
      } else {
        const key = entryStatusFilterKey(entry);
        if (key !== filters.status) return false;
      }
    }

    if (!matchesAddedDateRange(entry.addedAt, filters.addedFrom, filters.addedTo)) {
      return false;
    }

    if (!q) return true;

    const haystack = [
      entry.trackingNumber,
      entry.carrier,
      entry.addedByName,
      entry.lastStatusLabel,
      entry.lastStatus,
      entry.lastStatusDetails,
      entry.lastError,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(q);
  });
}

export function inboundTrackerFilterOptions(entries: InboundTrackerEntry[]): {
  carriers: string[];
  addedByNames: string[];
} {
  const carriers = new Set<string>();
  const addedByNames = new Set<string>();
  for (const entry of entries) {
    carriers.add((entry.carrier || "Unknown").trim());
    if (entry.addedByName?.trim()) addedByNames.add(entry.addedByName.trim());
  }
  return {
    carriers: [...carriers].sort((a, b) => a.localeCompare(b)),
    addedByNames: [...addedByNames].sort((a, b) => a.localeCompare(b)),
  };
}

export function normalizeTrackingNumber(raw: string): string {
  return normalizeTrackingScan(raw);
}

export function inboundTrackerDocId(trackingNumber: string): string {
  const normalized = normalizeTrackingNumber(trackingNumber).toUpperCase();
  const safe = normalized.replace(/[^A-Z0-9]/g, "_").slice(0, 120);
  return safe || `it_${Date.now()}`;
}

export function isInboundTrackerStale(
  entry: Pick<InboundTrackerEntry, "lastCheckedAt" | "isClosed">,
  now = Date.now()
): boolean {
  if (entry.isClosed) return false;
  const checked = toMillis(entry.lastCheckedAt);
  if (!checked) return true;
  return now - checked >= INBOUND_TRACKER_REFRESH_MS;
}

export function statusBadgeVariant(
  entry: Pick<InboundTrackerEntry, "lastStatus" | "lastStatusLabel" | "lastError" | "isDelivered">
): "pending" | "transit" | "delivered" | "error" | "unknown" {
  if (entry.lastError) return "error";
  if (entry.isDelivered || entry.lastStatusLabel === "Delivered") return "delivered";
  if (entry.lastStatusLabel === "Not found") return "unknown";
  const label = (entry.lastStatusLabel || entry.lastStatus || "").toLowerCase();
  if (label.includes("label") || label.includes("pre")) return "pending";
  if (label.includes("transit") || label.includes("delivery")) return "transit";
  return "transit";
}

export function formatInboundTrackerDate(value: unknown): string {
  const ms = toMillis(value);
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
