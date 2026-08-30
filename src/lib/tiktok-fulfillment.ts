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

function providersFromDeliveryOptionList(
  payload: unknown,
  deliveryOptionId?: string,
  deliveryOptionName?: string
): TikTokShippingProvider[] {
  const root = asRecord(payload) ?? {};
  const list = root.delivery_option_list;
  if (!Array.isArray(list)) return [];

  const wantedId = str(deliveryOptionId);
  const wantedName = str(deliveryOptionName).toLowerCase();
  const out: TikTokShippingProvider[] = [];

  for (const raw of list) {
    const option = asRecord(raw);
    if (!option) continue;
    const optionId = str(option.delivery_option_id);
    const optionName = str(option.delivery_option_name).toLowerCase();
    if (wantedId && optionId && optionId !== wantedId) continue;
    if (!wantedId && wantedName && optionName && optionName !== wantedName) continue;

    for (const provider of normalizeProviderList(option.shipping_provider_list)) {
      if (!out.some((p) => p.id === provider.id)) out.push(provider);
    }
  }

  // If filters were too strict, fall back to every carrier TikTok returned.
  if (!out.length && (wantedId || wantedName)) {
    return providersFromDeliveryOptionList(payload);
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

/** TikTok requires delivery_option_id when listing eligible carriers. */
export async function fetchTikTokShippingProviders(options: {
  accessToken: string;
  shopCipher: string | null;
  deliveryOptionId?: string;
  deliveryOptionName?: string;
}): Promise<{ providers: TikTokShippingProvider[]; errorDetail?: string }> {
  const deliveryOptionId = str(options.deliveryOptionId);
  const deliveryOptionName = str(options.deliveryOptionName);

  const attempts: Array<{ path: string; query?: Record<string, string> }> = [];
  if (deliveryOptionId) {
    attempts.push(
      {
        path: "/logistics/202309/shipping_providers",
        query: { delivery_option_id: deliveryOptionId },
      },
      {
        path: "/fulfillment/202309/shipping_providers",
        query: { delivery_option_id: deliveryOptionId },
      }
    );
  }
  attempts.push(
    { path: "/logistics/202309/shipping_providers" },
    { path: "/fulfillment/202309/shipping_providers" }
  );

  let lastDetail = "";
  for (const attempt of attempts) {
    const res = await tikTokApiRequest<Record<string, unknown>>({
      method: "GET",
      path: attempt.path,
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
      query: attempt.query,
    });
    if (res.code !== 0) {
      lastDetail = parseTikTokError(res);
      continue;
    }

    const fromDeliveryOptions = providersFromDeliveryOptionList(
      res.data,
      deliveryOptionId,
      deliveryOptionName
    );
    if (fromDeliveryOptions.length) return { providers: fromDeliveryOptions };

    const providers = normalizeProviderList(res.data);
    if (providers.length) return { providers };

    const deliveryOptions = asRecord(res.data)?.delivery_options;
    if (Array.isArray(deliveryOptions)) {
      for (const option of deliveryOptions) {
        const fromOption = normalizeProviderList(asRecord(option)?.shipping_provider_list);
        if (fromOption.length) return { providers: fromOption };
      }
    }
  }

  return { providers: [], errorDetail: lastDetail || "No shipping providers returned." };
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
