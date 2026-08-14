import {
  normalizeShippoCountry,
  normalizeShippoState,
  normalizeUsZip,
} from "@/lib/location-shipping-address";
import { BUY_LABELS_DEFAULT_FROM_PHONE } from "@/lib/buy-labels-bulk-import";
import type { ShippingAddress } from "@/types";

const STORAGE_KEY = "prepcorex:buy-label-ebay-prefill";
const FULFILL_HANDOFF_KEY = "prepcorex:ebay-label-fulfill-handoff";

export type BuyLabelEbayPrefillLine = {
  title: string;
  sku?: string | null;
  quantity: number;
};

export type BuyLabelEbayPrefill = {
  orderId: string;
  connectionId: string;
  ownerUserId: string;
  ownerName: string;
  customerName?: string | null;
  email?: string | null;
  toAddress: ShippingAddress | null;
  lineItems: BuyLabelEbayPrefillLine[];
};

export type EbayLabelFulfillHandoff = {
  ownerUserId: string;
  orderId: string;
  connectionId: string;
  inventoryProductId?: string | null;
  inventoryProductName?: string | null;
  labelPurchaseId?: string | null;
  labelPrice?: number | null;
  trackingNumber?: string | null;
  trackingCompany?: string | null;
  purchasedByUserId?: string | null;
};

export type EbayShipToStored = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  stateOrProvince?: string | null;
  postalCode?: string | null;
  countryCode?: string | null;
};

export function ebayShipToBuyLabelsAddress(
  shipTo: EbayShipToStored | null | undefined,
  options?: {
    customerName?: string | null;
    email?: string | null;
    warehousePhone?: string | null;
  }
): ShippingAddress | null {
  if (!shipTo?.addressLine1?.trim()) return null;

  const country = normalizeShippoCountry(shipTo.countryCode || undefined);
  const state = normalizeShippoState(shipTo.stateOrProvince || undefined, country);
  const zip =
    country === "US"
      ? normalizeUsZip(shipTo.postalCode || undefined)
      : String(shipTo.postalCode || "").trim();

  const name =
    (shipTo.fullName || "").trim() ||
    (options?.customerName || "").trim() ||
    "Customer";

  const warehousePhone =
    (options?.warehousePhone || "").trim() || BUY_LABELS_DEFAULT_FROM_PHONE;

  return {
    name,
    street1: shipTo.addressLine1.trim(),
    street2: shipTo.addressLine2?.trim() || undefined,
    city: (shipTo.city || "").trim(),
    state,
    zip,
    country,
    phone: (shipTo.phone || "").trim() || warehousePhone,
    email: (shipTo.email || options?.email || "").trim() || undefined,
  };
}

export function saveBuyLabelEbayPrefill(prefill: BuyLabelEbayPrefill): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
}

export function loadBuyLabelEbayPrefill(): BuyLabelEbayPrefill | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as BuyLabelEbayPrefill;
  } catch {
    return null;
  }
}

export function clearBuyLabelEbayPrefill(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function saveEbayLabelFulfillHandoff(handoff: EbayLabelFulfillHandoff): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(FULFILL_HANDOFF_KEY, JSON.stringify(handoff));
}

export function loadEbayLabelFulfillHandoff(): EbayLabelFulfillHandoff | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(FULFILL_HANDOFF_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as EbayLabelFulfillHandoff;
  } catch {
    return null;
  }
}

export function clearEbayLabelFulfillHandoff(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(FULFILL_HANDOFF_KEY);
}

export function ebayQuickFulfillReturnUrl(input: {
  ownerUserId: string;
  orderId: string;
}): string {
  const params = new URLSearchParams({
    userId: input.ownerUserId,
    orderId: input.orderId,
    from: "buy-labels",
  });
  return `/admin/dashboard/ebay-orders?${params.toString()}`;
}
