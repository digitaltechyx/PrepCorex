import { etsyApiKeyHeader } from "@/lib/etsy-oauth";

export const ETSY_API_BASE =
  process.env.ETSY_API_BASE?.trim() || "https://api.etsy.com/v3/application";

export type EtsyApiErrorBody = {
  error?: string;
  error_description?: string;
};

export async function etsyApiRequest<T>(input: {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  accessToken: string;
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  /** Prefer for createReceiptShipment (Etsy expects form-urlencoded). */
  formBody?: Record<string, string | number | boolean | undefined | null>;
}): Promise<T> {
  const url = new URL(
    input.path.startsWith("http")
      ? input.path
      : `${ETSY_API_BASE}${input.path.startsWith("/") ? "" : "/"}${input.path}`
  );
  if (input.query) {
    for (const [k, v] of Object.entries(input.query)) {
      if (v == null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers: Record<string, string> = {
    "x-api-key": etsyApiKeyHeader(),
    Authorization: `Bearer ${input.accessToken}`,
  };
  let body: string | undefined;
  const method = input.method || "GET";
  if (method !== "GET") {
    if (input.formBody) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(input.formBody)) {
        if (v == null || v === "") continue;
        params.set(k, String(v));
      }
      body = params.toString();
    } else if (input.body != null) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(input.body);
    }
  }

  const res = await fetch(url.toString(), {
    method,
    headers,
    body,
  });
  const text = await res.text();
  let data: T | (EtsyApiErrorBody & T);
  try {
    data = JSON.parse(text) as T;
  } catch {
    throw new Error(`Etsy API invalid JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const err = data as EtsyApiErrorBody;
    throw new Error(
      err.error_description || err.error || `Etsy API HTTP ${res.status}`
    );
  }
  return data as T;
}

/** Common `carrier_name` values Etsy accepts for tracking updates. */
export const ETSY_COMMON_CARRIERS = [
  { id: "usps", label: "USPS" },
  { id: "ups", label: "UPS" },
  { id: "fedex", label: "FedEx" },
  { id: "dhl", label: "DHL" },
  { id: "dhl_express", label: "DHL Express" },
  { id: "canada_post", label: "Canada Post" },
  { id: "royal_mail", label: "Royal Mail" },
  { id: "other", label: "Other" },
] as const;

export type EtsyListingInventoryOffering = {
  offering_id?: number;
  quantity?: number;
  is_enabled?: boolean;
  price?: { amount?: number; divisor?: number; currency_code?: string } | number;
  readiness_state_id?: number;
};

export type EtsyListingInventoryProduct = {
  product_id?: number;
  sku?: string;
  is_deleted?: boolean;
  offerings?: EtsyListingInventoryOffering[];
  property_values?: unknown[];
};

export type EtsyListingInventory = {
  products?: EtsyListingInventoryProduct[];
  price_on_property?: number[];
  quantity_on_property?: number[];
  sku_on_property?: number[];
};

export type EtsyUserMe = {
  user_id?: number;
  primary_email?: string;
  first_name?: string;
  last_name?: string;
};

export type EtsyShop = {
  shop_id?: number;
  shop_name?: string;
  title?: string;
  url?: string;
  currency_code?: string;
};

export type EtsyListing = {
  listing_id?: number;
  title?: string;
  state?: string;
  quantity?: number;
  sku?: string[];
  price?: { amount?: number; divisor?: number; currency_code?: string };
  images?: Array<{ url_570xN?: string; url_fullxfull?: string }>;
  url?: string;
};

export type EtsyReceipt = {
  receipt_id?: number;
  receipt_type?: number;
  status?: string;
  is_paid?: boolean;
  is_shipped?: boolean;
  created_timestamp?: number;
  updated_timestamp?: number;
  name?: string;
  first_line?: string;
  second_line?: string | null;
  city?: string;
  state?: string;
  zip?: string;
  country_iso?: string;
  formatted_address?: string;
  payment_method?: string;
  grandtotal?: { amount?: number; divisor?: number; currency_code?: string };
  Transactions?: Array<{
    transaction_id?: number;
    title?: string;
    quantity?: number;
    sku?: string;
    listing_id?: number;
  }>;
};
