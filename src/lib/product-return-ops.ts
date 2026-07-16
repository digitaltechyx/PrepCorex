/**
 * Shared product-return lifecycle for Admin + Warehouse Ops.
 * Mirrors admin Product Returns: approve/reject, receive, ship, close+invoice,
 * walk-in (known user), and closed walk-in (unknown → Allocate).
 */
import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";
import { format } from "date-fns";
import { db } from "@/lib/firebase";
import { applyClientInvoiceLifecycleFields } from "@/lib/client-invoice-lifecycle";
import { generateInvoicePDF } from "@/lib/invoice-generator";
import {
  CROSSDOCK_CLOSED_SKU,
  buildClosedCrossdockLine,
  generateCrossdockReceiveLot,
} from "@/lib/warehouse-crossdock";
import {
  createWarehouseCarton,
  createWarehousePallet,
  warehouseCartonDocRef,
  warehousePalletDocRef,
} from "@/lib/warehouse-carton-firestore";
import { receiveReturnAtDock } from "@/lib/warehouse-returns";
import type { ProductReturn, UserProfile, WarehouseCartonDoc } from "@/types";

export const RETURN_WALK_IN_MARKER = "[RETURN_WALK_IN]";

export type ProductReturnDoc = ProductReturn & {
  id: string;
  ownerUserId: string;
  receivingLog?: Array<Record<string, unknown>>;
  shippingLog?: Array<Record<string, unknown>>;
  shippedQuantity?: number;
  inventoryCreditedQuantity?: number;
  pricing?: Record<string, unknown>;
  invoiceId?: string;
  invoiceNumber?: string;
  closedBy?: string;
  source?: string;
};

export function resolveReturnSku(item: Pick<ProductReturn, "sku" | "newProductSku">): string {
  return String(item.sku ?? item.newProductSku ?? "").trim();
}

export function resolveReturnProductName(
  item: Pick<ProductReturn, "productName" | "newProductName">
): string {
  return String(item.productName ?? item.newProductName ?? "Unknown Product").trim();
}

export function formatReturnShipToAddress(
  additionalServices?: Record<string, unknown> | null
): string {
  const shippingAddress = additionalServices?.shippingAddress as
    | { address?: string; city?: string; state?: string; zipCode?: string; country?: string }
    | undefined;
  if (!shippingAddress) return "";
  return `${shippingAddress.address || ""}, ${shippingAddress.city || ""} ${shippingAddress.state || ""} ${shippingAddress.zipCode || ""}, ${shippingAddress.country || ""}`
    .replace(/\s+/g, " ")
    .replace(/^,\s*|,\s*$/g, "")
    .trim();
}

function buildInventoryCreatePayload(input: {
  productName: string;
  quantity: number;
  now: Timestamp;
  returnSummary: string;
  sku: string;
  remarksImageUrls?: string[];
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    productName: input.productName,
    quantity: input.quantity,
    dateAdded: input.now,
    receivingDate: input.now,
    status: "In Stock",
    inventoryType: "product",
    remarks: input.returnSummary,
    createdAt: input.now,
    updatedAt: input.now,
  };
  if (input.sku) payload.sku = input.sku;
  if (input.remarksImageUrls && input.remarksImageUrls.length > 0) {
    payload.remarksImageUrls = input.remarksImageUrls;
  }
  return payload;
}

function mergeRemarksImageUrls(existing: unknown, incoming: string[]): string[] {
  const prev = Array.isArray(existing)
    ? existing.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  return [...new Set([...prev, ...incoming.map((u) => u.trim()).filter(Boolean)])];
}

export async function approveProductReturn(input: {
  ownerUserId: string;
  returnId: string;
  operatorId: string;
}): Promise<void> {
  const returnRef = doc(db, `users/${input.ownerUserId}/productReturns`, input.returnId);
  const now = Timestamp.now();
  const snap = await getDoc(returnRef);
  if (!snap.exists()) throw new Error("Return request not found.");
  const data = snap.data() as ProductReturn;
  if (data.status !== "pending") throw new Error("Only pending returns can be approved.");

  await updateDoc(returnRef, {
    status: "approved",
    approvedAt: now,
    approvedBy: input.operatorId,
    updatedAt: now,
    ...(Array.isArray((data as ProductReturnDoc).receivingLog)
      ? {}
      : { receivingLog: [] }),
  });
}

export async function rejectProductReturn(input: {
  ownerUserId: string;
  returnId: string;
  reason: string;
}): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Rejection reason is required.");
  const returnRef = doc(db, `users/${input.ownerUserId}/productReturns`, input.returnId);
  const now = Timestamp.now();
  const snap = await getDoc(returnRef);
  if (!snap.exists()) throw new Error("Return request not found.");
  if ((snap.data() as ProductReturn).status !== "pending") {
    throw new Error("Only pending returns can be rejected.");
  }
  await updateDoc(returnRef, {
    status: "cancelled",
    adminRemarks: reason,
    rejectReason: reason,
    updatedAt: now,
  });
}

