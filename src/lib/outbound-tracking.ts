import type { OutboundTrackerEntry } from "@/types";

export const OUTBOUND_TRACKING_COLLECTION = "outboundTracker";
export const OUTBOUND_TRACKING_REFRESH_MS = 6 * 60 * 60 * 1000;
export const OUTBOUND_TRACKING_STALE_MS = 48 * 60 * 60 * 1000;

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
export function outboundTrackerAddedDate(
  entry: Pick<OutboundTrackerEntry, "addedAt">
): string {
  return formatOutboundTrackerDate(entry.addedAt);
}

export function outboundTrackerAddedViaLabel(
  addedVia?: OutboundTrackerEntry["addedVia"]
): string {
  return addedVia === "scan" ? "Scanned" : "Manual";
}

export type OutboundTrackerStatusFilter =
  | "all"
  | "active"
  | "delivered"
  | "in_transit"
  | "pending"
  | "not_found"
  | "error";

export type OutboundTrackerFilters = {
  search: string;
  carrier: string;
  status: OutboundTrackerStatusFilter;
  addedVia: "all" | "scan" | "manual";
  addedBy: string;
};

export const OUTBOUND_TRACKER_DEFAULT_FILTERS: OutboundTrackerFilters = {
  search: "",
  carrier: "all",
  status: "all",
  addedVia: "all",
  addedBy: "all",
};

function entryStatusFilterKey(
  entry: OutboundTrackerEntry
): OutboundTrackerStatusFilter | null {
  const variant = statusBadgeVariant(entry);
  if (entry.lastError || variant === "error") return "error";
  if (entry.isDelivered || entry.isClosed || variant === "delivered") return "delivered";
  if (entry.lastStatusLabel === "Not found" || variant === "unknown") return "not_found";
  if (variant === "pending") return "pending";
  if (variant === "transit") return "in_transit";
  if (!entry.isClosed) return "active";
  return null;
}

export function filterOutboundTrackerEntries(
  entries: OutboundTrackerEntry[],
  filters: OutboundTrackerFilters
): OutboundTrackerEntry[] {
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

export function outboundTrackerFilterOptions(entries: OutboundTrackerEntry[]): {
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
  return raw.trim().replace(/\s+/g, "");
}

export function outboundTrackerDocId(trackingNumber: string): string {
  const normalized = normalizeTrackingNumber(trackingNumber).toUpperCase();
  const safe = normalized.replace(/[^A-Z0-9]/g, "_").slice(0, 120);
  return safe || `ot_${Date.now()}`;
}

export function isOutboundTrackingStale(
  entry: Pick<OutboundTrackerEntry, "lastCheckedAt" | "isClosed">,
  now = Date.now()
): boolean {
  if (entry.isClosed) return false;
  const checked = toMillis(entry.lastCheckedAt);
  if (!checked) return true;
  return now - checked >= OUTBOUND_TRACKING_REFRESH_MS;
}

export function statusBadgeVariant(
  entry: Pick<OutboundTrackerEntry, "lastStatus" | "lastStatusLabel" | "lastError" | "isDelivered">
): "pending" | "transit" | "delivered" | "error" | "unknown" {
  if (entry.lastError) return "error";
  if (entry.isDelivered || entry.lastStatusLabel === "Delivered") return "delivered";
  if (entry.lastStatusLabel === "Not found") return "unknown";
  const label = (entry.lastStatusLabel || entry.lastStatus || "").toLowerCase();
  if (label.includes("label") || label.includes("pre")) return "pending";
  if (label.includes("transit") || label.includes("delivery")) return "transit";
  return "transit";
}

export function formatOutboundTrackerDate(value: unknown): string {
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
