import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  isExpiryPast,
  listWarehouseCartons,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import { getWarehouseCarton } from "@/lib/warehouse-receive-corrections";
import {
  linesToFirestorePayload,
  nextCartonLineId,
  rollCartonBinStateFromLines,
} from "@/lib/warehouse-carton-line-utils";
import {
  cartonReceivedIso,
  compareFlatStockFefoFifo,
  comparePickStepWalkOrder,
  dateFromFirestore,
} from "@/lib/warehouse-stock-sort";
import type {
  UserProfile,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseCartonStatus,
  WarehouseDoc,
} from "@/types";

const WAREHOUSES = "warehouses";

const PICKABLE_CARTON_STATUSES: WarehouseCartonStatus[] = [
  "stowed",
  "stowed_partial",
  "split",
  "available",
  "reserved",
];

export type WarehousePickStatus = "ready" | "picking" | "picked" | "skipped";

export type OutboundPickLine = {
  sku: string;
  productName: string;
  quantityUnits: number;
  productId: string;
};

export type OutboundPickOrder = {
  id: string;
  clientUserId: string;
  clientDisplayName: string;
  shipTo?: string;
  confirmedAt: Date | null;
  warehousePickStatus: WarehousePickStatus;
  lines: OutboundPickLine[];
};

export type PickTaskStep = {
  stepKey: string;
  sku: string;
  productName: string;
  lot: string | null;
  expiry: string | null;
  condition: "good" | "damaged";
  quantity: number;
  binId: string;
  binPath: string;
  cartonId: string;
  cartonCode: string;
  lineId: string;
  sequence: number;
  /** For FIFO when line has no expiry. */
  receivedAtIso: string;
};

export type PickPlan = {
  order: OutboundPickOrder;
  steps: PickTaskStep[];
  shortfalls: Array<{
    sku: string;
    productName: string;
    needed: number;
    planned: number;
  }>;
  readyToPick: boolean;
};

type PickSource = {
  sku: string;
  lot: string | null;
  expiry: string | null;
  condition: "good" | "damaged";
  quantity: number;
  binId: string;
  binPath: string;
  cartonId: string;
  cartonCode: string;
  lineId: string;
  receivedAtIso: string;
};

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

async function getBinPathMap(warehouseId: string): Promise<Map<string, string>> {
  const snap = await getDocs(collection(db, WAREHOUSES, warehouseId, "bins"));
  const map = new Map<string, string>();
  for (const d of snap.docs) {
    const data = d.data() as { path?: string };
    if (data.path) map.set(d.id, String(data.path));
  }
  return map;
}

async function loadClientProductMap(
  clientUserId: string
): Promise<Map<string, { sku: string; productName: string }>> {
  const snap = await getDocs(collection(db, `users/${clientUserId}/inventory`));
  const map = new Map<string, { sku: string; productName: string }>();
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const sku = String(data.sku ?? "").trim();
    if (!sku) continue;
    map.set(d.id, {
      sku,
      productName: String(data.productName ?? data.sku ?? "").trim() || sku,
    });
  }
  return map;
}

function pickStatusFromRequest(data: Record<string, unknown>): WarehousePickStatus {
  const raw = data.warehousePickStatus;
  if (raw === "picking" || raw === "picked" || raw === "ready" || raw === "skipped") {
    return raw;
  }
  return "ready";
}

function isCartonPickable(carton: WarehouseCartonDoc): boolean {
  if (carton.status === "voided" || carton.status === "closed") return false;
  if (
    carton.status === "quarantine" ||
    carton.status === "damaged" ||
    carton.status === "expired" ||
    carton.status === "on_hold" ||
    carton.status === "receiving" ||
    carton.status === "received"
  ) {
    return false;
  }
  return PICKABLE_CARTON_STATUSES.includes(carton.status);
}

function isLinePickable(
  carton: WarehouseCartonDoc,
  line: WarehouseCartonLine,
  orderClientId: string
): boolean {
  if (!line.binId) return false;
  if (line.allocationStatus === "picked") return false;
  if (line.condition === "damaged") return false;
  if (line.expiry && isExpiryPast(line.expiry)) return false;
  if (!isCartonPickable(carton)) return false;
  if (line.clientId && line.clientId !== orderClientId) return false;
  if (carton.clientId && carton.clientId !== orderClientId) return false;
  return true;
}