/** Record received units on the RMA (admin-style qty update) without creating a warehouse carton. */
export async function recordReturnQuantityReceived(input: {
  ownerUserId: string;
  returnId: string;
  quantity: number;
  operatorId: string;
  notes?: string | null;
}): Promise<{ receivedQuantity: number }> {
  const qty = Math.floor(input.quantity);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  const returnRef = doc(db, `users/${input.ownerUserId}/productReturns`, input.returnId);
  const snap = await getDoc(returnRef);
  if (!snap.exists()) throw new Error("Return request not found.");
  const data = snap.data() as ProductReturnDoc;
  if (data.status !== "approved" && data.status !== "in_progress") {
    throw new Error("Return must be approved or in progress.");
  }
  const now = Timestamp.now();
  const current = Math.max(0, Math.floor(data.receivedQuantity ?? 0));
  const next = current + qty;
  const log = Array.isArray(data.receivingLog) ? [...data.receivingLog] : [];
  const entry: Record<string, unknown> = {
    quantity: qty,
    receivedAt: now,
    receivedBy: input.operatorId,
  };
  if (input.notes?.trim()) entry.notes = input.notes.trim();

  await updateDoc(returnRef, {
    receivedQuantity: next,
    receivingLog: [...log, entry],
    status: data.status === "approved" ? "in_progress" : data.status,
    updatedAt: now,
  });
  return { receivedQuantity: next };
}

/**
 * Dock receive into quarantine carton + bump receivedQuantity (warehouse physical receive).
 */
export async function receiveReturnWithCarton(input: {
  warehouseId: string;
  ownerUserId: string;
  productReturnId: string;
  sku: string;
  productTitle?: string | null;
  quantity: number;
  condition?: "good" | "damaged";
  unitType?: import("@/lib/warehouse-returns").ReturnReceiveUnitType;
  lot?: string | null;
  expiry?: string | null;
  trackingNumber?: string | null;
  notes?: string | null;
  photoUrls?: string[] | null;
  stagingArea?: string | null;
  receivedBy?: string | null;
  operatorId?: string | null;
  closeAfter?: boolean;
}): Promise<{
  cartonId: string;
  cartonCode: string;
  receiveLot: string;
  palletId: string | null;
  palletCode: string | null;
}> {
  const result = await receiveReturnAtDock({
    warehouseId: input.warehouseId,
    clientUserId: input.ownerUserId,
    productReturnId: input.productReturnId,
    sku: input.sku,
    productTitle: input.productTitle,
    quantity: input.quantity,
    condition: input.condition,
    unitType: input.unitType,
    lot: input.lot,
    expiry: input.expiry,
    trackingNumber: input.trackingNumber,
    notes: input.notes,
    photoUrls: input.photoUrls,
    stagingArea: input.stagingArea,
    receivedBy: input.receivedBy,
    operatorId: input.operatorId,
  });

  if (input.closeAfter) {
    const returnRef = doc(
      db,
      `users/${input.ownerUserId}/productReturns`,
      input.productReturnId
    );
    await updateDoc(returnRef, {
      fulfillmentStatus: "ready_to_close",
      updatedAt: Timestamp.now(),
    });
  }

  return result;
}

export async function createWalkInReturnWithUser(input: {
  ownerUserId: string;
  type: "existing" | "new";
  returnType?: "combine" | "partial";
  productId?: string | null;
  productName?: string | null;
  sku?: string | null;
  newProductName?: string | null;
  newProductSku?: string | null;
  requestedQuantity: number;
  userRemarks?: string | null;
  expiryDate?: string | null;
  operatorId: string;
}): Promise<{ returnId: string }> {
  const qty = Math.floor(input.requestedQuantity);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  if (input.type === "existing") {
    if (!input.productName?.trim() && !input.sku?.trim()) {
      throw new Error("Existing return needs a product name or SKU.");
    }
  } else if (!input.newProductName?.trim()) {
    throw new Error("New product name is required.");
  }

  const now = Timestamp.now();
  const payload: Record<string, unknown> = {
    type: input.type,
    returnType: input.returnType ?? "partial",
    requestedQuantity: qty,
    receivedQuantity: 0,
    shippedQuantity: 0,
    status: "approved",
    source: "warehouse_ops_walk_in",
    receivingLog: [],
    shippingLog: [],
    createdAt: now,
    updatedAt: now,
    approvedAt: now,
    approvedBy: input.operatorId,
    userRemarks: input.userRemarks?.trim() || "Walk-in return (warehouse ops)",
  };
  if (input.type === "existing") {
    if (input.productId) payload.productId = input.productId;
    if (input.productName?.trim()) payload.productName = input.productName.trim();
    if (input.sku?.trim()) payload.sku = input.sku.trim();
  } else {
    payload.newProductName = input.newProductName!.trim();
    if (input.newProductSku?.trim()) payload.newProductSku = input.newProductSku.trim();
  }
  const expiry = input.expiryDate?.trim().slice(0, 10);
  if (expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    payload.expiryDate = expiry;
  }

  const ref = await addDoc(collection(db, `users/${input.ownerUserId}/productReturns`), payload);
  return { returnId: ref.id };
}

