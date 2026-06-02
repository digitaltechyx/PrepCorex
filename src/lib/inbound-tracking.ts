import type { InboundTrackingEntry } from "@/types";

/** Re-fetch carrier status when older than this (6 hours). */
export const INBOUND_TRACKING_REFRESH_MS = 6 * 60 * 60 * 1000;

export function isInboundTrackingStale(
  entry: Pick<InboundTrackingEntry, "lastCheckedAt">,
  now = Date.now()
): boolean {
  const checked = toMillis(entry.lastCheckedAt);
  if (!checked) return true;
  return now - checked >= INBOUND_TRACKING_REFRESH_MS;
}

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

/** Best display status for a row (newest / most relevant entry). */
export function summarizeInboundTrackings(
  entries: InboundTrackingEntry[] | undefined | null
): {
  label: string;
  variant: "none" | "pending" | "transit" | "delivered" | "error" | "unknown";
  entry?: InboundTrackingEntry;
} {
  if (!entries || entries.length === 0) {
    return { label: "No tracking", variant: "none" };
  }

  const sorted = [...entries].sort(
    (a, b) => (toMillis(b.lastCheckedAt) ?? 0) - (toMillis(a.lastCheckedAt) ?? 0)
  );
  const primary = sorted[0];
  const label = primary.lastStatusLabel || primary.lastStatus || "Tracking added";

  if (primary.lastError) return { label: "Check failed", variant: "error", entry: primary };
  if (primary.lastStatus?.toLowerCase().includes("delivered") || primary.lastStatusLabel === "Delivered") {
    return { label: "Delivered", variant: "delivered", entry: primary };
  }
  if (primary.lastStatusLabel === "Not found") {
    return { label: "Not found", variant: "unknown", entry: primary };
  }
  if (
    primary.lastStatus?.toLowerCase().includes("transit") ||
    primary.lastStatusLabel?.toLowerCase().includes("transit")
  ) {
    return { label: label, variant: "transit", entry: primary };
  }
  if (primary.lastStatus?.toLowerCase().includes("pre_transit") || primary.lastStatusLabel === "Label created") {
    return { label: "Label created", variant: "pending", entry: primary };
  }

  return { label, variant: "transit", entry: primary };
}

export function shippoCarrierSelectValue(carrier?: string | null): string {
  if (!carrier) return "usps";
  const c = carrier.toLowerCase();
  if (c.includes("ups")) return "ups";
  if (c.includes("fedex")) return "fedex";
  if (c.includes("dhl")) return "dhl";
  if (c.includes("usps")) return "usps";
  return "usps";
}
