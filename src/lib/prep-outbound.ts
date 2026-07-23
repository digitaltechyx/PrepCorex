import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  expectedApprovedInboundQty,
  warehouseGoodReceivedQty,
} from "@/lib/inventory-inbound-display";
import { shipmentUnits } from "@/lib/client-inventory-outbound-sync";
import type { InventoryRequest } from "@/types";

export const PREP_OUTBOUND_PRODUCT_PREFIX = "prep:";

export function prepOutboundProductId(inboundRequestId: string): string {
  return `${PREP_OUTBOUND_PRODUCT_PREFIX}${inboundRequestId}`;
}

export function isPrepOutboundProductId(productId: string | undefined | null): boolean {
  return String(productId ?? "").startsWith(PREP_OUTBOUND_PRODUCT_PREFIX);
}

export function parsePrepOutboundRequestId(productId: string | undefined | null): string | null {
  const raw = String(productId ?? "");
  if (!raw.startsWith(PREP_OUTBOUND_PRODUCT_PREFIX)) return null;
  const id = raw.slice(PREP_OUTBOUND_PRODUCT_PREFIX.length).trim();
  return id || null;
}

export function inboundUnitsAvailableForPrep(req: InventoryRequest): number {
  const expected = expectedApprovedInboundQty(req);
  const good = warehouseGoodReceivedQty(req);
  return Math.max(0, expected - good);
}

/** Pending or approved-but-not-fully-received inbound a client may prep-outbound against. */
export function isSelectablePrepInbound(
  req: InventoryRequest,
  shipmentType: "product" | "box" | "pallet"
): boolean {
  if (req.status === "cancelled" || req.status === "rejected") return false;
  if (req.status !== "pending" && req.status !== "approved") return false;
  if (req.status === "approved" && req.fulfillmentStatus === "closed") return false;
  if (inboundUnitsAvailableForPrep(req) < 1) return false;

  const t = req.inventoryType;
  if (shipmentType === "box") return t === "box";
  if (shipmentType === "pallet") return t === "pallet";
  // product outbound: product (and legacy rows without type)
  return t === "product" || t == null || t === undefined;
}

export function shipmentLineSourceInboundId(
  shipment: Record<string, unknown>
): string | null {
  const explicit = String(shipment.sourceInventoryRequestId ?? "").trim();
  if (explicit) return explicit;
  return parsePrepOutboundRequestId(String(shipment.productId ?? ""));
}

export function shipmentRequestIsPrepOutbound(data: Record<string, unknown>): boolean {
  if (data.isPrepOutbound === true) return true;
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  return shipments.some((s) => Boolean(shipmentLineSourceInboundId(s)));
}

export function prepInboundIdsFromShipments(
  shipments: Array<Record<string, unknown>>
): string[] {
  const ids = new Set<string>();
  for (const s of shipments) {
    const id = shipmentLineSourceInboundId(s);
    if (id) ids.add(id);
  }
  return [...ids];
}

/** Whether linked inbound(s) have enough putaway good qty for each prep line. */
export function prepOutboundWaitingOnInbound(input: {
  shipmentData: Record<string, unknown>;
  inboundById: Map<string, InventoryRequest | (InventoryRequest & Record<string, unknown>)>;
}): boolean {
  if (!shipmentRequestIsPrepOutbound(input.shipmentData)) return false;
  const shipments = Array.isArray(input.shipmentData.shipments)
    ? (input.shipmentData.shipments as Array<Record<string, unknown>>)
    : [];
  for (let i = 0; i < shipments.length; i += 1) {
    const shipment = shipments[i]!;
    const inboundId = shipmentLineSourceInboundId(shipment);
    if (!inboundId) continue;
    const inbound = input.inboundById.get(inboundId);
    if (!inbound) return true;
    const needed = shipmentUnits(input.shipmentData, shipment, i);
    if (warehouseGoodReceivedQty(inbound) < needed) return true;
  }
  return false;
}

