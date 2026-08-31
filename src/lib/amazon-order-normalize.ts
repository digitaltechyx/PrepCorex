/** Normalize Amazon SP-API Orders v0 payloads for PrepCorex UI. */

import { stripUndefined } from "@/lib/utils";

export type AmazonFulfillmentChannel = "MFN" | "AFN";

export type AmazonOrderLineItem = {
  orderItemId: string;
  asin: string | null;
  sellerSku: string | null;
  title: string;
  quantityOrdered: number;
  quantityShipped: number;
  itemPrice: string | null;
  currency: string | null;
};

export type AmazonOrderAddress = {
  name: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  addressLine3: string | null;
  city: string | null;
  stateOrRegion: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
  /** True when street/name/phone were redacted by Amazon (no DTC role). */
  addressRestricted: boolean;
};

export type AmazonNormalizedOrder = {
  id: string;
  amazonOrderId: string;
  sellerOrderId: string | null;
  connectionId: string;
  sellingPartnerId: string | null;
  storeName: string;
  marketplaceId: string | null;
  salesChannel: string | null;
  fulfillmentChannel: AmazonFulfillmentChannel;
  isFba: boolean;
  orderStatus: string | null;
  /** MFN + unshipped/partial — eligible for warehouse quick fulfill. */
  sellerFulfillable: boolean;
  createdAt: string | null;
  updatedAt: string | null;
  currency: string | null;
  orderTotal: string | null;
  buyerEmail: string | null;
  shipServiceLevel: string | null;
  isPrime: boolean;
  numberOfItemsUnshipped: number;
  numberOfItemsShipped: number;
  earliestShipDate: string | null;
  latestShipDate: string | null;
  shippingAddress: AmazonOrderAddress | null;
  lineItems: AmazonOrderLineItem[];
  trackingNumbers: string[];
  trackingCarriers: string[];
  syncedAt: string | null;
  quickFulfilledAt: string | null;
  quickFulfilledShippedId: string | null;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function money(v: unknown): string | null {
  const rec = asRecord(v);
  if (rec) {
    const amount = str(rec.Amount) ?? str(rec.amount);
    if (amount) return amount;
  }
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function currencyFromMoney(v: unknown): string | null {
  const rec = asRecord(v);
  if (!rec) return null;
  return str(rec.CurrencyCode) ?? str(rec.currencyCode);
}

export function normalizeAmazonAddress(raw: unknown): AmazonOrderAddress | null {
  const a = asRecord(raw);
  if (!a) return null;
  const name = str(a.Name) ?? str(a.name);
  const line1 = str(a.AddressLine1) ?? str(a.addressLine1);
  const line2 = str(a.AddressLine2) ?? str(a.addressLine2);
  const line3 = str(a.AddressLine3) ?? str(a.addressLine3);
  const city = str(a.City) ?? str(a.city);
  const state = str(a.StateOrRegion) ?? str(a.stateOrRegion) ?? str(a.State) ?? str(a.state);
  const postal = str(a.PostalCode) ?? str(a.postalCode);
  const country = str(a.CountryCode) ?? str(a.countryCode);
  const phone = str(a.Phone) ?? str(a.phone);
  const hasRestrictedFields = Boolean(name || line1 || phone);
  const hasAnyField = Boolean(city || state || postal || country || line1 || name);
  if (!hasAnyField) return null;
  return {
    name,
    addressLine1: line1,
    addressLine2: line2,
    addressLine3: line3,
    city,
    stateOrRegion: state,
    postalCode: postal,
    countryCode: country,
    phone,
    addressRestricted: !hasRestrictedFields && Boolean(city || state || country),
  };
}

export function amazonAddressSummary(addr: AmazonOrderAddress | null): string | null {
  if (!addr) return null;
  const parts = [
    addr.name,
    addr.addressLine1,
    addr.addressLine2,
    addr.addressLine3,
    [addr.city, addr.stateOrRegion, addr.postalCode].filter(Boolean).join(", "),
    addr.countryCode,
  ].filter(Boolean);
  if (addr.addressRestricted && parts.length <= 2) {
    parts.push("(full address requires Direct to Consumer Shipping role)");
  }
  return parts.length ? parts.join(", ") : null;
}

function normalizeLineItem(raw: unknown): AmazonOrderLineItem | null {
  const li = asRecord(raw);
  if (!li) return null;
  const orderItemId = str(li.OrderItemId) ?? str(li.orderItemId) ?? "";
  const title = str(li.Title) ?? str(li.title) ?? "Item";
  const qtyOrdered = num(li.QuantityOrdered) ?? num(li.quantityOrdered) ?? 1;
  const qtyShipped = num(li.QuantityShipped) ?? num(li.quantityShipped) ?? 0;
  const itemPrice = money(li.ItemPrice) ?? money(li.itemPrice);
  const currency =
    currencyFromMoney(li.ItemPrice) ??
    currencyFromMoney(li.itemPrice) ??
    str(li.CurrencyCode) ??
    null;
  return {
    orderItemId: orderItemId || title,
    asin: str(li.ASIN) ?? str(li.asin),
    sellerSku: str(li.SellerSKU) ?? str(li.sellerSku),
    title,
    quantityOrdered: Math.max(0, Math.floor(qtyOrdered)),
    quantityShipped: Math.max(0, Math.floor(qtyShipped)),
    itemPrice,
    currency,
  };
}

export function isAmazonSellerFulfillable(input: {
  fulfillmentChannel: AmazonFulfillmentChannel;
  orderStatus: string | null;
}): boolean {
  if (input.fulfillmentChannel !== "MFN") return false;
  const status = (input.orderStatus || "").toLowerCase();
  return status === "unshipped" || status === "partiallyshipped";
}

export function normalizeAmazonOrder(
  raw: Record<string, unknown>,
  meta: {
    connectionId: string;
    storeName: string;
    sellingPartnerId?: string | null;
    lineItems?: unknown[];
    shippingAddress?: unknown;
    trackingNumbers?: string[];
    trackingCarriers?: string[];
  }
): AmazonNormalizedOrder {
  const amazonOrderId = str(raw.AmazonOrderId) ?? str(raw.amazonOrderId) ?? "";
  const fulfillmentRaw = (str(raw.FulfillmentChannel) ?? str(raw.fulfillmentChannel) ?? "MFN").toUpperCase();
  const fulfillmentChannel: AmazonFulfillmentChannel =
    fulfillmentRaw === "AFN" ? "AFN" : "MFN";
  const orderStatus = str(raw.OrderStatus) ?? str(raw.orderStatus);
  const orderTotalRaw = raw.OrderTotal ?? raw.orderTotal;
  const lineItemsRaw = meta.lineItems ?? raw.OrderItems ?? raw.orderItems ?? [];
  const lineItems = (Array.isArray(lineItemsRaw) ? lineItemsRaw : [])
    .map(normalizeLineItem)
    .filter((li): li is AmazonOrderLineItem => li != null);

  const shippingAddress =
    normalizeAmazonAddress(meta.shippingAddress ?? raw.ShippingAddress ?? raw.shippingAddress) ??
    null;

  return {
    id: amazonOrderId,
    amazonOrderId,
    sellerOrderId: str(raw.SellerOrderId) ?? str(raw.sellerOrderId),
    connectionId: meta.connectionId,
    sellingPartnerId: meta.sellingPartnerId ?? null,
    storeName: meta.storeName,
    marketplaceId: str(raw.MarketplaceId) ?? str(raw.marketplaceId),
    salesChannel: str(raw.SalesChannel) ?? str(raw.salesChannel),
    fulfillmentChannel,
    isFba: fulfillmentChannel === "AFN",
    orderStatus,
    sellerFulfillable: isAmazonSellerFulfillable({ fulfillmentChannel, orderStatus }),
    createdAt: str(raw.PurchaseDate) ?? str(raw.purchaseDate),
    updatedAt: str(raw.LastUpdateDate) ?? str(raw.lastUpdateDate),
    currency: currencyFromMoney(orderTotalRaw),
    orderTotal: money(orderTotalRaw),
    buyerEmail: str(raw.BuyerEmail) ?? str(raw.buyerEmail),
    shipServiceLevel: str(raw.ShipServiceLevel) ?? str(raw.shipServiceLevel),
    isPrime: raw.IsPrime === true || raw.isPrime === true,
    numberOfItemsUnshipped: num(raw.NumberOfItemsUnshipped) ?? num(raw.numberOfItemsUnshipped) ?? 0,
    numberOfItemsShipped: num(raw.NumberOfItemsShipped) ?? num(raw.numberOfItemsShipped) ?? 0,
    earliestShipDate: str(raw.EarliestShipDate) ?? str(raw.earliestShipDate),
    latestShipDate: str(raw.LatestShipDate) ?? str(raw.latestShipDate),
    shippingAddress,
    lineItems,
    trackingNumbers: meta.trackingNumbers ?? [],
    trackingCarriers: meta.trackingCarriers ?? [],
    syncedAt: str(raw.syncedAt) ?? null,
    quickFulfilledAt: str(raw.quickFulfilledAt) ?? null,
    quickFulfilledShippedId: str(raw.quickFulfilledShippedId) ?? null,
  };
}

export function amazonOrderToFirestoreDoc(order: AmazonNormalizedOrder): Record<string, unknown> {
  return stripUndefined({
    id: order.id,
    amazonOrderId: order.amazonOrderId,
    sellerOrderId: order.sellerOrderId ?? undefined,
    connectionId: order.connectionId,
    sellingPartnerId: order.sellingPartnerId ?? undefined,
    storeName: order.storeName,
    marketplaceId: order.marketplaceId ?? undefined,
    salesChannel: order.salesChannel ?? undefined,
    fulfillmentChannel: order.fulfillmentChannel,
    isFba: order.isFba,
    orderStatus: order.orderStatus ?? undefined,
    sellerFulfillable: order.sellerFulfillable,
    created_at: order.createdAt ?? undefined,
    updated_at: order.updatedAt ?? undefined,
    createdAt: order.createdAt ?? undefined,
    updatedAt: order.updatedAt ?? undefined,
    currency: order.currency ?? undefined,
    orderTotal: order.orderTotal ?? undefined,
    buyerEmail: order.buyerEmail ?? undefined,
    shipServiceLevel: order.shipServiceLevel ?? undefined,
    isPrime: order.isPrime,
    numberOfItemsUnshipped: order.numberOfItemsUnshipped,
    numberOfItemsShipped: order.numberOfItemsShipped,
    earliestShipDate: order.earliestShipDate ?? undefined,
    latestShipDate: order.latestShipDate ?? undefined,
    shippingAddress: order.shippingAddress ?? undefined,
    lineItems: order.lineItems,
    trackingNumbers: order.trackingNumbers,
    trackingCarriers: order.trackingCarriers,
    syncedAt: order.syncedAt ?? undefined,
    quickFulfilledAt: order.quickFulfilledAt ?? undefined,
    quickFulfilledShippedId: order.quickFulfilledShippedId ?? undefined,
  });
}

export function amazonOrderFromFirestore(
  docId: string,
  data: Record<string, unknown>
): AmazonNormalizedOrder {
  const fulfillmentRaw = String(data.fulfillmentChannel ?? "MFN").toUpperCase();
  const fulfillmentChannel: AmazonFulfillmentChannel =
    fulfillmentRaw === "AFN" ? "AFN" : "MFN";
  const orderStatus =
    typeof data.orderStatus === "string" ? data.orderStatus : null;
  const lineItemsRaw = Array.isArray(data.lineItems) ? data.lineItems : [];
  const lineItems = lineItemsRaw
    .map(normalizeLineItem)
    .filter((li): li is AmazonOrderLineItem => li != null);

  return {
    id: str(data.id) ?? docId,
    amazonOrderId: str(data.amazonOrderId) ?? docId,
    sellerOrderId: str(data.sellerOrderId),
    connectionId: String(data.connectionId ?? ""),
    sellingPartnerId: str(data.sellingPartnerId),
    storeName: String(data.storeName ?? "Amazon"),
    marketplaceId: str(data.marketplaceId),
    salesChannel: str(data.salesChannel),
    fulfillmentChannel,
    isFba: data.isFba === true || fulfillmentChannel === "AFN",
    orderStatus,
    sellerFulfillable:
      data.sellerFulfillable === true ||
      isAmazonSellerFulfillable({ fulfillmentChannel, orderStatus }),
    createdAt: str(data.createdAt) ?? str(data.created_at),
    updatedAt: str(data.updatedAt) ?? str(data.updated_at),
    currency: str(data.currency),
    orderTotal: str(data.orderTotal),
    buyerEmail: str(data.buyerEmail),
    shipServiceLevel: str(data.shipServiceLevel),
    isPrime: data.isPrime === true,
    numberOfItemsUnshipped: num(data.numberOfItemsUnshipped) ?? 0,
    numberOfItemsShipped: num(data.numberOfItemsShipped) ?? 0,
    earliestShipDate: str(data.earliestShipDate),
    latestShipDate: str(data.latestShipDate),
    shippingAddress: normalizeAmazonAddress(data.shippingAddress),
    lineItems,
    trackingNumbers: Array.isArray(data.trackingNumbers)
      ? data.trackingNumbers.map(String)
      : [],
    trackingCarriers: Array.isArray(data.trackingCarriers)
      ? data.trackingCarriers.map(String)
      : [],
    syncedAt: str(data.syncedAt),
    quickFulfilledAt: str(data.quickFulfilledAt),
    quickFulfilledShippedId: str(data.quickFulfilledShippedId),
  };
}
