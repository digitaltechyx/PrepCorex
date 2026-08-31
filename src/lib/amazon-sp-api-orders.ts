/**
 * Amazon SP-API Orders v0, FBA inventory, and FBA inbound helpers.
 */

import {
  amazonSpApiGet,
  amazonSpApiPost,
  getValidAmazonToken,
  type AmazonMarketplaceSummary,
} from "@/lib/amazon-sp-api";
import {
  isAmazonSellerFulfillable,
  normalizeAmazonOrder,
  type AmazonNormalizedOrder,
} from "@/lib/amazon-order-normalize";

const MAX_ORDERS = 500;
const LOOKBACK_DAYS = 30;

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function payloadRecord(data: unknown): Record<string, unknown> {
  const root = asRecord(data);
  if (root.payload && typeof root.payload === "object" && !Array.isArray(root.payload)) {
    return root.payload as Record<string, unknown>;
  }
  return root;
}

function ordersFromPayload(data: unknown): Record<string, unknown>[] {
  const payload = payloadRecord(data);
  const orders = payload.Orders ?? payload.orders;
  return Array.isArray(orders) ? (orders as Record<string, unknown>[]) : [];
}

function nextTokenFromPayload(data: unknown): string | null {
  const payload = payloadRecord(data);
  const token = payload.NextToken ?? payload.nextToken;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

function orderItemsFromPayload(data: unknown): unknown[] {
  const payload = payloadRecord(data);
  const items = payload.OrderItems ?? payload.orderItems;
  return Array.isArray(items) ? items : [];
}

function addressFromPayload(data: unknown): unknown {
  const payload = payloadRecord(data);
  return payload.ShippingAddress ?? payload.shippingAddress ?? null;
}

export type AmazonFbaInventoryRow = {
  sellerSku: string;
  fnSku: string | null;
  asin: string | null;
  productName: string | null;
  marketplaceId: string;
  totalQuantity: number;
  fulfillableQuantity: number;
  inboundWorkingQuantity: number;
  inboundShippedQuantity: number;
  inboundReceivingQuantity: number;
  reservedQuantity: number;
  lastUpdatedTime: string | null;
};

export type AmazonFbaInboundPlanRow = {
  inboundPlanId: string;
  name: string | null;
  status: string | null;
  createdAt: string | null;
  lastUpdatedAt: string | null;
  marketplaceIds: string[];
};

export function resolveAmazonMarketplaceIds(
  marketplaces: AmazonMarketplaceSummary[],
  fallback = "ATVPDKIKX0DER"
): string[] {
  const ids = marketplaces.map((m) => m.id).filter((id): id is string => Boolean(id));
  return ids.length > 0 ? ids : [fallback];
}

export async function fetchAmazonOrdersPage(input: {
  accessToken: string;
  marketplaceIds: string[];
  createdAfter: string;
  nextToken?: string;
}): Promise<{ orders: Record<string, unknown>[]; nextToken: string | null }> {
  const query: Record<string, string> = {
    MarketplaceIds: input.marketplaceIds.join(","),
    CreatedAfter: input.createdAfter,
    MaxResultsPerPage: "100",
  };
  if (input.nextToken) query.NextToken = input.nextToken;

  const res = await amazonSpApiGet({
    path: "/orders/v0/orders",
    accessToken: input.accessToken,
    query,
  });
  if (!res.ok) {
    const err = asRecord(res.data);
    const errors = Array.isArray(err.errors) ? err.errors : [];
    const first = asRecord(errors[0]);
    throw new Error(
      String(first.message || first.Message || err.message || `Amazon orders HTTP ${res.status}`)
    );
  }
  return {
    orders: ordersFromPayload(res.data),
    nextToken: nextTokenFromPayload(res.data),
  };
}

export async function fetchAmazonOrderItems(input: {
  accessToken: string;
  amazonOrderId: string;
}): Promise<unknown[]> {
  const res = await amazonSpApiGet({
    path: `/orders/v0/orders/${encodeURIComponent(input.amazonOrderId)}/orderItems`,
    accessToken: input.accessToken,
  });
  if (!res.ok) return [];
  return orderItemsFromPayload(res.data);
}

export async function fetchAmazonOrderAddress(input: {
  accessToken: string;
  amazonOrderId: string;
}): Promise<unknown | null> {
  const res = await amazonSpApiGet({
    path: `/orders/v0/orders/${encodeURIComponent(input.amazonOrderId)}/address`,
    accessToken: input.accessToken,
  });
  if (!res.ok) return null;
  return addressFromPayload(res.data);
}

export async function fetchAmazonOrdersFromApi(input: {
  accessToken: string;
  marketplaceIds: string[];
  lookbackDays?: number;
  maxOrders?: number;
  /** Fetch ship-to for MFN unshipped orders (needs DTC role for full PII). */
  fetchAddresses?: boolean;
}): Promise<Record<string, unknown>[]> {
  const lookbackDays = input.lookbackDays ?? LOOKBACK_DAYS;
  const maxOrders = input.maxOrders ?? MAX_ORDERS;
  const createdAfter = new Date();
  createdAfter.setDate(createdAfter.getDate() - lookbackDays);

  const rawOrders: Record<string, unknown>[] = [];
  let nextToken: string | undefined;

  while (rawOrders.length < maxOrders) {
    const page = await fetchAmazonOrdersPage({
      accessToken: input.accessToken,
      marketplaceIds: input.marketplaceIds,
      createdAfter: createdAfter.toISOString(),
      nextToken,
    });
    rawOrders.push(...page.orders);
    if (!page.nextToken || page.orders.length === 0) break;
    nextToken = page.nextToken;
  }

  const slice = rawOrders.slice(0, maxOrders);
  const enriched: Record<string, unknown>[] = [];

  for (let i = 0; i < slice.length; i += 5) {
    const batch = slice.slice(i, i + 5);
    const batchResults = await Promise.all(
      batch.map(async (order) => {
        const amazonOrderId = String(order.AmazonOrderId ?? order.amazonOrderId ?? "").trim();
        if (!amazonOrderId) return { ...order, _lineItems: [], _shippingAddress: null };

        const lineItems = await fetchAmazonOrderItems({
          accessToken: input.accessToken,
          amazonOrderId,
        });

        let shippingAddress: unknown = order.ShippingAddress ?? order.shippingAddress ?? null;
        const channel = String(order.FulfillmentChannel ?? order.fulfillmentChannel ?? "MFN").toUpperCase();
        const status = String(order.OrderStatus ?? order.orderStatus ?? "");
        const needsAddress =
          input.fetchAddresses !== false &&
          channel === "MFN" &&
          isAmazonSellerFulfillable({ fulfillmentChannel: "MFN", orderStatus: status });

        if (needsAddress) {
          const fromApi = await fetchAmazonOrderAddress({
            accessToken: input.accessToken,
            amazonOrderId,
          });
          if (fromApi) shippingAddress = fromApi;
        }

        return { ...order, _lineItems: lineItems, _shippingAddress: shippingAddress };
      })
    );
    enriched.push(...batchResults);
  }

  return enriched;
}

export function mapRawAmazonOrders(
  rawOrders: Record<string, unknown>[],
  meta: {
    connectionId: string;
    storeName: string;
    sellingPartnerId?: string | null;
  }
): AmazonNormalizedOrder[] {
  return rawOrders
    .map((raw) => {
      const amazonOrderId = String(raw.AmazonOrderId ?? raw.amazonOrderId ?? "").trim();
      if (!amazonOrderId) return null;
      return normalizeAmazonOrder(raw, {
        connectionId: meta.connectionId,
        storeName: meta.storeName,
        sellingPartnerId: meta.sellingPartnerId,
        lineItems: raw._lineItems as unknown[] | undefined,
        shippingAddress: raw._shippingAddress,
      });
    })
    .filter((o): o is AmazonNormalizedOrder => o != null);
}

export function amazonCarrierCode(carrierName: string | undefined): string {
  const c = (carrierName || "").trim().toUpperCase();
  if (c.includes("USPS")) return "USPS";
  if (c.includes("UPS")) return "UPS";
  if (c.includes("FEDEX") || c.includes("FED EX")) return "FedEx";
  if (c.includes("DHL")) return "DHL";
  if (c.includes("AMAZON")) return "Amazon Shipping";
  return carrierName?.trim() || "Other";
}

export async function confirmAmazonOrderShipment(input: {
  accessToken: string;
  amazonOrderId: string;
  marketplaceId: string;
  carrierName: string;
  trackingNumber: string;
  orderItems: Array<{ orderItemId: string; quantity: number }>;
}): Promise<void> {
  const carrierCode = amazonCarrierCode(input.carrierName);
  const shipDate = new Date().toISOString();
  const body = {
    marketplaceId: input.marketplaceId,
    packageDetail: {
      packageReferenceId: `pcx-${Date.now()}`,
      carrierCode,
      carrierName: input.carrierName.trim() || carrierCode,
      shippingMethod: "Standard",
      trackingNumber: input.trackingNumber.trim(),
      shipDate,
      orderItems: input.orderItems.map((item) => ({
        orderItemId: item.orderItemId,
        quantity: item.quantity,
      })),
    },
  };

  const res = await amazonSpApiPost({
    path: `/orders/v0/orders/${encodeURIComponent(input.amazonOrderId)}/shipmentConfirmation`,
    accessToken: input.accessToken,
    body,
  });

  if (!res.ok) {
    const err = asRecord(res.data);
    const errors = Array.isArray(err.errors) ? err.errors : [];
    const first = asRecord(errors[0]);
    throw new Error(
      String(first.message || first.Message || err.message || `confirmShipment HTTP ${res.status}`)
    );
  }
}

export async function fetchAmazonFbaInventorySummaries(input: {
  accessToken: string;
  marketplaceIds: string[];
}): Promise<AmazonFbaInventoryRow[]> {
  const marketplaceId = input.marketplaceIds[0];
  if (!marketplaceId) return [];

  const rows: AmazonFbaInventoryRow[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < 50; page++) {
    const query: Record<string, string> = {
      granularityType: "Marketplace",
      granularityId: marketplaceId,
      marketplaceIds: input.marketplaceIds.join(","),
      details: "true",
    };
    if (nextToken) query.nextToken = nextToken;

    const res = await amazonSpApiGet({
      path: "/fba/inventory/v1/summaries",
      accessToken: input.accessToken,
      query,
    });
    if (!res.ok) {
      const err = asRecord(res.data);
      const errors = Array.isArray(err.errors) ? err.errors : [];
      const first = asRecord(errors[0]);
      throw new Error(
        String(first.message || first.Message || err.message || `FBA inventory HTTP ${res.status}`)
      );
    }

    const payload = payloadRecord(res.data);
    const summaries = payload.inventorySummaries ?? payload.InventorySummaries;
    if (Array.isArray(summaries)) {
      for (const row of summaries) {
        const rec = asRecord(row);
        const sellerSku = String(rec.sellerSku ?? rec.SellerSku ?? "").trim();
        if (!sellerSku) continue;
        const details = asRecord(rec.inventoryDetails ?? rec.InventoryDetails);
        rows.push({
          sellerSku,
          fnSku: String(rec.fnSku ?? rec.FnSku ?? "").trim() || null,
          asin: String(rec.asin ?? rec.Asin ?? "").trim() || null,
          productName: String(rec.productName ?? rec.ProductName ?? "").trim() || null,
          marketplaceId: String(rec.marketplaceId ?? rec.MarketplaceId ?? marketplaceId),
          totalQuantity: Number(rec.totalQuantity ?? rec.TotalQuantity ?? 0) || 0,
          fulfillableQuantity:
            Number(details.fulfillableQuantity ?? details.FulfillableQuantity ?? 0) || 0,
          inboundWorkingQuantity:
            Number(details.inboundWorkingQuantity ?? details.InboundWorkingQuantity ?? 0) || 0,
          inboundShippedQuantity:
            Number(details.inboundShippedQuantity ?? details.InboundShippedQuantity ?? 0) || 0,
          inboundReceivingQuantity:
            Number(details.inboundReceivingQuantity ?? details.InboundReceivingQuantity ?? 0) || 0,
          reservedQuantity: Number(details.reservedQuantity ?? details.ReservedQuantity ?? 0) || 0,
          lastUpdatedTime: String(rec.lastUpdatedTime ?? rec.LastUpdatedTime ?? "").trim() || null,
        });
      }
    }

    const pagination = asRecord(payload.pagination ?? payload.Pagination);
    const next = String(pagination.nextToken ?? pagination.NextToken ?? payload.nextToken ?? "").trim();
    if (!next) break;
    nextToken = next;
  }

  rows.sort((a, b) => a.sellerSku.localeCompare(b.sellerSku));
  return rows;
}

export async function fetchAmazonFbaInboundPlans(input: {
  accessToken: string;
}): Promise<AmazonFbaInboundPlanRow[]> {
  const rows: AmazonFbaInboundPlanRow[] = [];
  let paginationToken: string | undefined;

  for (let page = 0; page < 20; page++) {
    const query: Record<string, string> = { pageSize: "30" };
    if (paginationToken) query.paginationToken = paginationToken;

    const res = await amazonSpApiGet({
      path: "/inbound/fba/2024-03-20/inboundPlans",
      accessToken: input.accessToken,
      query,
    });
    if (!res.ok) {
      const err = asRecord(res.data);
      const errors = Array.isArray(err.errors) ? err.errors : [];
      const first = asRecord(errors[0]);
      throw new Error(
        String(first.message || first.Message || err.message || `FBA inbound HTTP ${res.status}`)
      );
    }

    const payload = payloadRecord(res.data);
    const plans = payload.inboundPlans;
    if (Array.isArray(plans)) {
      for (const plan of plans) {
        const rec = asRecord(plan);
        const inboundPlanId = String(rec.inboundPlanId ?? "").trim();
        if (!inboundPlanId) continue;
        rows.push({
          inboundPlanId,
          name: String(rec.name ?? "").trim() || null,
          status: String(rec.status ?? "").trim() || null,
          createdAt: String(rec.createdAt ?? "").trim() || null,
          lastUpdatedAt: String(rec.lastUpdatedAt ?? "").trim() || null,
          marketplaceIds: Array.isArray(rec.marketplaceIds)
            ? rec.marketplaceIds.map(String)
            : [],
        });
      }
    }

    const pagination = asRecord(payload.pagination);
    const next = String(pagination.nextToken ?? "").trim();
    if (!next) break;
    paginationToken = next;
  }

  rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
  return rows;
}

export async function getAmazonConnectionTokensOrThrow(
  uid: string,
  connectionId?: string
): Promise<NonNullable<Awaited<ReturnType<typeof getValidAmazonToken>>>> {
  const tokens = await getValidAmazonToken(uid, connectionId);
  if (!tokens) {
    throw new Error("Amazon connection not found. Reconnect from Integrations.");
  }
  return tokens;
}
