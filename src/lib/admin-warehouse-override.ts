import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { hasRole } from "@/lib/permissions";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";
import {
  createReceiveBatch,
  parseWarehouseCartonDoc,
  parseWarehousePalletDoc,
  warehouseCartonDocRef,
  warehousePalletDocRef,
} from "@/lib/warehouse-carton-firestore";
import { recordInboundReceiveBatch } from "@/lib/warehouse-inbound-receive";
import { applyPutawayAssignments } from "@/lib/warehouse-putaway";
import type {
  ShopifyInventoryPushHint,
  EbayInventoryPushHint,
} from "@/lib/client-inventory-inbound-sync";
import {
  binsEligibleForPutawayLine,
  findBinByPath,
  inspectBinContents,
  validateLineToArea,
  validateLineToBin,
} from "@/lib/warehouse-putaway";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import {
  fallbackAreas,
  listWarehouseAreas,
} from "@/lib/warehouse-putaway-disposition";
import { formatExpiryForInput } from "@/lib/warehouse-inbound-requests";
import { disposeQuarantineLine, listQuarantineHolds, releaseQuarantineLineToStorage } from "@/lib/warehouse-quarantine";
import { isFbaLabelWorkflowRequest } from "@/lib/fba-shipment-workflow";
import { orderLinesForRequests } from "@/lib/warehouse-outbound-lines";
import {
  dispatchStatusFromRequest,
  packStatusFromRequest,
  pickStatusFromRequest,
} from "@/lib/warehouse-outbound-request-status";
import {
  applyPickStep,
  buildPickPlan,
  markPickOrderStatus,
  type OutboundPickOrder,
} from "@/lib/warehouse-pick";
import {
  buildPackPlan,
  completeDispatchHandoff,
  completePackReadyToDispatch,
  markPackItemVerified,
  type OutboundPackOrder,
} from "@/lib/warehouse-pack";
import type {
  InventoryRequest,
  ShipmentRequest,
  UserProfile,
  WarehouseCartonDoc,
  WarehouseDoc,
  WarehousePalletDoc,
} from "@/types";

export type { QuarantineHoldRow } from "@/lib/warehouse-quarantine";

