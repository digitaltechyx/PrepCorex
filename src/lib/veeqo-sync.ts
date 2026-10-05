import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  mapVeeqoItems,
  mapVeeqoShipTo,
  veeqoCustomerName,
  veeqoListOrders,
  type VeeqoCredentials,
  type VeeqoOrder,
} from "@/lib/veeqo-api";

export type StoredVeeqoOrder = {
  orderId: number;
  orderNumber: string;
  orderStatus: string;
  orderDate?: string | null;
  createDate?: string | null;
  modifyDate?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  shipTo?: Record<string, unknown> | null;
  items: Array<{
    sku?: string;
    name?: string;
    quantity?: number;
    unitPrice?: number;
  }>;
  orderTotal?: number | null;
  allocationId?: number | null;
  allocationIds: number[];
  hasPurchasedLabel: boolean;
  trackingNumber?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  shipmentId?: number | null;
  labelShipDate?: string | null;
  connectionId: string;
  syncedAt: string;
};

function daysAgoVeeqo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 00:00:00`;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickLabelFields(order: VeeqoOrder): Pick<
  StoredVeeqoOrder,
  | "allocationId"
  | "allocationIds"
  | "hasPurchasedLabel"
  | "trackingNumber"
  | "carrierCode"
  | "serviceCode"
  | "shipmentId"
  | "labelShipDate"
> {
  const allocations = Array.isArray(order.allocations) ? order.allocations : [];
  const allocationIds = allocations.map((a) => a.id).filter((id) => id != null);
  const primary = allocations[0];
  const labeled = allocations.find((a) => a.shipment?.tracking_number || a.shipment?.id);

  return {
    allocationId: primary?.id ?? null,
    allocationIds,
    hasPurchasedLabel: Boolean(labeled),
    trackingNumber: labeled?.shipment?.tracking_number || null,
    carrierCode: labeled?.shipment?.carrier || null,
    serviceCode: labeled?.shipment?.service_type || null,
    shipmentId: labeled?.shipment?.id ?? null,
    labelShipDate: labeled?.shipment?.shipped_at || null,
  };
}

function mapOrder(order: VeeqoOrder): Omit<StoredVeeqoOrder, "connectionId" | "syncedAt"> {
  return {
    orderId: order.id,
    orderNumber: String(order.number ?? order.id),
    orderStatus: String(order.status || "unknown"),
    orderDate: order.created_at || null,
    createDate: order.created_at || null,
    modifyDate: order.updated_at || null,
    customerEmail: order.customer?.email || order.deliver_to?.email || null,
    customerName: veeqoCustomerName(order),
    shipTo: mapVeeqoShipTo(order),
    items: mapVeeqoItems(order),
    orderTotal: toNumber(order.total_price),
    ...pickLabelFields(order),
  };
}

export async function syncVeeqoOrdersForConnection(opts: {
  userId: string;
  connectionId: string;
  creds: VeeqoCredentials;
  lookbackDays?: number;
}): Promise<{ synced: number; withLabels: number; openCount: number }> {
  const lookbackDays = opts.lookbackDays ?? 60;
  const createdAtMin = daysAgoVeeqo(lookbackDays);

  const [awaiting, shipped, onHold, awaitingStock] = await Promise.all([
    veeqoListOrders(opts.creds, {
      status: "awaiting_fulfillment",
      createdAtMin,
      maxPages: 4,
    }),
    veeqoListOrders(opts.creds, {
      status: "shipped",
      createdAtMin,
      maxPages: 3,
    }),
    veeqoListOrders(opts.creds, {
      status: "on_hold",
      createdAtMin,
      maxPages: 2,
    }),
    veeqoListOrders(opts.creds, {
      status: "awaiting_stock",
      createdAtMin,
      maxPages: 2,
    }),
  ]);

  const orderMap = new Map<number, VeeqoOrder>();
  for (const order of [...awaiting, ...shipped, ...onHold, ...awaitingStock]) {
    if (order?.id != null) orderMap.set(order.id, order);
  }

  const syncedAt = new Date().toISOString();
  const col = adminDb().collection("users").doc(opts.userId).collection("veeqoOrders");

  let withLabels = 0;
  let openCount = 0;
  const writes: Promise<unknown>[] = [];

  for (const order of orderMap.values()) {
    const mapped = mapOrder(order);
    if (mapped.hasPurchasedLabel) withLabels += 1;
    if (
      mapped.orderStatus === "awaiting_fulfillment" ||
      mapped.orderStatus === "awaiting_stock" ||
      mapped.orderStatus === "on_hold"
    ) {
      openCount += 1;
    }
    const docId = `${opts.connectionId}_${order.id}`;
    writes.push(
      col.doc(docId).set(
        {
          ...mapped,
          connectionId: opts.connectionId,
          syncedAt,
          updatedAt: adminFieldValue().serverTimestamp(),
        },
        { merge: true }
      )
    );
  }

  const chunkSize = 40;
  for (let i = 0; i < writes.length; i += chunkSize) {
    await Promise.all(writes.slice(i, i + chunkSize));
  }

  await adminDb()
    .collection("users")
    .doc(opts.userId)
    .collection("veeqoConnections")
    .doc(opts.connectionId)
    .set(
      {
        lastSyncedAt: adminFieldValue().serverTimestamp(),
        lastSyncOrderCount: orderMap.size,
        lastSyncLabeledCount: withLabels,
        lastSyncOpenCount: openCount,
      },
      { merge: true }
    );

  return { synced: orderMap.size, withLabels, openCount };
}
