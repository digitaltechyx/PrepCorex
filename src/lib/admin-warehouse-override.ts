import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { hasRole } from "@/lib/permissions";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";
import {
  createReceiveBatch,
  parseWarehouseCartonDoc,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import { recordInboundReceiveBatch } from "@/lib/warehouse-inbound-receive";
import { applyPutawayAssignments } from "@/lib/warehouse-putaway";
import {
  fallbackAreas,
  listWarehouseAreas,
} from "@/lib/warehouse-putaway-disposition";
import { formatExpiryForInput } from "@/lib/warehouse-inbound-requests";
import { disposeQuarantineLine, listQuarantineHolds, releaseQuarantineLineToStorage } from "@/lib/warehouse-quarantine";
import type { InventoryRequest, UserProfile } from "@/types";

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
  quantity?: number;
  operatorId?: string | null;
  clientDisplayName?: string | null;
};

export type AdminInboundCompleteResult = {
  cartonId: string;
  cartonCode: string;
  quantityReceived: number;
  stagingArea: string;
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
  if (String(request.fulfillmentStatus ?? "").toLowerCase() === "closed") {
    throw new Error("This inbound request is already closed.");
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
  const stagingArea =
    input.stagingArea?.trim() ||
    eligible.find((a) => a.code.trim())?.code.trim() ||
    "";
  if (!stagingArea) {
    throw new Error("No warehouse area configured. Add an area in Warehouses setup.");
  }

  const expiryRaw = (request as InventoryRequest & { expiryDate?: unknown }).expiryDate;
  const expiry =
    expiryRaw != null && expiryRaw !== ""
      ? formatExpiryForInput(expiryRaw as Parameters<typeof formatExpiryForInput>[0])
      : null;

  const { cartonIds } = await createReceiveBatch({
    warehouseId: input.warehouseId,
    receivedBy: input.operatorId ?? null,
    stagingArea,
    isLoose: true,
    cartons: [
      {
        copies: 1,
        clientId: input.clientUserId,
        clientDisplayName: input.clientDisplayName ?? null,
        inventoryRequestId: input.requestId,
        lines: [
          {
            sku,
            productTitle: request.productName?.trim() || null,
            quantity: qty,
            expiry,
            inventoryRequestId: input.requestId,
            clientId: input.clientUserId,
          },
        ],
      },
    ],
  });

  const cartonId = cartonIds[0];
  if (!cartonId) throw new Error("Receive failed — no carton created.");

  const cartonSnap = await getDoc(warehouseCartonDocRef(input.warehouseId, cartonId));
  if (!cartonSnap.exists()) throw new Error("Received carton not found.");
  const carton = parseWarehouseCartonDoc(cartonSnap.id, cartonSnap.data() as Record<string, unknown>);
  const line = carton.lines?.[0];
  if (!line?.lineId) throw new Error("Received carton has no line.");

  await recordInboundReceiveBatch({
    warehouseId: input.warehouseId,
    entries: [
      {
        clientUserId: input.clientUserId,
        inventoryRequestId: input.requestId,
        productName: request.productName ?? null,
        cartonId,
        cartonCode: carton.cartonCode,
        sku,
        quantity: qty,
      },
    ],
    operatorId: input.operatorId ?? null,
  });

  await applyPutawayAssignments(
    input.warehouseId,
    cartonId,
    carton,
    [{ lineId: line.lineId, stagingArea, quantity: qty }],
    { operatorId: input.operatorId ?? null, warehouseAreas: areas }
  );

  return {
    cartonId,
    cartonCode: carton.cartonCode,
    quantityReceived: qty,
    stagingArea,
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
