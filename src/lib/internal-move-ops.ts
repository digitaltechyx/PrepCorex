import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  createWarehouseCarton,
  listWarehouseCartons,
  updateWarehouseCarton,
  warehouseCartonDocRef,
  warehouseCartonsCollectionRef,
} from "@/lib/warehouse-carton-firestore";
import { isActiveWarehouseCarton } from "@/lib/warehouse-carton-states";
import { warehousesCollectionRef } from "@/lib/warehouse-firestore";
import type {
  InternalMoveProcessMode,
  InternalMoveRequest,
  InternalMoveRequestLine,
  InternalMoveUserScope,
  InventoryItem,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

const REQUESTS = "internalMoveRequests";
const WAREHOUSES = "warehouses";

export function internalMoveRequestsPath(): string {
  return REQUESTS;
}

export function internalMoveRequestRef(requestId: string) {
  return doc(db, REQUESTS, requestId);
}

/** Qty available at a given location for an inventory item. */
export function qtyAtLocation(item: InventoryItem, locationId: string): number {
  const loc = String(locationId || "").trim();
  if (!loc) return 0;
  const map = item.locationQuantities;
  if (map && typeof map === "object" && Object.keys(map).length > 0) {
    const n = Number(map[loc] ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (String(item.locationId || "").trim() === loc) {
    const n = Number(item.quantity) || 0;
    return n > 0 ? n : 0;
  }
  return 0;
}

export async function findWarehouseByLocationId(
  locationId: string
): Promise<WarehouseDoc | null> {
  const loc = String(locationId || "").trim();
  if (!loc) return null;
  const snap = await getDocs(
    query(warehousesCollectionRef(), where("linkedLocationId", "==", loc), limit(1))
  );
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...(d.data() as Omit<WarehouseDoc, "id">) };
}

function normSku(v: unknown): string {
  return String(v ?? "")
    .trim()
    .toLowerCase();
}

function lineMatchesProduct(
  line: WarehouseCartonLine,
  sku: string | undefined,
  productName: string
): boolean {
  const wantSku = normSku(sku);
  const lineSku = normSku(line.sku);
  if (wantSku && lineSku && wantSku === lineSku) return true;
  const title = String(line.productTitle ?? "")
    .trim()
    .toLowerCase();
  const name = productName.trim().toLowerCase();
  if (name && title && title === name) return true;
  if (wantSku && lineSku && lineSku.includes(wantSku)) return true;
  return false;
}

function cartonMatchesProduct(
  carton: WarehouseCartonDoc,
  clientId: string,
  sku: string | undefined,
  productName: string
): boolean {
  if (!isActiveWarehouseCarton(carton)) return false;
  const cid = String(carton.clientId ?? "").trim();
  if (cid && cid !== clientId) return false;
  const lines = carton.lines ?? [];
  if (lines.length > 0) {
    return lines.some((l) => {
      const lineClient = String(l.clientId ?? "").trim();
      if (lineClient && lineClient !== clientId) return false;
      return lineMatchesProduct(l, sku, productName);
    });
  }
  const wantSku = normSku(sku);
  const rootSku = normSku(carton.sku);
  if (wantSku && rootSku && wantSku === rootSku) return true;
  const title = String(carton.productTitle ?? "")
    .trim()
    .toLowerCase();
  const name = productName.trim().toLowerCase();
  return Boolean(name && title && title === name);
}

/** Active cartons at a warehouse that hold this client's product. */
export async function findCartonsForClientProduct(
  warehouseId: string,
  clientId: string,
  sku: string | undefined,
  productName: string
): Promise<WarehouseCartonDoc[]> {
  const all = await listWarehouseCartons(warehouseId);
  return all.filter((c) => cartonMatchesProduct(c, clientId, sku, productName));
}

function matchingLineQty(
  carton: WarehouseCartonDoc,
  clientId: string,
  sku: string | undefined,
  productName: string
): number {
  const lines = carton.lines ?? [];
  if (lines.length > 0) {
    return lines.reduce((sum, l) => {
      const lineClient = String(l.clientId ?? "").trim();
      if (lineClient && lineClient !== clientId) return sum;
      if (!lineMatchesProduct(l, sku, productName)) return sum;
      return sum + Math.max(0, Number(l.quantity) || 0);
    }, 0);
  }
  if (cartonMatchesProduct(carton, clientId, sku, productName)) {
    return Math.max(0, Number(carton.quantity) || 0);
  }
  return 0;
}

async function cartonCodeExists(
  warehouseId: string,
  cartonCode: string
): Promise<boolean> {
  const snap = await getDocs(
    query(
      warehouseCartonsCollectionRef(warehouseId),
      where("cartonCode", "==", cartonCode),
      limit(1)
    )
  );
  return !snap.empty;
}

async function uniqueDestCartonCode(
  destWarehouseId: string,
  preferred: string
): Promise<string> {
  const base = preferred.trim() || `MOVE-${Date.now()}`;
  if (!(await cartonCodeExists(destWarehouseId, base))) return base;
  for (let i = 1; i <= 20; i++) {
    const candidate = `${base}-M${i}`;
    if (!(await cartonCodeExists(destWarehouseId, candidate))) return candidate;
  }
  return `${base}-M${Date.now()}`;
}

function clearLinePlacement(line: WarehouseCartonLine): WarehouseCartonLine {
  return {
    ...line,
    binId: null,
    stagingArea: null,
  };
}

function buildLocationQuantities(
  item: InventoryItem,
  fromLocationId: string
): Record<string, number> {
  const availableQty = Number(item.quantity) || 0;
  const fallbackSource = String(item.locationId || fromLocationId || "").trim();
  const incoming = item.locationQuantities;
  const normalized: Record<string, number> = {};
  if (incoming && typeof incoming === "object") {
    for (const [key, value] of Object.entries(incoming)) {
      const id = String(key || "").trim();
      const qtyValue = Number(value);
      if (!id || !Number.isFinite(qtyValue) || qtyValue <= 0) continue;
      normalized[id] = qtyValue;
    }
  }
  const sum = Object.values(normalized).reduce((acc, n) => acc + n, 0);
  if (sum <= 0 && fallbackSource) {
    normalized[fallbackSource] = availableQty;
    return normalized;
  }
  if (sum < availableQty && fallbackSource) {
    normalized[fallbackSource] = (normalized[fallbackSource] || 0) + (availableQty - sum);
  }
  return normalized;
}

async function applyInventoryLocationMove(input: {
  userId: string;
  inventoryId: string;
  productName: string;
  sku?: string;
  quantity: number;
  fromLocationId: string;
  toLocationId: string;
  fromLocationName: string;
  toLocationName: string;
  movedBy: string;
  requestId: string;
  reason?: string;
}): Promise<void> {
  const sourceRef = doc(db, `users/${input.userId}/inventory`, input.inventoryId);
  const sourceSnap = await getDoc(sourceRef);
  if (!sourceSnap.exists()) {
    throw new Error(`Inventory item "${input.productName}" no longer exists.`);
  }
  const sourceData = { id: sourceSnap.id, ...sourceSnap.data() } as InventoryItem;
  const locationQuantities = buildLocationQuantities(sourceData, input.fromLocationId);
  const fromAvailable = Number(locationQuantities[input.fromLocationId] || 0);
  if (fromAvailable <= 0) {
    throw new Error(
      `"${input.productName}" has no quantity at ${input.fromLocationName || "source site"}.`
    );
  }
  if (input.quantity > fromAvailable) {
    throw new Error(
      `Only ${fromAvailable} units of "${input.productName}" available at source (requested ${input.quantity}).`
    );
  }

  locationQuantities[input.fromLocationId] = Math.max(0, fromAvailable - input.quantity);
  if (locationQuantities[input.fromLocationId] <= 0) {
    delete locationQuantities[input.fromLocationId];
  }
  locationQuantities[input.toLocationId] =
    Number(locationQuantities[input.toLocationId] || 0) + input.quantity;

  const nextPrimaryLocationId =
    (sourceData.locationId && locationQuantities[sourceData.locationId]
      ? sourceData.locationId
      : "") ||
    Object.keys(locationQuantities)[0] ||
    input.toLocationId;

  await updateDoc(sourceRef, {
    locationId: nextPrimaryLocationId,
    locationQuantities,
    updatedAt: new Date(),
  });

  await addDoc(collection(db, `users/${input.userId}/inventoryTransfers`), {
    inventoryId: input.inventoryId,
    productName: input.productName,
    sku: input.sku || "",
    quantity: input.quantity,
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    fromLocationName: input.fromLocationName,
    toLocationName: input.toLocationName,
    reason: input.reason?.trim() || "Internal site move",
    movedBy: input.movedBy,
    movedAt: new Date(),
    kind: "site_move",
    requestId: input.requestId,
  });
}

type TransferSlice = {
  carton: WarehouseCartonDoc;
  /** Qty to move from this carton for the product. */
  qty: number;
};

function planCartonSlices(
  cartons: WarehouseCartonDoc[],
  clientId: string,
  sku: string | undefined,
  productName: string,
  needQty: number
): TransferSlice[] {
  const slices: TransferSlice[] = [];
  let remaining = needQty;
  // Prefer cartons with fewer matching units (finish small ones first), then by code.
  const ranked = [...cartons].sort((a, b) => {
    const qa = matchingLineQty(a, clientId, sku, productName);
    const qb = matchingLineQty(b, clientId, sku, productName);
    if (qa !== qb) return qa - qb;
    return a.cartonCode.localeCompare(b.cartonCode);
  });
  for (const carton of ranked) {
    if (remaining <= 0) break;
    const available = matchingLineQty(carton, clientId, sku, productName);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    slices.push({ carton, qty: take });
    remaining -= take;
  }
  if (remaining > 0) {
    throw new Error(
      `No warehouse label found at source site for "${productName}" covering ${needQty} units (short ${remaining}). Receive/putaway history required to reuse a label.`
    );
  }
  return slices;
}

async function transferCartonSlice(input: {
  sourceWarehouseId: string;
  destWarehouseId: string;
  carton: WarehouseCartonDoc;
  clientId: string;
  sku: string | undefined;
  productName: string;
  qty: number;
  operatorId: string;
  operatorName: string;
  requestId: string;
}): Promise<{ destCartonId: string; destCartonCode: string }> {
  const { carton, qty, clientId, sku, productName } = input;
  const lines = carton.lines ?? [];
  const matching =
    lines.length > 0
      ? lines.filter((l) => {
          const lineClient = String(l.clientId ?? "").trim();
          if (lineClient && lineClient !== clientId) return false;
          return lineMatchesProduct(l, sku, productName);
        })
      : [];

  const totalMatch =
    matching.length > 0
      ? matching.reduce((s, l) => s + Math.max(0, l.quantity), 0)
      : Math.max(0, carton.quantity);
  const fullCartonMove =
    qty >= totalMatch &&
    (matching.length === 0 || matching.length === (lines.length || 0) || qty >= carton.quantity);

  // Build destination lines for moved qty
  let destLines: WarehouseCartonLine[] = [];
  let remaining = qty;
  if (matching.length > 0) {
    for (const l of matching) {
      if (remaining <= 0) break;
      const take = Math.min(Math.max(0, l.quantity), remaining);
      if (take <= 0) continue;
      destLines.push(
        clearLinePlacement({
          ...l,
          lineId: `${l.lineId}-s2s`,
          quantity: take,
          clientId: l.clientId || clientId,
        })
      );
      remaining -= take;
    }
  } else {
    destLines = [
      {
        lineId: `s2s-${Date.now()}`,
        sku: carton.sku || sku || "UNKNOWN",
        productTitle: carton.productTitle || productName,
        quantity: qty,
        condition: "good",
        binId: null,
        stagingArea: null,
        clientId,
        inventoryRequestId: carton.inventoryRequestId ?? null,
        productReturnId: carton.productReturnId ?? null,
      },
    ];
  }

  const destCode = await uniqueDestCartonCode(input.destWarehouseId, carton.cartonCode);
  const destQty = destLines.reduce((s, l) => s + l.quantity, 0);
  const destCartonId = await createWarehouseCarton({
    warehouseId: input.destWarehouseId,
    sku: destLines.length === 1 ? destLines[0].sku : "MIXED",
    quantity: destQty,
    lot: carton.lot ?? null,
    expiry: carton.expiry ?? null,
    status: "received",
    clientId,
    receivedForClient: carton.receivedForClient ?? null,
    binId: null,
    palletId: null,
    productTitle: carton.productTitle || productName,
    inventoryRequestId: carton.inventoryRequestId ?? null,
    productReturnId: carton.productReturnId ?? null,
    cartonCode: destCode,
    lines: destLines,
    isMixed: destLines.length > 1,
    isLoose: carton.isLoose,
    isPackage: carton.isPackage,
    receiveMode: carton.receiveMode ?? null,
    stagingArea: null,
    receivedBy: input.operatorId,
    notes: `Site move from ${carton.cartonCode} (request ${input.requestId})`,
  });

  // Update / void source
  if (fullCartonMove || qty >= carton.quantity) {
    await updateWarehouseCarton(input.sourceWarehouseId, carton.id, {
      status: "voided",
      binId: null,
      quantity: 0,
    });
    await updateDoc(warehouseCartonDocRef(input.sourceWarehouseId, carton.id), {
      voidedAt: serverTimestamp(),
      lines: [],
      stagingArea: null,
      palletId: null,
      notes: `Moved to warehouse ${input.destWarehouseId} as ${destCode} (request ${input.requestId})`,
      updatedAt: serverTimestamp(),
    });
  } else if (matching.length > 0) {
    let left = qty;
    const nextLines: WarehouseCartonLine[] = [];
    for (const l of lines) {
      const isMatch =
        (!String(l.clientId ?? "").trim() || String(l.clientId).trim() === clientId) &&
        lineMatchesProduct(l, sku, productName);
      if (!isMatch) {
        nextLines.push(l);
        continue;
      }
      const take = Math.min(Math.max(0, l.quantity), left);
      left -= take;
      const remain = Math.max(0, l.quantity - take);
      if (remain > 0) nextLines.push({ ...l, quantity: remain });
    }
    const nextQty = nextLines.reduce((s, l) => s + l.quantity, 0);
    await updateDoc(warehouseCartonDocRef(input.sourceWarehouseId, carton.id), {
      lines: nextLines,
      quantity: nextQty,
      sku: nextLines.length === 1 ? nextLines[0].sku : nextLines.length > 1 ? "MIXED" : carton.sku,
      isMixed: nextLines.length > 1,
      status: nextQty > 0 ? carton.status : "voided",
      ...(nextQty <= 0
        ? { voidedAt: serverTimestamp(), binId: null, stagingArea: null }
        : {}),
      updatedAt: serverTimestamp(),
    });
  } else {
    const nextQty = Math.max(0, carton.quantity - qty);
    await updateWarehouseCarton(input.sourceWarehouseId, carton.id, {
      quantity: nextQty,
      ...(nextQty <= 0 ? { status: "voided", binId: null } : {}),
    });
    if (nextQty <= 0) {
      await updateDoc(warehouseCartonDocRef(input.sourceWarehouseId, carton.id), {
        voidedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  // Movement events on both warehouses
  const eventPayload = {
    type: "internal_site_move",
    cartonId: carton.id,
    cartonCode: carton.cartonCode,
    destCartonId,
    destCartonCode: destCode,
    clientUserId: clientId,
    sku: sku || carton.sku || null,
    quantity: qty,
    requestId: input.requestId,
    operatorId: input.operatorId,
    operatorLabel: input.operatorName,
    fromWarehouseId: input.sourceWarehouseId,
    toWarehouseId: input.destWarehouseId,
    createdAt: serverTimestamp(),
    summary: `Site move ${qty}u ${carton.cartonCode} → ${destCode}`,
  };
  const batch = writeBatch(db);
  batch.set(doc(collection(db, WAREHOUSES, input.sourceWarehouseId, "movementEvents")), eventPayload);
  batch.set(doc(collection(db, WAREHOUSES, input.destWarehouseId, "movementEvents")), {
    ...eventPayload,
    cartonId: destCartonId,
    cartonCode: destCode,
  });
  await batch.commit();

  return { destCartonId, destCartonCode: destCode };
}

export async function createInternalMoveRequest(input: {
  fromLocationId: string;
  toLocationId: string;
  fromLocationName: string;
  toLocationName: string;
  userScope: InternalMoveUserScope;
  userIds: string[];
  lines: Array<Omit<InternalMoveRequestLine, "sourceCartonIds" | "destCartonIds" | "error">>;
  reason?: string;
  createdBy: string;
  createdByName: string;
}): Promise<string> {
  if (input.fromLocationId === input.toLocationId) {
    throw new Error("From and To sites must be different.");
  }
  if (!input.userIds.length) throw new Error("Select at least one user.");
  if (!input.lines.length) throw new Error("Add at least one product line.");

  const fromWh = await findWarehouseByLocationId(input.fromLocationId);
  const toWh = await findWarehouseByLocationId(input.toLocationId);
  if (!fromWh) {
    throw new Error(
      `No warehouse is linked to site "${input.fromLocationName || input.fromLocationId}".`
    );
  }
  if (!toWh) {
    throw new Error(
      `No warehouse is linked to site "${input.toLocationName || input.toLocationId}".`
    );
  }
  if (fromWh.id === toWh.id) {
    throw new Error("From and To sites resolve to the same warehouse.");
  }

  for (const line of input.lines) {
    if (!line.userId || !line.inventoryId) {
      throw new Error("Each line needs a user and inventory item.");
    }
    if (!Number.isFinite(line.quantity) || line.quantity < 1) {
      throw new Error(`Invalid quantity for "${line.productName}".`);
    }
  }

  const ref = await addDoc(collection(db, REQUESTS), {
    fromLocationId: input.fromLocationId,
    toLocationId: input.toLocationId,
    fromLocationName: input.fromLocationName,
    toLocationName: input.toLocationName,
    fromWarehouseId: fromWh.id,
    toWarehouseId: toWh.id,
    fromWarehouseCode: fromWh.code,
    toWarehouseCode: toWh.code,
    userScope: input.userScope,
    userIds: input.userIds,
    lines: input.lines.map((l) => ({
      userId: l.userId,
      userName: l.userName || "",
      inventoryId: l.inventoryId,
      productName: l.productName,
      sku: l.sku || "",
      quantity: Math.floor(l.quantity),
    })),
    reason: input.reason?.trim() || "",
    status: "pending",
    createdBy: input.createdBy,
    createdByName: input.createdByName,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function cancelInternalMoveRequest(input: {
  requestId: string;
  reason?: string;
}): Promise<void> {
  const ref = internalMoveRequestRef(input.requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Move request not found.");
  const data = snap.data() as InternalMoveRequest;
  if (data.status !== "pending") {
    throw new Error(`Cannot cancel a request that is already ${data.status}.`);
  }
  await updateDoc(ref, {
    status: "cancelled",
    cancelledAt: Timestamp.now(),
    cancelReason: input.reason?.trim() || "",
  });
}

/**
 * Process a pending internal move: transfer carton labels source→dest (awaiting putaway)
 * and update each user's location quantities.
 */
export async function processInternalMoveRequest(input: {
  requestId: string;
  operatorId: string;
  operatorName: string;
  processMode: InternalMoveProcessMode;
}): Promise<InternalMoveRequest> {
  const ref = internalMoveRequestRef(input.requestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Move request not found.");
  const request = { id: snap.id, ...snap.data() } as InternalMoveRequest;
  if (request.status !== "pending") {
    throw new Error(`This request was already ${request.status}.`);
  }

  await updateDoc(ref, { status: "in_progress" });

  const movedCartonRefs: NonNullable<InternalMoveRequest["movedCartonRefs"]> = [];
  const updatedLines: InternalMoveRequestLine[] = [];

  try {
    // Cache cartons per warehouse to avoid re-listing for every line
    const sourceCartons = await listWarehouseCartons(request.fromWarehouseId);

    for (const line of request.lines) {
      const cartons = sourceCartons.filter((c) =>
        cartonMatchesProduct(c, line.userId, line.sku, line.productName)
      );
      if (cartons.length === 0) {
        throw new Error(
          `No warehouse label found at source site for "${line.productName}" (user ${line.userName || line.userId}). Receive/putaway history required to reuse a label.`
        );
      }

      const slices = planCartonSlices(
        cartons,
        line.userId,
        line.sku,
        line.productName,
        line.quantity
      );

      const sourceIds: string[] = [];
      const destIds: string[] = [];

      for (const slice of slices) {
        const result = await transferCartonSlice({
          sourceWarehouseId: request.fromWarehouseId,
          destWarehouseId: request.toWarehouseId,
          carton: slice.carton,
          clientId: line.userId,
          sku: line.sku,
          productName: line.productName,
          qty: slice.qty,
          operatorId: input.operatorId,
          operatorName: input.operatorName,
          requestId: request.id,
        });
        sourceIds.push(slice.carton.id);
        destIds.push(result.destCartonId);
        movedCartonRefs.push({
          warehouseId: request.toWarehouseId,
          cartonId: result.destCartonId,
          cartonCode: result.destCartonCode,
          userId: line.userId,
          inventoryId: line.inventoryId,
        });
        // Keep in-memory carton list roughly accurate for subsequent lines
        const idx = sourceCartons.findIndex((c) => c.id === slice.carton.id);
        if (idx >= 0) {
          const c = sourceCartons[idx];
          const left = matchingLineQty(c, line.userId, line.sku, line.productName) - slice.qty;
          if (left <= 0 && slice.qty >= c.quantity) {
            sourceCartons.splice(idx, 1);
          } else {
            sourceCartons[idx] = {
              ...c,
              quantity: Math.max(0, c.quantity - slice.qty),
            };
          }
        }
      }

      await applyInventoryLocationMove({
        userId: line.userId,
        inventoryId: line.inventoryId,
        productName: line.productName,
        sku: line.sku,
        quantity: line.quantity,
        fromLocationId: request.fromLocationId,
        toLocationId: request.toLocationId,
        fromLocationName: request.fromLocationName || "",
        toLocationName: request.toLocationName || "",
        movedBy: input.operatorName,
        requestId: request.id,
        reason: request.reason,
      });

      updatedLines.push({
        ...line,
        sourceCartonIds: sourceIds,
        destCartonIds: destIds,
      });
    }

    await updateDoc(ref, {
      status: "awaiting_putaway",
      lines: updatedLines,
      movedCartonRefs,
      processedBy: input.operatorId,
      processedByName: input.operatorName,
      processedAt: Timestamp.now(),
      processMode: input.processMode,
    });

    return {
      ...request,
      status: "awaiting_putaway",
      lines: updatedLines,
      movedCartonRefs,
      processedBy: input.operatorId,
      processedByName: input.operatorName,
      processMode: input.processMode,
    };
  } catch (err) {
    // Roll status back to pending so admin can retry / fix
    await updateDoc(ref, { status: "pending" }).catch(() => undefined);
    throw err;
  }
}

export async function listPendingInternalMovesForSourceWarehouse(
  warehouseId: string
): Promise<InternalMoveRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, REQUESTS),
      where("fromWarehouseId", "==", warehouseId),
      where("status", "==", "pending")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as InternalMoveRequest));
}

export async function listAwaitingPutawayInternalMovesForDestWarehouse(
  warehouseId: string
): Promise<InternalMoveRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, REQUESTS),
      where("toWarehouseId", "==", warehouseId),
      where("status", "==", "awaiting_putaway")
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as InternalMoveRequest));
}
