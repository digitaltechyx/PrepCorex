import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";

export type TikTokShippingProvider = {
  id: string;
  name: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

function providerId(raw: Record<string, unknown>): string {
  return str(
    raw.id ??
      raw.shipping_provider_id ??
      raw.provider_id ??
      raw.shipping_providerId
  );
}

function providerName(raw: Record<string, unknown>): string {
  return str(raw.name ?? raw.shipping_provider_name ?? raw.provider_name) || providerId(raw);
}

function normalizeProviderList(payload: unknown): TikTokShippingProvider[] {
  const data = asRecord(payload) ?? {};
  const buckets = [
    data.shipping_providers,
    data.shipping_provider_list,
    data.providers,
    Array.isArray(payload) ? payload : null,
  ];
  const out: TikTokShippingProvider[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const raw of bucket) {
      const row = asRecord(raw);
      if (!row) continue;
      const id = providerId(row);
      if (!id || out.some((p) => p.id === id)) continue;
      out.push({ id, name: providerName(row) });
    }
  }
  return out;
}

export function extractDeliveryOptionId(orderLike: unknown): string {
  const order = asRecord(orderLike);
  if (!order) return "";

  const direct = str(order.delivery_option_id);
  if (direct) return direct;

  for (const bucket of [order.line_items, order.item_list, order.order_line_items]) {
    if (!Array.isArray(bucket)) continue;
    for (const raw of bucket) {
      const line = asRecord(raw);
      const fromLine = str(line?.delivery_option_id);
      if (fromLine) return fromLine;
    }
  }

  // Some payloads only expose a numeric delivery option reference.
  const numeric = str(order.delivery_option);
  if (/^\d+$/.test(numeric)) return numeric;

  return "";
}

export function extractDeliveryOptionName(orderLike: unknown): string {
  const order = asRecord(orderLike);
  if (!order) return "";
  return str(order.delivery_option_name ?? order.delivery_option_description ?? order.delivery_option);
}

type DeliveryOptionCandidate = { id: string; name: string };

async function listDeliveryOptionCandidates(options: {
  accessToken: string;
  shopCipher: string | null;
  warehouseId?: string;
}): Promise<DeliveryOptionCandidate[]> {
  const out: DeliveryOptionCandidate[] = [];
  const warehouseIds: string[] = [];

  if (options.warehouseId) {
    warehouseIds.push(options.warehouseId);
  } else {
    const whRes = await tikTokApiRequest<{ warehouses?: Array<Record<string, unknown>> }>({
      method: "GET",
      path: "/logistics/202309/warehouses",
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
    });
    if (whRes.code === 0) {
      for (const wh of whRes.data?.warehouses ?? []) {
        const row = asRecord(wh);
        const id = str(row?.id ?? row?.warehouse_id);
        if (id) warehouseIds.push(id);
      }
    }
  }

  for (const warehouseId of warehouseIds) {
    const optRes = await tikTokApiRequest<Record<string, unknown>>({
      method: "GET",
      path: `/logistics/202309/warehouses/${encodeURIComponent(warehouseId)}/delivery_options`,
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
    });
    if (optRes.code !== 0) continue;

    const opts = [
      ...(Array.isArray(optRes.data?.delivery_options) ? optRes.data.delivery_options : []),
      ...(Array.isArray(optRes.data?.delivery_option_list) ? optRes.data.delivery_option_list : []),
    ];
    for (const raw of opts) {
      const row = asRecord(raw);
      if (!row) continue;
      const id = str(row.delivery_option_id ?? row.id);
      if (!id || out.some((candidate) => candidate.id === id)) continue;
      out.push({
        id,
        name: str(row.delivery_option_name ?? row.name),
      });
    }
  }

  return out;
}

function pickDeliveryOptionId(
  candidates: DeliveryOptionCandidate[],
  preferredId?: string,
  preferredName?: string
): string {
  const wantedId = str(preferredId);
  if (wantedId) return wantedId;

  const wantedName = str(preferredName).toLowerCase();
  if (wantedName) {
    const exact = candidates.find((c) => c.name.toLowerCase() === wantedName);
    if (exact) return exact.id;
    const partial = candidates.find(
      (c) =>
        c.name.toLowerCase().includes(wantedName) || wantedName.includes(c.name.toLowerCase())
    );
    if (partial) return partial.id;
  }

  return candidates[0]?.id ?? "";
}

export function extractShippingProviderId(orderLike: unknown): string {
  const order = asRecord(orderLike);
  if (!order) return "";
  const direct = str(order.shipping_provider_id);
  if (direct) return direct;
  const nested = asRecord(order.shipping_provider);
  return providerId(nested ?? {});
}

