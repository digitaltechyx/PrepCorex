/** Normalize Shopify Admin API order payloads for PrepCorex UI. */

export type ShopifyOrderLineItem = {
  id: string;
  title: string;
  variantTitle: string | null;
  quantity: number;
  sku: string | null;
  variantId: number | null;
  productId: number | null;
  price: string | null;
  fulfillmentStatus: string | null;
};

export type ShopifyOrderAddress = {
  name: string | null;
  company: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  province: string | null;
  country: string | null;
  zip: string | null;
  phone: string | null;
};

export type ShopifyOrderShippingLine = {
  title: string;
  price: string | null;
  code: string | null;
};

export type ShopifyNormalizedOrder = {
  id: string;
  orderNumber: number;
  name: string | null;
  shop: string;
  connectionId: string | null;
  shopName: string;
  email: string | null;
  financialStatus: string | null;
  fulfillmentStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  note: string | null;
  tags: string | null;
  currency: string | null;
  totalPrice: string | null;
  subtotalPrice: string | null;
  totalTax: string | null;
  totalShipping: string | null;
  shippingAddress: ShopifyOrderAddress | null;
  billingAddress: ShopifyOrderAddress | null;
  customerName: string | null;
  lineItems: ShopifyOrderLineItem[];
  trackingNumbers: string[];
  trackingCompanies: string[];
  shippingLines: ShopifyOrderShippingLine[];
  syncedAt: string | null;
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
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v.toFixed(2);
  const s = String(v).trim();
  return s || null;
}

function normalizeAddress(raw: unknown): ShopifyOrderAddress | null {
  const a = asRecord(raw);
  if (!a) return null;
  const first = str(a.first_name);
  const last = str(a.last_name);
  const name = [first, last].filter(Boolean).join(" ") || str(a.name);
  return {
    name,
    company: str(a.company),
    address1: str(a.address1),
    address2: str(a.address2),
    city: str(a.city),
    province: str(a.province) || str(a.province_code),
    country: str(a.country) || str(a.country_code),
    zip: str(a.zip) || str(a.postal_code),
    phone: str(a.phone),
  };
}