/** Admin and sub_admin can run warehouse floor actions from the admin dashboard. */
export function hasAdminWarehouseOverride(
  userProfile: UserProfile | null | undefined
): boolean {
  if (!userProfile) return false;
  if (hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin")) return true;
  return hasWarehouseOpsAccess(userProfile);
}

function expectedRequestQty(req: InventoryRequest): number {
  if (typeof req.receivedQuantity === "number" && req.receivedQuantity > 0) {
    return req.receivedQuantity;
  }
  if (typeof req.requestedQuantity === "number" && req.requestedQuantity > 0) {
    return req.requestedQuantity;
  }
  return Math.max(0, req.quantity ?? 0);
}

function remainingInboundQty(req: InventoryRequest): number {
  const expected = expectedRequestQty(req);
  const received = Math.max(0, Number(req.warehouseGoodReceivedQty ?? 0));
  return Math.max(0, expected - received);
}

export type AdminInboundCompleteInput = {
  clientUserId: string;
  requestId: string;
  warehouseId: string;
  /** Area code for good putaway (e.g. storage zone). Required when not using a bin. */
  stagingArea?: string | null;
  /** Good storage bin path; area is used only when the zone has no bins. */
  binPath?: string | null;
  /** Area code for damaged → quarantine putaway when not using a bin. */
  damagedStagingArea?: string | null;
  /** Damaged quarantine bin path. */
  damagedBinPath?: string | null;
  /** Good units to receive (sellable). */
  quantity?: number;
  /** Damaged units to receive → quarantine. */
  damagedQuantity?: number;
  unitType?: "loose" | "carton" | "pallet";
  packageCount?: number;
  lot?: string | null;
  expiry?: string | null;
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  operatorId?: string | null;
  clientDisplayName?: string | null;
};

export type AdminInboundCompleteResult = {
  cartonIds: string[];
  cartonCodes: string[];
  palletId: string | null;
  palletCode: string | null;
  quantityReceived: number;
  stagingArea: string;
  putawayDestination: string;
  cartons: WarehouseCartonDoc[];
  pallets: WarehousePalletDoc[];
  shopifyPushHints: ShopifyInventoryPushHint[];
  ebayPushHints: EbayInventoryPushHint[];
};

/**
 * Admin override: receive approved inbound product stock and putaway in one step.
 * Mirrors warehouse receive → putaway → client inventory sync.
 */
export async function adminCompleteInboundReceiveAndPutaway(
  input: AdminInboundCompleteInput
): Promise<AdminInboundCompleteResult> {
  const requestRef = doc(
    db,
    `users/${input.clientUserId}/inventoryRequests`,
    input.requestId
  );
  const snap = await getDoc(requestRef);
  if (!snap.exists()) throw new Error("Inbound request not found.");

  const request = { id: snap.id, ...snap.data() } as InventoryRequest;
  const status = String(request.status ?? "").trim().toLowerCase();
  if (status !== "approved") {
    throw new Error("Only approved requests can be received.");
  }
  if (request.inventoryType !== "product") {
    throw new Error("Admin receive override applies to product inbound only.");
  }
  if (String(request.fulfillmentStatus ?? "").trim().toLowerCase() !== "open") {
    throw new Error(
      "Only Warehouse Ops open inbounds can be received here. Legacy admin-fulfilled requests stay out of this flow."
    );
  }

  const remaining = remainingInboundQty(request);
  if (remaining <= 0) {
    throw new Error("Nothing left to receive on this request.");
  }

  const goodQty =
    input.quantity == null
      ? remaining
      : Math.max(0, Math.floor(input.quantity));
  const damagedQty = Math.max(0, Math.floor(input.damagedQuantity ?? 0));
  if (goodQty + damagedQty < 1) {
    throw new Error("Enter at least 1 good or damaged unit.");
  }
  const qty = goodQty;
  const sku = String((request as InventoryRequest & { sku?: string }).sku ?? "").trim();
  if (!sku) throw new Error("Request is missing SKU.");

  const areas = await listWarehouseAreas(input.warehouseId);
  const eligible = fallbackAreas(areas);

  const requestedBinPath = input.binPath?.trim() || "";
  const destinationBin = requestedBinPath
    ? await findBinByPath(input.warehouseId, requestedBinPath)
    : null;
  if (requestedBinPath && !destinationBin) {
    throw new Error("Selected storage bin was not found.");
  }
  const stagingArea =
    destinationBin?.area?.trim() ||
    input.stagingArea?.trim() ||
    (qty > 0 ? eligible.find((a) => a.code.trim())?.code.trim() || "" : "");

  const requestedDamagedBinPath = input.damagedBinPath?.trim() || "";
  const damagedDestinationBin = requestedDamagedBinPath
    ? await findBinByPath(input.warehouseId, requestedDamagedBinPath)
    : null;
  if (requestedDamagedBinPath && !damagedDestinationBin) {
    throw new Error("Selected quarantine bin was not found.");
  }
  const damagedStagingArea =
    damagedDestinationBin?.area?.trim() ||
    input.damagedStagingArea?.trim() ||
    "";

  if (qty > 0 && !destinationBin && !stagingArea) {
    throw new Error("Select a storage bin or area for good stock.");
  }
  if (damagedQty > 0 && !damagedDestinationBin && !damagedStagingArea) {
    throw new Error("Select a quarantine bin or area for damaged stock.");
  }

  const expiryRaw = (request as InventoryRequest & { expiryDate?: unknown }).expiryDate;
  const expiry =
    input.expiry?.trim() ||
    (expiryRaw != null && expiryRaw !== ""
      ? formatExpiryForInput(expiryRaw as Parameters<typeof formatExpiryForInput>[0])
      : null);
  const unitType = input.unitType ?? "loose";
  const packageCount =
    unitType === "loose"
      ? 1
      : qty > 0
        ? Math.min(qty, Math.max(1, Math.floor(input.packageCount ?? 1)))
        : 1;
  const baseQty = qty > 0 ? Math.floor(qty / packageCount) : 0;
  const extraQty = qty > 0 ? qty % packageCount : 0;

  const buildValidationLine = (
    condition: "good" | "damaged",
    quantity: number
  ) => ({
    lineId: condition === "good" ? "L1" : "L2",
    sku,
    productTitle: request.productName?.trim() || null,
    quantity: Math.max(1, quantity),
    lot: input.lot?.trim() || null,
    expiry,
    condition,
    binId: null,
    allocationStatus: "allocated" as const,
    clientId: input.clientUserId,
    inventoryRequestId: input.requestId,
  });

  if (qty > 0) {
    const validationLine = buildValidationLine(
      "good",
      Math.max(1, baseQty + (extraQty > 0 ? 1 : 0))
    );
    if (destinationBin) {
      const contents = await inspectBinContents(input.warehouseId, destinationBin.id);
      const validation = validateLineToBin(
        validationLine,
        destinationBin,
        contents,
        areas
      );
      if (!validation.ok) throw new Error(validation.reason);
    } else {
      const destinationArea = areas.find(
        (area) => area.code.trim().toUpperCase() === stagingArea.toUpperCase()
      );
      if (!destinationArea) throw new Error("Selected storage area was not found.");
      const validation = validateLineToArea(validationLine, destinationArea);
      if (!validation.ok) throw new Error(validation.reason);
    }
  }

  if (damagedQty > 0) {
    const validationLine = buildValidationLine("damaged", damagedQty);
    if (damagedDestinationBin) {
      const contents = await inspectBinContents(
        input.warehouseId,
        damagedDestinationBin.id
      );
      const validation = validateLineToBin(
        validationLine,
        damagedDestinationBin,
        contents,
        areas
      );
      if (!validation.ok) throw new Error(validation.reason);
    } else {
      const destinationArea = areas.find(
        (area) =>
          area.code.trim().toUpperCase() === damagedStagingArea.toUpperCase()
      );
      if (!destinationArea) throw new Error("Selected quarantine area was not found.");
      const validation = validateLineToArea(validationLine, destinationArea);
      if (!validation.ok) throw new Error(validation.reason);
    }
  }

  const cartons = Array.from({ length: packageCount }, (_, index) => {
    const lines: Array<{
      sku: string;
      productTitle: string | null;
      quantity: number;
      lot: string | null;
      expiry: string | null;
      damaged?: boolean;
      inventoryRequestId: string;
      clientId: string;
    }> = [];
    const goodForCarton = qty > 0 ? baseQty + (index < extraQty ? 1 : 0) : 0;
    if (goodForCarton > 0) {
      lines.push({
        sku,
        productTitle: request.productName?.trim() || null,
        quantity: goodForCarton,
        lot: input.lot?.trim() || null,
        expiry,
        damaged: false,
        inventoryRequestId: input.requestId,
        clientId: input.clientUserId,
      });
    }
    if (index === 0 && damagedQty > 0) {
      lines.push({
        sku,
        productTitle: request.productName?.trim() || null,
        quantity: damagedQty,
        lot: input.lot?.trim() || null,
        expiry,
        damaged: true,
        inventoryRequestId: input.requestId,
        clientId: input.clientUserId,
      });
    }
    return {
      copies: 1,
      clientId: input.clientUserId,
      clientDisplayName: input.clientDisplayName ?? null,
      inventoryRequestId: input.requestId,
      trackingNumber: input.trackingNumber?.trim() || null,
      carrier: input.carrier?.trim() || null,
      notes: input.notes?.trim() || null,
      lines,
    };
  });

  const receiveStagingArea =
    stagingArea || damagedStagingArea || eligible.find((a) => a.code.trim())?.code.trim() || "";

  const { palletId, cartonIds } = await createReceiveBatch({
    warehouseId: input.warehouseId,
    receivedBy: input.operatorId ?? null,
    stagingArea: receiveStagingArea,
    isLoose: unitType === "loose",
    pallet:
      unitType === "pallet"
        ? {
            trackingNumber: input.trackingNumber?.trim() || null,
            carrier: input.carrier?.trim() || null,
            notes: input.notes?.trim() || null,
          }
        : undefined,
    cartons,
  });

  if (cartonIds.length === 0) throw new Error("Receive failed — no carton created.");

  const receivedCartons = (
    await Promise.all(
      cartonIds.map(async (cartonId) => {
        const cartonSnap = await getDoc(
          warehouseCartonDocRef(input.warehouseId, cartonId)
        );
        if (!cartonSnap.exists()) return null;
        return parseWarehouseCartonDoc(
          cartonSnap.id,
          cartonSnap.data() as Record<string, unknown>
        );
      })
    )
  ).filter((carton): carton is WarehouseCartonDoc => carton !== null);
  if (receivedCartons.length !== cartonIds.length) {
    throw new Error("One or more received cartons could not be loaded.");
  }

  await recordInboundReceiveBatch({
    warehouseId: input.warehouseId,
    entries: receivedCartons.map((carton) => ({
        clientUserId: input.clientUserId,
        inventoryRequestId: input.requestId,
        productName: request.productName ?? null,
        cartonId: carton.id,
        cartonCode: carton.cartonCode,
        sku,
        quantity:
          carton.lines?.reduce((sum, line) => sum + Math.max(0, line.quantity), 0) ||
          carton.quantity,
      })),
    operatorId: input.operatorId ?? null,
  });

  const shopifyPushHints: ShopifyInventoryPushHint[] = [];
  const ebayPushHints: EbayInventoryPushHint[] = [];
  for (const carton of receivedCartons) {
    const lines = carton.lines ?? [];
    if (lines.length === 0) {
      throw new Error(`Received carton ${carton.cartonCode} has no lines.`);
    }
    const assignments = lines.map((line) => {
      if (!line.lineId) {
        throw new Error(`Received carton ${carton.cartonCode} has a line without id.`);
      }
      const isDamaged = line.condition === "damaged";
      if (isDamaged) {
        return damagedDestinationBin
          ? {
              lineId: line.lineId,
              binId: damagedDestinationBin.id,
              binPath: damagedDestinationBin.path,
              quantity: line.quantity,
            }
          : {
              lineId: line.lineId,
              stagingArea: damagedStagingArea,
              quantity: line.quantity,
            };
      }
      return destinationBin
        ? {
            lineId: line.lineId,
            binId: destinationBin.id,
            binPath: destinationBin.path,
            quantity: line.quantity,
          }
        : { lineId: line.lineId, stagingArea, quantity: line.quantity };
    });
    const putResult = await applyPutawayAssignments(
      input.warehouseId,
      carton.id,
      carton,
      assignments,
      { operatorId: input.operatorId ?? null, warehouseAreas: areas }
    );
    shopifyPushHints.push(...(putResult.shopifyPushHints ?? []));
    ebayPushHints.push(...(putResult.ebayPushHints ?? []));
  }

  let receivedPallet: WarehousePalletDoc | null = null;
  if (palletId) {
    await updateDoc(warehousePalletDocRef(input.warehouseId, palletId), {
      status: "available",
      stagingArea: receiveStagingArea,
      updatedAt: serverTimestamp(),
    });
    const palletSnap = await getDoc(
      warehousePalletDocRef(input.warehouseId, palletId)
    );
    if (palletSnap.exists()) {
      receivedPallet = parseWarehousePalletDoc(
        palletSnap.id,
        palletSnap.data() as Record<string, unknown>
      );
    }
  }

  const putawayCartons = (
    await Promise.all(
      cartonIds.map(async (cartonId) => {
        const cartonSnap = await getDoc(
          warehouseCartonDocRef(input.warehouseId, cartonId)
        );
        return cartonSnap.exists()
          ? parseWarehouseCartonDoc(
              cartonSnap.id,
              cartonSnap.data() as Record<string, unknown>
            )
          : null;
      })
    )
  ).filter((carton): carton is WarehouseCartonDoc => carton !== null);

  await updateDoc(requestRef, {
    warehouseProcessedVia: "admin_dashboard",
    warehouseProcessedBy: input.operatorId ?? null,
    warehouseProcessedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const goodDest = qty > 0 ? destinationBin?.path || stagingArea : "";
  const damagedDest =
    damagedQty > 0 ? damagedDestinationBin?.path || damagedStagingArea : "";
  const putawayDestination = [goodDest, damagedDest].filter(Boolean).join(" · ");

  return {
    cartonIds,
    cartonCodes: putawayCartons.map((carton) => carton.cartonCode),
    palletId,
    palletCode: receivedPallet?.palletCode ?? null,
    quantityReceived: qty + damagedQty,
    stagingArea: receiveStagingArea,
    putawayDestination,
    cartons: putawayCartons,
    pallets: receivedPallet ? [receivedPallet] : [],
    shopifyPushHints,
    ebayPushHints,
  };
}

/** Admin: list all quarantine holds across a warehouse. */
export async function adminListQuarantine(warehouseId: string) {
  return listQuarantineHolds(warehouseId);
}

export type AdminBatchReceiveItem = {
  clientUserId: string;
  requestId: string;
  clientDisplayName?: string | null;
};

export type AdminBatchReceiveSharedInput = Omit<
  AdminInboundCompleteInput,
  "clientUserId" | "requestId" | "quantity" | "damagedQuantity" | "clientDisplayName"
>;

type BatchPutawayContext = {
  areas: Awaited<ReturnType<typeof listWarehouseAreas>>;
  bins: Awaited<ReturnType<typeof listActiveWarehouseBins>>;
  binBySku: Map<string, string>;
};

async function resolveBatchItemPutawayDestination(input: {
  warehouseId: string;
  sku: string;
  productTitle: string | null;
  preferredBinPath?: string | null;
  preferredStagingArea?: string | null;
  ctx: BatchPutawayContext;
}): Promise<{ binPath: string | null; stagingArea: string | null }> {
  const { areas, bins, binBySku } = input.ctx;
  const sku = input.sku.trim();
  const validationLine = {
    lineId: "BATCH",
    sku,
    productTitle: input.productTitle,
    quantity: 1,
    lot: null,
    expiry: null,
    condition: "good" as const,
    binId: null,
    allocationStatus: "allocated" as const,
    clientId: null,
    inventoryRequestId: null,
  };

  const cachedBinPath = binBySku.get(sku);
  if (cachedBinPath) {
    return {
      binPath: cachedBinPath,
      stagingArea:
        bins.find((b) => b.path === cachedBinPath)?.area?.trim() ||
        input.preferredStagingArea?.trim() ||
        null,
    };
  }

  const tryBinPath = async (binPath: string): Promise<boolean> => {
    const bin = await findBinByPath(input.warehouseId, binPath);
    if (!bin) return false;
    const contents = await inspectBinContents(input.warehouseId, bin.id);
    const validation = validateLineToBin(validationLine, bin, contents, areas);
    if (!validation.ok) return false;
    binBySku.set(sku, bin.path);
    return true;
  };

  const preferredBinPath = input.preferredBinPath?.trim() || "";
  if (preferredBinPath && (await tryBinPath(preferredBinPath))) {
    const bin = bins.find((b) => b.path === preferredBinPath);
    return {
      binPath: preferredBinPath,
      stagingArea: bin?.area?.trim() || input.preferredStagingArea?.trim() || null,
    };
  }

  for (const bin of binsEligibleForPutawayLine(areas, bins, validationLine)) {
    if (await tryBinPath(bin.path)) {
      return {
        binPath: bin.path,
        stagingArea: bin.area?.trim() || input.preferredStagingArea?.trim() || null,
      };
    }
  }

  const stagingArea =
    input.preferredStagingArea?.trim() ||
    fallbackAreas(areas).find((a) => a.code.trim())?.code.trim() ||
    "";
  if (!stagingArea) {
    throw new Error(`No compatible bin or storage area found for SKU ${sku}.`);
  }
  const destinationArea = areas.find(
    (area) => area.code.trim().toUpperCase() === stagingArea.toUpperCase()
  );
  if (!destinationArea) {
    throw new Error(`Storage area ${stagingArea} was not found for SKU ${sku}.`);
  }
  const areaValidation = validateLineToArea(validationLine, destinationArea);
  if (!areaValidation.ok) {
    throw new Error(areaValidation.reason);
  }
  return { binPath: null, stagingArea };
}

/** Receive multiple open inbound requests with shared warehouse/putaway settings (full remaining qty each). */
export async function adminBatchReceiveInboundRequests(input: {
  items: AdminBatchReceiveItem[];
  shared: AdminBatchReceiveSharedInput;
}): Promise<{
  results: AdminInboundCompleteResult[];
  errors: Array<{ requestId: string; error: string }>;
}> {
  const results: AdminInboundCompleteResult[] = [];
  const errors: Array<{ requestId: string; error: string }> = [];
  const areas = await listWarehouseAreas(input.shared.warehouseId);
  const bins = await listActiveWarehouseBins(input.shared.warehouseId);
  const ctx: BatchPutawayContext = { areas, bins, binBySku: new Map() };

  for (const item of input.items) {
    try {
      const requestRef = doc(
        db,
        `users/${item.clientUserId}/inventoryRequests`,
        item.requestId
      );
      const snap = await getDoc(requestRef);
      if (!snap.exists()) {
        errors.push({ requestId: item.requestId, error: "Request not found." });
        continue;
      }
      const request = { id: snap.id, ...snap.data() } as InventoryRequest;
      const remaining = remainingInboundQty(request);
      if (remaining <= 0) {
        errors.push({ requestId: item.requestId, error: "Nothing left to receive." });
        continue;
      }
      const sku = String((request as InventoryRequest & { sku?: string }).sku ?? "").trim();
      if (!sku) {
        errors.push({ requestId: item.requestId, error: "Request is missing SKU." });
        continue;
      }

      const destination = await resolveBatchItemPutawayDestination({
        warehouseId: input.shared.warehouseId,
        sku,
        productTitle: request.productName?.trim() || null,
        preferredBinPath: input.shared.binPath,
        preferredStagingArea: input.shared.stagingArea,
        ctx,
      });

      const result = await adminCompleteInboundReceiveAndPutaway({
        ...input.shared,
        stagingArea: destination.stagingArea,
        binPath: destination.binPath,
        clientUserId: item.clientUserId,
        requestId: item.requestId,
        clientDisplayName: item.clientDisplayName ?? null,
        quantity: remaining,
        damagedQuantity: 0,
      });
      results.push(result);
    } catch (e) {
      errors.push({
        requestId: item.requestId,
        error: e instanceof Error ? e.message : "Receive failed.",
      });
    }
  }

  return { results, errors };
}

export type AdminOutboundBinAssessment = {
  hasFullBinStock: boolean;
  pickStepCount: number;
  shortfalls: Array<{ sku: string; productName: string; needed: number; planned: number }>;
};

async function loadOutboundPickOrder(input: {
  clientUserId: string;
  shipmentRequestId: string;
}): Promise<{ order: OutboundPickOrder; data: Record<string, unknown> }> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const data = snap.data() as Record<string, unknown>;
  const [lines] = await orderLinesForRequests([{ clientUserId: input.clientUserId, data }]);
  if (!lines?.length) throw new Error("Order has no pick lines.");
  return {
    data,
    order: {
      id: input.shipmentRequestId,
      clientUserId: input.clientUserId,
      clientDisplayName: "",
      warehousePickStatus: pickStatusFromRequest(data),
      lines,
      confirmedAt: null,
    },
  };
}

function assertAdminOutboundEligible(data: Record<string, unknown>): void {
  if (String(data.status ?? "").trim().toLowerCase() !== "confirmed") {
    throw new Error("Only confirmed orders can be fulfilled.");
  }
  if (dispatchStatusFromRequest(data) === "dispatched") {
    throw new Error("Order was already dispatched.");
  }
  if (data.crossdockFulfillment === true || String(data.crossdockLinkedUnitId ?? "").trim()) {
    throw new Error("Cross-dock orders must be fulfilled in Warehouse Ops.");
  }
  if (isFbaLabelWorkflowRequest(data)) {
    throw new Error("FBA label workflow orders must be fulfilled in Warehouse Ops.");
  }
}

/** Check whether warehouse bins can cover this order (vs client inventory only). */
export async function assessAdminOutboundBinStock(input: {
  warehouse: WarehouseDoc;
  clientUserId: string;
  shipmentRequestId: string;
}): Promise<AdminOutboundBinAssessment> {
  const { order, data } = await loadOutboundPickOrder(input);
  assertAdminOutboundEligible(data);
  const plan = await buildPickPlan(input.warehouse, order);
  const shortfalls = plan.shortfalls.map((s) => ({
    sku: s.sku,
    productName: s.productName,
    needed: s.needed,
    planned: s.planned,
  }));
  return {
    hasFullBinStock: shortfalls.length === 0 && plan.steps.length > 0,
    pickStepCount: plan.steps.length,
    shortfalls,
  };
}

/** Auto-run all pick steps and pack verify (no tracking) — admin one-click pick & pack. */
export async function adminAutoPickAndPackOutbound(input: {
  warehouse: WarehouseDoc;
  clientUserId: string;
  shipmentRequestId: string;
  operatorId?: string | null;
}): Promise<void> {
  const { order, data } = await loadOutboundPickOrder(input);
  assertAdminOutboundEligible(data);

  const pickStatus = pickStatusFromRequest(data);
  const packStatus = packStatusFromRequest(data);
  if (packStatus === "ready_to_dispatch") return;

  if (pickStatus !== "picked" && pickStatus !== "skipped") {
    const pickPlan = await buildPickPlan(input.warehouse, order);
    if (pickPlan.shortfalls.length > 0) {
      throw new Error(
        "Not enough bin stock — use Ship from client inventory or receive stock into bins first."
      );
    }
    if (pickPlan.steps.length === 0) {
      throw new Error("No pick steps found — use Ship from client inventory.");
    }

    for (const step of pickPlan.steps) {
      await applyPickStep({
        warehouseId: input.warehouse.id,
        clientUserId: input.clientUserId,
        shipmentRequestId: input.shipmentRequestId,
        step,
        scannedBinId: step.binId,
        scannedCartonId: step.cartonId,
        pickQty: step.quantity,
        operatorId: input.operatorId,
      });
    }

    await markPickOrderStatus({
      clientUserId: input.clientUserId,
      shipmentRequestId: input.shipmentRequestId,
      warehouseId: input.warehouse.id,
      status: "picked",
      operatorId: input.operatorId,
    });
  }

  const packOrder: OutboundPackOrder = {
    id: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    clientDisplayName: "",
    warehousePickStatus: "picked",
    warehousePackStatus: packStatusFromRequest(data),
    lines: order.lines,
    confirmedAt: null,
  };
  const packPlan = await buildPackPlan(input.warehouse, packOrder);
  if (packPlan.items.length === 0) {
    throw new Error("No picked stock to pack — use Ship from client inventory.");
  }
  for (const item of packPlan.items) {
    await markPackItemVerified({
      clientUserId: input.clientUserId,
      shipmentRequestId: input.shipmentRequestId,
      itemKey: item.itemKey,
      warehouseId: input.warehouse.id,
      operatorId: input.operatorId,
    });
  }

  await completePackReadyToDispatch({
    warehouseId: input.warehouse.id,
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    operatorId: input.operatorId,
    deferCourierTracking: true,
  });
}

/**
 * Mark order ready to dispatch using client inventory only (no warehouse bin pick/pack).
 * Use when sellable inventory exists but bins have no stock.
 */
export async function adminShipOutboundFromInventoryOnly(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  operatorId?: string | null;
}): Promise<void> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const data = snap.data() as Record<string, unknown>;
  assertAdminOutboundEligible(data);
  if (packStatusFromRequest(data) === "ready_to_dispatch") return;

  await updateDoc(ref, {
    warehousePickStatus: "picked",
    warehouseAdminInventoryOnlyFulfillment: true,
    warehousePickedAt: serverTimestamp(),
    warehousePickedBy: input.operatorId ?? null,
    warehousePackStatus: "ready_to_dispatch",
    warehouseDispatchStatus: "ready",
    warehouseReadyToDispatchAt: serverTimestamp(),
    warehousePackedBy: input.operatorId ?? null,
    warehouseId: input.warehouseId,
    updatedAt: serverTimestamp(),
  });
}