function collectPickSources(
  cartons: WarehouseCartonDoc[],
  binPath: Map<string, string>,
  orderClientId: string
): PickSource[] {
  const out: PickSource[] = [];
  for (const carton of cartons) {
    if (!isCartonPickable(carton)) continue;
    const lines =
      carton.lines && carton.lines.length > 0
        ? carton.lines
        : [
            {
              lineId: "L1",
              sku: carton.sku,
              quantity: carton.quantity,
              lot: carton.lot ?? null,
              expiry: carton.expiry ?? null,
              condition: (carton.status === "damaged" ? "damaged" : "good") as
                | "good"
                | "damaged",
              binId: carton.binId ?? null,
              allocationStatus: "unallocated" as const,
              clientId: carton.clientId ?? null,
            } satisfies WarehouseCartonLine,
          ];

    for (const line of lines) {
      if (!isLinePickable(carton, line, orderClientId)) continue;
      const path = line.binId ? binPath.get(line.binId) ?? line.binId : "";
      out.push({
        sku: line.sku,
        lot: line.lot ?? null,
        expiry: line.expiry ?? null,
        condition: line.condition,
        quantity: line.quantity,
        binId: line.binId!,
        binPath: path,
        cartonId: carton.id,
        cartonCode: carton.cartonCode,
        lineId: line.lineId,
        receivedAtIso: cartonReceivedIso(carton),
      });
    }
  }
  return out;
}

function sortSourcesFefoFifo(sources: PickSource[]): PickSource[] {
  return [...sources].sort((a, b) =>
    compareFlatStockFefoFifo(
      {
        expiry: a.expiry,
        receivedAtIso: a.receivedAtIso,
        cartonCode: a.cartonCode,
        binPath: a.binPath,
      },
      {
        expiry: b.expiry,
        receivedAtIso: b.receivedAtIso,
        cartonCode: b.cartonCode,
        binPath: b.binPath,
      }
    )
  );
}

function sortStepsWalkOrder(steps: PickTaskStep[]): PickTaskStep[] {
  return [...steps].sort((a, b) =>
    comparePickStepWalkOrder(
      {
        expiry: a.expiry,
        receivedAtIso: a.receivedAtIso,
        cartonCode: a.cartonCode,
        binPath: a.binPath,
      },
      {
        expiry: b.expiry,
        receivedAtIso: b.receivedAtIso,
        cartonCode: b.cartonCode,
        binPath: b.binPath,
      }
    )
  );
}

async function orderLinesFromRequest(
  clientUserId: string,
  data: Record<string, unknown>
): Promise<OutboundPickLine[]> {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  const products = await loadClientProductMap(clientUserId);
  const lines: OutboundPickLine[] = [];
  for (const shipment of shipments) {
    const productId = String(shipment.productId ?? "").trim();
    if (!productId) continue;
    const product = products.get(productId);
    const sku = String(shipment.sku ?? product?.sku ?? "").trim();
    if (!sku) continue;
    const qty = Math.max(0, Math.floor(Number(shipment.quantity) || 0));
    const packOf = Math.max(1, Math.floor(Number(shipment.packOf) || 1));
    const quantityUnits = qty * packOf;
    if (quantityUnits < 1) continue;
    lines.push({
      sku,
      productName: String(shipment.productName ?? product?.productName ?? sku).trim() || sku,
      quantityUnits,
      productId,
    });
  }
  return lines;
}

/** Confirmed outbound requests awaiting warehouse floor pick. */
export async function loadOutboundPickQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
}): Promise<OutboundPickOrder[]> {
  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const eligible = new Set(
    input.clients
      .filter((c) => clientMatchesWarehouse(c, input.warehouse))
      .map((c) => c.uid)
  );

  type ReqDoc = { id: string; ref: { path: string }; data: () => Record<string, unknown> };
  let docs: ReqDoc[] = [];
  try {
    const snap = await getDocs(
      query(collectionGroup(db, "shipmentRequests"), where("status", "==", "confirmed"))
    );
    docs = snap.docs.map((d) => ({
      id: d.id,
      ref: d.ref,
      data: () => d.data() as Record<string, unknown>,
    }));
  } catch {
    for (const uid of eligible) {
      const snap = await getDocs(
        query(
          collection(db, `users/${uid}/shipmentRequests`),
          where("status", "==", "confirmed")
        )
      );
      for (const d of snap.docs) {
        docs.push({
          id: d.id,
          ref: d.ref,
          data: () => d.data() as Record<string, unknown>,
        });
      }
    }
  }

  const orders: OutboundPickOrder[] = [];

  for (const d of docs) {
    const data = d.data();
    const clientUserId = d.ref.path.split("/")[1] ?? "";
    if (!eligible.has(clientUserId)) continue;

    const pickStatus = pickStatusFromRequest(data);
    if (pickStatus === "picked" || pickStatus === "skipped") continue;

    const lines = await orderLinesFromRequest(clientUserId, data);
    if (lines.length === 0) continue;

    orders.push({
      id: d.id,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      shipTo: data.shipTo != null ? String(data.shipTo) : undefined,
      confirmedAt: dateFromFirestore(data.confirmedAt),
      warehousePickStatus: pickStatus,
      lines,
    });
  }

  orders.sort((a, b) => {
    const ta = a.confirmedAt?.getTime() ?? 0;
    const tb = b.confirmedAt?.getTime() ?? 0;
    return ta - tb;
  });
  return orders;
}

