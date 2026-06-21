import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  addDoc,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  createWarehouseCarton,
  listWarehouseCartons,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import { normalizeReturnTracking, parseReturnTrackings } from "@/lib/return-tracking-client";
import {
  loadInboundRequestQueue,
  inboundRequestMatchesTracking,
  type InboundRequestRow,
} from "@/lib/warehouse-inbound-requests";
import {
  applyPutawayAssignmentsToLines,
  linesToFirestorePayload,
  rollCartonBinStateFromLines,
  type PutawayAssignment,
} from "@/lib/warehouse-carton-line-utils";
import type {
  ProductReturn,
  UserProfile,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

const WAREHOUSES = "warehouses";

export type ReturnRequestRow = ProductReturn & {
  id: string;
  clientUserId: string;
  clientDisplayName: string;
  skuLabel: string;
  productLabel: string;
  expectedQty: number;
  warehouseReceivedQty: number;
  remainingQty: number;
};

function userIdFromDocPath(path: string): string {
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}

function clientMatchesWarehouse(client: UserProfile, warehouse: WarehouseDoc): boolean {
  const linked = String(warehouse.linkedLocationId ?? "").trim();
  if (!linked) return true;
  const locs = Array.isArray(client.locations) ? client.locations : [];
  return locs.map(String).includes(linked);
}

function displayClient(client: UserProfile | undefined, userId: string): string {
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

function returnSku(r: ProductReturn): string {
  if (r.sku?.trim()) return r.sku.trim();
  if (r.newProductSku?.trim()) return r.newProductSku.trim();
  return "";
}

function returnProductName(r: ProductReturn): string {
  return (
    r.productName?.trim() ||
    r.newProductName?.trim() ||
    returnSku(r) ||
    "Product return"
  );
}

function expectedReturnQty(r: ProductReturn): number {
  return Math.max(0, Math.floor(r.requestedQuantity ?? 0));
}

/** Sum carton qty linked to each product return id from an already-loaded carton list. */
export function buildCartonQtyByProductReturnId(
  cartons: WarehouseCartonDoc[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of cartons) {
    if (c.status === "voided") continue;
    const rootRid = c.productReturnId?.trim();
    if (rootRid) {
      map.set(rootRid, (map.get(rootRid) ?? 0) + Math.max(0, c.quantity));
    }
    for (const line of c.lines ?? []) {
      const rid = (line.productReturnId ?? "").trim();
      if (!rid) continue;
      map.set(rid, (map.get(rid) ?? 0) + Math.max(0, line.quantity));
    }
  }
  return map;
}

/** Sum carton qty linked to each product return id. */
export async function cartonQtyByProductReturnId(
  warehouseId: string
): Promise<Map<string, number>> {
  const cartons = await listWarehouseCartons(warehouseId);
  return buildCartonQtyByProductReturnId(cartons);
}

/** Count returns awaiting QC receive (dashboard metric). */
export async function countReturnQcQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons?: WarehouseCartonDoc[];
}): Promise<number> {
  const { warehouse, clients } = input;
  const eligibleClientIds = new Set(
    clients.filter((c) => clientMatchesWarehouse(c, warehouse)).map((c) => c.uid)
  );

  const statuses = ["approved", "in_progress"];
  let docs: Array<{ id: string; ref: { path: string }; data: () => Record<string, unknown> }> = [];
  try {
    const snap = await getDocs(
      query(collectionGroup(db, "productReturns"), where("status", "in", statuses))
    );
    docs = snap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      data: () => d.data() as Record<string, unknown>,
    }));
  } catch {
    const eligible = Array.from(eligibleClientIds);
    const perUserSnaps = await Promise.all(
      eligible.map((uid) =>
        getDocs(
          query(
            collection(db, `users/${uid}/productReturns`),
            where("status", "in", statuses)
          )
        )
      )
    );
    docs = perUserSnaps.flatMap((s) =>
      s.docs.map((d) => ({
        id: d.id,
        ref: d.ref,
        data: () => d.data() as Record<string, unknown>,
      }))
    );
  }

  const cartonMap = input.cartons
    ? buildCartonQtyByProductReturnId(input.cartons)
    : await cartonQtyByProductReturnId(warehouse.id);

  let count = 0;
  for (const d of docs) {
    const data = d.data() as Omit<ProductReturn, "id">;
    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedReturnQty({ ...data, id: d.id });
    const warehouseReceivedQty = cartonMap.get(d.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - warehouseReceivedQty);
    if (remainingQty > 0) count += 1;
  }

  return count;
}