/** Closed unit, no client uid — return walk-in (not inbound). Link client later, then open at putaway. */
export async function receiveReturnWalkInUnknownUser(input: {
  warehouseId: string;
  /** Label / shipper name (same role as inbound closed “client name”). */
  displayName: string;
  quantity?: number;
  unitType?: "carton" | "pallet" | "package";
  receiveLot?: string | null;
  notes?: string | null;
  photoUrls?: string[];
  receivedBy?: string | null;
  operatorId?: string | null;
  stagingArea?: string | null;
}): Promise<{
  cartonId: string;
  cartonCode: string;
  receiveLot: string;
  palletId: string | null;
  palletCode: string | null;
}> {
  const name = input.displayName.trim();
  if (!name) throw new Error("Enter a name for this return (shipper / label name).");

  const qty = Math.max(1, Math.floor(input.quantity ?? 1));
  const unitType = input.unitType ?? "carton";
  const receiveLot = input.receiveLot?.trim() || generateCrossdockReceiveLot();
  const staging = input.stagingArea?.trim() || "RETURNS-STAGE";
  const noteParts = [RETURN_WALK_IN_MARKER, `Name: ${name}`, input.notes?.trim()].filter(
    Boolean
  );
  const title = `Closed return — ${name}`;

  let palletId: string | null = null;
  let palletCode: string | null = null;
  if (unitType === "pallet") {
    palletId = await createWarehousePallet({
      warehouseId: input.warehouseId,
      status: "receiving",
      receiveMode: "crossdock",
      isClosedCrossdock: true,
      isReturnReceive: true,
      clientId: null,
      receivedForClient: name,
      receiveLot,
      notes: noteParts.join(" "),
      receivedBy: input.receivedBy ?? null,
      stagingArea: staging,
      photoUrl: input.photoUrls?.[0] ?? null,
    });
    const palletSnap = await getDoc(warehousePalletDocRef(input.warehouseId, palletId));
    palletCode = palletSnap.exists()
      ? String((palletSnap.data() as { palletCode?: string }).palletCode ?? palletId)
      : palletId;
  }

  const line = buildClosedCrossdockLine({
    lot: receiveLot,
    clientDisplayName: name,
  });
  line.quantity = qty;
  line.productTitle = title;
  // Dock stage on carton root only — line staging would block putaway.
  line.stagingArea = null;

  const cartonId = await createWarehouseCarton({
    warehouseId: input.warehouseId,
    sku: CROSSDOCK_CLOSED_SKU,
    quantity: qty,
    productTitle: title,
    status: "received",
    clientId: null,
    receivedForClient: name,
    palletId,
    lines: [line],
    isLoose: false,
    isPackage: unitType === "package",
    receiveMode: "crossdock",
    isClosedCrossdock: true,
    isReturnReceive: true,
    notes: noteParts.join(" "),
    photoUrls: input.photoUrls,
    receivedBy: input.receivedBy ?? null,
    stagingArea: staging,
    receiveLot,
  });

  const snap = await getDoc(warehouseCartonDocRef(input.warehouseId, cartonId));
  const cartonCode = snap.exists()
    ? String((snap.data() as { cartonCode?: string }).cartonCode ?? cartonId)
    : cartonId;

  const eventsRef = collection(db, "warehouses", input.warehouseId, "movementEvents");
  await addDoc(eventsRef, {
    type: "return_walk_in_unknown",
    cartonId,
    cartonCode,
    palletId,
    palletCode,
    receiveLot,
    displayName: name,
    unitType,
    isReturnReceive: true,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  return { cartonId, cartonCode, receiveLot, palletId, palletCode };
}

export function isReturnWalkInCarton(carton: WarehouseCartonDoc): boolean {
  if (carton.isReturnReceive === true) return true;
  if (carton.productReturnId?.trim()) return true;
  const notes = String(carton.notes ?? "");
  if (notes.includes(RETURN_WALK_IN_MARKER)) return true;
  const title = String(carton.productTitle ?? "");
  if (/^Closed return\b/i.test(title)) return true;
  return false;
}

export function isReturnWalkInPallet(pallet: {
  isReturnReceive?: boolean;
  notes?: string | null;
}): boolean {
  if (pallet.isReturnReceive === true) return true;
  return String(pallet.notes ?? "").includes(RETURN_WALK_IN_MARKER);
}

/**
 * After Allocate / Link finds the client: create RMA + link carton for return putaway.
 */
export async function startReturnFromAllocatedWalkIn(input: {
  warehouseId: string;
  cartonId: string;
  clientUserId: string;
  type: "existing" | "new";
  productId?: string | null;
  productName?: string | null;
  sku?: string | null;
  newProductName?: string | null;
  newProductSku?: string | null;
  requestedQuantity?: number;
  operatorId: string;
}): Promise<{ returnId: string }> {
  const cartonRef = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const cartonSnap = await getDoc(cartonRef);
  if (!cartonSnap.exists()) throw new Error("Carton not found.");
  const carton = { id: cartonSnap.id, ...(cartonSnap.data() as object) } as WarehouseCartonDoc;
  if (!isReturnWalkInCarton(carton) && !carton.clientId && !input.clientUserId) {
    throw new Error("Not a return walk-in carton.");
  }

  const qty =
    Math.floor(input.requestedQuantity ?? carton.quantity ?? 1) || carton.quantity || 1;
  const { returnId } = await createWalkInReturnWithUser({
    ownerUserId: input.clientUserId,
    type: input.type,
    productId: input.productId,
    productName: input.productName || carton.productTitle,
    sku: input.sku,
    newProductName: input.newProductName || carton.productTitle,
    newProductSku: input.newProductSku,
    requestedQuantity: qty,
    userRemarks: `Started from walk-in carton ${carton.cartonCode}`,
    operatorId: input.operatorId,
  });

  const returnRef = doc(db, `users/${input.clientUserId}/productReturns`, returnId);
  const now = Timestamp.now();
  await updateDoc(returnRef, {
    receivedQuantity: qty,
    status: "in_progress",
    updatedAt: now,
    receivingLog: [
      {
        quantity: qty,
        receivedAt: now,
        receivedBy: input.operatorId,
        notes: `Walk-in carton ${carton.cartonCode}`,
      },
    ],
  });

  const nextLines = (carton.lines ?? []).map((l) => ({
    ...l,
    clientId: input.clientUserId,
    productReturnId: returnId,
    allocationStatus: "allocated" as const,
    stagingArea: l.stagingArea === "RETURNS-STAGE" || l.stagingArea === "RCV-STAGE" ? null : l.stagingArea,
  }));

  const batch = writeBatch(db);
  batch.update(cartonRef, {
    clientId: input.clientUserId,
    productReturnId: returnId,
    isReturnReceive: true,
    status: "received",
    ...(nextLines.length > 0
      ? {
          lines: nextLines.map((l) => ({
            lineId: l.lineId,
            sku: l.sku,
            productTitle: l.productTitle ?? null,
            quantity: l.quantity,
            lot: l.lot ?? null,
            expiry: l.expiry ?? null,
            condition: l.condition,
            binId: l.binId ?? null,
            stagingArea: l.stagingArea ?? null,
            allocationStatus: l.allocationStatus ?? "allocated",
            clientId: l.clientId ?? null,
            inventoryRequestId: l.inventoryRequestId ?? null,
            productReturnId: l.productReturnId ?? null,
          })),
        }
      : {}),
    updatedAt: serverTimestamp(),
  });
  batch.set(doc(collection(db, "warehouses", input.warehouseId, "movementEvents")), {
    type: "return_walk_in_linked",
    cartonId: input.cartonId,
    cartonCode: carton.cartonCode,
    productReturnId: returnId,
    clientUserId: input.clientUserId,
    isReturnReceive: true,
    operatorId: input.operatorId,
    at: serverTimestamp(),
  });
  await batch.commit();

  return { returnId };
}

export type ShipReturnInput = {
  ownerUserId: string;
  returnId: string;
  quantity: number;
  shipTo: string;
  notes?: string | null;
  operatorId: string;
  client: UserProfile | null | undefined;
  shippingUnitPrice?: number;
  shippingTotal?: number;
  generateInvoice?: boolean;
  writeShippedOrder?: boolean;
};

export async function shipReturnQuantity(input: ShipReturnInput): Promise<{
  shippedQuantity: number;
  invoiceNumber?: string;
}> {
  const quantity = Math.floor(input.quantity);
  if (quantity < 1) throw new Error("Ship quantity must be at least 1.");
  if (!input.shipTo.trim()) throw new Error("Ship-to destination is required.");

  const returnRef = doc(db, `users/${input.ownerUserId}/productReturns`, input.returnId);
  const snap = await getDoc(returnRef);
  if (!snap.exists()) throw new Error("Return request not found.");
  const data = snap.data() as ProductReturnDoc;
  const received = Math.max(0, Math.floor(data.receivedQuantity ?? 0));
  const shipped = Math.max(0, Math.floor(data.shippedQuantity ?? 0));
  const available = received - shipped;
  if (quantity > available) {
    throw new Error(`Only ${available} unit(s) available to ship.`);
  }

  const now = Timestamp.now();
  const today = new Date();
  const newShipped = shipped + quantity;
  const currentLog = Array.isArray(data.shippingLog) ? [...data.shippingLog] : [];
  const productName = resolveReturnProductName(data);
  const sku = resolveReturnSku(data);
  const unitPrice = input.shippingUnitPrice ?? 0;
  const shippingCost =
    input.shippingTotal ?? (unitPrice > 0 ? unitPrice * quantity : 0);

  let invoiceNumber: string | undefined;
  let invoiceId: string | undefined;

  await runTransaction(db, async (transaction) => {
    const entry: Record<string, unknown> = {
      quantity,
      shippedAt: now,
      shippedBy: input.operatorId,
      shipTo: input.shipTo.trim(),
    };
    if (input.notes?.trim()) entry.notes = input.notes.trim();
    if (unitPrice > 0) entry.shippingUnitPrice = unitPrice;
    if (shippingCost > 0) entry.shippingTotal = shippingCost;

    if (input.generateInvoice && shippingCost >= 0) {
      invoiceNumber = `INV-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-8)}`;
      const orderNumber = `ORD-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-4)}`;
      const invoiceItems = [
        {
          quantity,
          productName: `${productName} (Return Shipment)`,
          sku,
          shipDate: format(today, "dd/MM/yyyy"),
          packaging: "N/A",
          shipTo: input.shipTo.trim(),
          unitPrice: quantity > 0 ? shippingCost / quantity : unitPrice,
          amount: shippingCost,
        },
      ];
      const invoiceData = applyClientInvoiceLifecycleFields({
        invoiceNumber,
        date: format(today, "dd/MM/yyyy"),
        orderNumber,
        soldTo: {
          name: input.client?.name ?? "Unknown User",
          email: input.client?.email ?? "",
          phone: input.client?.phone ?? "",
          address: input.client?.address ?? "",
        },
        fbm: "Product Return Shipment",
        items: invoiceItems,
        subtotal: shippingCost,
        grandTotal: shippingCost,
        status: "pending" as const,
        createdAt: new Date(),
        userId: input.ownerUserId,
        type: "product_return_shipment",
        returnRequestId: input.returnId,
      });
      const invoiceRef = doc(collection(db, `users/${input.ownerUserId}/invoices`));
      transaction.set(invoiceRef, invoiceData);
      invoiceId = invoiceRef.id;
      entry.invoiceId = invoiceId;
      entry.invoiceNumber = invoiceNumber;
    }

    transaction.update(returnRef, {
      shippingLog: [...currentLog, entry],
      shippedQuantity: newShipped,
      updatedAt: now,
    });

    if (input.writeShippedOrder !== false) {
      const shippedRef = doc(collection(db, `users/${input.ownerUserId}/shipped`));
      transaction.set(shippedRef, {
        productName,
        date: Timestamp.fromDate(today),
        createdAt: now,
        shippedQty: quantity,
        boxesShipped: 1,
        unitsForPricing: quantity,
        remainingQty: 0,
        packOf: 1,
        unitPrice: quantity > 0 ? shippingCost / quantity : unitPrice,
        shipTo: input.shipTo.trim(),
        service: "Product Return Shipment",
        productType: "Standard",
        remarks: `Product Return - Request ID: ${input.returnId}`,
        items: [
          {
            productId: data.productId || "",
            productName,
            boxesShipped: 1,
            shippedQty: quantity,
            packOf: 1,
            unitPrice: quantity > 0 ? shippingCost / quantity : unitPrice,
            remainingQty: 0,
          },
        ],
        totalBoxes: 1,
        totalUnits: quantity,
        totalSkus: 1,
        returnRequestId: input.returnId,
        source: "warehouse_ops_return_ship",
      });
    }
  });

  if (input.generateInvoice && invoiceNumber) {
    const shippingCostPdf = shippingCost;
    await generateInvoicePDF({
      invoiceNumber,
      date: format(today, "dd/MM/yyyy"),
      orderNumber: `ORD-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-4)}`,
      soldTo: {
        name: input.client?.name || "Unknown User",
        email: input.client?.email || "",
        phone: input.client?.phone || "",
        address: input.client?.address || "",
      },
      fbm: "Product Return Shipment",
      items: [
        {
          quantity,
          productName: `${productName} (Return Shipment)`,
          shipDate: format(today, "dd/MM/yyyy"),
          packaging: "N/A",
          shipTo: input.shipTo.trim(),
          unitPrice: quantity > 0 ? shippingCostPdf / quantity : unitPrice,
          amount: shippingCostPdf,
        },
      ],
      subtotal: shippingCostPdf,
      grandTotal: shippingCostPdf,
      status: "pending" as const,
      type: "product_return_shipment",
    });
  }

  return { shippedQuantity: newShipped, invoiceNumber };
}

/**
 * Credit client inventory for returned units that were put away (not shipped).
 * Idempotent via inventoryCreditedQuantity on the return doc.
 */
export async function creditReturnInventory(input: {
  ownerUserId: string;
  returnId: string;
  quantity: number;
  operatorId?: string | null;
  summaryNote?: string | null;
  /** Photos from this putaway's receive carton — merge into inventory remarks images. */
  photoUrls?: string[] | null;
}): Promise<void> {
  const qty = Math.floor(input.quantity);
  if (qty < 1) return;

  const returnRef = doc(db, `users/${input.ownerUserId}/productReturns`, input.returnId);
  await runTransaction(db, async (transaction) => {
    const snap = await transaction.get(returnRef);
    if (!snap.exists()) throw new Error("Return request not found.");
    const data = snap.data() as ProductReturnDoc;
    const received = Math.max(0, Math.floor(data.receivedQuantity ?? 0));
    const shipped = Math.max(0, Math.floor(data.shippedQuantity ?? 0));
    const credited = Math.max(0, Math.floor(data.inventoryCreditedQuantity ?? 0));
    const maxCreditable = Math.max(0, received - shipped - credited);
    const toCredit = Math.min(qty, maxCreditable);
    if (toCredit < 1) return;

    // Credit invento ry: prefer existing product; otherwise create inventory row
    const now = Timestamp.now();
    const productName = resolveReturnProductName(data);
    const sku = resolveReturnSku(data);
    const summary =
      input.summaryNote?.trim() ||
      `[Return putaway] ID: ${input.returnId} | +${toCredit} | By: ${input.operatorId || "ops"}`;

    const incomingPhotos = [
      ...new Set((input.photoUrls ?? []).map((u) => String(u || "").trim()).filter(Boolean)),
    ];
    // Also include all photos stored on the return across partial receives (in case carton missed some).
    const returnStoredPhotos = Array.isArray((data as { receivePhotoUrls?: unknown }).receivePhotoUrls)
      ? ((data as { receivePhotoUrls: unknown[] }).receivePhotoUrls as unknown[])
          .map((u) => String(u || "").trim())
          .filter(Boolean)
      : [];
    const allPhotos = [...new Set([...incomingPhotos, ...returnStoredPhotos])];

    const returnPatch: Record<string, unknown> = {
      inventoryCreditedQuantity: credited + toCredit,
      updatedAt: now,
    };

    if (data.type === "existing" && data.productId) {
      const invRef = doc(db, `users/${input.ownerUserId}/inventory`, data.productId);
      const invSnap = await transaction.get(invRef);
      if (invSnap.exists()) {
        const current = invSnap.data();
        const existingRemarks = String(current.remarks || "").trim();
        const invPatch: Record<string, unknown> = {
          quantity: (current.quantity || 0) + toCredit,
          status: "In Stock",
          remarks: existingRemarks ? `${existingRemarks}\n\n${summary}` : summary,
          updatedAt: now,
        };
        if (allPhotos.length > 0) {
          invPatch.remarksImageUrls = mergeRemarksImageUrls(
            current.remarksImageUrls,
            allPhotos
          );
        }
        transaction.update(invRef, invPatch);
      } else {
        transaction.set(
          invRef,
          buildInventoryCreatePayload({
            productName,
            quantity: toCredit,
            now,
            returnSummary: summary,
            sku,
            remarksImageUrls: allPhotos,
          })
        );
      }
    } else {
      const newInv = doc(collection(db, `users/${input.ownerUserId}/inventory`));
      transaction.set(
        newInv,
        buildInventoryCreatePayload({
          productName,
          quantity: toCredit,
          now,
          returnSummary: summary,
          sku,
          remarksImageUrls: allPhotos,
        })
      );
      returnPatch.productId = newInv.id;
      returnPatch.type = "existing";
      returnPatch.productName = productName;
      if (sku) returnPatch.sku = sku;
    }

    transaction.update(returnRef, returnPatch);
  });
}

export type CloseReturnInvoiceInput = {
  ownerUserId: string;
  returnId: string;
  operatorId: string;
  client: UserProfile | null | undefined;
  returnFee: number;
  packingFee?: number;
  boxQuantity?: number;
  palletFee?: number;
  palletQuantity?: number;
  shippingUnitPrice?: number;
  generateInvoice: boolean;
  /** When ship-to was requested on the original RMA, ship remaining on close. */
  shipRemainingOnClose?: boolean;
};

export async function closeProductReturnWithInvoice(
  input: CloseReturnInvoiceInput
): Promise<{ invoiceNumber?: string }> {
  if (isNaN(input.returnFee) || input.returnFee < 0) {
    throw new Error("Enter a valid return handling fee.");
  }

  const returnRef = doc(db, `users/${input.ownerUserId}/productReturns`, input.returnId);
  const snap = await getDoc(returnRef);
  if (!snap.exists()) throw new Error("Return request not found.");
  const selected = { ...(snap.data() as ProductReturnDoc), id: snap.id };
  if (selected.status === "closed") throw new Error("Return is already closed.");
  if ((selected.receivedQuantity || 0) <= 0) {
    throw new Error("Cannot close with zero received quantity.");
  }

  const now = Timestamp.now();
  const today = new Date();
  const shippedQtyCurrent = selected.shippedQuantity || 0;
  const remainingToShip = Math.max(0, selected.receivedQuantity - shippedQtyCurrent);
  const packingFeeNum = input.packingFee || 0;
  const palletFeeNum = input.palletFee || 0;
  const shippingUnitPriceNum = input.shippingUnitPrice || 0;
  const shouldShip =
    input.shipRemainingOnClose ?? !!selected.additionalServices?.shipToAddress;
  const shippingFeeNum = shouldShip ? remainingToShip * shippingUnitPriceNum : 0;
  const returnHandlingTotal = input.returnFee * selected.receivedQuantity;
  const grandTotal = returnHandlingTotal + packingFeeNum + palletFeeNum + shippingFeeNum;
  const shipToAddress = formatReturnShipToAddress(selected.additionalServices);

  const pricing: Record<string, unknown> = {
    returnFee: input.returnFee,
    total: grandTotal,
  };
  if (packingFeeNum > 0) pricing.packingFee = packingFeeNum;
  if (palletFeeNum > 0) pricing.palletFee = palletFeeNum;
  if (shippingFeeNum > 0) pricing.shippingFee = shippingFeeNum;

  let invoiceNumber: string | undefined;

  await runTransaction(db, async (transaction) => {
    const returnSnap = await transaction.get(returnRef);
    const latest = returnSnap.exists()
      ? ({ ...(returnSnap.data() as ProductReturnDoc), id: returnSnap.id } as ProductReturnDoc)
      : selected;
    const productName = resolveReturnProductName(latest);
    const sku = resolveReturnSku(latest);
    const shippedQty = latest.shippedQuantity || 0;
    const remainingQuantity = Math.max(0, latest.receivedQuantity - shippedQty);
    const credited = Math.max(0, Math.floor(latest.inventoryCreditedQuantity ?? 0));
    const willShipRemaining = shouldShip && remainingQuantity > 0;
    const stillToCredit = Math.max(0, remainingQuantity - credited);

    let inventoryDoc: Awaited<ReturnType<typeof transaction.get>> | null = null;
    let inventoryRef: ReturnType<typeof doc> | null = null;
    if (!willShipRemaining && stillToCredit > 0 && latest.type === "existing" && latest.productId) {
      inventoryRef = doc(db, `users/${input.ownerUserId}/inventory`, latest.productId);
      inventoryDoc = await transaction.get(inventoryRef);
    }

    const returnUpdate: Record<string, unknown> = {
      status: "closed",
      closedAt: now,
      closedBy: input.operatorId,
      pricing,
      updatedAt: now,
      fulfillmentStatus: "closed",
    };

    if (willShipRemaining) {
      const currentShippingLog = latest.shippingLog || [];
      returnUpdate.shippingLog = [
        ...currentShippingLog,
        {
          quantity: remainingQuantity,
          shippedAt: now,
          shippedBy: input.operatorId,
          notes: "Shipped remaining items on close",
          shippingUnitPrice: shippingUnitPriceNum,
          shippingTotal: shippingFeeNum,
        },
      ];
      returnUpdate.shippedQuantity = shippedQty + remainingQuantity;
    }

    transaction.update(returnRef, returnUpdate);

    // Credit any remaining inventory not yet credited via putaway
    if (!willShipRemaining && stillToCredit > 0) {
      const summary = `[Return Completed] ID: ${input.returnId} | Added: ${stillToCredit}`;
      if (latest.type === "existing" && latest.productId && inventoryRef && inventoryDoc) {
        if (inventoryDoc.exists()) {
          const currentData = inventoryDoc.data() as { quantity?: number; remarks?: string };
          const existingRemarks = (currentData.remarks || "").trim();
          transaction.update(inventoryRef, {
            quantity: (currentData.quantity || 0) + stillToCredit,
            status: "In Stock",
            remarks: existingRemarks ? `${existingRemarks}\n\n${summary}` : summary,
            updatedAt: now,
          });
        } else {
          transaction.set(
            inventoryRef,
            buildInventoryCreatePayload({
              productName,
              quantity: stillToCredit,
              now,
              returnSummary: summary,
              sku,
            })
          );
        }
      } else {
        const newInv = doc(collection(db, `users/${input.ownerUserId}/inventory`));
        transaction.set(
          newInv,
          buildInventoryCreatePayload({
            productName,
            quantity: stillToCredit,
            now,
            returnSummary: summary,
            sku,
          })
        );
      }
      transaction.update(returnRef, {
        inventoryCreditedQuantity: credited + stillToCredit,
      });
    }

    if (input.generateInvoice) {
      invoiceNumber = `INV-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-8)}`;
      const orderNumber = `ORD-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-4)}`;
      const invoiceItems: Array<Record<string, unknown>> = [
        {
          quantity: latest.receivedQuantity,
          productName: `${productName} (Return Handling)`,
          sku,
          shipDate: format(today, "dd/MM/yyyy"),
          packaging: "N/A",
          shipTo: shipToAddress,
          unitPrice: input.returnFee,
          amount: returnHandlingTotal,
        },
      ];
      if (packingFeeNum > 0) {
        const boxQty = input.boxQuantity || 1;
        invoiceItems.push({
          quantity: boxQty,
          productName: "Packing Service",
          shipDate: format(today, "dd/MM/yyyy"),
          packaging: "N/A",
          shipTo: "",
          unitPrice: boxQty > 0 ? packingFeeNum / boxQty : packingFeeNum,
          amount: packingFeeNum,
        });
      }
      if (palletFeeNum > 0) {
        const palletQty = input.palletQuantity || 1;
        invoiceItems.push({
          quantity: palletQty,
          productName: "Palletizing Service",
          shipDate: format(today, "dd/MM/yyyy"),
          packaging: "N/A",
          shipTo: "",
          unitPrice: palletQty > 0 ? palletFeeNum / palletQty : palletFeeNum,
          amount: palletFeeNum,
        });
      }
      if (shippingFeeNum > 0) {
        invoiceItems.push({
          quantity: remainingQuantity,
          productName: `${productName} (Return Shipment)`,
          sku,
          shipDate: format(today, "dd/MM/yyyy"),
          packaging: "N/A",
          shipTo: shipToAddress,
          unitPrice: shippingUnitPriceNum,
          amount: shippingFeeNum,
        });
      }

      const invoiceData = applyClientInvoiceLifecycleFields({
        invoiceNumber,
        date: format(today, "dd/MM/yyyy"),
        orderNumber,
        soldTo: {
          name: input.client?.name ?? "Unknown User",
          email: input.client?.email ?? "",
          phone: input.client?.phone ?? "",
          address: input.client?.address ?? "",
        },
        fbm: "Product Return",
        items: invoiceItems,
        subtotal: grandTotal,
        grandTotal,
        status: "pending" as const,
        createdAt: new Date(),
        userId: input.ownerUserId,
        type: "product_return",
        returnRequestId: input.returnId,
      });
      const invoiceRef = doc(collection(db, `users/${input.ownerUserId}/invoices`));
      transaction.set(invoiceRef, invoiceData);
      transaction.update(returnRef, {
        invoiceId: invoiceRef.id,
        invoiceNumber,
      });
    }

    if (willShipRemaining) {
      const shippedRef = doc(collection(db, `users/${input.ownerUserId}/shipped`));
      transaction.set(shippedRef, {
        productName,
        date: Timestamp.fromDate(today),
        createdAt: now,
        shippedQty: remainingQuantity,
        boxesShipped: (selected.additionalServices?.boxesCount as number) || 1,
        unitsForPricing: remainingQuantity,
        remainingQty: 0,
        packOf: 1,
        unitPrice: shippingUnitPriceNum,
        shipTo: shipToAddress,
        service: "Product Return Shipment",
        productType: "Standard",
        remarks: `Product Return - Request ID: ${input.returnId}`,
        items: [
          {
            productId: latest.productId || "",
            productName,
            boxesShipped: (selected.additionalServices?.boxesCount as number) || 1,
            shippedQty: remainingQuantity,
            packOf: 1,
            unitPrice: shippingUnitPriceNum,
            remainingQty: 0,
          },
        ],
        totalBoxes: (selected.additionalServices?.boxesCount as number) || 1,
        totalUnits: remainingQuantity,
        totalSkus: 1,
        returnRequestId: input.returnId,
      });
    }
  });

  if (input.generateInvoice && invoiceNumber) {
    const productName = resolveReturnProductName(selected);
    const boxQty = input.boxQuantity || 1;
    const palletQty = input.palletQuantity || 1;
    const invoiceItems: Array<{
      quantity: number;
      productName: string;
      shipDate: string;
      packaging: string;
      shipTo: string;
      unitPrice: number;
      amount: number;
    }> = [
      {
        quantity: selected.receivedQuantity,
        productName: `${productName} (Return Handling)`,
        shipDate: format(today, "dd/MM/yyyy"),
        packaging: "N/A",
        shipTo: shipToAddress,
        unitPrice: input.returnFee,
        amount: returnHandlingTotal,
      },
    ];
    if (packingFeeNum > 0) {
      invoiceItems.push({
        quantity: boxQty,
        productName: "Packing Service",
        shipDate: format(today, "dd/MM/yyyy"),
        packaging: "N/A",
        shipTo: "",
        unitPrice: boxQty > 0 ? packingFeeNum / boxQty : packingFeeNum,
        amount: packingFeeNum,
      });
    }
    if (palletFeeNum > 0) {
      invoiceItems.push({
        quantity: palletQty,
        productName: "Palletizing Service",
        shipDate: format(today, "dd/MM/yyyy"),
        packaging: "N/A",
        shipTo: "",
        unitPrice: palletQty > 0 ? palletFeeNum / palletQty : palletFeeNum,
        amount: palletFeeNum,
      });
    }
    if (shippingFeeNum > 0) {
      invoiceItems.push({
        quantity: remainingToShip,
        productName: `${productName} (Return Shipment)`,
        shipDate: format(today, "dd/MM/yyyy"),
        packaging: "N/A",
        shipTo: shipToAddress,
        unitPrice: shippingUnitPriceNum,
        amount: shippingFeeNum,
      });
    }
    await generateInvoicePDF({
      invoiceNumber,
      date: format(today, "dd/MM/yyyy"),
      orderNumber: `ORD-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-4)}`,
      soldTo: {
        name: input.client?.name || "Unknown User",
        email: input.client?.email || "",
        phone: input.client?.phone || "",
        address: input.client?.address || "",
      },
      fbm: "Product Return",
      items: invoiceItems,
      subtotal: grandTotal,
      grandTotal,
      status: "pending" as const,
      type: "product_return",
    });
  }

  return { invoiceNumber };
}
