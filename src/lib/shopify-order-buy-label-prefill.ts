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

export type BuyLabelShopifyPrefillLine = {
  title: string;
  variantTitle?: string | null;
  sku?: string | null;
  quantity: number;
};

export type BuyLabelShopifyPrefill = {
  orderId: string;
  orderName: string;
  shop: string;
  shopName?: string;
  ownerUserId: string;
  ownerName: string;
  customerName?: string | null;
  email?: string | null;
  /** Null when the Shopify order has no usable ship-to address. */
  toAddress: ShippingAddress | null;
  lineItems: BuyLabelShopifyPrefillLine[];
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
  const ownerUserId = String(order.ownerUserId || "").trim();
  const orderId = String(order.id || "").trim();
  if (!ownerUserId || !orderId) return null;

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

  const lineItems: BuyLabelShopifyPrefillLine[] = (order.lineItems || []).map((li) => ({
    title: String(li.title || "Item").trim() || "Item",
    variantTitle: li.variantTitle ?? null,
    sku: li.sku ?? null,
    quantity: Number.isFinite(li.quantity) ? li.quantity : 1,
  }));

  return {
    orderId,
    orderName: order.name || `#${order.orderNumber}`,
    shop: order.shop,
    shopName: order.shopName || order.shop,
    ownerUserId,
    ownerName: order.ownerName,
    customerName: order.customerName,
    email: order.email,
    toAddress,
    lineItems,
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
    parsed.ownerUserId = String(parsed.ownerUserId || "").trim();
    parsed.orderId = String(parsed.orderId || "").trim();
    if (!parsed.ownerUserId || !parsed.orderId) return null;

    if (parsed.toAddress?.street1) {
      // Re-normalize in case older session data had a full state name / empty phone.
      const country = normalizeShippoCountry(parsed.toAddress.country);
      parsed.toAddress = {
        ...parsed.toAddress,
        country,
        state: normalizeShippoState(parsed.toAddress.state, country),
        phone: BUY_LABELS_DEFAULT_FROM_PHONE,
      };
    } else {
      parsed.toAddress = null;
    }

    parsed.lineItems = Array.isArray(parsed.lineItems)
      ? parsed.lineItems.map((li) => ({
          title: String(li?.title || "Item").trim() || "Item",
          variantTitle: li?.variantTitle ?? null,
          sku: li?.sku ?? null,
          quantity: Number.isFinite(Number(li?.quantity)) ? Number(li.quantity) : 1,
        }))
      : [];

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