export async function loadReturnRequestQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
}): Promise<ReturnRequestRow[]> {
  const { warehouse, clients } = input;
  const clientById = new Map(clients.map((c) => [c.uid, c]));
  const eligibleClientIds = new Set(
    clients.filter((c) => clientMatchesWarehouse(c, warehouse)).map((c) => c.uid)
  );

  const statuses = ["approved", "in_progress"];
  let docs: Array<{ id: string; ref: { path: string }; data: () => Record<string, unknown> }> = [];
  try {
    const snap = await getDocs(
      query(collectionGroup(db, "productReturns"), where("status", "in", statuses))
    );
    docs = snap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      data: () => d.data() as Record<string, unknown>,
    }));
  } catch {
    const eligible = Array.from(eligibleClientIds);
    const perUserSnaps = await Promise.all(
      eligible.map((uid) =>
        getDocs(
          query(
            collection(db, `users/${uid}/productReturns`),
            where("status", "in", statuses)
          )
        )
      )
    );
    docs = perUserSnaps.flatMap((s) =>
      s.docs.map((d) => ({
        id: d.id,
        ref: d.ref,
        data: () => d.data() as Record<string, unknown>,
      }))
    );
  }

  const cartonMap = await cartonQtyByProductReturnId(warehouse.id);
  const rows: ReturnRequestRow[] = [];

  for (const d of docs) {
    const data = d.data() as Omit<ProductReturn, "id">;
    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedReturnQty({ ...data, id: d.id });
    const warehouseReceivedQty = cartonMap.get(d.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - warehouseReceivedQty);

    rows.push({
      ...data,
      id: d.id,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      skuLabel: returnSku({ ...data, id: d.id }),
      productLabel: returnProductName({ ...data, id: d.id }),
      expectedQty,
      warehouseReceivedQty,
      remainingQty,
    });
  }

  return rows.sort((a, b) => {
    if (a.remainingQty > 0 !== b.remainingQty > 0) {
      return a.remainingQty > 0 ? -1 : 1;
    }
    return a.clientDisplayName.localeCompare(b.clientDisplayName);
  });
}

export function returnMatchesTracking(row: ReturnRequestRow, trackingRaw: string): boolean {
  const needle = normalizeReturnTracking(trackingRaw);
  if (!needle) return false;
  const trackings = parseReturnTrackings(row.returnTrackings);
  if (trackings.some((t) => normalizeReturnTracking(t.trackingNumber) === needle)) {
    return true;
  }
  for (const ship of row.shipments ?? []) {
    const tn = ship.trackingNumber ?? ship.tracking;
    if (typeof tn === "string" && normalizeReturnTracking(tn) === needle) return true;
  }
  return false;
}

export async function findReturnsByTracking(
  warehouse: WarehouseDoc,
  clients: UserProfile[],
  trackingRaw: string
): Promise<ReturnRequestRow[]> {
  const rows = await loadReturnRequestQueue({ warehouse, clients });
  return rows.filter((r) => returnMatchesTracking(r, trackingRaw));
}

export type DockIntakeScanResult = {
  tracking: string;
  inbound: InboundRequestRow[];
  returns: ReturnRequestRow[];
};

/** Single-dock lookup: inbound requests first, then returns (same tracking scan). */
export async function scanDockIntake(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  trackingRaw: string;
}): Promise<DockIntakeScanResult> {
  const tracking = input.trackingRaw.trim();
  const [inboundAll, returnRows] = await Promise.all([
    loadInboundRequestQueue({
      warehouse: input.warehouse,
      clients: input.clients,
      dockQueue: true,
    }),
    findReturnsByTracking(input.warehouse, input.clients, tracking),
  ]);

  const inbound = inboundAll.filter((row) => inboundRequestMatchesTracking(row, tracking));

  return { tracking, inbound, returns: returnRows };
}

