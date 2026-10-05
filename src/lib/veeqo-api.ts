/**
 * Veeqo API client (private API key via x-api-key header).
 * Buy-label flow: order → allocation → package dims → rates → POST /shipping/shipments.
 * @see https://developers.veeqo.com/guides/purchase-a-label/
 */

export const VEEQO_API_BASE = "https://api.veeqo.com";

export type VeeqoCredentials = {
  apiKey: string;
};

export type VeeqoAddress = {
  first_name?: string | null;
  last_name?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  country?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type VeeqoLineItem = {
  id?: number;
  sellable_id?: number;
  quantity?: number;
  price_per_unit?: number | string;
  sellable?: {
    id?: number;
    sku_code?: string | null;
    product_title?: string | null;
    title?: string | null;
  } | null;
};

export type VeeqoAllocation = {
  id: number;
  order_id?: number;
  updated_at?: string;
  created_at?: string;
  total_weight?: number;
  weight_unit?: string;
  shipment?: {
    id?: number;
    tracking_number?: string | null;
    carrier?: string | null;
    service_type?: string | null;
    shipped_at?: string | null;
  } | null;
  allocation_package?: {
    weight?: number | null;
    weight_unit?: string | null;
    width?: number | null;
    height?: number | null;
    depth?: number | null;
    dimensions_unit?: string | null;
  } | null;
};

export type VeeqoOrder = {
  id: number;
  number?: string | number | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  total_price?: number | string | null;
  delivery_method?: { id?: number; name?: string | null } | null;
  customer?: {
    email?: string | null;
    phone?: string | null;
    billing_address?: VeeqoAddress | null;
  } | null;
  deliver_to?: VeeqoAddress | null;
  line_items?: VeeqoLineItem[];
  allocations?: VeeqoAllocation[];
};

export type VeeqoShippingServiceOptionValue = {
  value: string;
  label?: string;
  price?: number;
  currency?: string;
};

export type VeeqoShippingServiceOption = {
  key: string;
  label?: string;
  type?: string;
  multiple?: boolean;
  values?: VeeqoShippingServiceOptionValue[];
};

export type VeeqoShippingRate = {
  carrier: string;
  name: string;
  title?: string;
  short_title?: string;
  title_with_price?: string;
  total_net_charge?: string | number;
  total_gross_charge?: string | number;
  base_rate?: string | number;
  currency?: string;
  remote_shipment_id?: string;
  sub_carrier_id?: string;
  service_carrier?: string;
  carrier_id?: string | number | null;
  expected_delivery_days?: number | null;
  shipping_service_options?: VeeqoShippingServiceOption[];
  [key: string]: unknown;
};

export type VeeqoRatesResponse = {
  available?: VeeqoShippingRate[];
  unavailable?: unknown[];
  linked_accounts?: Array<{ id?: number | string; carrier?: string; name?: string }>;
  error_messages?: string[];
};

export type VeeqoPackageInput = {
  weight: number;
  weightUnit?: "oz" | "g";
  width: number;
  height: number;
  depth: number;
  dimensionsUnit?: "inches" | "cm";
};

export type VeeqoPurchaseLabelInput = {
  allocationId: number;
  rate: VeeqoShippingRate;
  /** Optional carrier account id from linked account / shipping configuration. */
  carrierId?: string | number | null;
  notifyCustomer?: boolean;
  /** Overrides for shipping_service_options keys; defaults to first value per option. */
  serviceOptionValues?: Record<string, string>;
};

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function veeqoCustomerName(order: VeeqoOrder): string | null {
  const ship = order.deliver_to;
  if (ship) {
    const name = [ship.first_name, ship.last_name].filter(Boolean).join(" ").trim();
    if (name) return name;
    if (ship.company) return String(ship.company);
  }
  const bill = order.customer?.billing_address;
  if (bill) {
    const name = [bill.first_name, bill.last_name].filter(Boolean).join(" ").trim();
    if (name) return name;
  }
  return null;
}

export function veeqoOrderHasLabel(order: VeeqoOrder): boolean {
  const allocations = Array.isArray(order.allocations) ? order.allocations : [];
  return allocations.some((a) => Boolean(a.shipment?.tracking_number || a.shipment?.id));
}

export async function veeqoRequest<T>(
  creds: VeeqoCredentials,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith("http") ? path : `${VEEQO_API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      "x-api-key": creds.apiKey,
      Accept: "application/json",
      "Content-Type": "application/json",
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
          : body?.error_messages
            ? JSON.stringify(body.error_messages)
            : body?.error ||
              body?.message ||
              body?.Message ||
              body?.errors ||
              JSON.stringify(body);
    } catch {
      details = await response.text().catch(() => "");
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error("Invalid Veeqo API key");
    }
    throw new Error(
      typeof details === "string" && details
        ? details
        : `Veeqo HTTP ${response.status}`
    );
  }

  if (response.status === 204) return {} as T;
  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

/** Validate credentials with a lightweight orders call. */
export async function veeqoValidateCredentials(creds: VeeqoCredentials): Promise<void> {
  await veeqoRequest(creds, "/orders?page_size=1&page=1");
}

export async function veeqoListOrders(
  creds: VeeqoCredentials,
  opts?: {
    status?: string;
    pageSize?: number;
    maxPages?: number;
    createdAtMin?: string;
    updatedAtMin?: string;
  }
): Promise<VeeqoOrder[]> {
  const pageSize = opts?.pageSize ?? 25;
  const maxPages = opts?.maxPages ?? 5;
  const orders: VeeqoOrder[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (opts?.status) params.set("status", opts.status);
    if (opts?.createdAtMin) params.set("created_at_min", opts.createdAtMin);
    if (opts?.updatedAtMin) params.set("updated_at_min", opts.updatedAtMin);

    const data = await veeqoRequest<VeeqoOrder[] | { orders?: VeeqoOrder[] }>(
      creds,
      `/orders?${params.toString()}`
    );
    const batch = Array.isArray(data) ? data : Array.isArray(data.orders) ? data.orders : [];
    orders.push(...batch);
    if (batch.length < pageSize) break;
  }

  return orders;
}

export async function veeqoGetOrder(
  creds: VeeqoCredentials,
  orderId: number
): Promise<VeeqoOrder> {
  return veeqoRequest<VeeqoOrder>(creds, `/orders/${orderId}`);
}

/**
 * Set package dimensions/weight on an allocation (required before rates).
 * Tries PUT (update), falls back to POST (create).
 */
export async function veeqoSetAllocationPackage(
  creds: VeeqoCredentials,
  allocationId: number,
  pkg: VeeqoPackageInput
): Promise<unknown> {
  const body = {
    allocation_package: {
      weight: pkg.weight,
      weight_unit: pkg.weightUnit || "oz",
      width: pkg.width,
      height: pkg.height,
      depth: pkg.depth,
      dimensions_unit: pkg.dimensionsUnit || "inches",
      package_provider: "CUSTOM",
      package_selection_source: "ONE_OFF",
      save_for_similar_shipments: false,
    },
  };

  try {
    return await veeqoRequest(creds, `/allocations/${allocationId}/allocation_package`, {
      method: "PUT",
      body: JSON.stringify(body),
    });
  } catch (putErr) {
    try {
      return await veeqoRequest(creds, `/allocations/${allocationId}/allocation_package`, {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch {
      throw putErr;
    }
  }
}

export async function veeqoGetRates(
  creds: VeeqoCredentials,
  allocationId: number,
  opts?: { shippingConfigurationIds?: Array<string | number> }
): Promise<VeeqoRatesResponse> {
  const params = new URLSearchParams({ from_allocation_package: "true" });
  for (const id of opts?.shippingConfigurationIds || []) {
    params.append("shipping_configuration_ids[]", String(id));
  }
  return veeqoRequest<VeeqoRatesResponse>(
    creds,
    `/shipping/rates/${allocationId}?${params.toString()}`
  );
}

function defaultServiceOptions(
  rate: VeeqoShippingRate,
  overrides?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = { ...(overrides || {}) };
  for (const opt of rate.shipping_service_options || []) {
    if (!opt?.key || out[opt.key] != null) continue;
    const first = Array.isArray(opt.values) ? opt.values[0] : null;
    if (first?.value != null) out[opt.key] = String(first.value);
  }
  return out;
}

export async function veeqoPurchaseLabel(
  creds: VeeqoCredentials,
  input: VeeqoPurchaseLabelInput
): Promise<unknown> {
  const rate = input.rate;
  if (!rate?.carrier || !rate?.name || !rate?.remote_shipment_id) {
    throw new Error("Selected rate is missing carrier, name, or remote_shipment_id");
  }

  const serviceOptions = defaultServiceOptions(rate, input.serviceOptionValues);
  const totalNet = String(rate.total_net_charge ?? "");
  const baseRate = String(rate.base_rate ?? rate.total_net_charge ?? "");

  const shipment: Record<string, unknown> = {
    allocation_id: input.allocationId,
    carrier_id: input.carrierId != null ? String(input.carrierId) : rate.carrier_id != null ? String(rate.carrier_id) : "",
    remote_shipment_id: rate.remote_shipment_id,
    service_type: rate.name,
    notify_customer: input.notifyCustomer !== false,
    sub_carrier_id: rate.sub_carrier_id || "",
    service_carrier: rate.service_carrier || "",
    payment_method_id: null,
    try_inbound_label: false,
    total_net_charge: totalNet,
    base_rate: baseRate,
    ...serviceOptions,
  };

  return veeqoRequest(creds, "/shipping/shipments", {
    method: "POST",
    body: JSON.stringify({
      carrier: rate.carrier,
      shipment,
    }),
  });
}

export function mapVeeqoShipTo(order: VeeqoOrder): Record<string, unknown> | null {
  const ship = order.deliver_to;
  if (!ship) return null;
  return {
    name: [ship.first_name, ship.last_name].filter(Boolean).join(" ").trim() || null,
    company: ship.company || null,
    street1: ship.address1 || null,
    street2: ship.address2 || null,
    city: ship.city || null,
    state: ship.state || null,
    postalCode: ship.zip || null,
    country: ship.country || null,
    phone: ship.phone || null,
  };
}

export function mapVeeqoItems(order: VeeqoOrder): Array<{
  sku?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
}> {
  const items = Array.isArray(order.line_items) ? order.line_items : [];
  return items.map((item) => ({
    sku: item.sellable?.sku_code || undefined,
    name: item.sellable?.product_title || item.sellable?.title || undefined,
    quantity: item.quantity,
    unitPrice: toNumber(item.price_per_unit) ?? undefined,
  }));
}
