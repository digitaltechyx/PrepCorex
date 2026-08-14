import { adminDb } from "@/lib/firebase-admin";
import { getEbayApiBaseUrl, getValidEbayToken } from "@/lib/ebay-api";

type EbayLineItem = {
  lineItemId?: string;
  legacyItemId?: string;
  sku?: string;
  title?: string;
  quantity?: number;
  lineItemFulfillmentStatus?: string;
};

type EbayShipToAddress = {
  fullName?: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  stateOrProvince?: string;
  postalCode?: string;
  countryCode?: string;
};

type EbayOrder = {
  orderId?: string;
  creationDate?: string;
  lastModifiedDate?: string;
  orderFulfillmentStatus?: string;
  orderPaymentStatus?: string;
  lineItems?: EbayLineItem[];
  buyer?: { email?: string; fullName?: string };
  fulfillmentStartInstructions?: Array<{
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        email?: string;
        primaryPhone?: { phoneNumber?: string };
        contactAddress?: {
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          stateOrProvince?: string;
          postalCode?: string;
          countryCode?: string;
        };
      };
    };
  }>;
};

type OrderSearchResponse = {
  orders?: EbayOrder[];
  next?: string;
};

function extractShipTo(order: EbayOrder): EbayShipToAddress | null {
  const shipTo = order.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;
  if (!shipTo) return null;
  const addr = shipTo.contactAddress;
  return {
    fullName: shipTo.fullName,
    email: shipTo.email || order.buyer?.email,
    phone: shipTo.primaryPhone?.phoneNumber,
    addressLine1: addr?.addressLine1,
    addressLine2: addr?.addressLine2,
    city: addr?.city,
    stateOrProvince: addr?.stateOrProvince,
    postalCode: addr?.postalCode,
    countryCode: addr?.countryCode,
  };
}

export type SyncOrdersResult = {
  ok: boolean;
  totalFetched: number;
  totalSaved: number;
  message?: string;
  error?: string;
};

type SyncOrdersInput = {
  uid: string;
  connectionId?: string;
  filterNotStarted?: boolean;
  maxPages?: number;
  pageSize?: number;
};

export async function syncEbayOrdersForConnection({
  uid,
  connectionId,
  filterNotStarted = false,
  maxPages = 20,
  pageSize = 50,
}: SyncOrdersInput): Promise<SyncOrdersResult> {
  const conn = await getValidEbayToken(uid, connectionId);
  if (!conn) {
    return {
      ok: false,
      totalFetched: 0,
      totalSaved: 0,
      error: "No eBay connection. Connect your eBay account in Integrations first.",
    };
  }

  const db = adminDb();
  const connectionRef = db.collection("users").doc(uid).collection("ebayConnections").doc(conn.connectionId);
  const connectionSnap = await connectionRef.get();
  if (!connectionSnap.exists) {
    return { ok: false, totalFetched: 0, totalSaved: 0, error: "No eBay connection" };
  }

  const connectionData = connectionSnap.data() ?? {};
  const selectedListingIds = Array.isArray(connectionData.selectedListingIds)
    ? (connectionData.selectedListingIds as string[])
    : [];
  const selectedSet = new Set(selectedListingIds.filter(Boolean));
  if (selectedSet.size === 0) {
    return {
      ok: true,
      totalFetched: 0,
      totalSaved: 0,
      message: "No selected listings for this eBay connection. Select listings first, then sync.",
    };
  }

  const base = getEbayApiBaseUrl(conn.isSandbox);
  const ordersCol = db.collection("users").doc(uid).collection("ebayOrders");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
    "Content-Language": "en-US",
  };

  let totalFetched = 0;
  let totalSaved = 0;
  let nextUrl: string | null = `${base}/sell/fulfillment/v1/order?limit=${pageSize}`;
  if (filterNotStarted) {
    nextUrl =
      `${base}/sell/fulfillment/v1/order?limit=${pageSize}` +
      "&filter=orderfulfillmentstatus%3A%7BNOT_STARTED%7CIN_PROGRESS%7D";
  }

  try {
    for (let page = 0; page < maxPages && nextUrl; page++) {
      const res = await fetch(nextUrl, { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return {
          ok: false,
          totalFetched,
          totalSaved,
          error:
            (err as { errors?: Array<{ message?: string; longMessage?: string }> })?.errors?.[0]
              ?.longMessage ||
            (err as { errors?: Array<{ message?: string; longMessage?: string }> })?.errors?.[0]?.message ||
            "Failed to fetch eBay orders",
        };
      }

      const data = (await res.json()) as OrderSearchResponse;
      const orders = data.orders ?? [];
      totalFetched += orders.length;

      for (const order of orders) {
        const orderId = order.orderId;
        if (!orderId) continue;

        const lineItems = order.lineItems ?? [];
        const selectedItems = lineItems.filter(
          (li) => li.legacyItemId && selectedSet.has(String(li.legacyItemId))
        );
        if (selectedItems.length === 0) continue;

        await ordersCol.doc(orderId).set(
          {
            orderId,
            connectionId: conn.connectionId,
            creationDate: order.creationDate ?? null,
            lastModifiedDate: order.lastModifiedDate ?? null,
            orderFulfillmentStatus: order.orderFulfillmentStatus ?? null,
            orderPaymentStatus: order.orderPaymentStatus ?? null,
            buyer: order.buyer
              ? {
                  email: order.buyer.email,
                  fullName: order.buyer.fullName,
                }
              : null,
            shipTo: extractShipTo(order),
            lineItems: selectedItems.map((li) => ({
              lineItemId: li.lineItemId,
              legacyItemId: li.legacyItemId,
              sku: li.sku,
              title: li.title,
              quantity: li.quantity,
              lineItemFulfillmentStatus: li.lineItemFulfillmentStatus,
            })),
            syncedAt: new Date().toISOString(),
          },
          { merge: true }
        );
        totalSaved++;
      }

      nextUrl = data.next ?? null;
      if (orders.length < pageSize) break;
    }

    await connectionRef.set(
      { lastAutoOrderSyncAt: new Date().toISOString() },
      { merge: true }
    );

    return { ok: true, totalFetched, totalSaved };
  } catch (err: unknown) {
    return {
      ok: false,
      totalFetched,
      totalSaved,
      error: err instanceof Error ? err.message : "Sync failed",
    };
  }
}
