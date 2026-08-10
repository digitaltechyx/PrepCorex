import { buildShipBestCustomNo } from "@/lib/shipbest-ids";
import type { LabelPurchase, LabelRefundRequest } from "@/types";

/** Users may request a label refund within this window after purchase. */
export const LABEL_REFUND_WINDOW_MS = 2 * 60 * 60 * 1000;

export const LABEL_REFUND_REQUESTS_COLLECTION = "labelRefundRequests";

export function labelRefundRequestsPath(userId: string): string {
  return `users/${userId}/${LABEL_REFUND_REQUESTS_COLLECTION}`;
}

export function firestoreTimeMs(value: unknown): number {
  if (value == null || value === "") return 0;
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "object") {
    const asAny = value as { seconds?: number; toMillis?: () => number };
    if (typeof asAny.toMillis === "function") {
      try {
        return asAny.toMillis();
      } catch {
        /* ignore */
      }
    }
    if (typeof asAny.seconds === "number") return asAny.seconds * 1000;
  }
  return 0;
}

/** Prefer label purchase / payment completion time for the refund window. */
export function labelPurchaseAnchorMs(label: Pick<
  LabelPurchase,
  "labelPurchasedAt" | "paymentCompletedAt" | "createdAt"
>): number {
  return (
    firestoreTimeMs(label.labelPurchasedAt) ||
    firestoreTimeMs(label.paymentCompletedAt) ||
    firestoreTimeMs(label.createdAt) ||
    0
  );
}

export function labelRefundWindowEndsAtMs(anchorMs: number): number {
  if (!anchorMs) return 0;
  return anchorMs + LABEL_REFUND_WINDOW_MS;
}

export function isWithinLabelRefundWindow(anchorMs: number, nowMs = Date.now()): boolean {
  if (!anchorMs) return false;
  return nowMs >= anchorMs && nowMs <= labelRefundWindowEndsAtMs(anchorMs);
}

