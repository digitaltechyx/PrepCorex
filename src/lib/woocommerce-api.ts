/**
 * WooCommerce REST API v3 client (Consumer Key + Secret).
 * @see https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication
 */

export type WooCommerceCredentials = {
  storeUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export type WooAddress = {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
};

export type WooLineItem = {
  id?: number;
  name?: string;
  product_id?: number;
  variation_id?: number;
  quantity?: number;
  sku?: string;
  price?: number | string;
  total?: string;
};

export type WooCommerceOrder = {
  id: number;
  number?: string;
  status?: string;
  currency?: string;
  date_created?: string;
  date_modified?: string;
  total?: string;
  customer_id?: number;
  billing?: WooAddress;
  shipping?: WooAddress;
  line_items?: WooLineItem[];
  shipping_total?: string;
  payment_method_title?: string;
  meta_data?: Array<{ id?: number; key?: string; value?: unknown }>;
};

export type WooCommerceProduct = {
  id: number;
  name?: string;
  sku?: string;
  type?: string;
  status?: string;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: string;
  price?: string;
  regular_price?: string;
  images?: Array<{ src?: string }>;
  variations?: number[];
};

/** Normalize store URL to origin without trailing slash. */
export function normalizeWooStoreUrl(raw: string): string {
  let url = String(raw || "").trim();
  if (!url) throw new Error("Store URL is required");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  const u = new URL(url);
  if (!u.hostname) throw new Error("Invalid store URL");
  return `${u.protocol}//${u.host}`.replace(/\/$/, "");
}

function basicAuthHeader(creds: WooCommerceCredentials): string {
  const token = Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`, "utf8").toString(
    "base64"
  );
  return `Basic ${token}`;
}

function apiBase(storeUrl: string): string {
  return `${normalizeWooStoreUrl(storeUrl)}/wp-json/wc/v3`;
}

export async function wooRequest<T>(
  creds: WooCommerceCredentials,
  path: string,
  init?: RequestInit
): Promise<T> {
  const base = apiBase(creds.storeUrl);
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${base}${cleanPath}`);

  // Some hosts strip Authorization; also pass as query (Woo supports this over HTTPS).
  url.searchParams.set("consumer_key", creds.consumerKey);
  url.searchParams.set("consumer_secret", creds.consumerSecret);

  const response = await fetch(url.toString(), {
    ...init,
    headers: {
      Authorization: basicAuthHeader(creds),
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let details = "";
    try {
      const body = await response.json();
      details =
        typeof body === "string"
          ? body
          : body?.message || body?.code || JSON.stringify(body);
    } catch {
      details = await response.text().catch(() => "");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid WooCommerce Consumer Key or Secret (or store blocked access)");
    }
    throw new Error(details || `WooCommerce HTTP ${response.status}`);
  }

  if (response.status === 204) return {} as T;
  return (await response.json()) as T;
}

export async function wooValidateCredentials(creds: WooCommerceCredentials): Promise<{
  storeUrl: string;
}> {
  const storeUrl = normalizeWooStoreUrl(creds.storeUrl);
  await wooRequest<WooCommerceOrder[]>(
    { ...creds, storeUrl },
    "/orders?per_page=1&page=1"
  );
  return { storeUrl };
}

export async function wooListOrders(
  creds: WooCommerceCredentials,
  opts?: {
    status?: string;
    perPage?: number;
    maxPages?: number;
    after?: string;
  }
): Promise<WooCommerceOrder[]> {
  const perPage = opts?.perPage ?? 50;
  const maxPages = opts?.maxPages ?? 5;
  const orders: WooCommerceOrder[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      orderby: "date",
      order: "desc",
    });
    if (opts?.status) params.set("status", opts.status);
    if (opts?.after) params.set("after", opts.after);

    const batch = await wooRequest<WooCommerceOrder[]>(
      creds,
      `/orders?${params.toString()}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    orders.push(...batch);
    if (batch.length < perPage) break;
  }
  return orders;
}

export async function wooUpdateOrder(
  creds: WooCommerceCredentials,
  orderId: number,
  body: Record<string, unknown>
): Promise<WooCommerceOrder> {
  return wooRequest<WooCommerceOrder>(creds, `/orders/${orderId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function wooListProducts(
  creds: WooCommerceCredentials,
  opts?: { perPage?: number; maxPages?: number; search?: string }
): Promise<WooCommerceProduct[]> {
  const perPage = opts?.perPage ?? 50;
  const maxPages = opts?.maxPages ?? 3;
  const products: WooCommerceProduct[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
      status: "publish",
    });
    if (opts?.search) params.set("search", opts.search);
    const batch = await wooRequest<WooCommerceProduct[]>(
      creds,
      `/products?${params.toString()}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    products.push(...batch);
    if (batch.length < perPage) break;
  }
  return products;
}

export async function wooUpdateProductStock(
  creds: WooCommerceCredentials,
  productId: number,
  stockQuantity: number,
  variationId?: number
): Promise<unknown> {
  const body = {
    manage_stock: true,
    stock_quantity: stockQuantity,
    stock_status: stockQuantity > 0 ? "instock" : "outofstock",
  };
  if (variationId && variationId > 0) {
    return wooRequest(creds, `/products/${productId}/variations/${variationId}`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  }
  return wooRequest(creds, `/products/${productId}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export type WooCommerceVariation = {
  id: number;
  sku?: string;
  manage_stock?: boolean;
  stock_quantity?: number | null;
  stock_status?: string;
  price?: string;
  attributes?: Array<{ name?: string; option?: string }>;
};

export async function wooListProductVariations(
  creds: WooCommerceCredentials,
  productId: number,
  opts?: { perPage?: number; maxPages?: number }
): Promise<WooCommerceVariation[]> {
  const perPage = opts?.perPage ?? 50;
  const maxPages = opts?.maxPages ?? 5;
  const rows: WooCommerceVariation[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(perPage),
    });
    const batch = await wooRequest<WooCommerceVariation[]>(
      creds,
      `/products/${productId}/variations?${params.toString()}`
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    rows.push(...batch);
    if (batch.length < perPage) break;
  }
  return rows;
}