export async function buildPickPlan(
  warehouse: WarehouseDoc,
  order: OutboundPickOrder
): Promise<PickPlan> {
  const [cartons, binPath] = await Promise.all([
    listWarehouseCartons(warehouse.id),
    getBinPathMap(warehouse.id),
  ]);

  const pool = sortSourcesFefoFifo(collectPickSources(cartons, binPath, order.clientUserId));
  const consumed = new Map<string, number>();
  const steps: PickTaskStep[] = [];
  const shortfalls: PickPlan["shortfalls"] = [];

  for (const demand of order.lines) {
    let remaining = demand.quantityUnits;
    let planned = 0;

    for (const source of pool) {
      if (source.sku !== demand.sku) continue;
      const key = `${source.cartonId}::${source.lineId}`;
      const used = consumed.get(key) ?? 0;
      const available = source.quantity - used;
      if (available <= 0) continue;

      const take = Math.min(remaining, available);
      consumed.set(key, used + take);
      steps.push({
        stepKey: `${source.cartonId}:${source.lineId}:${steps.length}`,
        sku: demand.sku,
        productName: demand.productName,
        lot: source.lot,
        expiry: source.expiry,
        condition: source.condition,
        quantity: take,
        binId: source.binId,
        binPath: source.binPath,
        cartonId: source.cartonId,
        cartonCode: source.cartonCode,
        lineId: source.lineId,
        sequence: 0,
        receivedAtIso: source.receivedAtIso,
      });
      remaining -= take;
      planned += take;
      if (remaining <= 0) break;
    }

    if (remaining > 0) {
      shortfalls.push({
        sku: demand.sku,
        productName: demand.productName,
        needed: demand.quantityUnits,
        planned,
      });
    }
  }

  const ordered = sortStepsWalkOrder(steps).map((s, idx) => ({
    ...s,
    sequence: idx + 1,
  }));

  return {
    order,
    steps: ordered,
    shortfalls,
    readyToPick: ordered.length > 0 && shortfalls.length === 0,
  };
}

function pickLineQuantity(
  lines: WarehouseCartonLine[],
  lineId: string,
  pickQty: number,
  input: { binId: string; clientUserId: string }
): { nextLines: WarehouseCartonLine[]; pickedLineId: string; pickedQty: number } {
  const idx = lines.findIndex((l) => l.lineId === lineId);
  if (idx < 0) throw new Error(`Line ${lineId} not found.`);

  const line = lines[idx];
  if (line.binId !== input.binId) {
    throw new Error(`Line ${line.sku} is not in the scanned bin.`);
  }
  if (line.allocationStatus === "picked") {
    throw new Error(`Line ${line.sku} is already picked.`);
  }

  const qty = Math.floor(pickQty);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  if (qty > line.quantity) {
    throw new Error(`Only ${line.quantity} available on ${line.sku}.`);
  }

  const next = [...lines];
  const pickedMeta = {
    allocationStatus: "picked" as const,
    clientId: input.clientUserId,
    inventoryRequestId: line.inventoryRequestId ?? null,
  };

  if (qty === line.quantity) {
    next[idx] = { ...line, ...pickedMeta };
    return { nextLines: next, pickedLineId: line.lineId, pickedQty: qty };
  }

  const newId = nextCartonLineId(next);
  next[idx] = { ...line, quantity: line.quantity - qty };
  next.push({
    ...line,
    lineId: newId,
    quantity: qty,
    ...pickedMeta,
  });
  return { nextLines: next, pickedLineId: newId, pickedQty: qty };
}

