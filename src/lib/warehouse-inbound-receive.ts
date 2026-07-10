import { addDoc, collection, doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  formatExpiryForInput,
  loadInboundRequestQueue,
  type InboundRequestRow,
} from "@/lib/warehouse-inbound-requests";
import type { InventoryRequest, UserProfile, WarehouseDoc } from "@/types";

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
    dockQueue: true,
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

function expectedRequestQty(req: Pick<InventoryRequest, "receivedQuantity" | "requestedQuantity" | "quantity">): number {
  if (typeof req.receivedQuantity === "number" && req.receivedQuantity > 0) return req.receivedQuantity;
  if (typeof req.requestedQuantity === "number" && req.requestedQuantity > 0) return req.requestedQuantity;
  return Math.max(0, req.quantity ?? 0);
}

/**
 * Warehouse-ops dock approve for product inbound (v2).
 * Marks request approved + fulfillment open — stock is added after receive/putaway, not here.
 */
export async function approveInboundRequestAtDock(input: {
  clientUserId: string;
  requestId: string;
  approvedBy: string;
}): Promise<void> {
  const requestRef = doc(db, `users/${input.clientUserId}/inventoryRequests`, input.requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Request not found.");
  const data = snap.data() as InventoryRequest;
  if (data.status !== "pending") {
    throw new Error("Only pending requests can be approved.");
  }
  if (data.inventoryType && data.inventoryType !== "product") {
    throw new Error("Dock approve is for product inbound requests. Use admin for box/pallet/container.");
  }

  const qty = expectedRequestQty(data);
  await updateDoc(requestRef, {
    status: "approved",
    approvedBy: input.approvedBy,
    approvedAt: serverTimestamp(),
    receivingDate: serverTimestamp(),
    requestedQuantity: typeof data.requestedQuantity === "number" ? data.requestedQuantity : qty,
    receivedQuantity: qty,
    fulfillmentStatus: "open",
    warehouseGoodReceivedQty: 0,
    warehouseDamagedReceivedQty: 0,
    updatedAt: serverTimestamp(),
  });
}

export async function rejectInboundRequestAtDock(input: {
  clientUserId: string;
  requestId: string;
  rejectedBy: string;
  reason?: string;
}): Promise<void> {
  const requestRef = doc(db, `users/${input.clientUserId}/inventoryRequests`, input.requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Request not found.");
  const data = snap.data() as InventoryRequest;
  if (data.status !== "pending") {
    throw new Error("Only pending requests can be rejected.");
  }
  await updateDoc(requestRef, {
    status: "rejected",
    rejectedBy: input.rejectedBy,
    rejectedAt: serverTimestamp(),
    rejectionReason: (input.reason || "").trim() || "Rejected at warehouse dock",
    updatedAt: serverTimestamp(),
  });
}