export function formatLabelAge(anchorMs: number, nowMs = Date.now()): string {
  if (!anchorMs) return "Unknown";
  const diff = Math.max(0, nowMs - anchorMs);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  if (hours < 48) return remMin > 0 ? `${hours}h ${remMin}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function formatLabelRefundCountdown(anchorMs: number, nowMs = Date.now()): string {
  const ends = labelRefundWindowEndsAtMs(anchorMs);
  const rem = ends - nowMs;
  if (rem <= 0) return "Expired";
  const minutes = Math.ceil(rem / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const hours = Math.floor(minutes / 60);
  const remMin = minutes % 60;
  return remMin > 0 ? `${hours}h ${remMin}m left` : `${hours}h left`;
}

export function canRequestLabelRefund(
  label: LabelPurchase,
  nowMs = Date.now()
): { ok: boolean; reason?: string } {
  const refundStatus = String(label.refundStatus || "none").toLowerCase();
  if (refundStatus === "requested") {
    return { ok: false, reason: "A refund request is already pending admin review." };
  }
  if (refundStatus === "refunded") {
    return { ok: false, reason: "This label was already refunded." };
  }

  const paymentOk =
    label.paymentStatus === "succeeded" ||
    label.status === "label_purchased" ||
    label.status === "completed" ||
    label.status === "label_failed" ||
    label.status === "payment_succeeded";

  if (!paymentOk) {
    return { ok: false, reason: "Payment must succeed before requesting a refund." };
  }

  if (!label.stripePaymentIntentId?.trim()) {
    return { ok: false, reason: "Missing payment reference for refund." };
  }

  const amount = Math.max(0, Math.floor(Number(label.paymentAmount) || 0));
  if (amount < 1) {
    return { ok: false, reason: "Nothing to refund on this label." };
  }

  const anchor = labelPurchaseAnchorMs(label);
  if (!isWithinLabelRefundWindow(anchor, nowMs)) {
    return {
      ok: false,
      reason: "Refund requests are only available within 2 hours of purchase.",
    };
  }

  return { ok: true };
}

/** Detect likely PrepCorex / integration failures (not carrier delivery issues). */
export function detectLabelPlatformIssue(label: Pick<LabelPurchase, "status" | "errorMessage">): boolean {
  if (label.status === "label_failed") return true;
  const msg = String(label.errorMessage || "").toLowerCase();
  if (!msg) return false;
  const patterns = [
    "shipment id not found",
    "rate id not found",
    "shipbest logistics product",
    "shipment address/parcel missing",
    "missing shipment",
    "payment succeeded but label",
    "webhook",
    "internal",
    "timeout",
    "failed to purchase",
    "could not create",
    "unauthorized",
    "api key",
  ];
  return patterns.some((p) => msg.includes(p));
}

export function formatLabelProviderName(provider?: string | null): string {
  const p = String(provider || "").toLowerCase();
  if (p === "shippo") return "Shippo";
  if (p === "shipbest") return "ShipBest";
  return provider ? String(provider) : "Unknown";
}

/** Prefer stored customNo; otherwise rebuild the deterministic ShipBest id. */
export function resolveShipBestCustomNo(
  userId: string,
  labelPurchaseId: string,
  stored?: string | null
): string | null {
  const existing = String(stored || "").trim();
  if (existing) return existing;
  if (!userId || !labelPurchaseId) return null;
  return buildShipBestCustomNo(userId, labelPurchaseId);
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = String(value || "").trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Fill gaps on older refund snapshots from the live label purchase
 * (and reconstruct ShipBest customNo when the purchase never stored it).
 */
export function mergeLabelRefundWithPurchase(
  request: LabelRefundRequest,
  label: LabelPurchase | null | undefined
): LabelRefundRequest {
  const provider = firstNonEmpty(
    request.labelProvider,
    label?.labelProvider,
    label?.selectedRate?.labelProvider
  );
  const isShipBest = String(provider || "").toLowerCase() === "shipbest";
  const shipbestCustomNo = isShipBest
    ? resolveShipBestCustomNo(
        request.userId,
        request.labelPurchaseId,
        firstNonEmpty(request.shipbestCustomNo, label?.shipbestCustomNo)
      )
    : firstNonEmpty(request.shipbestCustomNo, label?.shipbestCustomNo);

  if (!label) {
    return {
      ...request,
      labelProvider: provider || request.labelProvider,
      shipbestCustomNo: shipbestCustomNo || request.shipbestCustomNo || null,
    };
  }

  return {
    ...request,
    trackingNumber: firstNonEmpty(request.trackingNumber, label.trackingNumber),
    labelUrl: firstNonEmpty(request.labelUrl, label.labelUrl),
    labelProvider: provider || request.labelProvider,
    carrierProvider: firstNonEmpty(request.carrierProvider, label.selectedRate?.provider),
    serviceLevel: firstNonEmpty(request.serviceLevel, label.selectedRate?.serviceLevel),
    labelPurchaseStatus: request.labelPurchaseStatus || label.status || null,
    shippoTransactionId: firstNonEmpty(request.shippoTransactionId, label.shippoTransactionId),
    shipbestOrderNo: firstNonEmpty(request.shipbestOrderNo, label.shipbestOrderNo),
    shipbestCustomNo: shipbestCustomNo || null,
    selectedRateAmount: firstNonEmpty(request.selectedRateAmount, label.selectedRate?.amount),
    selectedRateCurrency: firstNonEmpty(request.selectedRateCurrency, label.selectedRate?.currency),
    errorMessage: firstNonEmpty(request.errorMessage, label.errorMessage),
    fromName: firstNonEmpty(request.fromName, label.fromAddress?.name),
    toName: firstNonEmpty(request.toName, label.toAddress?.name),
    toCity: firstNonEmpty(request.toCity, label.toAddress?.city),
    toCountry: firstNonEmpty(request.toCountry, label.toAddress?.country),
    stripeChargeId: firstNonEmpty(request.stripeChargeId, label.stripeChargeId),
  };
}

export function formatLabelMoney(amountCents: number, currency = "usd"): string {
  const cur = (currency || "usd").toUpperCase();
  return `${cur} $${(Math.max(0, amountCents) / 100).toFixed(2)}`;
}

export type LabelRefundRequestRow = LabelRefundRequest;
