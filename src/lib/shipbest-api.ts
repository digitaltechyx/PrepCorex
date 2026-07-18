import { createHmac, randomInt } from "crypto";
import type { ParcelDetails, ShippingAddress } from "@/types";

export const SHIPBEST_API_BASE = "https://oms.shipbest.com";

/** 1=g/cm, 2=kg/cm, 3=lb/in — matches Buy Labels form (lb + in). */
export const SHIPBEST_UNIT_LB_IN = 3;

export type ShipBestAddress = {
  nameFirst: string;
  nameLast: string;
  phone?: string;
  email?: string;
  corporateName?: string;
  country: string;
  province?: string;
  city: string;
  address1: string;
  address2?: string;
  zipCode?: string;
};

export type ShipBestSku = {
  sku: string;
  productNameCn: string;
  productNameEn: string;
  quantity: number;
  length: number;
  width: number;
  height: number;
  weight: number;
  unit: number;
  declaredUnitPrice: number;
  declaredCurrency: string;
  hsCode: string;
  productNature: string;
};

export type ShipBestProduct = {
  code: string;
  name: string;
};

export type ShipBestFeeQuote = {
  logisticsProductId: number;
  logisticsProductName: string;
  logisticsProductCode?: string;
  totalShippingFee: number;
  totalDiscountShippingFee: number;
  currency: string;
};

type ShipBestEnvelope<T> = {
  code: number;
  message?: string;
  data?: T;
  requestId?: string;
};

function requireShipBestCredentials(): { apiId: string; accessToken: string } {
  const apiId = process.env.SHIPBEST_API_ID?.trim();
  const accessToken = process.env.SHIPBEST_ACCESS_TOKEN?.trim();
  if (!apiId || !accessToken) {
    throw new Error(
      "ShipBest credentials not configured. Add SHIPBEST_API_ID and SHIPBEST_ACCESS_TOKEN."
    );
  }
  return { apiId, accessToken };
}

function buildSign(params: Record<string, string>, accessToken: string): string {
  const data = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHmac("sha256", accessToken).update(data, "utf8").digest("hex");
}

