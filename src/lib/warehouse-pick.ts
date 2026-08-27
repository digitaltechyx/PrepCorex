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
  listWarehouseCartons,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import { isExpiryPast } from "@/lib/warehouse-carton-states";
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
  hasLineExpiry,
} from "@/lib/warehouse-stock-sort";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import { orderLinesForRequests } from "@/lib/warehouse-outbound-lines";
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
  /** Customer remarks from the shipment request. */
  remarks?: string | null;
};

/** One putaway location/batch the picker may take from (FEFO flexible mode). */
export type PickBatchOption = {
  cartonId: string;
  cartonCode: string;
  lineId: string;
  binId: string;
  binPath: string;
  lot: string | null;
  expiry: string | null;
  quantity: number;
  condition: "good" | "damaged";
  receivedAtIso: string;
};

export type PickTaskStep = {
  stepKey: string;
  sku: string;
  productName: string;
  lot: string | null;
  expiry: string | null;
  condition: "good" | "damaged";
  /** Units still needed for this SKU (FEFO) or units allocated to this locked step (FIFO). */
  quantity: number;
  binId: string;
  binPath: string;
  cartonId: string;
  cartonCode: string;
  lineId: string;
  sequence: number;
  /** For FIFO when line has no expiry. */
  receivedAtIso: string;
  /**
   * When true, show all `batchOptions` and allow picking from any of them.
   * Bin/carton on the step are the suggested (earliest expiry) location only.
   */
  allowAnyBatch?: boolean;
  batchOptions?: PickBatchOption[];
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

type PickMovementEvent = {
  sku: string;
  quantity: number;
};

export type DetailedPickMovementEvent = {
  type: "pick" | "pick_reverse";
  sku: string;
  quantity: number;
  cartonId: string;
  cartonCode: string;
  lineId: string;
  fromBinId: string;
  fromBinPath: string;
  atMs: number;
};

export type OutboundPickSourceHint = {
  sku: string;
  binPath: string;
  cartonCode: string;
  quantity: number;
};

function eventAtMs(value: unknown): number {
  if (!value) return 0;
  if (typeof value === "object" && value !== null && "seconds" in value) {
    return Number((value as { seconds: number }).seconds) * 1000;
  }
  if (typeof value === "string") {
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  return 0;
}

async function loadDetailedPickMovementEvents(
  warehouseId: string,
  shipmentRequestId: string
): Promise<DetailedPickMovementEvent[]> {
  const types = new Set(["pick", "pick_reverse"]);
  try {
    const snap = await getDocs(
      query(
        collection(db, WAREHOUSES, warehouseId, "movementEvents"),
        where("shipmentRequestId", "==", shipmentRequestId)
      )
    );
    return snap.docs
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const type = String(data.type ?? "");
        if (!types.has(type)) return null;
        return {
          type: type as "pick" | "pick_reverse",
          sku: String(data.sku ?? ""),
          quantity: Math.max(0, Math.floor(Number(data.quantity) || 0)),
          cartonId: String(data.cartonId ?? ""),
          cartonCode: String(data.cartonCode ?? ""),
          lineId: String(data.lineId ?? ""),
          fromBinId: String(data.fromBinId ?? ""),
          fromBinPath: String(data.fromBinPath ?? ""),
          atMs: eventAtMs(data.at),
        } satisfies DetailedPickMovementEvent;
      })
      .filter((row): row is DetailedPickMovementEvent => Boolean(row));
  } catch {
    const snap = await getDocs(collection(db, WAREHOUSES, warehouseId, "movementEvents"));
    return snap.docs
      .filter((d) => String(d.data().shipmentRequestId ?? "") === shipmentRequestId)
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        const type = String(data.type ?? "");
        if (!types.has(type)) return null;
        return {
          type: type as "pick" | "pick_reverse",
          sku: String(data.sku ?? ""),
          quantity: Math.max(0, Math.floor(Number(data.quantity) || 0)),
          cartonId: String(data.cartonId ?? ""),
          cartonCode: String(data.cartonCode ?? ""),
          lineId: String(data.lineId ?? ""),
          fromBinId: String(data.fromBinId ?? ""),
          fromBinPath: String(data.fromBinPath ?? ""),
          atMs: eventAtMs(data.at),
        } satisfies DetailedPickMovementEvent;
      })
      .filter((row): row is DetailedPickMovementEvent => Boolean(row));
  }
}

