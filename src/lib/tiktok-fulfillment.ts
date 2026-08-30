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

type DeliveryOptionCandidate = { id: string; name: string; type: string };

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
        type: str(row.type ?? row.delivery_option_type),
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
  platformShipping?: boolean;
}> {
  if (options.orderLike && isTikTokPlatformShippingOrder(options.orderLike)) {
    return {
      providers: [],
      deliveryOptionId: extractDeliveryOptionId(options.orderLike),
      platformShipping: true,
      errorDetail:
        "This order uses Standard/TikTok platform shipping. TikTok assigns the carrier — PrepCorex cannot list seller carriers for it. Enable Ship by seller in TikTok Seller Center, then place a SEND_BY_SELLER test order.",
    };
  }

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

  const sellerOptionIds = candidates
    .filter(
      (candidate) =>
        candidate.type.toUpperCase() === "SEND_BY_SELLER" ||
        candidate.name.toUpperCase().includes("SELLER")
    )
    .map((candidate) => candidate.id);

  const idsToTry = [
    resolvedId,
    ...sellerOptionIds.filter((id) => id && id !== resolvedId),
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
    errorDetail:
      sellerOptionIds.length === 0
        ? "No Ship by seller delivery option found for this TikTok shop. In Seller Center → Shipping settings, add a seller-shipped template, then create a test order with that option."
        : lastDetail || "No shipping providers returned for this order's delivery option.",
  };
}

