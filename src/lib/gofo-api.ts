/**
 * GOFO Express open API client (sandbox → production).
 * Docs: docs/API Documentation-EN.docx
 *
 * Auth: HTTP Basic (username:password → Base64)
 * Env:
 *   GOFO_API_BASE_URL   e.g. https://uat-dbu-api.eminxing.com
 *   GOFO_API_USERNAME
 *   GOFO_API_PASSWORD
 *   GOFO_PRODUCT_CODE   e.g. "GOFO Parcel Pickup" | "GOFO Ground Pickup"
 *   GOFO_ENTRY_PORT     e.g. EWR | PHX | LAX | …
 */

export type GofoApiResponse<T = unknown> = {
  code: number;
  msg?: string;
  msgEn?: string;
  data?: T;
};

export type GofoShipper = {
  shipperName: string;
  shipperPhone: string;
  shipperCountry: string;
  shipperState: string;
  shipperCity: string;
  shipperArea?: string;
  shipperStreet: string;
  shipperCode: string;
  shipperEmail?: string;
};

export type GofoConsignee = {
  consigneeName: string;
  consigneePhone: string;
  consigneeCountry: string;
  consigneeState: string;
  consigneeCity: string;
  consigneeArea?: string;
  address1: string;
  address2?: string;
  address3?: string;
  consigneeCode: string;
  consigneeNumIn?: string;
  consigneeNumExt?: string;
  remarks?: string;
  consigneeEmail?: string;
};

export type GofoOrderGoods = {
  weight: number;
  length: number;
  width: number;
  height: number;
};

export type GofoOrderItem = {
  itemNameEn: string;
  itemNameZh?: string;
  itemQty: number;
};

export type GofoCreateOrderPayload = {
  cOrderNo?: string;
  referenceNo?: string;
  reference4?: string;
  ytReference?: string;
  shippingType?: "HDN" | "ZT";
  productCode: string;
  declaredValue: number;
  entryPort: string;
  queryReceiveStartTime?: string;
  queryReceiveEndTime?: string;
  orderShipper: GofoShipper;
  orderConsignee: GofoConsignee;
  orderGoods: GofoOrderGoods;
  orderItemList: GofoOrderItem[];
  orderInsurance?: { insuredAmount: number };
  isSpecialItem?: string;
};

export type GofoCreateOrderResult = {
  cOrderNo?: string;
  verificationPin?: string;
  type?: string;
  waybillNo?: string;
};

export type GofoCostEstimationResult = {
  totalTaxAmount?: number;
  currencyName?: string;
  [key: string]: unknown;
};

export type GofoLabelResult = {
  base64code?: string;
  base64Code?: string;
};

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function getGofoConfig() {
  return {
    baseUrl: requireEnv("GOFO_API_BASE_URL").replace(/\/$/, ""),
    username: requireEnv("GOFO_API_USERNAME"),
    password: requireEnv("GOFO_API_PASSWORD"),
    productCode: process.env.GOFO_PRODUCT_CODE?.trim() || "GOFO Parcel Pickup",
    entryPort: process.env.GOFO_ENTRY_PORT?.trim() || "PHX",
  };
}

function basicAuthHeader(username: string, password: string): string {
  const token = Buffer.from(`${username}:${password}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function gofoRequest<T = unknown>(
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<GofoApiResponse<T>> {
  const { baseUrl, username, password } = getGofoConfig();
  const url = `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuthHeader(username, password),
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: method === "POST" && body !== undefined ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json: GofoApiResponse<T> | null = null;
  try {
    json = text ? (JSON.parse(text) as GofoApiResponse<T>) : null;
  } catch {
    throw new Error(`GOFO non-JSON response (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!json) {
    throw new Error(`GOFO empty response (${res.status})`);
  }

  return json;
}

export function gofoOk(res: GofoApiResponse): boolean {
  return Number(res.code) === 200;
}

export async function gofoVerifyDelivery(consignee: {
  consigneeCountry: string;
  consigneeState?: string;
  consigneeCity?: string;
  consigneeArea?: string;
  consigneeStreet?: string;
  consigneeCode: string;
}) {
  return gofoRequest<{ sortingCode?: string }>("POST", "/open-api/v2/order/verifyDelivery", {
    orderConsignee: consignee,
  });
}

export async function gofoCostEstimation(payload: GofoCreateOrderPayload) {
  return gofoRequest<GofoCostEstimationResult>(
    "POST",
    "/open-api/v2/order/costEstimation",
    payload
  );
}

export async function gofoCreateOrder(payload: GofoCreateOrderPayload) {
  return gofoRequest<GofoCreateOrderResult>("POST", "/open-api/v2/order/create", payload);
}

export async function gofoCancelOrder(orderNo: string, remarks?: string) {
  return gofoRequest("POST", "/open-api/v2/order/cancel", {
    orderNo,
    remarks: remarks || "Cancelled from PrepCorex sandbox test",
  });
}

export async function gofoGetLabel(orderNo: string) {
  const q = encodeURIComponent(orderNo);
  return gofoRequest<GofoLabelResult>(
    "GET",
    `/open-api/v2/order/getOrderLabelUrlV2?orderNo=${q}`
  );
}

export async function gofoTrack(orderNo: string) {
  const q = encodeURIComponent(orderNo);
  return gofoRequest("GET", `/open-api/v2/order/track/${q}`);
}

/** PSF NJ warehouse–style shipper for sandbox tests (adjust when GOFO confirms US shipper format). */
export function defaultPsfShipper(): GofoShipper {
  return {
    shipperName: "Prep Services FBA",
    shipperPhone: "13476613010",
    shipperCountry: "US",
    shipperState: "New Jersey",
    shipperCity: "Mount Laurel",
    shipperArea: "Mount Laurel",
    shipperStreet: "1700 Liberty Place",
    shipperCode: "08054",
    shipperEmail: "info@prepservicesfba.com",
  };
}
