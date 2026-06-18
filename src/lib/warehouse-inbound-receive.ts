import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  formatExpiryForInput,
  loadInboundRequestQueue,
  type InboundRequestRow,
} from "@/lib/warehouse-inbound-requests";
import type { UserProfile, WarehouseDoc } from "@/types";

export type InboundReceivePrefill = {
  clientUserId: string;
  clientDisplayName: string;
  inventoryRequestId: string;
  productName: string;
  sku: string;
  remainingQty: number;
  expiry: string;
};

export function inboundRequestPrefill(row: InboundRequestRow): InboundReceivePrefill {
  return {
    clientUserId: row.clientUserId,
    clientDisplayName: row.clientDisplayName,
    inventoryRequestId: row.id,
    productName: row.productName?.trim() || "Product",
    sku: row.sku?.trim() || "",
    remainingQty: Math.max(0, row.remainingQty),
    expiry: formatExpiryForInput(row.expiryDate),
  };
}

export async function reloadInboundRequestRow(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  clientUserId: string;
  requestId: string;
}): Promise<InboundRequestRow | null> {
  const rows = await loadInboundRequestQueue({
    warehouse: input.warehouse,
    clients: input.clients,
    includePending: true,
  });
  return (
    rows.find((r) => r.id === input.requestId && r.clientUserId === input.clientUserId) ?? null
  );
}

export async function recordInboundReceiveBatch(input: {
  warehouseId: string;
  entries: Array<{
    clientUserId: string;
    inventoryRequestId: string;
    productName?: string | null;
    cartonId: string;
    cartonCode: string;
    sku: string;
    quantity: number;
  }>;
  trackingNumber?: string | null;
  operatorId?: string | null;
}): Promise<void> {
  if (input.entries.length === 0) return;

  const byRequest = new Map<
    string,
    {
      clientUserId: string;
      inventoryRequestId: string;
      productName?: string | null;
      lines: typeof input.entries;
    }
  >();

  for (const entry of input.entries) {
    const key = `${entry.clientUserId}:${entry.inventoryRequestId}`;
    const bucket = byRequest.get(key) ?? {
      clientUserId: entry.clientUserId,
      inventoryRequestId: entry.inventoryRequestId,
      productName: entry.productName,
      lines: [],
    };
    bucket.lines.push(entry);
    byRequest.set(key, bucket);
  }

  for (const bucket of byRequest.values()) {
    await recordInboundReceiveEvents({
      warehouseId: input.warehouseId,
      clientUserId: bucket.clientUserId,
      inventoryRequestId: bucket.inventoryRequestId,
      productName: bucket.productName,
      entries: bucket.lines.map((e) => ({
        cartonId: e.cartonId,
        cartonCode: e.cartonCode,
        sku: e.sku,
        quantity: e.quantity,
      })),
      trackingNumber: input.trackingNumber,
      operatorId: input.operatorId,
    });
  }
}

/** Returns error message when any linked request would be over-received. */
export function validateInboundReceiveQty(input: {
  cartons: Array<{
    copies: number;
    lines: Array<{
      inventoryRequestId?: string | null;
      clientId?: string | null;
      goodQty: number;
    }>;
  }>;
  queue: InboundRequestRow[];
}): string | null {
  const totals = new Map<string, number>();

  for (const carton of input.cartons) {
    const copies = Math.max(1, carton.copies);
    for (const line of carton.lines) {
      const rid = line.inventoryRequestId?.trim();
      const cid = line.clientId?.trim();
      if (!rid || !cid) continue;
      const key = `${cid}:${rid}`;
      totals.set(key, (totals.get(key) ?? 0) + Math.max(0, line.goodQty) * copies);
    }
  }

  for (const [key, qty] of totals) {
    const sep = key.indexOf(":");
    if (sep < 0) continue;
    const clientUserId = key.slice(0, sep);
    const requestId = key.slice(sep + 1);
    const row = input.queue.find((r) => r.clientUserId === clientUserId && r.id === requestId);
    if (!row) continue;
    if (qty > row.remainingQty) {
      return `${row.clientDisplayName} — ${row.productName}: ${qty} entered but only ${row.remainingQty} remaining on the request.`;
    }
  }

  return null;
}

export async function recordInboundReceiveEvents(input: {
  warehouseId: string;
  clientUserId: string;
  inventoryRequestId: string;
  productName?: string | null;
  entries: Array<{ cartonId: string; cartonCode: string; sku: string; quantity: number }>;
  trackingNumber?: string | null;
  operatorId?: string | null;
}): Promise<void> {
  if (input.entries.length === 0) return;

  const requestRef = doc(
    db,
    "users",
    input.clientUserId,
    "inventoryRequests",
    input.inventoryRequestId
  );
  await updateDoc(requestRef, {
    receivingDate: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, "warehouses", input.warehouseId, "movementEvents");
  for (const entry of input.entries) {
    await addDoc(eventsRef, {
      type: "inbound_receive",
      inventoryRequestId: input.inventoryRequestId,
      clientUserId: input.clientUserId,
      productName: input.productName ?? null,
      cartonId: entry.cartonId,
      cartonCode: entry.cartonCode,
      sku: entry.sku,
      quantity: entry.quantity,
      trackingNumber: input.trackingNumber ?? null,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }
}
