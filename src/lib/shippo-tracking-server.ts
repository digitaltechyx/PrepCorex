/**
 * Server-side Shippo tracking fetch + status normalization.
 */

export type ShippoTrackResult = {
  ok: boolean;
  tracking?: Record<string, unknown>;
  error?: string;
};

export function carrierToShippoCode(carrier?: string | null): string {
  if (!carrier) return "usps";
  switch (carrier.trim().toLowerCase()) {
    case "usps":
      return "usps";
    case "ups":
      return "ups";
    case "fedex":
      return "fedex";
    case "dhl":
      return "dhl_express";
    case "amazon logistics":
    case "amazon":
      return "usps";
    default:
      return "usps";
  }
}

export async function fetchShippoTracking(
  trackingNumber: string,
  carrier?: string | null
): Promise<ShippoTrackResult> {
  const apiKey = process.env.SHIPPO_API_KEY;
  if (!apiKey) {
    return { ok: false, error: "Shippo API key not configured" };
  }

  const effectiveCarrier = carrierToShippoCode(carrier);
  const url = `https://api.goshippo.com/tracks/${encodeURIComponent(
    effectiveCarrier
  )}/${encodeURIComponent(trackingNumber.trim())}/`;

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `ShippoToken ${apiKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const details =
        (errorData as { detail?: string }).detail ||
        (errorData as { message?: string }).message ||
        `HTTP ${response.status}`;
      return { ok: false, error: details };
    }

    const tracking = (await response.json()) as Record<string, unknown>;
    return { ok: true, tracking };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}

export function parseShippoTrackingStatus(tracking?: Record<string, unknown>): {
  status: string;
  statusLabel: string;
  statusDetails?: string;
  isDelivered: boolean;
  isUnknown: boolean;
} {
  const rawStatus = (tracking?.tracking_status as { status?: string } | undefined)?.status;
  const statusDetails = (tracking?.tracking_status as { status_details?: string } | undefined)
    ?.status_details;

  const statusUpper = (rawStatus || "UNKNOWN").toUpperCase();
  const looksUnknown =
    !tracking?.tracking_status ||
    statusUpper === "UNKNOWN" ||
    (statusDetails && statusDetails.toLowerCase().includes("not found"));

  const statusLabel = formatTrackingStatusLabel(rawStatus);
  const isDelivered = statusUpper.includes("DELIVERED");

  return {
    status: rawStatus || "UNKNOWN",
    statusLabel: looksUnknown ? "Not found" : statusLabel,
    statusDetails: statusDetails || undefined,
    isDelivered,
    isUnknown: looksUnknown,
  };
}

export function formatTrackingStatusLabel(status: string | undefined): string {
  if (!status) return "Unknown";
  const statusLower = status.toLowerCase();
  if (statusLower.includes("delivered")) return "Delivered";
  if (statusLower.includes("out_for_delivery") || statusLower.includes("out for delivery"))
    return "Out for delivery";
  if (statusLower.includes("in_transit") || statusLower.includes("in transit")) return "In transit";
  if (statusLower.includes("pre_transit") || statusLower.includes("pre transit")) return "Label created";
  if (statusLower.includes("transit")) return "In transit";
  return status
    .split(/[_\s]+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}
