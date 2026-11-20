import type { ShopifyNormalizedOrder } from "@/lib/shopify-order-normalize";

export function isShopifyOrderCancelled(
  order: Pick<ShopifyNormalizedOrder, "cancelledAt">
): boolean {
  return Boolean(order.cancelledAt && String(order.cancelledAt).trim());
}

/** Paid in Shopify sense (fully paid). */
export function isShopifyOrderPaid(
  order: Pick<ShopifyNormalizedOrder, "financialStatus">
): boolean {
  return String(order.financialStatus || "").trim().toLowerCase() === "paid";
}

/** Not fully paid yet (pending / authorized / partially paid / unknown). */
export function isShopifyOrderUnpaid(
  order: Pick<ShopifyNormalizedOrder, "financialStatus">
): boolean {
  const s = String(order.financialStatus || "").trim().toLowerCase();
  return s === "" || s === "pending" || s === "authorized" || s === "partially_paid";
}

/** Refunded or partially refunded. */
export function isShopifyOrderRefunded(
  order: Pick<ShopifyNormalizedOrder, "financialStatus">
): boolean {
  const s = String(order.financialStatus || "").trim().toLowerCase();
  return s === "refunded" || s === "partially_refunded";
}

/** Still needs fulfillment work (includes Shopify "partial"). */
export function isShopifyOrderUnfulfilledStatus(
  status: string | null | undefined
): boolean {
  const s = String(status || "").trim().toLowerCase();
  return !s || s === "null" || s === "unfulfilled" || s === "partial";
}

export function formatShopifyPaymentLabel(status: string | null | undefined): string {
  const s = String(status || "").trim().toLowerCase();
  if (!s) return "Payment unknown";
  const map: Record<string, string> = {
    pending: "Payment pending",
    authorized: "Authorized",
    partially_paid: "Partially paid",
    paid: "Paid",
    partially_refunded: "Partially refunded",
    refunded: "Refunded",
    voided: "Voided",
  };
  return map[s] || s.replace(/_/g, " ");
}

export function formatShopifyFulfillmentLabel(status: string | null | undefined): string {
  const s = String(status || "").trim().toLowerCase();
  if (!s || s === "null") return "Unfulfilled";
  const map: Record<string, string> = {
    unfulfilled: "Unfulfilled",
    partial: "Partially fulfilled",
    fulfilled: "Fulfilled",
    restocked: "Restocked",
  };
  return map[s] || s.replace(/_/g, " ");
}

/** Short guidance line for warehouse / fulfillment staff. */
export function getShopifyOrderTeamHint(
  order: Pick<ShopifyNormalizedOrder, "cancelledAt" | "financialStatus" | "fulfillmentStatus">
): string {
  if (isShopifyOrderCancelled(order)) {
    const pay = String(order.financialStatus || "").toLowerCase();
    if (pay === "refunded" || pay === "partially_refunded") {
      return "Do not ship — order cancelled and refunded.";
    }
    if (pay === "voided") {
      return "Do not ship — order cancelled (payment voided).";
    }
    return "Do not ship — order cancelled on Shopify.";
  }
  const pay = String(order.financialStatus || "").toLowerCase();
  if (pay === "refunded") {
    return "Do not ship — payment fully refunded.";
  }
  if (pay === "voided") {
    return "Do not ship — payment voided.";
  }
  const fs = String(order.fulfillmentStatus || "").toLowerCase();
  if (fs === "fulfilled") {
    return "Already fulfilled on Shopify.";
  }
  if (pay === "pending" || pay === "authorized") {
    return "Payment not fully captured — confirm before shipping.";
  }
  return "Ready to process if stock is available.";
}