/** Net floor-picked units per SKU (pick minus pick_reverse). */
export async function loadNetPickedBySku(
  warehouseId: string,
  shipmentRequestId: string
): Promise<Map<string, number>> {
  const events = await loadDetailedPickMovementEvents(warehouseId, shipmentRequestId);
  const net = new Map<string, number>();
  for (const event of events) {
    if (!event.sku || event.quantity < 1) continue;
    const signed = event.type === "pick_reverse" ? -event.quantity : event.quantity;
    net.set(event.sku, (net.get(event.sku) ?? 0) + signed);
  }
  for (const [sku, qty] of net) {
    if (qty <= 0) net.delete(sku);
    else net.set(sku, qty);
  }
  return net;
}

async function loadPickEventsForOrder(
  warehouseId: string,
  shipmentRequestId: string
): Promise<PickMovementEvent[]> {
  const net = await loadNetPickedBySku(warehouseId, shipmentRequestId);
  return [...net.entries()].map(([sku, quantity]) => ({ sku, quantity }));
}

/** True when pick movement events satisfy every order line (picked lines are excluded from the pick plan pool). */
export async function isOrderFullyPicked(
  warehouseId: string,
  order: OutboundPickOrder
): Promise<boolean> {
  if (order.lines.length === 0) return false;
  const events = await loadPickEventsForOrder(warehouseId, order.id);
  const pickedBySku = new Map<string, number>();
  for (const e of events) {
    if (!e.sku) continue;
    pickedBySku.set(e.sku, (pickedBySku.get(e.sku) ?? 0) + e.quantity);
  }
  return order.lines.every((line) => (pickedBySku.get(line.sku) ?? 0) >= line.quantityUnits);
}

/** Promote stuck "picking" orders to "picked" when floor picks already satisfy demand. */
export async function reconcilePickOrderStatusIfComplete(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  lines: OutboundPickLine[];
  operatorId?: string | null;
}): Promise<boolean> {
  const ref = doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return false;

  const pickStatus = pickStatusFromRequest(snap.data() as Record<string, unknown>);
  if (pickStatus !== "picking") return false;

  const order: OutboundPickOrder = {
    id: input.shipmentRequestId,
    clientUserId: input.clientUserId,
    clientDisplayName: "",
    warehousePickStatus: "picking",
    lines: input.lines,
    confirmedAt: null,
  };

  if (!(await isOrderFullyPicked(input.warehouseId, order))) return false;

  await markPickOrderStatus({
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    warehouseId: input.warehouseId,
    status: "picked",
    operatorId: input.operatorId,
  });
  return true;
}

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

function remarksFromRequest(data: Record<string, unknown>): string | null {
  const remarks = String(data.remarks ?? "").trim();
  return remarks || null;
}

