import type { AdminShopifyOrder } from "@/lib/shopify-admin-orders";
import type { ShopifyOrderAddress } from "@/lib/shopify-order-normalize";
import { BUY_LABELS_DEFAULT_FROM_PHONE } from "@/lib/buy-labels-bulk-import";
import {
  normalizeShippoCountry,
  normalizeShippoState,
  normalizeUsZip,
} from "@/lib/location-shipping-address";
import type { ShippingAddress } from "@/types";

const STORAGE_KEY = "prepcorex:buy-label-shopify-prefill";
const FULFILL_HANDOFF_KEY = "prepcorex:shopify-label-fulfill-handoff";

export type BuyLabelShopifyPrefill = {
  orderId: string;
  orderName: string;
  shop: string;
  ownerUserId: string;
  ownerName: string;
  toAddress: ShippingAddress;
};

/** After PrepCorex Buy Label → return to Quick Fulfill with tracking + product. */
export type ShopifyLabelFulfillHandoff = {
  ownerUserId: string;
  orderId: string;
  orderName: string;
  shop: string;
  inventoryProductId?: string | null;
  inventoryProductName?: string | null;
  labelPurchaseId?: string | null;
  /** Label charge in USD (dollars). */
  labelPrice?: number | null;
  trackingNumber?: string | null;
  trackingCompany?: string | null;
  /** Admin uid that owns the labelPurchases doc. */
  purchasedByUserId?: string | null;
};

export function shopifyAddressToBuyLabelsToAddress(
  addr: ShopifyOrderAddress | null,
  options?: {
    customerName?: string | null;
    email?: string | null;
    /** Warehouse / PrepCorex default for To phone. */
    warehousePhone?: string | null;
  }
): ShippingAddress | null {
  if (!addr?.address1?.trim()) return null;

  const country = normalizeShippoCountry(addr.country || undefined);
  const state = normalizeShippoState(addr.province || undefined, country);
  const zip =
    country === "US" ? normalizeUsZip(addr.zip || undefined) : String(addr.zip || "").trim();

  const name =
    (addr.name || "").trim() ||
    (options?.customerName || "").trim() ||
    "Customer";

  const warehousePhone =
    (options?.warehousePhone || "").trim() || BUY_LABELS_DEFAULT_FROM_PHONE;

  return {
    name,
    street1: addr.address1.trim(),
    street2: addr.address2?.trim() || undefined,
    city: (addr.city || "").trim(),
    state,
    zip,
    country,
    // Warehouse phone by default; user edits To on the form when recipient needs a different number.
    phone: warehousePhone,
    email: options?.email?.trim() || undefined,
  };
}

export function buildBuyLabelPrefillFromShopifyOrder(
  order: AdminShopifyOrder
): BuyLabelShopifyPrefill | null {
  const shipping = order.shippingAddress;
  const billing = order.billingAddress;
  const common = {
    customerName: order.customerName,
    email: order.email,
    warehousePhone: BUY_LABELS_DEFAULT_FROM_PHONE,
  };

  const toAddress =
    shopifyAddressToBuyLabelsToAddress(shipping, common) ||
    shopifyAddressToBuyLabelsToAddress(billing, common);

  if (!toAddress) return null;

  return {
    orderId: order.id,
    orderName: order.name || `#${order.orderNumber}`,
    shop: order.shop,
    ownerUserId: order.ownerUserId,
    ownerName: order.ownerName,
    toAddress,
  };
}

export function saveBuyLabelPrefillFromShopifyOrder(order: AdminShopifyOrder): boolean {
  const prefill = buildBuyLabelPrefillFromShopifyOrder(order);
  if (!prefill || typeof sessionStorage === "undefined") return false;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
  return true;
}

export function loadBuyLabelPrefillFromSession(): BuyLabelShopifyPrefill | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as BuyLabelShopifyPrefill;
    if (!parsed?.toAddress?.street1) return null;
    // Re-normalize in case older session data had a full state name / empty phone.
    const country = normalizeShippoCountry(parsed.toAddress.country);
    parsed.toAddress = {
      ...parsed.toAddress,
      country,
      state: normalizeShippoState(parsed.toAddress.state, country),
      phone: BUY_LABELS_DEFAULT_FROM_PHONE,
    };
    parsed.ownerUserId = String(parsed.ownerUserId || "").trim();
    return parsed;
  } catch {
    return null;
  }
}

export function clearBuyLabelPrefillFromSession(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function saveShopifyLabelFulfillHandoff(handoff: ShopifyLabelFulfillHandoff): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.setItem(FULFILL_HANDOFF_KEY, JSON.stringify(handoff));
}

export function loadShopifyLabelFulfillHandoff(): ShopifyLabelFulfillHandoff | null {
  if (typeof sessionStorage === "undefined") return null;
  const raw = sessionStorage.getItem(FULFILL_HANDOFF_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ShopifyLabelFulfillHandoff;
    if (!parsed?.ownerUserId || !parsed?.orderId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearShopifyLabelFulfillHandoff(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(FULFILL_HANDOFF_KEY);
}

export function shopifyQuickFulfillReturnUrl(handoff: {
  ownerUserId: string;
  orderId: string;
}): string {
  const params = new URLSearchParams({
    userId: handoff.ownerUserId,
    quickFulfillOrderId: handoff.orderId,
  });
  return `/admin/dashboard/shopify-orders?${params.toString()}`;
}