export async function resolveTikTokShippingProviderId(options: {
  accessToken: string;
  shopCipher: string | null;
  orderLike: Record<string, unknown> | null;
  preferredProviderId?: string;
}): Promise<{ shippingProviderId: string; providers: TikTokShippingProvider[]; errorDetail?: string }> {
  const deliveryOptionId = options.orderLike ? extractDeliveryOptionId(options.orderLike) : "";
  const deliveryOptionName = options.orderLike ? extractDeliveryOptionName(options.orderLike) : "";
  const listed = await fetchTikTokShippingProviders({
    accessToken: options.accessToken,
    shopCipher: options.shopCipher,
    deliveryOptionId,
    deliveryOptionName,
    orderLike: options.orderLike,
  });

  const preferred = str(options.preferredProviderId);
  if (preferred) {
    const match = listed.providers.find((p) => p.id === preferred);
    if (match) return { shippingProviderId: match.id, providers: listed.providers };
    // Keep caller selection when TikTok list could not be loaded.
    if (!listed.providers.length) {
      return { shippingProviderId: preferred, providers: listed.providers };
    }
  }

  const fromOrder = options.orderLike ? extractShippingProviderId(options.orderLike) : "";
  if (fromOrder) {
    const match = listed.providers.find((p) => p.id === fromOrder);
    if (match) return { shippingProviderId: match.id, providers: listed.providers };
    if (!listed.providers.length) {
      return { shippingProviderId: fromOrder, providers: listed.providers };
    }
  }

  const first = listed.providers[0]?.id ?? "";
  if (first) return { shippingProviderId: first, providers: listed.providers };

  return {
    shippingProviderId: preferred || fromOrder,
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

function deliveryOptionToken(value: unknown): string {
  return str(value).toUpperCase();
}

function isPlatformDeliveryOptionLabel(name: string): boolean {
  const token = name.toUpperCase().trim();
  if (!token) return false;
  if (token.includes("SEND_BY_SELLER") || token.includes("SELLER SHIP") || token.includes("SHIP BY SELLER")) {
    return false;
  }
  if (/^(STANDARD|ECONOMY|EXPRESS)(\s+SHIPPING)?$/.test(token)) return true;
  if (
    token.includes("STANDARD SHIPPING") ||
    token.includes("ECONOMY SHIPPING") ||
    token.includes("EXPRESS SHIPPING")
  ) {
    return true;
  }
  return false;
}

export function isTikTokNotSellerShippedError(message: string): boolean {
  return /not shipped by sellers|shipped by sellers/i.test(message);
}

export const TIKTOK_PLATFORM_SHIPPING_DETAIL =
  "This order uses TikTok/platform shipping. PrepCorex can only upload tracking for merchant self-ship (SELLER / SEND_BY_SELLER) orders. Ship via TikTok Seller Center, or create a seller-shipped sandbox order for fulfilment testing.";

export function extractOrderFulfillmentSignals(orderLike: unknown): {
  shippingType: string;
  fulfillmentType: string;
  deliveryOptionType: string;
} {
  const order = asRecord(orderLike);
  if (!order) return { shippingType: "", fulfillmentType: "", deliveryOptionType: "" };
  return {
    shippingType: str(order.shipping_type ?? order.shippingType),
    fulfillmentType: str(order.fulfillment_type ?? order.fulfillmentType),
    deliveryOptionType: str(order.delivery_option_type ?? order.deliveryOptionType),
  };
}

/** True when TikTok handles labels/logistics — seller tracking upload is not allowed. */
export function isTikTokPlatformShippingOrder(orderLike: unknown): boolean {
  const order = asRecord(orderLike);
  if (!order) return false;

  const { shippingType, fulfillmentType, deliveryOptionType } =
    extractOrderFulfillmentSignals(order);
  const shippingToken = shippingType.toUpperCase();
  const fulfillmentToken = fulfillmentType.toUpperCase();
  const deliveryTypeToken = deliveryOptionType.toUpperCase();
  const deliveryName = extractDeliveryOptionName(order).toUpperCase();

  if (shippingToken === "TIKTOK") return true;
  if (fulfillmentToken.includes("FULFILLMENT_BY_TIKTOK") || fulfillmentToken === "FBT") {
    return true;
  }
  if (deliveryTypeToken === "SEND_BY_SELLER") return false;
  if (shippingToken === "SELLER") return false;
  if (fulfillmentToken.includes("FULFILLMENT_BY_SELLER")) return false;
  if (isPlatformDeliveryOptionLabel(deliveryName)) return true;
  if (deliveryName.includes("SEND_BY_SELLER") || deliveryName.includes("SELLER SHIP")) {
    return false;
  }
  if (
    deliveryTypeToken &&
    ["STANDARD", "EXPRESS", "ECONOMY"].includes(deliveryTypeToken) &&
    deliveryTypeToken !== "SEND_BY_SELLER"
  ) {
    return true;
  }

  const delivery = extractOrderDeliveryOption(order);
  if (
    isPlatformLogisticsDeliveryOption(delivery.raw) &&
    !isSellerShippedDeliveryOption(delivery.raw) &&
    !isSellerShippedDeliveryOption(delivery.name)
  ) {
    return true;
  }

  for (const bucket of [order.line_items, order.item_list, order.order_line_items]) {
    if (!Array.isArray(bucket)) continue;
    for (const raw of bucket) {
      const line = asRecord(raw);
      if (!line) continue;
      const lineShipping = str(line.shipping_type).toUpperCase();
      if (lineShipping === "TIKTOK") return true;
      if (lineShipping === "SELLER") return false;
      const lineType = str(line.delivery_option_type).toUpperCase();
      if (lineType === "SEND_BY_SELLER") return false;
      const lineName = str(line.delivery_option_name).toUpperCase();
      if (isPlatformDeliveryOptionLabel(lineName)) return true;
    }
  }

  return false;
}

/** True when TikTok marks the order/package as merchant self-ship (SEND_BY_SELLER). */
export function isSellerShippedDeliveryOption(value: unknown): boolean {
  const token = deliveryOptionToken(value);
  if (!token) return false;
  if (
    token.includes("SEND_BY_SELLER") ||
    token.includes("SELLER_SHIP") ||
    token.includes("MERCHANT") ||
    token === "SELLER"
  ) {
    return true;
  }
  if (
    token.includes("TIKTOK") ||
    token.includes("PLATFORM") ||
    token.includes("4PL") ||
    token.includes("FBT")
  ) {
    return false;
  }
  // Common numeric enum in package detail payloads.
  if (token === "2") return true;
  return false;
}

/** True when fulfilment is handled by TikTok/platform logistics (not seller tracking upload). */
export function isPlatformLogisticsDeliveryOption(value: unknown): boolean {
  const token = deliveryOptionToken(value);
  if (!token) return false;
  if (
    token.includes("TIKTOK") ||
    token.includes("PLATFORM") ||
    token.includes("4PL") ||
    token.includes("FBT")
  ) {
    return true;
  }
  if (isSellerShippedDeliveryOption(value)) return false;
  if (token === "1") return true;
  return false;
}

export function extractOrderDeliveryOption(orderLike: unknown): {
  id: string;
  name: string;
  raw: unknown;
} {
  const order = asRecord(orderLike);
  if (!order) return { id: "", name: "", raw: null };
  return {
    id: extractDeliveryOptionId(order),
    name: extractDeliveryOptionName(order),
    raw: order.delivery_option ?? order.delivery_option_id ?? null,
  };
}

export function extractPackageDeliveryOption(packageLike: unknown): unknown {
  const pkg = asRecord(packageLike);
  if (!pkg) return null;
  return pkg.delivery_option ?? pkg.delivery_option_id ?? pkg.delivery_option_name ?? null;
}

/** Load package detail (delivery_option, status) before seller ship attempts. */
export async function loadTikTokPackageDetail(options: {
  accessToken: string;
  shopCipher: string | null;
  packageId: string;
}): Promise<{ pkg: Record<string, unknown> | null; errorDetail?: string }> {
  const attempts: Array<{ method: "GET" | "POST"; path: string; body?: Record<string, unknown> }> = [
    {
      method: "GET",
      path: `/fulfillment/202309/packages/${encodeURIComponent(options.packageId)}`,
    },
    {
      method: "POST",
      path: "/fulfillment/202309/packages/detail",
      body: { package_id: options.packageId },
    },
    {
      method: "POST",
      path: "/fulfillment/202309/packages/detail",
      body: { package_id_list: [options.packageId] },
    },
  ];

  let lastDetail = "";
  for (const attempt of attempts) {
    const res = await tikTokApiRequest<Record<string, unknown>>({
      method: attempt.method,
      path: attempt.path,
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
      body: attempt.body ?? null,
    });
    if (res.code !== 0) {
      lastDetail = parseTikTokError(res);
      continue;
    }
    const data = res.data ?? {};
    const candidates = [
      data,
      asRecord(data.package),
      Array.isArray(data.packages) ? asRecord(data.packages[0]) : null,
      Array.isArray(data.package_list) ? asRecord(data.package_list[0]) : null,
    ];
    for (const candidate of candidates) {
      if (candidate) return { pkg: candidate };
    }
    lastDetail = "Package detail returned no package payload.";
  }

  return { pkg: null, errorDetail: lastDetail || undefined };
}

export async function shipTikTokSellerPackage(options: {
  accessToken: string;
  shopCipher: string | null;
  packageId: string;
  trackingNumber: string;
  shippingProviderId: string;
}): Promise<{ ok: true; mode: string } | { ok: false; detail: string }> {
  const shipExtras = selfShipmentBody(options.trackingNumber, options.shippingProviderId);
  const attempts: Array<{ path: string; body: Record<string, unknown>; mode: string }> = [
    {
      path: "/fulfillment/202309/packages/ship",
      body: { package_id: options.packageId, ...shipExtras },
      mode: "packages_ship",
    },
    {
      path: `/fulfillment/202309/packages/${encodeURIComponent(options.packageId)}/ship`,
      body: { package_id: options.packageId, ...shipExtras },
      mode: "package_ship_by_id",
    },
  ];

  let lastDetail = "";
  for (const attempt of attempts) {
    const res = await tikTokApiRequest({
      method: "POST",
      path: attempt.path,
      accessToken: options.accessToken,
      shopCipher: options.shopCipher,
      body: attempt.body,
    });
    if (res.code === 0) return { ok: true, mode: attempt.mode };
    lastDetail = parseTikTokError(res);
  }

  return { ok: false, detail: lastDetail || "Ship package failed." };
}