export async function loadProductReturnRow(
  clientUserId: string,
  returnId: string,
  warehouse: WarehouseDoc,
  clients: UserProfile[]
): Promise<ReturnRequestRow | null> {
  const rows = await loadReturnRequestQueue({ warehouse, clients });
  return rows.find((r) => r.id === returnId && r.clientUserId === clientUserId) ?? null;
}

export async function receiveReturnAtDock(input: {
  warehouseId: string;
  clientUserId: string;
  productReturnId: string;
  sku: string;
  productTitle?: string | null;
  quantity: number;
  condition?: "good" | "damaged";
  trackingNumber?: string | null;
  carrier?: string | null;
  notes?: string | null;
  stagingArea?: string | null;
  receivedBy?: string | null;
  operatorId?: string | null;
}): Promise<{ cartonId: string; cartonCode: string }> {
  const qty = Math.floor(input.quantity);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  const sku = input.sku.trim();
  if (!sku) throw new Error("SKU is required.");

  const returnRef = doc(db, "users", input.clientUserId, "productReturns", input.productReturnId);
  const returnSnap = await getDoc(returnRef);
  if (!returnSnap.exists()) throw new Error("Return request not found.");
  const returnData = returnSnap.data() as ProductReturn;

  const line: WarehouseCartonLine = {
    lineId: "L1",
    sku,
    productTitle: input.productTitle?.trim() || returnProductName({ ...returnData, id: input.productReturnId }),
    quantity: qty,
    lot: null,
    expiry: null,
    condition: input.condition === "damaged" ? "damaged" : "good",
    binId: null,
    stagingArea: input.stagingArea?.trim() || "RETURNS-STAGE",
    allocationStatus: "allocated",
    clientId: input.clientUserId,
    inventoryRequestId: null,
    productReturnId: input.productReturnId,
  };

  const cartonId = await createWarehouseCarton({
    warehouseId: input.warehouseId,
    sku,
    quantity: qty,
    productTitle: line.productTitle,
    status: "quarantine",
    clientId: input.clientUserId,
    productReturnId: input.productReturnId,
    lines: [line],
    isLoose: true,
    receiveMode: "unpackaged",
    trackingNumber: input.trackingNumber ?? null,
    carrier: input.carrier ?? null,
    notes: input.notes ?? null,
    receivedBy: input.receivedBy ?? null,
    stagingArea: input.stagingArea?.trim() || "RETURNS-STAGE",
  });

  const cartonSnap = await getDoc(warehouseCartonDocRef(input.warehouseId, cartonId));
  const cartonCode = cartonSnap.exists()
    ? String((cartonSnap.data() as { cartonCode?: string }).cartonCode ?? cartonId)
    : cartonId;

  const prevReceived = Math.max(0, Math.floor(returnData.receivedQuantity ?? 0));
  const nextReceived = prevReceived + qty;
  const nextStatus =
    returnData.status === "approved" || returnData.status === "in_progress"
      ? "in_progress"
      : returnData.status;

  await updateDoc(returnRef, {
    receivedQuantity: nextReceived,
    status: nextStatus,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  await addDoc(eventsRef, {
    type: "return_receive",
    productReturnId: input.productReturnId,
    clientUserId: input.clientUserId,
    cartonId,
    cartonCode,
    sku,
    quantity: qty,
    condition: line.condition,
    stagingArea: line.stagingArea,
    trackingNumber: input.trackingNumber ?? null,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  return { cartonId, cartonCode };
}

export async function listQuarantineReturnCartons(
  warehouseId: string
): Promise<WarehouseCartonDoc[]> {
  const cartons = await listWarehouseCartons(warehouseId);
  return cartons
    .filter((c) => c.status === "quarantine" && !!c.productReturnId?.trim())
    .sort((a, b) => a.cartonCode.localeCompare(b.cartonCode));
}

export async function applyReturnQcRestock(input: {
  warehouseId: string;
  cartonId: string;
  binId: string;
  binPath: string;
  operatorId?: string | null;
}): Promise<void> {
  const ref = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Carton not found.");
  const carton = snap.data() as Record<string, unknown>;
  if (carton.status !== "quarantine") throw new Error("Carton is not awaiting return QC.");

  const linesRaw = Array.isArray(carton.lines) ? (carton.lines as WarehouseCartonLine[]) : [];
  const lines: WarehouseCartonLine[] =
    linesRaw.length > 0
      ? linesRaw
      : [
          {
            lineId: "L1",
            sku: String(carton.sku ?? ""),
            quantity: typeof carton.quantity === "number" ? carton.quantity : 0,
            condition: "good",
            binId: null,
            allocationStatus: "allocated",
            clientId: carton.clientId != null ? String(carton.clientId) : null,
            productReturnId:
              carton.productReturnId != null ? String(carton.productReturnId) : null,
          },
        ];

  const assignments: PutawayAssignment[] = lines.map((l) => ({
    lineId: l.lineId,
    binId: input.binId,
    binPath: input.binPath,
    quantity: l.quantity,
  }));

  const nextLines = applyPutawayAssignmentsToLines(lines, assignments);
  const { status, binId } = rollCartonBinStateFromLines(
    { status: "quarantine" } as WarehouseCartonDoc,
    nextLines
  );

  const batch = writeBatch(db);
  batch.update(ref, {
    lines: linesToFirestorePayload(nextLines),
    status,
    binId,
    stagingArea: null,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "return_qc_restock",
    cartonId: input.cartonId,
    cartonCode: String(carton.cartonCode ?? ""),
    productReturnId: carton.productReturnId ?? null,
    toBinId: input.binId,
    toBinPath: input.binPath,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
}

export async function applyReturnQcDamaged(input: {
  warehouseId: string;
  cartonId: string;
  stagingArea?: string | null;
  notes?: string | null;
  operatorId?: string | null;
}): Promise<void> {
  const ref = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Carton not found.");
  const data = snap.data() as Record<string, unknown>;
  if (data.status !== "quarantine") throw new Error("Carton is not awaiting return QC.");

  const linesRaw = Array.isArray(data.lines) ? (data.lines as WarehouseCartonLine[]) : [];
  const nextLines = linesRaw.map((l) => ({
    ...l,
    condition: "damaged" as const,
    stagingArea: input.stagingArea?.trim() || l.stagingArea || "DAMAGED-STAGE",
    binId: null,
  }));

  await updateDoc(ref, {
    status: "damaged",
    lines: linesToFirestorePayload(nextLines),
    stagingArea: input.stagingArea?.trim() || "DAMAGED-STAGE",
    notes: input.notes?.trim() || (data.notes != null ? String(data.notes) : null),
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  await writeBatch(db)
    .set(doc(eventsRef), {
      type: "return_qc_damaged",
      cartonId: input.cartonId,
      cartonCode: String(data.cartonCode ?? ""),
      productReturnId: data.productReturnId ?? null,
      stagingArea: input.stagingArea?.trim() || "DAMAGED-STAGE",
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    })
    .commit();
}

export async function applyReturnQcDispose(input: {
  warehouseId: string;
  cartonId: string;
  notes?: string | null;
  operatorId?: string | null;
}): Promise<void> {
  const ref = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Carton not found.");
  const data = snap.data() as Record<string, unknown>;
  if (data.status !== "quarantine") throw new Error("Carton is not awaiting return QC.");

  await updateDoc(ref, {
    status: "closed",
    notes: input.notes?.trim() || (data.notes != null ? String(data.notes) : null),
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  await writeBatch(db)
    .set(doc(eventsRef), {
      type: "return_qc_dispose",
      cartonId: input.cartonId,
      cartonCode: String(data.cartonCode ?? ""),
      productReturnId: data.productReturnId ?? null,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    })
    .commit();
}
