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
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const sec = Number((value as { seconds: number }).seconds);
    return Number.isFinite(sec) ? sec * 1000 : null;
  }
  if (value instanceof Date) return value.getTime();
  return null;
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
