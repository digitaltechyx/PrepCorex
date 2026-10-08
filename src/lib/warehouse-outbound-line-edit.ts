import {
  doc,
  getDoc,
  serverTimestamp,
  Timestamp,
  updateDoc,
  deleteField,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  adjustClientInventoryForOutboundLineEdit,
  hasClientInventoryDeducted,
  recordOutboundLineLayoutEdit,
  shipmentUnits,
} from "@/lib/client-inventory-outbound-sync";
import {
  buildEditableShipmentLines,
  buildOrderLinesFromRequestData,
  formatOutboundPackLine,
  loadClientProductMap,
} from "@/lib/warehouse-outbound-lines";
import {
  getPickSourceHintsForSku,
  loadNetPickedBySku,
  reconcilePickStatusAfterLineEdit,
  reverseWarehousePicksForSkuQuantity,
  type OutboundPickSourceHint,
} from "@/lib/warehouse-pick";
import { restoreWarehouseStockForOutboundCancel } from "@/lib/warehouse-pack";

function normOutboundStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase();
}

function packStatusFromRequest(data: Record<string, unknown>): string {
  return String(data.warehousePackStatus ?? "")
    .trim()
    .toLowerCase();
}

function dispatchStatusFromRequest(data: Record<string, unknown>): string {
  return String(data.warehouseDispatchStatus ?? "")
    .trim()
    .toLowerCase();
}

function shipmentLineIsPrepOnly(shipment: Record<string, unknown>): boolean {
  const productId = String(shipment.productId ?? "").trim();
  const inboundId = String(shipment.sourceInventoryRequestId ?? "").trim();
  if (inboundId) return true;
  return productId.startsWith("prep:");
}

