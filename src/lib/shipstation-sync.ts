import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  shipstationListOrders,
  shipstationListShipments,
  type ShipStationCredentials,
  type ShipStationOrder,
  type ShipStationShipment,
} from "@/lib/shipstation-api";

export type StoredShipStationOrder = {
  orderId: number;
  orderNumber: string;
  orderKey?: string;
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
  amountPaid?: number | null;
  shippingAmount?: number | null;
  /** True when ShipStation has a generated label/shipment for this order. */
  hasPurchasedLabel: boolean;
  trackingNumber?: string | null;
  carrierCode?: string | null;
  serviceCode?: string | null;
  shipmentId?: number | null;
  shipmentCost?: number | null;
  labelShipDate?: string | null;
  connectionId: string;
  syncedAt: string;
};

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function mapOrderBase(order: ShipStationOrder): Omit<
  StoredShipStationOrder,
  | "hasPurchasedLabel"
  | "trackingNumber"
  | "carrierCode"
  | "serviceCode"
  | "shipmentId"
  | "shipmentCost"
  | "labelShipDate"
  | "connectionId"
  | "syncedAt"
> {
  return {
    orderId: order.orderId,
    orderNumber: String(order.orderNumber || order.orderId),
    orderKey: order.orderKey,
    orderStatus: String(order.orderStatus || "unknown"),
    orderDate: order.orderDate || null,
    createDate: order.createDate || null,
    modifyDate: order.modifyDate || null,
    customerEmail: order.customerEmail || null,
    customerName: order.shipTo?.name || order.customerUsername || null,
    shipTo: (order.shipTo as Record<string, unknown>) || null,
    items: Array.isArray(order.items)
      ? order.items.map((item) => ({
          sku: item.sku,
          name: item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
        }))
      : [],
    orderTotal: order.orderTotal ?? null,
    amountPaid: order.amountPaid ?? null,
    shippingAmount: order.shippingAmount ?? null,
  };
}

function applyShipment(
  base: ReturnType<typeof mapOrderBase>,
  shipment?: ShipStationShipment
): Omit<StoredShipStationOrder, "connectionId" | "syncedAt"> {
  if (!shipment) {
    return {
      ...base,
      // Without a ShipStation-generated shipment, label is not confirmed purchased in SS.
      hasPurchasedLabel: false,
      trackingNumber: null,
      carrierCode: null,
      serviceCode: null,
      shipmentId: null,
      shipmentCost: null,
      labelShipDate: null,
    };
  }
  return {
    ...base,
    hasPurchasedLabel: true,
    trackingNumber: shipment.trackingNumber || null,
    carrierCode: shipment.carrierCode || null,
    serviceCode: shipment.serviceCode || null,
    shipmentId: shipment.shipmentId || null,
    shipmentCost: shipment.shipmentCost ?? null,
    labelShipDate: shipment.shipDate || shipment.createDate || null,
    orderStatus: base.orderStatus || "shipped",
  };
}

export async function syncShipStationOrdersForConnection(opts: {
  userId: string;
  connectionId: string;
  creds: ShipStationCredentials;
  lookbackDays?: number;
}): Promise<{ synced: number; withLabels: number }> {
  const lookbackDays = opts.lookbackDays ?? 60;
  const createDateStart = daysAgoIso(lookbackDays);

  const [shipments, awaiting, shipped, pending] = await Promise.all([
    shipstationListShipments(opts.creds, { createDateStart, maxPages: 5 }),
    shipstationListOrders(opts.creds, {
      orderStatus: "awaiting_shipment",
      createDateStart,
      maxPages: 3,
    }),
    shipstationListOrders(opts.creds, {
      orderStatus: "shipped",
      createDateStart,
      maxPages: 3,
    }),
    shipstationListOrders(opts.creds, {
      orderStatus: "pending_fulfillment",
      createDateStart,
      maxPages: 2,
    }),
  ]);

  const shipmentByOrderId = new Map<number, ShipStationShipment>();
  for (const shipment of shipments) {
    if (shipment.orderId == null) continue;
    const existing = shipmentByOrderId.get(shipment.orderId);
    if (!existing) {
      shipmentByOrderId.set(shipment.orderId, shipment);
      continue;
    }
    // Keep newest non-voided shipment
    const existingDate = existing.createDate || "";
    const nextDate = shipment.createDate || "";
    if (nextDate > existingDate) shipmentByOrderId.set(shipment.orderId, shipment);
  }

  const orderMap = new Map<number, ShipStationOrder>();
  for (const order of [...awaiting, ...shipped, ...pending]) {
    if (order.orderId != null) orderMap.set(order.orderId, order);
  }
  // Ensure labeled shipments still get a row even if order list missed them
  for (const [orderId, shipment] of shipmentByOrderId) {
    if (!orderMap.has(orderId)) {
      orderMap.set(orderId, {
        orderId,
        orderNumber: shipment.orderNumber,
        orderKey: shipment.orderKey,
        orderStatus: "shipped",
        shipDate: shipment.shipDate,
        trackingNumber: shipment.trackingNumber,
        carrierCode: shipment.carrierCode,
        serviceCode: shipment.serviceCode,
      });
    }
  }

  const syncedAt = new Date().toISOString();
  const col = adminDb()
    .collection("users")
    .doc(opts.userId)
    .collection("shipstationOrders");

  let withLabels = 0;
  const writes: Promise<unknown>[] = [];

  for (const order of orderMap.values()) {
    const shipment = shipmentByOrderId.get(order.orderId);
    const mapped = applyShipment(mapOrderBase(order), shipment);
    if (mapped.hasPurchasedLabel) withLabels += 1;
    const docId = `${opts.connectionId}_${order.orderId}`;
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

  // Batch in chunks to avoid huge Promise.all
  const chunkSize = 40;
  for (let i = 0; i < writes.length; i += chunkSize) {
    await Promise.all(writes.slice(i, i + chunkSize));
  }

  await adminDb()
    .collection("users")
    .doc(opts.userId)
    .collection("shipstationConnections")
    .doc(opts.connectionId)
    .set(
      {
        lastSyncedAt: adminFieldValue().serverTimestamp(),
        lastSyncOrderCount: orderMap.size,
        lastSyncLabeledCount: withLabels,
      },
      { merge: true }
    );

  return { synced: orderMap.size, withLabels };
}