function displayClient(client: UserProfile | undefined, userId: string): string {
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

function sourceToBatchOption(source: PickSource): PickBatchOption {
  return {
    cartonId: source.cartonId,
    cartonCode: source.cartonCode,
    lineId: source.lineId,
    binId: source.binId,
    binPath: source.binPath,
    lot: source.lot,
    expiry: source.expiry,
    quantity: source.quantity,
    condition: source.condition,
    receivedAtIso: source.receivedAtIso,
  };
}

function batchOptionKey(option: Pick<PickBatchOption, "cartonId" | "lineId">): string {
  return `${option.cartonId}::${option.lineId}`;
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

async function orderLinesFromRequest(
  clientUserId: string,
  data: Record<string, unknown>
): Promise<OutboundPickLine[]> {
  const [lines] = await orderLinesForRequests([{ clientUserId, data }]);
  return lines ?? [];
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

  type PendingPick = {
    id: string;
    clientUserId: string;
    data: Record<string, unknown>;
    pickStatus: WarehousePickStatus;
  };
  const pending: PendingPick[] = [];

  for (const d of docs) {
    const data = d.data();
    const clientUserId = d.ref.path.split("/")[1] ?? "";
    if (!eligible.has(clientUserId)) continue;

    const pickStatus = pickStatusFromRequest(data);
    if (pickStatus === "picked" || pickStatus === "skipped") continue;

    pending.push({ id: d.id, clientUserId, data, pickStatus });
  }

  const lineSets = await orderLinesForRequests(
    pending.map((p) => ({ clientUserId: p.clientUserId, data: p.data }))
  );

  const orders: OutboundPickOrder[] = [];
  pending.forEach((p, index) => {
    const lines = lineSets[index] ?? [];
    if (lines.length === 0) return;
    orders.push({
      id: p.id,
      clientUserId: p.clientUserId,
      clientDisplayName: displayClient(clientById.get(p.clientUserId), p.clientUserId),
      shipTo: p.data.shipTo != null ? String(p.data.shipTo) : undefined,
      confirmedAt: dateFromFirestore(p.data.confirmedAt),
      warehousePickStatus: p.pickStatus,
      lines,
      remarks: remarksFromRequest(p.data),
    });
  });

  orders.sort((a, b) => {
    const ta = a.confirmedAt?.getTime() ?? 0;
    const tb = b.confirmedAt?.getTime() ?? 0;
    return tb - ta;
  });
  return orders;
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

export async function buildPickPlan(
  warehouse: WarehouseDoc,
  order: OutboundPickOrder
): Promise<PickPlan> {
  const [cartons, binPath, pickEvents] = await Promise.all([
    listWarehouseCartons(warehouse.id),
    getBinPathMap(warehouse.id),
    loadPickEventsForOrder(warehouse.id, order.id),
  ]);

  const alreadyPickedBySku = new Map<string, number>();
  for (const event of pickEvents) {
    if (!event.sku) continue;
    alreadyPickedBySku.set(
      event.sku,
      (alreadyPickedBySku.get(event.sku) ?? 0) + event.quantity
    );
  }

  const pool = sortSourcesFefoFifo(collectPickSources(cartons, binPath, order.clientUserId));
  const consumed = new Map<string, number>();
  const steps: PickTaskStep[] = [];
  const shortfalls: PickPlan["shortfalls"] = [];

  for (const demand of order.lines) {
    const alreadyPicked = alreadyPickedBySku.get(demand.sku) ?? 0;
    let remaining = Math.max(0, demand.quantityUnits - alreadyPicked);
    if (remaining <= 0) continue;

    const skuSources = pool.filter((source) => source.sku === demand.sku);
    const hasExpiryBatch = skuSources.some((source) => hasLineExpiry(source.expiry));

    if (hasExpiryBatch) {
      // FEFO flexible: one step listing every putaway batch; picker chooses.
      const options: PickBatchOption[] = [];
      let availableTotal = 0;
      for (const source of skuSources) {
        const key = batchOptionKey(source);
        const used = consumed.get(key) ?? 0;
        const available = source.quantity - used;
        if (available <= 0) continue;
        options.push({ ...sourceToBatchOption(source), quantity: available });
        availableTotal += available;
      }

      if (options.length === 0) {
        shortfalls.push({
          sku: demand.sku,
          productName: demand.productName,
          needed: demand.quantityUnits,
          planned: alreadyPicked,
        });
        continue;
      }

      const planned = Math.min(remaining, availableTotal);
      const suggested = options[0];
      steps.push({
        stepKey: `fefo:${demand.sku}:${steps.length}`,
        sku: demand.sku,
        productName: demand.productName,
        lot: suggested.lot,
        expiry: suggested.expiry,
        condition: suggested.condition,
        quantity: planned,
        binId: suggested.binId,
        binPath: suggested.binPath,
        cartonId: suggested.cartonId,
        cartonCode: suggested.cartonCode,
        lineId: suggested.lineId,
        sequence: 0,
        receivedAtIso: suggested.receivedAtIso,
        allowAnyBatch: true,
        batchOptions: options,
      });

      // Reserve capacity across options so later SKU lines cannot double-count.
      let toReserve = planned;
      for (const option of options) {
        if (toReserve <= 0) break;
        const take = Math.min(toReserve, option.quantity);
        const key = batchOptionKey(option);
        consumed.set(key, (consumed.get(key) ?? 0) + take);
        toReserve -= take;
      }

      if (planned < remaining) {
        shortfalls.push({
          sku: demand.sku,
          productName: demand.productName,
          needed: demand.quantityUnits,
          planned: alreadyPicked + planned,
        });
      }
      continue;
    }

    // FIFO locked: allocate specific bin/carton steps (oldest receive first).
    let planned = 0;
    for (const source of skuSources) {
      const key = batchOptionKey(source);
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
        allowAnyBatch: false,
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
        planned: alreadyPicked + planned,
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

function unpickLineQuantity(
  lines: WarehouseCartonLine[],
  lineId: string,
  unpickQty: number,
  input: { binId: string }
): { nextLines: WarehouseCartonLine[]; unpickedQty: number } {
  const idx = lines.findIndex((l) => l.lineId === lineId);
  if (idx < 0) throw new Error(`Line ${lineId} not found.`);

  const line = lines[idx];
  if (line.allocationStatus !== "picked") {
    throw new Error(`Line ${line.sku} is not picked.`);
  }

  const qty = Math.min(Math.floor(unpickQty), line.quantity);
  if (qty < 1) throw new Error("Unpick quantity must be at least 1.");

  const next = [...lines];
  if (qty === line.quantity) {
    next[idx] = { ...line, allocationStatus: "unallocated" as const };
    return { nextLines: next, unpickedQty: qty };
  }

  const newId = nextCartonLineId(next);
  next[idx] = { ...line, quantity: line.quantity - qty };
  next.push({
    ...line,
    lineId: newId,
    quantity: qty,
    binId: input.binId || line.binId,
    allocationStatus: "unallocated" as const,
  });
  return { nextLines: next, unpickedQty: qty };
}

/**
 * Return units from picked cartons back to the floor for one SKU (LIFO by pick time).
 */
export async function reverseWarehousePicksForSkuQuantity(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  sku: string;
  unitsToUnpick: number;
  operatorId?: string | null;
  reason?: string | null;
}): Promise<number> {
  const sku = input.sku.trim();
  const target = Math.floor(input.unitsToUnpick);
  if (!sku || target < 1) return 0;

  const events = (await loadDetailedPickMovementEvents(input.warehouseId, input.shipmentRequestId))
    .filter((e) => e.type === "pick" && e.sku === sku && e.quantity > 0)
    .sort((a, b) => b.atMs - a.atMs);

  if (events.length === 0) return 0;

  const batch = writeBatch(db);
  let remaining = target;
  let totalUnpicked = 0;

  for (const event of events) {
    if (remaining <= 0) break;

    const carton = await getWarehouseCarton(input.warehouseId, event.cartonId);
    if (!carton) continue;

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

    const liveLine = baseLines.find((l) => l.lineId === event.lineId);
    if (!liveLine || liveLine.allocationStatus !== "picked") continue;

    const take = Math.min(remaining, liveLine.quantity, event.quantity);
    if (take < 1) continue;

    const unpicked = unpickLineQuantity(baseLines, event.lineId, take, {
      binId: event.fromBinId || liveLine.binId || "",
    });
    remaining -= unpicked.unpickedQty;
    totalUnpicked += unpicked.unpickedQty;

    const { status, binId } = rollCartonBinStateFromLines(carton, unpicked.nextLines);
    batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
      lines: linesToFirestorePayload(unpicked.nextLines),
      status,
      binId,
      updatedAt: serverTimestamp(),
    });

    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "pick_reverse",
      shipmentRequestId: input.shipmentRequestId,
      clientUserId: input.clientUserId,
      cartonId: carton.id,
      cartonCode: carton.cartonCode,
      lineId: event.lineId,
      sku,
      quantity: unpicked.unpickedQty,
      fromBinId: event.fromBinId || liveLine.binId || null,
      fromBinPath: event.fromBinPath || null,
      operatorId: input.operatorId ?? null,
      reason: input.reason?.trim() || null,
      at: serverTimestamp(),
    });
  }

  if (totalUnpicked < 1) return 0;
  await batch.commit();
  return totalUnpicked;
}

/** Bins/cartons already used when picking this SKU on the order (for qty-increase hints). */
export async function getPickSourceHintsForSku(input: {
  warehouseId: string;
  shipmentRequestId: string;
  sku: string;
}): Promise<OutboundPickSourceHint[]> {
  const sku = input.sku.trim();
  if (!sku) return [];

  const events = (await loadDetailedPickMovementEvents(input.warehouseId, input.shipmentRequestId))
    .filter((e) => e.sku === sku)
    .sort((a, b) => a.atMs - b.atMs);

  const netByKey = new Map<string, OutboundPickSourceHint>();
  for (const event of events) {
    const key = `${event.fromBinPath || event.fromBinId}::${event.cartonCode || event.cartonId}`;
    const signed = event.type === "pick_reverse" ? -event.quantity : event.quantity;
    if (signed === 0) continue;
    const existing = netByKey.get(key) ?? {
      sku,
      binPath: event.fromBinPath || event.fromBinId || "—",
      cartonCode: event.cartonCode || event.cartonId,
      quantity: 0,
    };
    existing.quantity += signed;
    netByKey.set(key, existing);
  }

  return [...netByKey.values()].filter((row) => row.quantity > 0);
}

export async function reconcilePickStatusAfterLineEdit(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  lines: OutboundPickLine[];
  operatorId?: string | null;
}): Promise<void> {
  const net = await loadNetPickedBySku(input.warehouseId, input.shipmentRequestId);
  const anyPicks = net.size > 0;
  const fullyPicked =
    input.lines.length > 0 &&
    input.lines.every((line) => (net.get(line.sku) ?? 0) >= line.quantityUnits);

  if (fullyPicked) {
    await markPickOrderStatus({
      clientUserId: input.clientUserId,
      shipmentRequestId: input.shipmentRequestId,
      warehouseId: input.warehouseId,
      status: "picked",
      operatorId: input.operatorId,
    });
    return;
  }

  await markPickOrderStatus({
    clientUserId: input.clientUserId,
    shipmentRequestId: input.shipmentRequestId,
    warehouseId: input.warehouseId,
    status: anyPicks ? "picking" : "ready",
    operatorId: input.operatorId,
  });
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

/** Scan bin (+ optional carton) and commit one pick step. */
export async function applyPickStep(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  step: PickTaskStep;
  scannedBinId: string;
  /** When omitted/empty, the planned carton for this step is used (FIFO) or resolved from batch options (FEFO). */
  scannedCartonId?: string | null;
  pickQty?: number;
  operatorId?: string | null;
}): Promise<{ pickedQty: number; orderComplete: boolean }> {
  const qty = Math.floor(input.pickQty ?? input.step.quantity);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  if (qty > input.step.quantity) {
    throw new Error(`This step allows at most ${input.step.quantity}.`);
  }

  const selected = resolvePickTarget(input.step, {
    scannedBinId: input.scannedBinId,
    scannedCartonId: input.scannedCartonId,
  });
  if (qty > selected.quantity) {
    throw new Error(`Only ${selected.quantity} available in this batch.`);
  }

  const carton = await getWarehouseCarton(input.warehouseId, selected.cartonId);
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

  const liveLine = baseLines.find((l) => l.lineId === selected.lineId);
  if (!liveLine || !isLinePickable(carton, liveLine, input.clientUserId)) {
    throw new Error("This line is no longer pickable.");
  }

  const picked = pickLineQuantity(baseLines, selected.lineId, qty, {
    binId: selected.binId,
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
    condition: selected.condition,
    lot: selected.lot,
    expiry: selected.expiry,
    fromBinId: selected.binId,
    fromBinPath: selected.binPath,
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
    remarks: snap.exists()
      ? remarksFromRequest(snap.data() as Record<string, unknown>)
      : null,
  };

  const orderComplete = await isOrderFullyPicked(input.warehouseId, order);

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

function resolvePickTarget(
  step: PickTaskStep,
  input: { scannedBinId: string; scannedCartonId?: string | null }
): PickBatchOption {
  const scannedCartonId = String(input.scannedCartonId ?? "").trim();

  if (!step.allowAnyBatch) {
    if (input.scannedBinId !== step.binId) {
      throw new Error("Wrong bin — scan the bin shown for this pick step.");
    }
    if (scannedCartonId && scannedCartonId !== step.cartonId) {
      throw new Error("Wrong carton — scan the carton shown for this pick step.");
    }
    return {
      cartonId: step.cartonId,
      cartonCode: step.cartonCode,
      lineId: step.lineId,
      binId: step.binId,
      binPath: step.binPath,
      lot: step.lot,
      expiry: step.expiry,
      quantity: step.quantity,
      condition: step.condition,
      receivedAtIso: step.receivedAtIso,
    };
  }

  const options = step.batchOptions ?? [];
  if (options.length === 0) {
    throw new Error("No expiry batches available for this pick.");
  }

  const inBin = options.filter((option) => option.binId === input.scannedBinId);
  if (inBin.length === 0) {
    throw new Error("Wrong bin — scan one of the listed batch bins for this product.");
  }

  let matched = inBin;
  if (scannedCartonId) {
    matched = inBin.filter((option) => option.cartonId === scannedCartonId);
    if (matched.length === 0) {
      throw new Error("Wrong carton — that carton is not one of the listed batches in this bin.");
    }
  } else {
    const cartonIds = new Set(inBin.map((option) => option.cartonId));
    if (cartonIds.size > 1) {
      throw new Error("Multiple cartons in this bin — scan the carton for the batch you are picking.");
    }
  }

  // Prefer earliest expiry among remaining matches (suggestion order).
  return [...matched].sort((a, b) =>
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
  )[0];
}

type PickReverseEvent = {
  cartonId: string;
  lineId: string;
};

async function loadPickReverseEvents(
  warehouseId: string,
  shipmentRequestId: string
): Promise<PickReverseEvent[]> {
  try {
    const snap = await getDocs(
      query(
        collection(db, WAREHOUSES, warehouseId, "movementEvents"),
        where("type", "==", "pick"),
        where("shipmentRequestId", "==", shipmentRequestId)
      )
    );
    return snap.docs.map((d) => {
      const data = d.data() as Record<string, unknown>;
      return {
        cartonId: String(data.cartonId ?? "").trim(),
        lineId: String(data.lineId ?? "").trim(),
      };
    });
  } catch {
    const snap = await getDocs(
      query(collection(db, WAREHOUSES, warehouseId, "movementEvents"), where("type", "==", "pick"))
    );
    return snap.docs
      .filter((d) => String(d.data().shipmentRequestId ?? "") === shipmentRequestId)
      .map((d) => {
        const data = d.data() as Record<string, unknown>;
        return {
          cartonId: String(data.cartonId ?? "").trim(),
          lineId: String(data.lineId ?? "").trim(),
        };
      });
  }
}

/**
 * Undo floor picks for a shipment: mark picked carton lines as unallocated again.
 * No-op when there are no pick events (approved but not yet picked).
 */
export async function reverseWarehousePicksForShipment(input: {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  operatorId?: string | null;
}): Promise<void> {
  const events = await loadPickReverseEvents(input.warehouseId, input.shipmentRequestId);
  const byCarton = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.cartonId || !e.lineId) continue;
    const set = byCarton.get(e.cartonId) ?? new Set<string>();
    set.add(e.lineId);
    byCarton.set(e.cartonId, set);
  }
  if (byCarton.size === 0) return;

  const batch = writeBatch(db);
  let reversedLineCount = 0;

  for (const [cartonId, lineIds] of byCarton) {
    const carton = await getWarehouseCarton(input.warehouseId, cartonId);
    if (!carton) continue;

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

    const restoredIds: string[] = [];
    const nextLines = baseLines.map((line) => {
      if (!lineIds.has(line.lineId) || line.allocationStatus !== "picked") return line;
      restoredIds.push(line.lineId);
      return {
        ...line,
        allocationStatus: "unallocated" as const,
      };
    });

    if (restoredIds.length === 0) continue;
    reversedLineCount += restoredIds.length;

    const { status, binId } = rollCartonBinStateFromLines(carton, nextLines);
    batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
      lines: linesToFirestorePayload(nextLines),
      status,
      binId,
      updatedAt: serverTimestamp(),
    });

    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "outbound_cancel_unpick",
      shipmentRequestId: input.shipmentRequestId,
      clientUserId: input.clientUserId,
      cartonId: carton.id,
      cartonCode: carton.cartonCode,
      lineIds: restoredIds,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }

  if (reversedLineCount === 0) return;
  await batch.commit();
}
