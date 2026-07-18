/**
 * ShipStation API V1 client (Basic auth: API Key + API Secret).
 * @see https://docs.shipstation.com/apis/shipstation-v1/docs/start-here/requirements
 */

export const SHIPSTATION_API_BASE = "https://ssapi.shipstation.com";

export type ShipStationCredentials = {
  apiKey: string;
  apiSecret: string;
};

export type ShipStationOrderItem = {
  orderItemId?: number;
  lineItemKey?: string;
  sku?: string;
  name?: string;
  quantity?: number;
  unitPrice?: number;
};

export type ShipStationAddress = {
  name?: string;
  company?: string;
  street1?: string;
  street2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
};

export type ShipStationOrder = {
  orderId: number;
  orderNumber?: string;
  orderKey?: string;
  orderDate?: string;
  createDate?: string;
  modifyDate?: string;
  orderStatus?: string;
  customerEmail?: string;
  customerUsername?: string;
  shipTo?: ShipStationAddress;
  billTo?: ShipStationAddress;
  items?: ShipStationOrderItem[];
  orderTotal?: number;
  amountPaid?: number;
  shippingAmount?: number;
  carrierCode?: string | null;
  serviceCode?: string | null;
  packageCode?: string | null;
  confirmation?: string | null;
  shipDate?: string | null;
  trackingNumber?: string | null;
  labelId?: number | null;
};

export type ShipStationShipment = {
  shipmentId: number;
  orderId?: number;
  orderKey?: string;
  orderNumber?: string;
  createDate?: string;
  shipDate?: string;
  shipmentCost?: number;
  insuranceCost?: number;
  trackingNumber?: string;
  carrierCode?: string;
  serviceCode?: string;
  packageCode?: string;
  voided?: boolean;
  labelData?: string | null;
};

function basicAuthHeader(creds: ShipStationCredentials): string {
  const token = Buffer.from(`${creds.apiKey}:${creds.apiSecret}`, "utf8").toString("base64");
  return `Basic ${token}`;
}

export async function shipstationRequest<T>(
  creds: ShipStationCredentials,
  path: string,
  init?: RequestInit
): Promise<T> {
  const url = path.startsWith("http") ? path : `${SHIPSTATION_API_BASE}${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: basicAuthHeader(creds),
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
          : body?.Message || body?.message || body?.ExceptionMessage || JSON.stringify(body);
    } catch {
      details = await response.text().catch(() => "");
    }
    if (response.status === 401) {
      throw new Error("Invalid ShipStation API Key or Secret");
    }
    throw new Error(details || `ShipStation HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return {} as T;
  }
  return (await response.json()) as T;
}

/** Validate credentials with a lightweight orders call. */
export async function shipstationValidateCredentials(
  creds: ShipStationCredentials
): Promise<void> {
  await shipstationRequest<{ orders?: unknown[] }>(
    creds,
    "/orders?pageSize=1&page=1"
  );
}

export async function shipstationListOrders(
  creds: ShipStationCredentials,
  opts?: {
    orderStatus?: string;
    pageSize?: number;
    maxPages?: number;
    createDateStart?: string;
  }
): Promise<ShipStationOrder[]> {
  const pageSize = opts?.pageSize ?? 100;
  const maxPages = opts?.maxPages ?? 5;
  const orders: ShipStationOrder[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: "ModifyDate",
      sortDir: "DESC",
    });
    if (opts?.orderStatus) params.set("orderStatus", opts.orderStatus);
    if (opts?.createDateStart) params.set("createDateStart", opts.createDateStart);

    const data = await shipstationRequest<{
      orders?: ShipStationOrder[];
      pages?: number;
      page?: number;
    }>(creds, `/orders?${params.toString()}`);

    const batch = Array.isArray(data.orders) ? data.orders : [];
    orders.push(...batch);
    const totalPages = Number(data.pages) || page;
    if (page >= totalPages || batch.length === 0) break;
  }

  return orders;
}

/** Only shipments that have labels generated in ShipStation. */
export async function shipstationListShipments(
  creds: ShipStationCredentials,
  opts?: {
    pageSize?: number;
    maxPages?: number;
    createDateStart?: string;
    includeShipmentItems?: boolean;
  }
): Promise<ShipStationShipment[]> {
  const pageSize = opts?.pageSize ?? 100;
  const maxPages = opts?.maxPages ?? 5;
  const shipments: ShipStationShipment[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortBy: "CreateDate",
      sortDir: "DESC",
      includeShipmentItems: opts?.includeShipmentItems === false ? "false" : "true",
    });
    if (opts?.createDateStart) params.set("createDateStart", opts.createDateStart);

    const data = await shipstationRequest<{
      shipments?: ShipStationShipment[];
      pages?: number;
    }>(creds, `/shipments?${params.toString()}`);

    const batch = Array.isArray(data.shipments) ? data.shipments : [];
    shipments.push(...batch.filter((s) => !s.voided));
    const totalPages = Number(data.pages) || page;
    if (page >= totalPages || batch.length === 0) break;
  }

  return shipments;
}