export async function markPickOrderStatus(input: {
  clientUserId: string;
  shipmentRequestId: string;
  warehouseId: string;
  status: WarehousePickStatus;
  operatorId?: string | null;
}): Promise<void> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const payload: Record<string, unknown> = {
    warehousePickStatus: input.status,
    warehouseId: input.warehouseId,
    updatedAt: serverTimestamp(),
  };
  if (input.status === "picked") {
    payload.warehousePickedAt = serverTimestamp();
    payload.warehousePickedBy = input.operatorId ?? null;
  }
  await updateDoc(ref, payload);
}

/** Remove a confirmed order from the pick queue without floor picking (legacy / test cleanup). */
export async function skipPickOrder(input: {
  clientUserId: string;
  shipmentRequestId: string;
  warehouseId: string;
  reason?: string;
  operatorId?: string | null;
}): Promise<void> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  await updateDoc(ref, {
    warehousePickStatus: "skipped",
    warehousePickSkipReason:
      input.reason?.trim() || "Removed from pick queue — no warehouse floor pick",
    warehousePickSkippedAt: serverTimestamp(),
    warehousePickSkippedBy: input.operatorId ?? null,
    warehouseId: input.warehouseId,
    updatedAt: serverTimestamp(),
  });
}

/** Scan bin + carton and commit one pick step. */
export async function applyPickStep(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  step: PickTaskStep;
  scannedBinId: string;
  scannedCartonId: string;
  pickQty?: number;
  operatorId?: string | null;
}): Promise<{ pickedQty: number; orderComplete: boolean }> {
  const qty = Math.floor(input.pickQty ?? input.step.quantity);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  if (qty > input.step.quantity) {
    throw new Error(`This step allows at most ${input.step.quantity}.`);
  }
  if (input.scannedBinId !== input.step.binId) {
    throw new Error("Wrong bin — scan the bin shown for this pick step.");
  }
  if (input.scannedCartonId !== input.step.cartonId) {
    throw new Error("Wrong carton — scan the carton shown for this pick step.");
  }

  const carton = await getWarehouseCarton(input.warehouseId, input.step.cartonId);
  if (!carton) throw new Error("Carton not found.");
  if (!isCartonPickable(carton)) {
    throw new Error("This carton cannot be picked (status blocked).");
  }

  const baseLines =
    carton.lines && carton.lines.length > 0
      ? carton.lines
      : [
          {
            lineId: "L1",
            sku: carton.sku,
            quantity: carton.quantity,
            lot: carton.lot ?? null,
            expiry: carton.expiry ?? null,
            condition: (carton.status === "damaged" ? "damaged" : "good") as
              | "good"
              | "damaged",
            binId: carton.binId ?? null,
            allocationStatus: "unallocated" as const,
            clientId: carton.clientId ?? null,
          } satisfies WarehouseCartonLine,
        ];

  const liveLine = baseLines.find((l) => l.lineId === input.step.lineId);
  if (!liveLine || !isLinePickable(carton, liveLine, input.clientUserId)) {
    throw new Error("This line is no longer pickable.");
  }

  const picked = pickLineQuantity(baseLines, input.step.lineId, qty, {
    binId: input.step.binId,
    clientUserId: input.clientUserId,
  });

  const { status, binId } = rollCartonBinStateFromLines(carton, picked.nextLines);

  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
    lines: linesToFirestorePayload(picked.nextLines),
    status,
    binId,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "pick",
    shipmentRequestId: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    cartonId: carton.id,
    cartonCode: carton.cartonCode,
    lineId: picked.pickedLineId,
    sku: input.step.sku,
    quantity: picked.pickedQty,
    condition: input.step.condition,
    lot: input.step.lot,
    fromBinId: input.step.binId,
    fromBinPath: input.step.binPath,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();

  await markPickOrderStatus({
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    warehouseId: input.warehouseId,
    status: "picking",
    operatorId: input.operatorId,
  });

  const snap = await getDoc(
    doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId)
  );
  const order: OutboundPickOrder = {
    id: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    clientDisplayName: "",
    warehousePickStatus: "picking",
    lines: snap.exists()
      ? await orderLinesFromRequest(input.clientUserId, snap.data() as Record<string, unknown>)
      : [],
    confirmedAt: null,
  };

  const plan = await buildPickPlan({ id: input.warehouseId } as WarehouseDoc, order);
  const orderComplete = plan.steps.length === 0 && plan.shortfalls.length === 0;

  if (orderComplete) {
    await markPickOrderStatus({
      clientUserId: input.clientUserId,
      shipmentRequestId: input.shipmentRequestId,
      warehouseId: input.warehouseId,
      status: "picked",
      operatorId: input.operatorId,
    });
  }

  return { pickedQty: picked.pickedQty, orderComplete };
}