/** Load order detail used to resolve delivery_option_id before fulfilment. */
export async function loadTikTokOrderDetail(options: {
  accessToken: string;
  shopCipher: string | null;
  orderId: string;
}): Promise<{ order: Record<string, unknown> | null; errorDetail?: string }> {
  const attempts: Array<{ path: string; body?: Record<string, unknown>; method?: "GET" | "POST" }> =
    [
      { method: "POST", path: "/order/202309/orders/detail", body: { order_id_list: [options.orderId] } },
      { method: "POST", path: "/order/202309/orders/detail", body: { ids: [options.orderId] } },
      { method: "GET", path: `/order/202309/orders/${encodeURIComponent(options.orderId)}` },
    ];

  let lastDetail = "";
  for (const attempt of attempts) {
    const detail = await tikTokApiRequest<Record<string, unknown>>({
      method: attempt.method ?? "POST",
      path: attempt.path,
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
      body: attempt.body ?? null,
    });
    if (detail.code !== 0) {
      lastDetail = parseTikTokError(detail);
      continue;
    }
    const payload = detail.data ?? {};
    const orders = Array.isArray(payload.orders)
      ? payload.orders
      : payload.order
        ? [payload.order]
        : [payload];
    const order = asRecord(orders[0]);
    if (order) return { order };
    lastDetail = "Order detail returned no order payload.";
  }
  return { order: null, errorDetail: lastDetail || undefined };
}

/** TikTok lists carriers at GET /logistics/202309/delivery_options/{id}/shipping_providers */
export async function fetchTikTokShippingProviders(options: {
  accessToken: string;
  shopCipher: string | null;
  deliveryOptionId?: string;
  deliveryOptionName?: string;
  orderLike?: Record<string, unknown> | null;
}): Promise<{
  providers: TikTokShippingProvider[];
  deliveryOptionId?: string;
  errorDetail?: string;
}> {
  const warehouseId = options.orderLike ? str(asRecord(options.orderLike)?.warehouse_id) : "";
  const candidates = await listDeliveryOptionCandidates({
    accessToken: options.accessToken,
    shopCipher: options.shopCipher,
    warehouseId: warehouseId || undefined,
  });

  const resolvedId = pickDeliveryOptionId(
    candidates,
    str(options.deliveryOptionId) ||
      (options.orderLike ? extractDeliveryOptionId(options.orderLike) : ""),
    str(options.deliveryOptionName) ||
      (options.orderLike ? extractDeliveryOptionName(options.orderLike) : "")
  );

  const idsToTry = [
    resolvedId,
    ...candidates.map((candidate) => candidate.id).filter((id) => id && id !== resolvedId),
  ].filter(Boolean);

  if (!idsToTry.length) {
    return {
      providers: [],
      errorDetail: "Could not resolve delivery_option_id for this TikTok shop.",
    };
  }

  let lastDetail = "";
  for (const deliveryOptionId of idsToTry) {
    const res = await tikTokApiRequest<Record<string, unknown>>({
      method: "GET",
      path: `/logistics/202309/delivery_options/${encodeURIComponent(deliveryOptionId)}/shipping_providers`,
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
    });
    if (res.code !== 0) {
      lastDetail = parseTikTokError(res);
      continue;
    }

    const providers = normalizeProviderList(res.data);
    if (providers.length) {
      return { providers, deliveryOptionId };
    }

    lastDetail = "Shipping providers endpoint returned an empty list.";
  }

  return {
    providers: [],
    deliveryOptionId: resolvedId || undefined,
    errorDetail: lastDetail || "No shipping providers returned.",
  };
}

export async function resolveTikTokShippingProviderId(options: {
  accessToken: string;
  shopCipher: string | null;
  orderLike: Record<string, unknown> | null;
  preferredProviderId?: string;
}): Promise<{ shippingProviderId: string; providers: TikTokShippingProvider[]; errorDetail?: string }> {
  const preferred = str(options.preferredProviderId);
  if (preferred) return { shippingProviderId: preferred, providers: [] };

  const fromOrder = options.orderLike ? extractShippingProviderId(options.orderLike) : "";
  if (fromOrder) return { shippingProviderId: fromOrder, providers: [] };

  const deliveryOptionId = options.orderLike ? extractDeliveryOptionId(options.orderLike) : "";
  const deliveryOptionName = options.orderLike ? extractDeliveryOptionName(options.orderLike) : "";
  const listed = await fetchTikTokShippingProviders({
    accessToken: options.accessToken,
    shopCipher: options.shopCipher,
    deliveryOptionId,
    deliveryOptionName,
    orderLike: options.orderLike,
  });
  const first = listed.providers[0]?.id ?? "";
  if (first) return { shippingProviderId: first, providers: listed.providers };

  return {
    shippingProviderId: "",
    providers: listed.providers,
    errorDetail: listed.errorDetail,
  };
}

export function selfShipmentBody(trackingNumber: string, shippingProviderId: string) {
  return {
    self_shipment: {
      tracking_number: trackingNumber,
      shipping_provider_id: shippingProviderId,
    },
  };
}