async function clearPackStateAfterLineEdit(
  clientUserId: string,
  shipmentRequestId: string
): Promise<void> {
  const requestRef = doc(db, `users/${clientUserId}/shipmentRequests`, shipmentRequestId);
  await updateDoc(requestRef, {
    warehousePackStatus: deleteField(),
    warehouseReadyToDispatchAt: deleteField(),
    warehousePackedBy: deleteField(),
    warehousePackVerifiedKeys: deleteField(),
    warehousePackStockSnapshot: deleteField(),
    warehouseCourierTracking: deleteField(),
    warehousePackCourierVerifiedAt: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

export type EditOutboundLineResult = {
  pickSourceHints: OutboundPickSourceHint[];
  unitsUnpicked: number;
  removed: boolean;
};

/**
 * Edit one open outbound line before dispatch.
 * Supports reduce qty, remove line, increase qty, change pack size, and (admin) unit price.
 */
export async function editOutboundLineAtWarehouse(input: {
  clientUserId: string;
  shipmentRequestId: string;
  warehouseId: string;
  lineIndex: number;
  /** New box count; 0 removes the line from the order. */
  newBoxQuantity: number;
  /** New pack size per box/case; defaults to existing line pack when omitted. */
  newPackOf?: number;
  /** When set, updates stored unit price on the shipment line (admin). */
  newUnitPrice?: number;
  editedBy: string;
  reason?: string;
  /** When true (default), reason is required. Admin UI may pass false. */
  requireReason?: boolean;
}): Promise<EditOutboundLineResult> {
  const clientUserId = input.clientUserId.trim();
  const shipmentRequestId = input.shipmentRequestId.trim();
  const warehouseId = input.warehouseId.trim();
  const lineIndex = Math.floor(input.lineIndex);
  const newBoxQuantity = Math.max(0, Math.floor(input.newBoxQuantity));
  const requireReason = input.requireReason !== false;
  const reason = (input.reason ?? "").trim() || (requireReason ? "" : "Admin correction");

  if (!clientUserId || !shipmentRequestId) throw new Error("Missing client or request.");
  if (!warehouseId) throw new Error("Warehouse is required.");
  if (!input.editedBy.trim()) throw new Error("Sign in required to edit.");
  if (!reason) throw new Error("Edit reason is required.");
  if (lineIndex < 0) throw new Error("Invalid line index.");

  const requestRef = doc(db, `users/${clientUserId}/shipmentRequests`, shipmentRequestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");

  const data = snap.data() as Record<string, unknown>;
  const status = normOutboundStatus(data.status);
  const editableStatuses = new Set([
    "confirmed",
    "pending",
    "awaiting_label",
    "awaiting_label_upload",
  ]);
  if (!editableStatuses.has(status)) {
    throw new Error(
      `Only open outbounds (pending / awaiting label / confirmed) can be corrected (current: ${status || "unknown"}).`
    );
  }
  if (dispatchStatusFromRequest(data) === "dispatched") {
    throw new Error("This order was already dispatched — line edit is not available.");
  }

  const shipments = Array.isArray(data.shipments)
    ? ([...data.shipments] as Array<Record<string, unknown>>)
    : [];
  const shipment = shipments[lineIndex];
  if (!shipment) throw new Error("Shipment line not found.");
  if (Boolean(shipment.warehouseLineRemoved)) {
    throw new Error("This line was already removed from the order.");
  }
  if (shipmentLineIsPrepOnly(shipment)) {
    throw new Error("Prep-only lines cannot be edited at warehouse.");
  }

  const productId = String(shipment.productId ?? "").trim();
  if (!productId) throw new Error("Missing product on shipment line.");

  const productMap = await loadClientProductMap(clientUserId);
  const editable = buildEditableShipmentLines(data, productMap);
  const lineMeta = editable.find((l) => l.lineIndex === lineIndex);
  if (!lineMeta) throw new Error("Could not resolve shipment line.");

  const oldBoxes = lineMeta.boxes;
  const oldPackOf = lineMeta.packOf;
  const oldUnitPrice = lineMeta.unitPrice;
  const newPackOf = Math.max(
    1,
    Math.floor(
      input.newPackOf != null && Number.isFinite(input.newPackOf)
        ? input.newPackOf
        : oldPackOf
    ) || 1
  );
  const priceProvided =
    input.newUnitPrice != null && Number.isFinite(input.newUnitPrice);
  const newUnitPrice = priceProvided
    ? Math.max(0, Number(input.newUnitPrice))
    : oldUnitPrice;
  const priceChanged = priceProvided && Math.abs(newUnitPrice - oldUnitPrice) > 0.0001;
  const oldUnits = shipmentUnits(data, shipment, lineIndex);
  const newUnits = newBoxQuantity * newPackOf;
  const unitDelta = newUnits - oldUnits;

  if (
    unitDelta === 0 &&
    newBoxQuantity === oldBoxes &&
    newPackOf === oldPackOf &&
    !priceChanged
  ) {
    throw new Error("Nothing to update — qty, pack of, and price are unchanged.");
  }

  const sku = lineMeta.sku;

  if (packStatusFromRequest(data) === "ready_to_dispatch") {
    await restoreWarehouseStockForOutboundCancel({
      warehouseId,
      clientUserId,
      shipmentRequestId,
      operatorId: input.editedBy,
    });
    await clearPackStateAfterLineEdit(clientUserId, shipmentRequestId);
  }

  let unitsUnpicked = 0;
  if (unitDelta < 0) {
    const netPicked = await loadNetPickedBySku(warehouseId, shipmentRequestId);
    const pickedForSku = netPicked.get(sku) ?? 0;
    const unitsToUnpick = Math.min(pickedForSku, oldUnits - newUnits);
    if (unitsToUnpick > 0) {
      unitsUnpicked = await reverseWarehousePicksForSkuQuantity({
        warehouseId,
        clientUserId,
        shipmentRequestId,
        sku,
        unitsToUnpick,
        operatorId: input.editedBy,
        reason,
      });
    }
  }

  const lineEditedAt = Timestamp.now();
  const layoutChanged = newBoxQuantity !== oldBoxes || newPackOf !== oldPackOf;
  const layoutBefore = formatOutboundPackLine(oldBoxes, oldPackOf);
  const nextShipments = [...shipments];
  if (newBoxQuantity === 0) {
    nextShipments[lineIndex] = {
      ...shipment,
      quantity: 0,
      warehouseLineRemoved: true,
      warehouseLineEditedAt: lineEditedAt,
      warehouseLineEditedBy: input.editedBy,
      warehouseLineEditReason: reason,
      warehouseLineEditFrom: layoutBefore,
      ...(priceChanged ? { unitPrice: newUnitPrice } : {}),
    };
  } else {
    nextShipments[lineIndex] = {
      ...shipment,
      quantity: newBoxQuantity,
      packOf: newPackOf,
      ...(priceChanged || priceProvided ? { unitPrice: newUnitPrice } : {}),
      warehouseLineEditedAt: lineEditedAt,
      warehouseLineEditedBy: input.editedBy,
      warehouseLineEditReason: reason,
      ...(layoutChanged ? { warehouseLineEditFrom: layoutBefore } : {}),
    };
  }

  await updateDoc(requestRef, {
    shipments: nextShipments,
    updatedAt: serverTimestamp(),
  });

  if (layoutChanged && unitDelta === 0 && newBoxQuantity > 0) {
    await recordOutboundLineLayoutEdit({
      clientUserId,
      shipmentRequestId,
      lineIndex,
      productId,
      boxesBefore: oldBoxes,
      packOfBefore: oldPackOf,
      boxesAfter: newBoxQuantity,
      packOfAfter: newPackOf,
      reason,
    });
  }

  if (hasClientInventoryDeducted(data) && unitDelta !== 0) {
    await adjustClientInventoryForOutboundLineEdit({
      clientUserId,
      shipmentRequestId,
      lineIndex,
      productId,
      unitDelta,
      packOf: newPackOf,
      boxesAfter: newBoxQuantity,
      boxesBefore: oldBoxes,
      packOfBefore: oldPackOf,
      reason,
    });
  }

  const updatedSnap = await getDoc(requestRef);
  const updatedData = updatedSnap.data() as Record<string, unknown>;
  const pickLines = buildOrderLinesFromRequestData(updatedData, productMap);

  await reconcilePickStatusAfterLineEdit({
    warehouseId,
    clientUserId,
    shipmentRequestId,
    lines: pickLines,
    operatorId: input.editedBy,
  });

  let pickSourceHints: OutboundPickSourceHint[] = [];
  if (unitDelta > 0) {
    pickSourceHints = await getPickSourceHintsForSku({
      warehouseId,
      shipmentRequestId,
      sku,
    });
  }

  return {
    pickSourceHints,
    unitsUnpicked,
    removed: newBoxQuantity === 0,
  };
}

/**
 * Admin: append a product line to an open outbound before dispatch.
 * Reserves client stock when the request already has inventory deducted.
 */
export async function addOutboundLineAtWarehouse(input: {
  clientUserId: string;
  shipmentRequestId: string;
  warehouseId: string;
  productId: string;
  boxQuantity: number;
  packOf?: number;
  unitPrice?: number;
  editedBy: string;
  reason?: string;
}): Promise<EditOutboundLineResult> {
  const clientUserId = input.clientUserId.trim();
  const shipmentRequestId = input.shipmentRequestId.trim();
  const warehouseId = input.warehouseId.trim();
  const productId = input.productId.trim();
  const boxQuantity = Math.max(0, Math.floor(input.boxQuantity));
  const packOf = Math.max(1, Math.floor(input.packOf ?? 1) || 1);
  const unitPrice =
    input.unitPrice != null && Number.isFinite(input.unitPrice)
      ? Math.max(0, Number(input.unitPrice))
      : 0;
  const reason = (input.reason ?? "").trim() || "Admin correction — add product";

  if (!clientUserId || !shipmentRequestId) throw new Error("Missing client or request.");
  if (!warehouseId) throw new Error("Warehouse is required.");
  if (!input.editedBy.trim()) throw new Error("Sign in required to edit.");
  if (!productId) throw new Error("Select a product to add.");
  if (boxQuantity < 1) throw new Error("Quantity must be at least 1.");

  const requestRef = doc(db, `users/${clientUserId}/shipmentRequests`, shipmentRequestId);
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Shipment request not found.");

  const data = snap.data() as Record<string, unknown>;
  const status = normOutboundStatus(data.status);
  const editableStatuses = new Set([
    "confirmed",
    "pending",
    "awaiting_label",
    "awaiting_label_upload",
  ]);
  if (!editableStatuses.has(status)) {
    throw new Error(
      `Only open outbounds (pending / awaiting label / confirmed) can be corrected (current: ${status || "unknown"}).`
    );
  }
  if (dispatchStatusFromRequest(data) === "dispatched") {
    throw new Error("This order was already dispatched — line edit is not available.");
  }

  const inventoryRef = doc(db, `users/${clientUserId}/inventory`, productId);
  const inventorySnap = await getDoc(inventoryRef);
  if (!inventorySnap.exists()) throw new Error("Product not found in client inventory.");
  const inv = inventorySnap.data() as Record<string, unknown>;
  const sku = String(inv.sku ?? "").trim() || productId;
  const productName = String(inv.productName ?? sku).trim() || sku;
  const units = boxQuantity * packOf;

  const productMap = await loadClientProductMap(clientUserId);
  const shipments = Array.isArray(data.shipments)
    ? ([...data.shipments] as Array<Record<string, unknown>>)
    : [];

  if (packStatusFromRequest(data) === "ready_to_dispatch") {
    await restoreWarehouseStockForOutboundCancel({
      warehouseId,
      clientUserId,
      shipmentRequestId,
      operatorId: input.editedBy,
    });
    await clearPackStateAfterLineEdit(clientUserId, shipmentRequestId);
  }

  const lineEditedAt = Timestamp.now();
  const lineIndex = shipments.length;
  shipments.push({
    productId,
    quantity: boxQuantity,
    packOf,
    unitPrice,
    sku,
    productName,
    warehouseLineEditedAt: lineEditedAt,
    warehouseLineEditedBy: input.editedBy,
    warehouseLineEditReason: reason,
    warehouseLineAddedByAdmin: true,
  });

  await updateDoc(requestRef, {
    shipments,
    updatedAt: serverTimestamp(),
  });

  if (hasClientInventoryDeducted(data) && units > 0) {
    await adjustClientInventoryForOutboundLineEdit({
      clientUserId,
      shipmentRequestId,
      lineIndex,
      productId,
      unitDelta: units,
      packOf,
      boxesAfter: boxQuantity,
      boxesBefore: 0,
      packOfBefore: packOf,
      reason,
    });
  }

  const updatedSnap = await getDoc(requestRef);
  const updatedData = updatedSnap.data() as Record<string, unknown>;
  const pickLines = buildOrderLinesFromRequestData(updatedData, productMap);

  await reconcilePickStatusAfterLineEdit({
    warehouseId,
    clientUserId,
    shipmentRequestId,
    lines: pickLines,
    operatorId: input.editedBy,
  });

  const pickSourceHints = await getPickSourceHintsForSku({
    warehouseId,
    shipmentRequestId,
    sku,
  });

  return {
    pickSourceHints,
    unitsUnpicked: 0,
    removed: false,
  };
}
