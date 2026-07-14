import {
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getCommittedOutboundUnits,
  shipmentUnits,
} from "@/lib/client-inventory-outbound-sync";
import { buildOrderLinesFromRequestData, type ClientProductMap } from "@/lib/warehouse-outbound-lines";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import type { LiveFirestoreDoc } from "@/lib/warehouse-ops-live-compute";
import type { InventoryItem, UserProfile, WarehouseDoc } from "@/types";

export type PendingOutboundRequest = {
  id: string;
  clientUserId: string;
  clientDisplayName: string;
  shipTo?: string;
  service?: string;
  status: string;
  createdAt: Date | null;
  labelUrls: string[];
  lineSummary: string;
  needsClientLabel: boolean;
  canApprove: boolean;
};

/** Parse comma/newline-separated label URLs on a shipment request. */
export function parseShipmentLabelUrls(raw: unknown): string[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((u) => String(u ?? "").trim()).filter(Boolean);
  }
  return String(raw)
    .split(/[,\n]+/)
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
}

function displayClient(client: UserProfile | undefined, userId: string): string {
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

function userIdFromDocPath(path: string): string {
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}

function normOutboundStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Build pending outbound rows for Pick screen (approve like inbound dock).
 */
export function buildPendingOutboundQueueLive(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  shipmentDocs: LiveFirestoreDoc[];
  productMaps: Map<string, ClientProductMap>;
}): PendingOutboundRequest[] {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const eligible = new Set(
    input.clients
      .filter((c) => clientMatchesWarehouse(c, input.warehouse))
      .map((c) => c.uid)
  );

  const rows: PendingOutboundRequest[] = [];

  for (const docRow of input.shipmentDocs) {
    const data = docRow.data;
    const status = normOutboundStatus(data.status);
    if (status !== "pending" && status !== "awaiting_label_upload") continue;

    const clientUserId = userIdFromDocPath(docRow.path);
    if (!clientUserId || !eligible.has(clientUserId)) continue;

    // Already on the floor / mid FBA pack — not a new pending approve row.
    const pickStatus = String(data.warehousePickStatus ?? "")
      .trim()
      .toLowerCase();
    const packStatus = String(data.warehousePackStatus ?? "")
      .trim()
      .toLowerCase();
    const fbaPhase = String(data.fbaPackPhase ?? "")
      .trim()
      .toLowerCase();
    if (
      pickStatus === "picking" ||
      pickStatus === "picked" ||
      pickStatus === "skipped" ||
      packStatus === "packing" ||
      packStatus === "ready_to_dispatch" ||
      fbaPhase === "awaiting_label" ||
      fbaPhase === "awaiting_courier"
    ) {
      continue;
    }

    const products = input.productMaps.get(clientUserId) ?? new Map();
    const lines = buildOrderLinesFromRequestData(data, products);
    const labelUrls = parseShipmentLabelUrls(data.labelUrl);
    const isFba =
      data.fbaLabelWorkflow === true ||
      String(data.service ?? "")
        .toLowerCase()
        .includes("fba");
    const needsClientLabel =
      status === "awaiting_label_upload" || (isFba && labelUrls.length === 0);
    const canApprove = status === "pending" || (status === "awaiting_label_upload" && labelUrls.length > 0);

    rows.push({
      id: docRow.id,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      shipTo: data.shipTo != null ? String(data.shipTo) : undefined,
      service: data.service != null ? String(data.service) : undefined,
      status,
      createdAt: dateFromFirestore(data.createdAt) ?? dateFromFirestore(data.requestedAt),
      labelUrls,
      lineSummary:
        lines.length > 0
          ? lines.map((l) => `${l.quantityUnits}× ${l.sku}`).join(" · ")
          : "No SKU lines resolved yet",
      needsClientLabel,
      canApprove,
    });
  }

  rows.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0));
  return rows;
}

/**
 * Floor approve for outbound — confirms request so it enters the pick queue.
 * Inventory deducts later at dispatch (same timing as admin confirm).
 */
export async function confirmOutboundRequestAtPick(input: {
  clientUserId: string;
  shipmentRequestId: string;
  confirmedBy: string;
}): Promise<void> {
  const clientUserId = input.clientUserId.trim();
  const requestId = input.shipmentRequestId.trim();
  if (!clientUserId || !requestId) throw new Error("Missing client or request.");
  if (!input.confirmedBy.trim()) throw new Error("Sign in required to approve.");

  const requestRef = doc(db, `users/${clientUserId}/shipmentRequests`, requestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const data = snap.data() as Record<string, unknown>;
  const status = normOutboundStatus(data.status);

  if (status === "confirmed") return;
  if (status !== "pending" && status !== "awaiting_label_upload") {
    throw new Error(`Only pending requests can be approved (current: ${status || "unknown"}).`);
  }

  const labelUrls = parseShipmentLabelUrls(data.labelUrl);
  if (status === "awaiting_label_upload" && labelUrls.length === 0) {
    throw new Error("Client label not uploaded yet — wait for label, then approve.");
  }

  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  if (shipments.length === 0) throw new Error("Order has no line items.");

  const committedByProduct = new Map<string, number>();
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId || committedByProduct.has(productId)) continue;
    committedByProduct.set(
      productId,
      await getCommittedOutboundUnits(clientUserId, productId, requestId)
    );
  }

  await runTransaction(db, async (transaction) => {
    for (let index = 0; index < shipments.length; index += 1) {
      const shipment = shipments[index]!;
      const productId = String(shipment.productId ?? "").trim();
      if (!productId) throw new Error("Missing product on a shipment line.");

      const inventoryRef = doc(db, `users/${clientUserId}/inventory`, productId);
      const inventorySnap = await transaction.get(inventoryRef);
      if (!inventorySnap.exists()) {
        throw new Error(`Product ${productId} not found in inventory.`);
      }

      const currentInventory = inventorySnap.data() as Omit<InventoryItem, "id">;
      const totalUnits = shipmentUnits(data, shipment, index);
      const committed = committedByProduct.get(productId) ?? 0;
      const sellable = Math.max(0, Number(currentInventory.quantity) - committed);
      if (sellable < totalUnits) {
        throw new Error(
          `Not enough stock for ${currentInventory.productName}. Available: ${sellable}, Requested: ${totalUnits}.`
        );
      }
    }

    transaction.update(requestRef, {
      status: "confirmed",
      confirmedBy: input.confirmedBy,
      confirmedAt: Timestamp.now(),
      clientInventoryDeductionTiming: "dispatch",
      warehousePickStatus: "ready",
      updatedAt: serverTimestamp(),
    });
  });
}

export async function rejectOutboundRequestAtPick(input: {
  clientUserId: string;
  shipmentRequestId: string;
  rejectedBy: string;
  reason?: string;
}): Promise<void> {
  const requestRef = doc(
    db,
    `users/${input.clientUserId}/shipmentRequests`,
    input.shipmentRequestId
  );
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const status = normOutboundStatus(snap.data()?.status);
  if (status === "rejected" || status === "cancelled") return;
  if (status !== "pending" && status !== "awaiting_label_upload") {
    throw new Error("Only pending requests can be rejected.");
  }

  await updateDoc(requestRef, {
    status: "rejected",
    rejectedBy: input.rejectedBy,
    rejectedAt: serverTimestamp(),
    rejectionReason: input.reason?.trim() || "Rejected at warehouse pick",
    updatedAt: serverTimestamp(),
  });
}
