/** Normalize TikTok Shop order payloads (search + detail) for PrepCorex UI. */

export type TikTokOrderLineItem = {
  id: string;
  productName: string;
  skuName: string | null;
  sellerSku: string | null;
  quantity: number;
  salePrice: string | null;
  currency: string | null;
  skuImage: string | null;
};

export type TikTokOrderRecipient = {
  name: string | null;
  phone: string | null;
  fullAddress: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  zipcode: string | null;
  country: string | null;
};

export type TikTokOrderPayment = {
  currency: string | null;
  totalAmount: string | null;
  subTotal: string | null;
  shippingFee: string | null;
  taxes: string | null;
};

export type TikTokNormalizedOrder = {
  id: string;
  status: string | null;
  createTime: number | null;
  updateTime: number | null;
  connectionId: string;
  shopId: string | null;
  shopName: string;
  buyerEmail: string | null;
  buyerMessage: string | null;
  payment: TikTokOrderPayment | null;
  recipient: TikTokOrderRecipient | null;
  lineItems: TikTokOrderLineItem[];
  trackingNumbers: string[];
  shippingProvider: string | null;
  deliveryOptionName: string | null;
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
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  const s = String(v).trim();
  return s || null;
}

function firstImageUrl(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === "string" && img.startsWith("http")) return img;
  const r = asRecord(img);
  if (!r) return null;
  const lists = [r.urls, r.url_list, r.thumb_urls];
  for (const list of lists) {
    if (Array.isArray(list) && typeof list[0] === "string" && list[0].startsWith("http")) {
      return list[0];
    }
  }
  if (typeof r.url === "string" && r.url.startsWith("http")) return r.url;
  return null;
}

function normalizeLineItem(raw: unknown): TikTokOrderLineItem | null {
  const li = asRecord(raw);
  if (!li) return null;
  const id = str(li.id ?? li.order_line_item_id) || "";
  const productName =
    str(li.product_name) ||
    str(li.product_title) ||
    str(li.sku_name) ||
    str(li.seller_sku) ||
    "Item";
  const qty = num(li.quantity) ?? num(li.sku_count) ?? 1;
  return {
    id: id || productName,
    productName,
    skuName: str(li.sku_name),
    sellerSku: str(li.seller_sku) || str(li.seller_sku_name),
    quantity: Math.max(1, Math.floor(qty)),
    salePrice: money(li.sale_price ?? li.sku_sale_price ?? li.original_price),
    currency: str(li.currency),
    skuImage: firstImageUrl(li.sku_image) || firstImageUrl(li.product_image) || firstImageUrl(li.image),
  };
}

function normalizeRecipient(rawOrder: Record<string, unknown>): TikTokOrderRecipient | null {
  const addr =
    asRecord(rawOrder.recipient_address) ||
    asRecord(rawOrder.shipping_address) ||
    asRecord(rawOrder.delivery_address);
  if (!addr) {
    const name = str(rawOrder.recipient_name) || str(rawOrder.buyer_name);
    if (!name) return null;
    return {
      name,
      phone: str(rawOrder.recipient_phone) || str(rawOrder.buyer_phone),
      fullAddress: null,
      addressLine: null,
      city: null,
      state: null,
      zipcode: null,
      country: null,
    };
  }

  const districtInfo = Array.isArray(addr.district_info)
    ? (addr.district_info as Array<Record<string, unknown>>)
    : [];
  const byLevel = (level: string) => {
    const hit = districtInfo.find((d) => String(d.address_level_name || d.level_name || "") === level);
    return str(hit?.address_name || hit?.name);
  };

  const name =
    str(addr.name) ||
    str(addr.full_name) ||
    str(addr.first_name) ||
    str(rawOrder.recipient_name);
  const phone = str(addr.phone_number) || str(addr.phone) || str(rawOrder.recipient_phone);
  const addressLine =
    str(addr.address_detail) ||
    str(addr.address_line1) ||
    str(addr.full_address) ||
    [str(addr.address_line1), str(addr.address_line2)].filter(Boolean).join(", ") ||
    null;
  const city = str(addr.city) || byLevel("city") || byLevel("City");
  const state = str(addr.state) || str(addr.province) || byLevel("state") || byLevel("province");
  const zipcode = str(addr.postal_code) || str(addr.zipcode) || str(addr.zip);
  const country = str(addr.region_code) || str(addr.country) || byLevel("country");
  const fullAddress =
    str(addr.full_address) ||
    [addressLine, city, state, zipcode, country].filter(Boolean).join(", ") ||
    null;

  if (!name && !fullAddress && !phone) return null;
  return { name, phone, fullAddress, addressLine, city, state, zipcode, country };
}

function normalizePayment(rawOrder: Record<string, unknown>): TikTokOrderPayment | null {
  const pay = asRecord(rawOrder.payment) || asRecord(rawOrder.payment_info);
  if (!pay) {
    const total = money(rawOrder.total_amount);
    if (!total) return null;
    return {
      currency: str(rawOrder.currency),
      totalAmount: total,
      subTotal: null,
      shippingFee: null,
      taxes: null,
    };
  }
  return {
    currency: str(pay.currency) || str(rawOrder.currency),
    totalAmount: money(pay.total_amount ?? pay.grand_total ?? pay.buyer_total),
    subTotal: money(pay.sub_total ?? pay.product_price),
    shippingFee: money(pay.shipping_fee ?? pay.original_shipping_fee),
    taxes: money(pay.tax ?? pay.taxes),
  };
}

function collectTracking(rawOrder: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = str(v);
    if (s && !out.includes(s)) out.push(s);
  };
  push(rawOrder.tracking_number);
  const packages = rawOrder.package_list || rawOrder.packages;
  if (Array.isArray(packages)) {
    for (const p of packages) {
      const pr = asRecord(p);
      if (!pr) continue;
      push(pr.tracking_number);
      if (Array.isArray(pr.tracking_number_list)) {
        for (const t of pr.tracking_number_list) push(t);
      }
    }
  }
  if (Array.isArray(rawOrder.tracking_number_list)) {
    for (const t of rawOrder.tracking_number_list) push(t);
  }
  return out;
}

export function normalizeTikTokOrder(
  raw: Record<string, unknown>,
  meta: { connectionId: string; shopId?: string | null; shopName?: string }
): TikTokNormalizedOrder {
  const lineRaw = raw.line_items ?? raw.item_list ?? [];
  const lineItems = Array.isArray(lineRaw)
    ? lineRaw.map(normalizeLineItem).filter((x): x is TikTokOrderLineItem => Boolean(x))
    : [];

  return {
    id: String(raw.id ?? raw.order_id ?? ""),
    status: str(raw.status) || str(raw.order_status),
    createTime: num(raw.create_time),
    updateTime: num(raw.update_time),
    connectionId: meta.connectionId,
    shopId: meta.shopId ?? null,
    shopName: meta.shopName || "TikTok Shop",
    buyerEmail: str(raw.buyer_email),
    buyerMessage: str(raw.buyer_message) || str(raw.note),
    payment: normalizePayment(raw),
    recipient: normalizeRecipient(raw),
    lineItems,
    trackingNumbers: collectTracking(raw),
    shippingProvider:
      str(raw.shipping_provider) ||
      str(raw.shipping_provider_name) ||
      str(asRecord(raw.shipping_provider)?.name),
    deliveryOptionName: str(raw.delivery_option_name) || str(raw.delivery_option),
  };
}

export function mergeTikTokOrderDetail(
  base: Record<string, unknown>,
  detail: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  if (!detail) return base;
  return { ...base, ...detail };
}
