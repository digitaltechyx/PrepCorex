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

export function formatLabelMoney(amountCents: number, currency = "usd"): string {
  const cur = (currency || "usd").toUpperCase();
  return `${cur} $${(Math.max(0, amountCents) / 100).toFixed(2)}`;
}

export type LabelRefundRequestRow = LabelRefundRequest;