/** Dispatch with tracking scan (courier label can be first bound here for admin fast-path). */
export async function adminDispatchOutboundWithTracking(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  trackingNumber: string;
  operatorId?: string | null;
}) {
  const snap = await getDoc(
    doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId)
  );
  if (!snap.exists()) throw new Error("Shipment request not found.");
  const data = snap.data() as Record<string, unknown>;
  assertAdminOutboundEligible(data);
  if (packStatusFromRequest(data) !== "ready_to_dispatch") {
    throw new Error("Complete pick & pack (or ship from inventory) before dispatch.");
  }

  const hadTracking = Boolean(
    String(data.warehouseCourierTracking ?? "").trim() ||
      String(data.trackingNumber ?? "").trim()
  );

  return completeDispatchHandoff({
    warehouseId: input.warehouseId,
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    scannedValue: input.trackingNumber.trim(),
    qcUnitType: "package",
    operatorId: input.operatorId,
    setTrackingAtDispatch: !hadTracking,
  });
}

/** Admin: release quarantine stock back to good (damaged → good). */
export async function adminReleaseQuarantine(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  destBinPath: string;
  quantity?: number;
  operatorId?: string | null;
}) {
  return releaseQuarantineLineToStorage(input);
}

/** Admin: dispose quarantine stock (write to recycledInventory). */
export async function adminDisposeQuarantine(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  quantity?: number;
  operatorId?: string | null;
  operatorName?: string | null;
}) {
  return disposeQuarantineLine(input);
}
