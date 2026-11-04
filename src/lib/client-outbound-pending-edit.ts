import { doc, getDoc, serverTimestamp, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  adjustClientInventoryForOutboundLineEdit,
  hasClientInventoryDeducted,
  recordOutboundLineLayoutEdit,
  shipmentUnits,
} from "@/lib/client-inventory-outbound-sync";
import { formatOutboundPackLine } from "@/lib/warehouse-outbound-lines";

export type ClientPendingOutboundLineEdit = {
  lineIndex: number;
  /** Box / carton count. 0 removes the line (at least one active line must remain). */
  boxQuantity: number;
  packOf: number;
};

/** New product lines appended while the request is still pending. */
export type ClientPendingOutboundNewLine = {
  productId: string;
  boxQuantity: number;
  packOf: number;
};

function shipmentLineIsPrepOnly(shipment: Record<string, unknown>): boolean {
  const productId = String(shipment.productId ?? "").trim();
  const inboundId = String(shipment.sourceInventoryRequestId ?? "").trim();
  if (inboundId) return true;
  return productId.startsWith("prep:");
}

function lineRemoved(shipment: Record<string, unknown>): boolean {
  return Boolean(shipment.warehouseLineRemoved) || Math.floor(Number(shipment.quantity) || 0) <= 0;
}

/**
 * Client edit for outbound while status is still `pending` (before admin approve).
 * Updates remarks, existing line qty/pack/remove, and appends new product lines.
 * Adjusts reserved sellable inventory for non–prep-only lines.
 */