function formatAddressLines(addr: ShopifyOrderAddress | null): string | null {
  if (!addr) return null;
  const parts = [
    addr.name,
    addr.company,
    addr.address1,
    addr.address2,
    [addr.city, addr.province, addr.zip].filter(Boolean).join(", "),
    addr.country,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function shopifyAddressSummary(addr: ShopifyOrderAddress | null): string | null {
  return formatAddressLines(addr);
}

function normalizeLineItem(raw: unknown): ShopifyOrderLineItem | null {
  const li = asRecord(raw);
  if (!li) return null;
  const id = str(li.id) || str(li.variant_id) || "";
  const title = str(li.title) || str(li.name) || "Item";
  const qty = num(li.quantity) ?? 1;
  return {
    id: id || title,
    title,
    variantTitle: str(li.variant_title),
    quantity: Math.max(1, Math.floor(qty)),
    sku: str(li.sku),
    variantId: num(li.variant_id),
    productId: num(li.product_id),
    price: money(li.price),
    fulfillmentStatus: str(li.fulfillment_status),
  };
}

export function normalizeShopifyOrder(
  raw: Record<string, unknown>,
  meta: { shop: string; connectionId?: string | null; shopName?: string }
): ShopifyNormalizedOrder {
  const id = str(raw.id) || "";
  const customer = asRecord(raw.customer);
  const customerName =
    [str(customer?.first_name), str(customer?.last_name)].filter(Boolean).join(" ") ||
    str(customer?.default_address ? asRecord(customer.default_address)?.name : null) ||
    null;

  const fulfillments = Array.isArray(raw.fulfillments) ? raw.fulfillments : [];
  const trackingNumbers: string[] = [];
  const trackingCompanies: string[] = [];
  for (const f of fulfillments) {
    const fr = asRecord(f);
    const tn = str(fr?.tracking_number);
    const tc = str(fr?.tracking_company);
    if (tn && !trackingNumbers.includes(tn)) trackingNumbers.push(tn);
    if (tc && !trackingCompanies.includes(tc)) trackingCompanies.push(tc);
  }

  const shippingLines: ShopifyOrderShippingLine[] = [];
  if (Array.isArray(raw.shipping_lines)) {
    for (const sl of raw.shipping_lines) {
      const row = asRecord(sl);
      if (!row) continue;
      shippingLines.push({
        title: str(row.title) || "Shipping",
        price: money(row.price),
        code: str(row.code),
      });
    }
  }

  const lineItems = (Array.isArray(raw.line_items) ? raw.line_items : [])
    .map(normalizeLineItem)
    .filter((li): li is ShopifyOrderLineItem => li != null);

  const totalShipping =
    shippingLines.length > 0
      ? shippingLines
          .reduce((sum, sl) => sum + (sl.price ? Number(sl.price) : 0), 0)
          .toFixed(2)
      : money(raw.total_shipping_price_set ? asRecord(asRecord(raw.total_shipping_price_set)?.shop_money)?.amount : raw.total_shipping);

  return {
    id,
    orderNumber: num(raw.order_number) ?? 0,
    name: str(raw.name),
    shop: meta.shop,
    connectionId: meta.connectionId ?? null,
    shopName: meta.shopName || meta.shop.replace(".myshopify.com", ""),
    email: str(raw.email) || str(customer?.email),
    financialStatus: str(raw.financial_status),
    fulfillmentStatus: raw.fulfillment_status != null ? String(raw.fulfillment_status) : null,
    createdAt: str(raw.created_at),
    updatedAt: str(raw.updated_at),
    note: str(raw.note),
    tags: str(raw.tags),
    currency: str(raw.currency),
    totalPrice: money(raw.total_price),
    subtotalPrice: money(raw.subtotal_price),
    totalTax: money(raw.total_tax),
    totalShipping,
    shippingAddress: normalizeAddress(raw.shipping_address),
    billingAddress: normalizeAddress(raw.billing_address),
    customerName,
    lineItems,
    trackingNumbers,
    trackingCompanies,
    shippingLines,
    syncedAt: str(raw.syncedAt) || null,
  };
}

/** Convert normalized order to Firestore-safe document (snake_case legacy + normalized fields). */
export function shopifyOrderToFirestoreDoc(order: ShopifyNormalizedOrder): Record<string, unknown> {
  return {
    id: order.id,
    order_number: order.orderNumber,
    name: order.name ?? undefined,
    shop: order.shop,
    connectionId: order.connectionId ?? undefined,
    shopName: order.shopName,
    email: order.email ?? undefined,
    financial_status: order.financialStatus ?? undefined,
    fulfillment_status: order.fulfillmentStatus,
    created_at: order.createdAt ?? undefined,
    updated_at: order.updatedAt ?? undefined,
    note: order.note ?? undefined,
    tags: order.tags ?? undefined,
    currency: order.currency ?? undefined,
    total_price: order.totalPrice ?? undefined,
    subtotal_price: order.subtotalPrice ?? undefined,
    total_tax: order.totalTax ?? undefined,
    total_shipping: order.totalShipping ?? undefined,
    customer: order.customerName ? { first_name: order.customerName.split(" ")[0], last_name: order.customerName.split(" ").slice(1).join(" ") || undefined } : undefined,
    shipping_address: order.shippingAddress
      ? {
          first_name: order.shippingAddress.name?.split(" ")[0],
          last_name: order.shippingAddress.name?.split(" ").slice(1).join(" ") || undefined,
          company: order.shippingAddress.company ?? undefined,
          address1: order.shippingAddress.address1 ?? undefined,
          address2: order.shippingAddress.address2 ?? undefined,
          city: order.shippingAddress.city ?? undefined,
          province: order.shippingAddress.province ?? undefined,
          country: order.shippingAddress.country ?? undefined,
          zip: order.shippingAddress.zip ?? undefined,
          phone: order.shippingAddress.phone ?? undefined,
        }
      : undefined,
    line_items: order.lineItems.map((li) => ({
      id: li.id,
      title: li.title,
      variant_title: li.variantTitle ?? undefined,
      quantity: li.quantity,
      sku: li.sku ?? undefined,
      variant_id: li.variantId ?? undefined,
      product_id: li.productId ?? undefined,
      price: li.price ?? undefined,
      fulfillment_status: li.fulfillmentStatus ?? undefined,
    })),
    tracking_numbers: order.trackingNumbers,
    tracking_companies: order.trackingCompanies,
    shipping_lines: order.shippingLines,
    syncedAt: order.syncedAt ?? new Date().toISOString(),
  };
}

/** Hydrate normalized order from a Firestore doc (webhook or prior sync). */
export function shopifyOrderFromFirestore(
  id: string,
  data: Record<string, unknown>
): ShopifyNormalizedOrder {
  const shop = str(data.shop) || "";
  const lineItemsRaw = Array.isArray(data.line_items) ? data.line_items : [];
  const lineItems = lineItemsRaw
    .map((li) =>
      normalizeLineItem({
        id: asRecord(li)?.id,
        title: asRecord(li)?.title,
        variant_title: asRecord(li)?.variant_title,
        quantity: asRecord(li)?.quantity,
        sku: asRecord(li)?.sku,
        variant_id: asRecord(li)?.variant_id,
        product_id: asRecord(li)?.product_id,
        price: asRecord(li)?.price,
        fulfillment_status: asRecord(li)?.fulfillment_status,
      })
    )
    .filter((li): li is ShopifyOrderLineItem => li != null);

  const trackingNumbers = Array.isArray(data.tracking_numbers)
    ? data.tracking_numbers.map((t) => str(t)).filter((t): t is string => Boolean(t))
    : [];
  const trackingCompanies = Array.isArray(data.tracking_companies)
    ? data.tracking_companies.map((t) => str(t)).filter((t): t is string => Boolean(t))
    : [];

  const shippingLines: ShopifyOrderShippingLine[] = Array.isArray(data.shipping_lines)
    ? data.shipping_lines
        .map((sl) => {
          const row = asRecord(sl);
          if (!row) return null;
          return {
            title: str(row.title) || "Shipping",
            price: money(row.price),
            code: str(row.code),
          };
        })
        .filter((sl): sl is ShopifyOrderShippingLine => sl != null)
    : [];

  const customer = asRecord(data.customer);
  const customerName =
    [str(customer?.first_name), str(customer?.last_name)].filter(Boolean).join(" ") || null;

  return {
    id,
    orderNumber: num(data.order_number) ?? 0,
    name: str(data.name),
    shop,
    connectionId: str(data.connectionId),
    shopName: str(data.shopName) || shop.replace(".myshopify.com", ""),
    email: str(data.email),
    financialStatus: str(data.financial_status),
    fulfillmentStatus: data.fulfillment_status != null ? String(data.fulfillment_status) : null,
    createdAt: str(data.created_at),
    updatedAt: str(data.updated_at),
    note: str(data.note),
    tags: str(data.tags),
    currency: str(data.currency),
    totalPrice: money(data.total_price),
    subtotalPrice: money(data.subtotal_price),
    totalTax: money(data.total_tax),
    totalShipping: money(data.total_shipping),
    shippingAddress: normalizeAddress(data.shipping_address),
    billingAddress: normalizeAddress(data.billing_address),
    customerName,
    lineItems,
    trackingNumbers,
    trackingCompanies,
    shippingLines,
    syncedAt: str(data.syncedAt),
  };
}
