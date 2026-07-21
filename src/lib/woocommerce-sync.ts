import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  wooListOrders,
  type WooCommerceCredentials,
  type WooCommerceOrder,
} from "@/lib/woocommerce-api";

export type StoredWooCommerceOrder = {
  orderId: number;
  orderNumber: string;
  status: string;
  currency?: string | null;
  dateCreated?: string | null;
  dateModified?: string | null;
  total?: number | null;
  shippingTotal?: number | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  shipTo?: Record<string, unknown> | null;
  billTo?: Record<string, unknown> | null;
  items: Array<{
    id?: number;
    name?: string;
    sku?: string;
    quantity?: number;
    productId?: number;
    variationId?: number;
    unitPrice?: number;
  }>;
  paymentMethodTitle?: string | null;
  trackingNumber?: string | null;
  trackingProvider?: string | null;
  fulfilledInPrepCorex?: boolean;
  connectionId: string;
  storeUrl?: string;
  syncedAt: string;
};

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

function money(raw?: string | number | null): number | null {
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function personName(addr?: { first_name?: string; last_name?: string } | null): string | null {
  if (!addr) return null;
  const name = [addr.first_name, addr.last_name].filter(Boolean).join(" ").trim();
  return name || null;
}

function trackingFromMeta(
  meta?: Array<{ key?: string; value?: unknown }>
): { trackingNumber: string | null; trackingProvider: string | null } {
  if (!Array.isArray(meta)) return { trackingNumber: null, trackingProvider: null };
  const find = (...keys: string[]) => {
    for (const key of keys) {
      const hit = meta.find((m) => String(m.key || "").toLowerCase() === key.toLowerCase());
      if (hit?.value != null && String(hit.value).trim()) return String(hit.value).trim();
    }
    return null;
  };
  return {
    trackingNumber: find(
      "_tracking_number",
      "tracking_number",
      "_wc_shipment_tracking_number",
      "ywot_tracking_code"
    ),
    trackingProvider: find(
      "_tracking_provider",
      "tracking_provider",
      "_wc_shipment_tracking_provider",
      "ywot_carrier_name"
    ),
  };
}

function mapOrder(order: WooCommerceOrder): Omit<
  StoredWooCommerceOrder,
  "connectionId" | "syncedAt" | "storeUrl" | "fulfilledInPrepCorex"
> {
  const shipping = order.shipping || null;
  const billing = order.billing || null;
  const track = trackingFromMeta(order.meta_data);
  return {
    orderId: order.id,
    orderNumber: String(order.number || order.id),
    status: String(order.status || "unknown"),
    currency: order.currency || null,
    dateCreated: order.date_created || null,
    dateModified: order.date_modified || null,
    total: money(order.total),
    shippingTotal: money(order.shipping_total),
    customerName: personName(shipping) || personName(billing),
    customerEmail: billing?.email || null,
    customerPhone: billing?.phone || shipping?.phone || null,
    shipTo: shipping as Record<string, unknown> | null,
    billTo: billing as Record<string, unknown> | null,
    items: Array.isArray(order.line_items)
      ? order.line_items.map((li) => ({
          id: li.id,
          name: li.name,
          sku: li.sku,
          quantity: li.quantity,
          productId: li.product_id,
          variationId: li.variation_id,
          unitPrice: money(li.price),
        }))
      : [],
    paymentMethodTitle: order.payment_method_title || null,
    trackingNumber: track.trackingNumber,
    trackingProvider: track.trackingProvider,
  };
}

export async function syncWooCommerceOrdersForConnection(opts: {
  userId: string;
  connectionId: string;
  creds: WooCommerceCredentials;
  lookbackDays?: number;
}): Promise<{ synced: number; openCount: number }> {
  const lookbackDays = opts.lookbackDays ?? 60;
  const after = daysAgoIso(lookbackDays);

  const remote = await wooListOrders(opts.creds, {
    after,
    maxPages: 6,
    perPage: 50,
  });

  const syncedAt = new Date().toISOString();
  const col = adminDb()
    .collection("users")
    .doc(opts.userId)
    .collection("woocommerceOrders");

  let openCount = 0;
  const writes: Promise<unknown>[] = [];

  for (const order of remote) {
    const mapped = mapOrder(order);
    if (mapped.status !== "completed" && mapped.status !== "cancelled" && mapped.status !== "refunded") {
      openCount += 1;
    }
    const docId = `${opts.connectionId}_${order.id}`;
    writes.push(
      col.doc(docId).set(
        {
          ...mapped,
          connectionId: opts.connectionId,
          storeUrl: opts.creds.storeUrl,
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
    .collection("woocommerceConnections")
    .doc(opts.connectionId)
    .set(
      {
        lastSyncedAt: adminFieldValue().serverTimestamp(),
        lastSyncOrderCount: remote.length,
        lastSyncOpenCount: openCount,
      },
      { merge: true }
    );

  return { synced: remote.length, openCount };
}