export async function updatePendingOutboundByClient(input: {
  clientUserId: string;
  shipmentRequestId: string;
  editedBy: string;
  remarks: string;
  lines: ClientPendingOutboundLineEdit[];
  newLines?: ClientPendingOutboundNewLine[];
}): Promise<void> {
  const clientUserId = input.clientUserId.trim();
  const shipmentRequestId = input.shipmentRequestId.trim();
  const editedBy = input.editedBy.trim();
  if (!clientUserId || !shipmentRequestId) throw new Error("Missing client or request.");
  if (!editedBy) throw new Error("Sign in required to edit.");

  const requestRef = doc(db, `users/${clientUserId}/shipmentRequests`, shipmentRequestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");

  const data = snap.data() as Record<string, unknown>;
  const status = String(data.status || "").toLowerCase();
  if (status !== "pending") {
    throw new Error(
      "This order can only be edited while it is Pending (before admin approval)."
    );
  }
  if (data.warehouseDispatchStatus === "dispatched") {
    throw new Error("This order was already dispatched and cannot be edited.");
  }
  if (data.crossdockFulfillment === true || String(data.crossdockLinkedUnitId ?? "").trim()) {
    throw new Error("Cross-dock outbounds cannot be edited here. Cancel and recreate if needed.");
  }

  const shipments = Array.isArray(data.shipments)
    ? ([...data.shipments] as Array<Record<string, unknown>>)
    : [];

  const editsByIndex = new Map<number, ClientPendingOutboundLineEdit>();
  for (const line of input.lines) {
    const idx = Math.floor(line.lineIndex);
    if (idx < 0 || idx >= shipments.length) {
      throw new Error(`Invalid line index ${idx}.`);
    }
    editsByIndex.set(idx, {
      lineIndex: idx,
      boxQuantity: Math.max(0, Math.floor(Number(line.boxQuantity) || 0)),
      packOf: Math.max(1, Math.floor(Number(line.packOf) || 1)),
    });
  }

  const normalizedNewLines = (input.newLines || [])
    .map((line) => ({
      productId: String(line.productId || "").trim(),
      boxQuantity: Math.max(0, Math.floor(Number(line.boxQuantity) || 0)),
      packOf: Math.max(1, Math.floor(Number(line.packOf) || 1)),
    }))
    .filter((line) => line.productId && line.boxQuantity > 0);

  for (const line of normalizedNewLines) {
    if (line.productId.startsWith("prep:")) {
      throw new Error("Prep-only products cannot be added from this editor.");
    }
  }

  const activeExistingAfter = shipments.filter((shipment, index) => {
    if (lineRemoved(shipment) && !editsByIndex.has(index)) return false;
    const edit = editsByIndex.get(index);
    if (edit) return edit.boxQuantity > 0;
    return !lineRemoved(shipment);
  });
  if (activeExistingAfter.length + normalizedNewLines.length === 0) {
    throw new Error("Keep at least one product line, or cancel the request instead.");
  }

  const nextShipments = [...shipments];
  const inventoryAdjustments: Array<{
    lineIndex: number;
    productId: string;
    unitDelta: number;
    packOf: number;
    boxesAfter: number;
    boxesBefore: number;
    packOfBefore: number;
    layoutOnly: boolean;
    prepOnly: boolean;
  }> = [];

  const editedAt = Timestamp.now();
  let anyChange = false;
  const nextRemarks = (input.remarks || "").trim();
  const prevRemarks = String(data.remarks || "").trim();
  if (nextRemarks !== prevRemarks) anyChange = true;
  if (normalizedNewLines.length > 0) anyChange = true;

  for (const [lineIndex, edit] of editsByIndex) {
    const shipment = nextShipments[lineIndex];
    if (!shipment) continue;
    if (Boolean(shipment.warehouseLineRemoved) && edit.boxQuantity <= 0) continue;

    const productId = String(shipment.productId ?? "").trim();
    if (!productId && edit.boxQuantity > 0) {
      throw new Error("Missing product on a shipment line.");
    }

    const oldBoxes = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const oldPackOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    const oldUnits = shipmentUnits(data, shipment, lineIndex);
    const newBoxes = edit.boxQuantity;
    const newPackOf = edit.packOf;
    const newUnits = newBoxes * newPackOf;
    const unitDelta = newUnits - oldUnits;
    const layoutChanged = newBoxes !== oldBoxes || newPackOf !== oldPackOf;

    if (!layoutChanged) continue;
    anyChange = true;

    const layoutBefore = formatOutboundPackLine(oldBoxes, oldPackOf);
    if (newBoxes === 0) {
      nextShipments[lineIndex] = {
        ...shipment,
        quantity: 0,
        warehouseLineRemoved: true,
        clientLineEditedAt: editedAt,
        clientLineEditedBy: editedBy,
        warehouseLineEditFrom: layoutBefore,
      };
    } else {
      nextShipments[lineIndex] = {
        ...shipment,
        quantity: newBoxes,
        packOf: newPackOf,
        warehouseLineRemoved: false,
        clientLineEditedAt: editedAt,
        clientLineEditedBy: editedBy,
        warehouseLineEditFrom: layoutBefore,
      };
    }

    inventoryAdjustments.push({
      lineIndex,
      productId,
      unitDelta,
      packOf: newPackOf,
      boxesAfter: newBoxes,
      boxesBefore: oldBoxes,
      packOfBefore: oldPackOf,
      layoutOnly: unitDelta === 0 && newBoxes > 0,
      prepOnly: shipmentLineIsPrepOnly(shipment),
    });
  }

  const newLineAdjustments: Array<{
    lineIndex: number;
    productId: string;
    units: number;
    packOf: number;
    boxesAfter: number;
  }> = [];

  for (const line of normalizedNewLines) {
    const inventoryRef = doc(db, `users/${clientUserId}/inventory`, line.productId);
    const inventorySnap = await getDoc(inventoryRef);
    if (!inventorySnap.exists()) {
      throw new Error(`Product not found in inventory (${line.productId}).`);
    }
    const inv = inventorySnap.data() as Record<string, unknown>;
    const sku = String(inv.sku ?? "").trim() || line.productId;
    const productName = String(inv.productName ?? sku).trim() || sku;
    const unitPrice = Math.max(0, Number(inv.unitPrice) || 0);
    const lineIndex = nextShipments.length;
    nextShipments.push({
      productId: line.productId,
      quantity: line.boxQuantity,
      packOf: line.packOf,
      unitPrice,
      sku,
      productName,
      clientLineAddedAt: editedAt,
      clientLineEditedBy: editedBy,
      clientLineAddedByClient: true,
    });
    newLineAdjustments.push({
      lineIndex,
      productId: line.productId,
      units: line.boxQuantity * line.packOf,
      packOf: line.packOf,
      boxesAfter: line.boxQuantity,
    });
  }

  if (!anyChange) {
    throw new Error("Nothing to update — change products, qty, pack size, or remarks first.");
  }

  await updateDoc(requestRef, {
    shipments: nextShipments,
    remarks: nextRemarks || null,
    clientEditedAt: editedAt,
    clientEditedBy: editedBy,
    updatedAt: serverTimestamp(),
  });

  const reserved = hasClientInventoryDeducted(data);
  for (const adj of inventoryAdjustments) {
    if (adj.prepOnly || !adj.productId) continue;
    if (adj.layoutOnly) {
      await recordOutboundLineLayoutEdit({
        clientUserId,
        shipmentRequestId,
        lineIndex: adj.lineIndex,
        productId: adj.productId,
        boxesBefore: adj.boxesBefore,
        packOfBefore: adj.packOfBefore,
        boxesAfter: adj.boxesAfter,
        packOfAfter: adj.packOf,
        reason: "Client edit before admin approval",
      });
      continue;
    }
    if (!reserved || adj.unitDelta === 0) continue;
    await adjustClientInventoryForOutboundLineEdit({
      clientUserId,
      shipmentRequestId,
      lineIndex: adj.lineIndex,
      productId: adj.productId,
      unitDelta: adj.unitDelta,
      packOf: adj.packOf,
      boxesAfter: adj.boxesAfter,
      boxesBefore: adj.boxesBefore,
      packOfBefore: adj.packOfBefore,
      reason: "Client edit before admin approval",
    });
  }

  if (reserved) {
    for (const adj of newLineAdjustments) {
      if (adj.units <= 0) continue;
      await adjustClientInventoryForOutboundLineEdit({
        clientUserId,
        shipmentRequestId,
        lineIndex: adj.lineIndex,
        productId: adj.productId,
        unitDelta: adj.units,
        packOf: adj.packOf,
        boxesAfter: adj.boxesAfter,
        boxesBefore: 0,
        packOfBefore: adj.packOf,
        reason: "Client added product before admin approval",
      });
    }
  }
}