export async function shipbestRequest<T>(
  path: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const { apiId, accessToken } = requireShipBestCredentials();
  const timestamp = String(Date.now());
  const nonce = String(randomInt(10, 99));
  const method = "post";
  const sign = buildSign(
    {
      accessToken,
      apiId,
      method,
      nonce,
      timestamp,
      url: path,
    },
    accessToken
  );

  const response = await fetch(`${SHIPBEST_API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apiId,
      accessToken,
      timestamp,
      nonce,
      sign,
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json().catch(() => null)) as ShipBestEnvelope<T> | null;
  if (!response.ok) {
    throw new Error(
      json?.message || `ShipBest HTTP ${response.status} for ${path}`
    );
  }
  if (!json || typeof json.code !== "number") {
    throw new Error(`Invalid ShipBest response for ${path}`);
  }
  if (json.code !== 0) {
    throw new Error(json.message || `ShipBest error ${json.code} for ${path}`);
  }
  return json.data as T;
}

export function splitPersonName(fullName: string): { nameFirst: string; nameLast: string } {
  const parts = String(fullName || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { nameFirst: "Customer", nameLast: "Name" };
  if (parts.length === 1) return { nameFirst: parts[0], nameLast: parts[0] };
  return { nameFirst: parts[0], nameLast: parts.slice(1).join(" ") };
}

export function toShipBestAddress(address: ShippingAddress): ShipBestAddress {
  const { nameFirst, nameLast } = splitPersonName(address.name);
  return {
    nameFirst,
    nameLast,
    phone: address.phone || undefined,
    email: address.email || undefined,
    country: String(address.country || "US").toUpperCase(),
    province: address.state || undefined,
    city: address.city,
    address1: address.street1,
    address2: address.street2 || undefined,
    zipCode: address.zip || undefined,
  };
}

/** Default customs line for label quoting/purchase when the UI does not collect SKU details. */
export function buildDefaultShipBestSku(parcel: {
  length: number;
  width: number;
  height: number;
  weight: number;
}): ShipBestSku {
  return {
    sku: "GENERAL",
    productNameCn: "商品",
    productNameEn: "Merchandise",
    quantity: 1,
    length: Number(parcel.length) || 1,
    width: Number(parcel.width) || 1,
    height: Number(parcel.height) || 1,
    weight: Number(parcel.weight) || 0.1,
    unit: SHIPBEST_UNIT_LB_IN,
    declaredUnitPrice: 1,
    declaredCurrency: "USD",
    hsCode: "000000",
    productNature: "2,4",
  };
}

export function formatShipBestShipDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export async function shipbestVerifyAuth(): Promise<void> {
  await shipbestRequest("/api/oauth/verify", {});
}

export async function shipbestGetProducts(): Promise<ShipBestProduct[]> {
  const data = await shipbestRequest<{ productVoList?: ShipBestProduct[] }>(
    "/api/logistics/getProducts",
    {}
  );
  return Array.isArray(data?.productVoList) ? data.productVoList : [];
}

export async function shipbestTrialOrderPrice(input: {
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: Pick<ParcelDetails, "length" | "width" | "height"> & { weight: number };
  logisticsProductCode?: string;
  logisticsProductId?: number;
}): Promise<ShipBestFeeQuote[]> {
  const sku = buildDefaultShipBestSku(input.parcel);
  const body: Record<string, unknown> = {
    insuranceService: 0,
    insuranceFeeCurrency: "USD",
    signServiceType: 0,
    length: Number(input.parcel.length),
    width: Number(input.parcel.width),
    height: Number(input.parcel.height),
    weight: Number(input.parcel.weight),
    declareQuantity: 1,
    declaredAmount: 1,
    declaredAmountCurrency: "USD",
    displayUnitSystem: SHIPBEST_UNIT_LB_IN,
    recipientAddressQo: toShipBestAddress(input.toAddress),
    sendAddressQo: toShipBestAddress(input.fromAddress),
    skuList: [sku],
  };
  if (input.logisticsProductCode) {
    body.logisticsProductCode = input.logisticsProductCode;
  }
  if (input.logisticsProductId != null) {
    body.logisticsProductId = input.logisticsProductId;
  }

  const data = await shipbestRequest<{
    orderFeeCalcVos?: Array<{
      logisticsProductId?: number;
      logisticsProductName?: string;
      logisticsProductCode?: string;
      totalShippingFee?: number;
      totalDiscountShippingFee?: number;
      currency?: string;
    }>;
  }>("/api/logistics/trialOrderPrice", body);

  const list = Array.isArray(data?.orderFeeCalcVos) ? data.orderFeeCalcVos : [];
  return list.map((row) => ({
    logisticsProductId: Number(row.logisticsProductId) || 0,
    logisticsProductName: String(row.logisticsProductName || "ShipBest"),
    logisticsProductCode: row.logisticsProductCode || input.logisticsProductCode,
    totalShippingFee: Number(row.totalShippingFee) || 0,
    totalDiscountShippingFee:
      Number(row.totalDiscountShippingFee) || Number(row.totalShippingFee) || 0,
    currency: String(row.currency || "USD"),
  }));
}

export async function shipbestCreateOrder(input: {
  customNo: string;
  logisticsProductCode: string;
  logisticsProductId?: number;
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: Pick<ParcelDetails, "length" | "width" | "height"> & { weight: number };
  remark?: string;
}): Promise<unknown> {
  const sku = buildDefaultShipBestSku(input.parcel);
  const body: Record<string, unknown> = {
    customNo: input.customNo,
    logisticsProductCode: input.logisticsProductCode,
    insuranceService: 0,
    insuranceFeeCurrency: "USD",
    signServiceType: 0,
    length: Number(input.parcel.length),
    width: Number(input.parcel.width),
    height: Number(input.parcel.height),
    weight: Number(input.parcel.weight),
    remark: input.remark || "PrepCorex Buy Labels",
    declareQuantity: 1,
    declaredAmount: 1,
    declaredAmountCurrency: "USD",
    displayUnitSystem: SHIPBEST_UNIT_LB_IN,
    shipDate: formatShipBestShipDate(),
    recipientAddressQo: toShipBestAddress(input.toAddress),
    sendAddressQo: toShipBestAddress(input.fromAddress),
    skuList: [sku],
  };
  if (input.logisticsProductId != null && input.logisticsProductId > 0) {
    body.logisticsProductId = input.logisticsProductId;
  }
  return shipbestRequest("/api/order/create", body);
}

export type ShipBestOrderDetail = {
  orderNo?: string;
  customNo?: string;
  status?: number;
  errorMsg?: string;
  trackingNo?: string;
  labelUrl?: string;
  feePrice?: number;
  feePriceCurrency?: string;
  logisticsProductCode?: string;
  logisticsProductName?: string;
};

export async function shipbestOrderDetail(opts: {
  orderNo?: string;
  customNo?: string;
}): Promise<ShipBestOrderDetail | null> {
  if (!opts.orderNo && !opts.customNo) {
    throw new Error("orderNo or customNo is required");
  }
  const data = await shipbestRequest<ShipBestOrderDetail>("/api/order/detail", {
    ...(opts.orderNo ? { orderNo: opts.orderNo } : {}),
    ...(opts.customNo ? { customNo: opts.customNo } : {}),
  });
  return data || null;
}

export async function shipbestWaitForLabel(
  customNo: string,
  options?: { attempts?: number; delayMs?: number }
): Promise<ShipBestOrderDetail> {
  const attempts = options?.attempts ?? 12;
  const delayMs = options?.delayMs ?? 2500;
  let last: ShipBestOrderDetail | null = null;

  for (let i = 0; i < attempts; i++) {
    last = await shipbestOrderDetail({ customNo });
    if (last?.status === 3) {
      throw new Error(last.errorMsg || "ShipBest order is in error status");
    }
    if (last?.status === 6) {
      throw new Error("ShipBest order was cancelled");
    }
    if (last?.trackingNo || last?.labelUrl) {
      return last;
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  if (last) return last;
  throw new Error("ShipBest order detail not available after create");
}