/**
 * Units already reserved against an inbound by other pre outbounds
 * (pending / awaiting label / confirmed not yet dispatched).
 */
export async function getCommittedPrepUnitsAgainstInbound(
  clientUserId: string,
  inboundRequestId: string,
  excludeRequestId?: string
): Promise<number> {
  const snap = await getDocs(
    query(
      collection(db, `users/${clientUserId}/shipmentRequests`),
      where("status", "in", ["pending", "awaiting_label_upload", "confirmed"])
    )
  );

  let committed = 0;
  for (const reqDoc of snap.docs) {
    if (excludeRequestId && reqDoc.id === excludeRequestId) continue;
    const data = reqDoc.data() as Record<string, unknown>;
    if (data.warehouseDispatchStatus === "dispatched") continue;
    if (data.clientInventoryDeductedAt) continue;

    const shipments = Array.isArray(data.shipments)
      ? (data.shipments as Array<Record<string, unknown>>)
      : [];
    shipments.forEach((shipment, index) => {
      if (shipmentLineSourceInboundId(shipment) !== inboundRequestId) return;
      committed += shipmentUnits(data, shipment, index);
    });
  }
  return committed;
}

async function findInventoryIdForInbound(
  clientUserId: string,
  inbound: InventoryRequest & { id?: string },
  inboundRequestId: string
): Promise<string | null> {
  const restockId = String(inbound.productId ?? "").trim();
  if (restockId) return restockId;

  const invSnap = await getDocs(collection(db, `users/${clientUserId}/inventory`));
  for (const d of invSnap.docs) {
    const source = String(d.data().sourceRequestId ?? "").trim();
    if (source === inboundRequestId) return d.id;
  }
  return null;
}

/**
 * Resolve prep lines to real inventory productIds and ensure inbound putaway covers the qty.
 * Returns updated shipments array suitable for confirm/pick.
 */
export async function resolvePrepOutboundShipmentsForConfirm(input: {
  clientUserId: string;
  requestData: Record<string, unknown>;
}): Promise<Array<Record<string, unknown>>> {
  const shipments = Array.isArray(input.requestData.shipments)
    ? (input.requestData.shipments as Array<Record<string, unknown>>)
    : [];
  if (shipments.length === 0) return [];

  const resolved: Array<Record<string, unknown>> = [];

  for (let index = 0; index < shipments.length; index += 1) {
    const shipment = { ...shipments[index]! };
    const inboundId = shipmentLineSourceInboundId(shipment);
    if (!inboundId) {
      resolved.push(shipment);
      continue;
    }

    const inboundRef = doc(db, `users/${input.clientUserId}/inventoryRequests`, inboundId);
    const inboundSnap = await getDoc(inboundRef);
    if (!inboundSnap.exists()) {
      throw new Error(
        `Linked inbound request not found for ${String(shipment.productName || inboundId)}.`
      );
    }
    const inbound = { id: inboundSnap.id, ...(inboundSnap.data() as InventoryRequest) };
    const needed = shipmentUnits(input.requestData, shipment, index);
    const good = warehouseGoodReceivedQty(inbound);
    if (good < needed) {
      const name = String(shipment.productName || inbound.productName || inboundId);
      throw new Error(
        `Receive inbound first for "${name}" before processing this pre outbound. Received ${good} of ${needed} units needed.`
      );
    }

    let productId = String(shipment.productId ?? "").trim();
    if (!productId || isPrepOutboundProductId(productId)) {
      productId = (await findInventoryIdForInbound(input.clientUserId, inbound, inboundId)) || "";
    }
    if (!productId) {
      throw new Error(
        `Inbound for "${inbound.productName}" is received but inventory is not ready yet. Finish putaway, then approve.`
      );
    }

    shipment.productId = productId;
    shipment.sourceInventoryRequestId = inboundId;
    if (!shipment.productName) shipment.productName = inbound.productName;
    if (!shipment.sku && inbound.sku) shipment.sku = inbound.sku;
    resolved.push(shipment);
  }

  return resolved;
}
