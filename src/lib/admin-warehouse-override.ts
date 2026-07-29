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
  /** Area code for putaway (e.g. storage zone). Required when not using a bin. */
  stagingArea?: string | null;
  /** Searchable bin destination; area is used only when the zone has no bins. */
  binPath?: string | null;
  quantity?: number;
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

  const qty = Math.min(
    remaining,
    Math.max(1, Math.floor(input.quantity ?? remaining))
  );
  const sku = String((request as InventoryRequest & { sku?: string }).sku ?? "").trim();
  if (!sku) throw new Error("Request is missing SKU.");

  const areas = await listWarehouseAreas(input.warehouseId);
  const eligible = fallbackAreas(areas);
  const requestedBinPath = input.binPath?.trim() || "";
  const destinationBin = requestedBinPath
    ? await findBinByPath(input.warehouseId, requestedBinPath)
    : null;
  if (requestedBinPath && !destinationBin) {
    throw new Error("Selected putaway bin was not found.");
  }
  const stagingArea =
    destinationBin?.area?.trim() ||
    input.stagingArea?.trim() ||
    eligible.find((a) => a.code.trim())?.code.trim() ||
    "";
  if (!stagingArea) {
    throw new Error("Select a putaway bin or storage area.");
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
      : Math.min(qty, Math.max(1, Math.floor(input.packageCount ?? 1)));
  const baseQty = Math.floor(qty / packageCount);
  const extraQty = qty % packageCount;
  const validationLine = {
    lineId: "L1",
    sku,
    productTitle: request.productName?.trim() || null,
    quantity: Math.max(1, baseQty + (extraQty > 0 ? 1 : 0)),
    lot: input.lot?.trim() || null,
    expiry,
    condition: "good" as const,
    binId: null,
    allocationStatus: "allocated" as const,
    clientId: input.clientUserId,
    inventoryRequestId: input.requestId,
  };
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
    if (!destinationArea) throw new Error("Selected putaway area was not found.");
    const validation = validateLineToArea(validationLine, destinationArea);
    if (!validation.ok) throw new Error(validation.reason);
  }
  const cartons = Array.from({ length: packageCount }, (_, index) => ({
    copies: 1,
    clientId: input.clientUserId,
    clientDisplayName: input.clientDisplayName ?? null,
    inventoryRequestId: input.requestId,
    trackingNumber: input.trackingNumber?.trim() || null,
    carrier: input.carrier?.trim() || null,
    notes: input.notes?.trim() || null,
    lines: [
      {
        sku,
        productTitle: request.productName?.trim() || null,
        quantity: baseQty + (index < extraQty ? 1 : 0),
        lot: input.lot?.trim() || null,
        expiry,
        inventoryRequestId: input.requestId,
        clientId: input.clientUserId,
      },
    ],
  }));

  const { palletId, cartonIds } = await createReceiveBatch({
    warehouseId: input.warehouseId,
    receivedBy: input.operatorId ?? null,
    stagingArea,
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
        quantity: carton.lines?.[0]?.quantity ?? carton.quantity,
      })),
    operatorId: input.operatorId ?? null,
  });

  for (const carton of receivedCartons) {
    const line = carton.lines?.[0];
    if (!line?.lineId) throw new Error(`Received carton ${carton.cartonCode} has no line.`);
    await applyPutawayAssignments(
      input.warehouseId,
      carton.id,
      carton,
      [
        destinationBin
          ? {
              lineId: line.lineId,
              binId: destinationBin.id,
              binPath: destinationBin.path,
              quantity: line.quantity,
            }
          : { lineId: line.lineId, stagingArea, quantity: line.quantity },
      ],
      { operatorId: input.operatorId ?? null, warehouseAreas: areas }
    );
  }

  let receivedPallet: WarehousePalletDoc | null = null;
  if (palletId) {
    await updateDoc(warehousePalletDocRef(input.warehouseId, palletId), {
      status: "available",
      stagingArea,
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

  return {
    cartonIds,
    cartonCodes: putawayCartons.map((carton) => carton.cartonCode),
    palletId,
    palletCode: receivedPallet?.palletCode ?? null,
    quantityReceived: qty,
    stagingArea,
    putawayDestination: destinationBin?.path || stagingArea,
    cartons: putawayCartons,
    pallets: receivedPallet ? [receivedPallet] : [],
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
