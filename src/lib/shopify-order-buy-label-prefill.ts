import type { AdminShopifyOrder } from "@/lib/shopify-admin-orders";
import type { ShopifyOrderAddress } from "@/lib/shopify-order-normalize";
import {
  normalizeShippoCountry,
  normalizeShippoState,
  normalizeUsZip,
} from "@/lib/location-shipping-address";
import type { ShippingAddress } from "@/types";

const STORAGE_KEY = "prepcorex:buy-label-shopify-prefill";

export type BuyLabelShopifyPrefill = {
  orderId: string;
  orderName: string;
  shop: string;
  ownerName: string;
  toAddress: ShippingAddress;
};

export function shopifyAddressToBuyLabelsToAddress(
  addr: ShopifyOrderAddress | null,
  options?: { customerName?: string | null; email?: string | null }
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

  return {
    name,
    street1: addr.address1.trim(),
    street2: addr.address2?.trim() || undefined,
    city: (addr.city || "").trim(),
    state,
    zip,
    country,
    phone: (addr.phone || "").trim(),
    email: options?.email?.trim() || undefined,
  };
}

export function buildBuyLabelPrefillFromShopifyOrder(
  order: AdminShopifyOrder
): BuyLabelShopifyPrefill | null {
  const shipping = order.shippingAddress;
  const billing = order.billingAddress;
  const toAddress =
    shopifyAddressToBuyLabelsToAddress(shipping, {
      customerName: order.customerName,
      email: order.email,
    }) ||
    shopifyAddressToBuyLabelsToAddress(billing, {
      customerName: order.customerName,
      email: order.email,
    });

  if (!toAddress) return null;

  return {
    orderId: order.id,
    orderName: order.name || `#${order.orderNumber}`,
    shop: order.shop,
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
    return parsed;
  } catch {
    return null;
  }
}

export function clearBuyLabelPrefillFromSession(): void {
  if (typeof sessionStorage === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}
