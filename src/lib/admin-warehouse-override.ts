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
import type { ShopifyInventoryPushHint } from "@/lib/client-inventory-inbound-sync";
import {
  findBinByPath,
  inspectBinContents,
  validateLineToArea,
  validateLineToBin,
} from "@/lib/warehouse-putaway";
import {
  fallbackAreas,
  listWarehouseAreas,
} from "@/lib/warehouse-putaway-disposition";
import { formatExpiryForInput } from "@/lib/warehouse-inbound-requests";
import { disposeQuarantineLine, listQuarantineHolds, releaseQuarantineLineToStorage } from "@/lib/warehouse-quarantine";
import type {
  InventoryRequest,
  UserProfile,
  WarehouseCartonDoc,
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
  };
}

/** Admin: list all quarantine holds across a warehouse. */
export async function adminListQuarantine(warehouseId: string) {
  return listQuarantineHolds(warehouseId);
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
