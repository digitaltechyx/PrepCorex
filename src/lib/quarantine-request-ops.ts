import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { parseWarehouseCartonDoc, warehouseCartonDocRef } from "@/lib/warehouse-carton-firestore";
import {
  linesToFirestorePayload,
  nextCartonLineId,
  rollCartonBinStateFromLines,
  rollupCartonStagingArea,
} from "@/lib/warehouse-carton-line-utils";
import {
  findBinByPath,
  inspectBinContents,
  validateLineToArea,
  validateLineToBin,
} from "@/lib/warehouse-putaway";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import { searchInventory } from "@/lib/warehouse-allocate";
import {
  disposeQuarantineLine,
  releaseQuarantineLineToStorage,
} from "@/lib/warehouse-quarantine";
import type {
  InventoryItem,
  QuarantineRequest,
  QuarantineRequestKind,
  QuarantineRequestPick,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

export const QUARANTINE_REQUESTS = "quarantineRequests";

/** A physical line the operator can pull units from to satisfy a request. */
export type QuarantineSourceRow = {
  cartonId: string;
  cartonCode: string;
  lineId: string;
  sku: string;
  productTitle: string | null;
  lot: string | null;
  /** Units available on this line. */
  availableQty: number;
  binId: string | null;
  binPath: string | null;
  stagingArea: string | null;
  locationLabel: string;
};

export function quarantineRequestKindLabel(kind: QuarantineRequestKind): string {
  if (kind === "release") return "Release from quarantine";
  if (kind === "dispose") return "Dispose from quarantine";
  return "Move to quarantine";
}

/** Requests still moving through the workflow (client cannot re-request the same product). */
export function quarantineRequestIsOpen(request: Pick<QuarantineRequest, "status">): boolean {
  return request.status === "pending" || request.status === "approved";
}

/** Product ids with a request still in flight, keyed for quick lookup in pickers. */
export function openQuarantineProductIds(requests: QuarantineRequest[]): Set<string> {
  return new Set(requests.filter(quarantineRequestIsOpen).map((r) => r.productId));
}

async function notifyUser(
  userId: string,
  payload: { title: string; message: string; requestId: string; createdBy: string }
): Promise<void> {
  try {
    await addDoc(collection(db, `users/${userId}/notifications`), {
      type: "quarantine_request",
      title: payload.title,
      message: payload.message,
      isRead: false,
      targetUrl: "/dashboard/quarantine",
      relatedRequestId: payload.requestId,
      createdAt: Timestamp.now(),
      createdBy: payload.createdBy,
    });
  } catch {
    // Notification delivery must never block the request itself.
  }
}

function parseRequest(id: string, data: Record<string, unknown>): QuarantineRequest {
  return { ...(data as Omit<QuarantineRequest, "id">), id };
}

export async function submitQuarantineRequest(input: {
  userId: string;
  userName: string;
  kind: QuarantineRequestKind;
  item: Pick<InventoryItem, "id" | "productName" | "sku">;
  quantity: number;
  reason: string;
  notes?: string | null;
  requestedBy: string;
  requestedByName: string;
  /** Admin raising the request for the client. */
  onBehalf?: boolean;
}): Promise<string> {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Enter a reason for this request.");
  const qty = Math.floor(Number(input.quantity));
  if (!Number.isFinite(qty) || qty < 1) throw new Error("Enter a quantity of at least 1.");

  const ref = await addDoc(collection(db, QUARANTINE_REQUESTS), {
    kind: input.kind,
    userId: input.userId,
    userName: input.userName || "Client",
    productId: input.item.id,
    productName: input.item.productName,
    sku: input.item.sku ?? "",
    quantity: qty,
    reason,
    notes: input.notes?.trim() || null,
    status: "pending",
    requestedAt: serverTimestamp(),
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName || "User",
    onBehalf: Boolean(input.onBehalf),
  });

  if (input.onBehalf) {
    await notifyUser(input.userId, {
      title: "Quarantine request raised for you",
      message: `An admin raised a ${quarantineRequestKindLabel(
        input.kind
      ).toLowerCase()} request for "${input.item.productName}" (${qty} units).`,
      requestId: ref.id,
      createdBy: input.requestedBy,
    });
  }

  return ref.id;
}

export async function approveQuarantineRequest(input: {
  request: QuarantineRequest;
  approverUid: string;
  approverName: string;
}): Promise<void> {
  const ref = doc(db, QUARANTINE_REQUESTS, input.request.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("This request no longer exists.");
  const current = parseRequest(snap.id, snap.data() as Record<string, unknown>);
  if (current.status !== "pending") {
    throw new Error(`This request was already ${current.status}.`);
  }

  await updateDoc(ref, {
    status: "approved",
    approvedBy: input.approverUid,
    approvedByName: input.approverName || "Admin",
    approvedAt: Timestamp.now(),
  });

  await notifyUser(input.request.userId, {
    title: "Quarantine request approved",
    message: `Your request for "${input.request.productName}" was approved. The warehouse will move the stock and mark it completed.`,
    requestId: input.request.id,
    createdBy: input.approverUid,
  });
}

export async function rejectQuarantineRequest(input: {
  request: QuarantineRequest;
  approverUid: string;
  approverName: string;
  adminFeedback?: string;
}): Promise<void> {
  const feedback = input.adminFeedback?.trim() ?? "";
  await updateDoc(doc(db, QUARANTINE_REQUESTS, input.request.id), {
    status: "rejected",
    rejectedBy: input.approverUid,
    rejectedByName: input.approverName || "Admin",
    rejectedAt: Timestamp.now(),
    ...(feedback ? { adminFeedback: feedback } : {}),
  });

  await notifyUser(input.request.userId, {
    title: "Quarantine request rejected",
    message: feedback
      ? `Your request for "${input.request.productName}" was rejected. Reason: ${feedback}`
      : `Your request for "${input.request.productName}" was rejected.`,
    requestId: input.request.id,
    createdBy: input.approverUid,
  });
}

/** Withdraw a request that has not been completed yet. */
export async function cancelQuarantineRequest(requestId: string): Promise<void> {
  await updateDoc(doc(db, QUARANTINE_REQUESTS, requestId), {
    status: "cancelled",
    cancelledAt: Timestamp.now(),
  });
}

export async function listQuarantineRequestsForUser(
  userId: string
): Promise<QuarantineRequest[]> {
  const snap = await getDocs(
    query(collection(db, QUARANTINE_REQUESTS), where("userId", "==", userId))
  );
  return snap.docs
    .map((d) => parseRequest(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => requestSortMs(b) - requestSortMs(a));
}

/** Every request awaiting a decision or a physical move — the warehouse-ops queue. */
export async function listOpenQuarantineRequests(max = 200): Promise<QuarantineRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, QUARANTINE_REQUESTS),
      where("status", "in", ["pending", "approved"]),
      limit(max)
    )
  );
  return snap.docs
    .map((d) => parseRequest(d.id, d.data() as Record<string, unknown>))
    .sort((a, b) => requestSortMs(b) - requestSortMs(a));
}

export async function listRecentQuarantineRequests(max = 100): Promise<QuarantineRequest[]> {
  const snap = await getDocs(
    query(collection(db, QUARANTINE_REQUESTS), orderBy("requestedAt", "desc"), limit(max))
  );
  return snap.docs.map((d) => parseRequest(d.id, d.data() as Record<string, unknown>));
}

export function requestSortMs(request: QuarantineRequest): number {
  const raw = request.requestedAt;
  if (!raw) return 0;
  if (typeof raw === "string") {
    const ms = new Date(raw).getTime();
    return Number.isNaN(ms) ? 0 : ms;
  }
  return (raw.seconds ?? 0) * 1000;
}

/**
 * Where the operator can pull units from for this request.
 * Quarantine requests draw on sellable stock; release/dispose draw on stock already
 * sitting in quarantine.
 */
export async function findQuarantineSources(
  warehouse: WarehouseDoc,
  request: Pick<QuarantineRequest, "kind" | "userId" | "sku" | "productName">
): Promise<QuarantineSourceRow[]> {
  const wantQuarantined = request.kind !== "quarantine";
  const rows = await searchInventory(warehouse, {
    clientId: request.userId,
    sku: request.sku || undefined,
    condition: wantQuarantined ? "damaged" : "good",
  });

  const skuKey = request.sku.trim().toUpperCase();
  const out: QuarantineSourceRow[] = [];

  for (const row of rows) {
    if (skuKey && row.line.sku.trim().toUpperCase() !== skuKey) continue;
    if (row.line.quantity <= 0) continue;
    if (row.line.allocationStatus === "picked") continue;
    if (wantQuarantined) {
      // Only stock that is actually resting in a quarantine location.
      if (row.locationKind !== "quarantine") continue;
      if (row.line.quarantineDisposedAt) continue;
    }
    out.push({
      cartonId: row.cartonId,
      cartonCode: row.cartonCode,
      lineId: row.line.lineId,
      sku: row.line.sku,
      productTitle: row.productTitle,
      lot: row.line.lot ?? null,
      availableQty: row.line.quantity,
      binId: row.line.binId ?? null,
      binPath: row.binPath,
      stagingArea: row.stagingArea,
      locationLabel: row.locationLabel,
    });
  }

  out.sort((a, b) => b.availableQty - a.availableQty || a.cartonCode.localeCompare(b.cartonCode));
  return out;
}

type CompletePick = { cartonId: string; lineId: string; quantity: number };

async function resolveQuarantineDestination(
  warehouseId: string,
  probe: WarehouseCartonLine,
  destBinPath: string | null | undefined,
  destAreaCode: string | null | undefined
): Promise<
  | { kind: "bin"; binId: string; binPath: string }
  | { kind: "area"; areaCode: string }
> {
  const areas = await listWarehouseAreas(warehouseId);
  const path = destBinPath?.trim();

  if (path) {
    const bin = await findBinByPath(warehouseId, path);
    if (!bin) throw new Error(`Bin "${path}" not found in this warehouse.`);
    const contents = await inspectBinContents(warehouseId, bin.id);
    const check = validateLineToBin(probe, bin, contents, areas);
    if (!check.ok) throw new Error(check.reason);
    return { kind: "bin", binId: bin.id, binPath: bin.path };
  }

  const code = destAreaCode?.trim();
  if (!code) throw new Error("Select a destination quarantine bin or area.");
  const area = areas.find((a) => a.code.trim().toUpperCase() === code.toUpperCase());
  if (!area) throw new Error(`Area "${code}" not found in this warehouse.`);
  const check = validateLineToArea(probe, area);
  if (!check.ok) throw new Error(check.reason);
  return { kind: "area", areaCode: area.code };
}

/**
 * Move good units into quarantine: the picked qty is split off its source line as a
 * damaged line resting in the quarantine destination. Client inventory moves the same
 * qty from sellable to `damagedQuantity`.
 */
async function applyMoveToQuarantine(input: {
  warehouse: WarehouseDoc;
  request: QuarantineRequest;
  picks: CompletePick[];
  destBinPath?: string | null;
  destAreaCode?: string | null;
  operatorId?: string | null;
}): Promise<{
  movedQty: number;
  applied: QuarantineRequestPick[];
  dest: { binId: string | null; binPath: string | null; areaCode: string | null };
}> {
  const warehouseId = input.warehouse.id;
  const totalQty = input.picks.reduce((s, p) => s + Math.max(0, Math.floor(p.quantity)), 0);
  if (totalQty < 1) throw new Error("Select at least one source line and quantity.");

  const probe: WarehouseCartonLine = {
    lineId: "probe",
    sku: input.request.sku,
    productTitle: input.request.productName,
    quantity: totalQty,
    lot: null,
    expiry: null,
    condition: "damaged",
    binId: null,
    allocationStatus: "unallocated",
    clientId: input.request.userId,
    inventoryRequestId: null,
  };
  const dest = await resolveQuarantineDestination(
    warehouseId,
    probe,
    input.destBinPath,
    input.destAreaCode
  );

  const byCarton = new Map<string, CompletePick[]>();
  for (const pick of input.picks) {
    if (Math.floor(pick.quantity) < 1) continue;
    const list = byCarton.get(pick.cartonId) ?? [];
    list.push(pick);
    byCarton.set(pick.cartonId, list);
  }

  const now = new Date();
  const applied: QuarantineRequestPick[] = [];
  let movedQty = 0;

  for (const [cartonId, picks] of byCarton) {
    const cartonRef = warehouseCartonDocRef(warehouseId, cartonId);
    const snap = await getDoc(cartonRef);
    if (!snap.exists()) throw new Error("A source carton no longer exists — reload and retry.");
    const carton = parseWarehouseCartonDoc(snap.id, snap.data() as Record<string, unknown>);

    let nextLines = [...(carton.lines ?? [])];
    let cartonMoved = 0;

    for (const pick of picks) {
      const idx = nextLines.findIndex((l) => l.lineId === pick.lineId);
      if (idx < 0) throw new Error(`Line ${pick.lineId} is gone from ${carton.cartonCode}.`);
      const line = nextLines[idx];
      if (line.allocationStatus === "picked") {
        throw new Error(`${line.sku} on ${carton.cartonCode} is already picked for an order.`);
      }
      const qty = Math.min(line.quantity, Math.floor(pick.quantity));
      if (qty < 1) continue;

      const quarantined: WarehouseCartonLine = {
        ...line,
        quantity: qty,
        condition: "damaged",
        binId: dest.kind === "bin" ? dest.binId : null,
        stagingArea: dest.kind === "area" ? dest.areaCode : null,
        quarantineAt: now,
        quarantineReleasedAt: null,
        clientId: line.clientId ?? input.request.userId,
      };

      if (qty === line.quantity) {
        nextLines[idx] = { ...quarantined, lineId: line.lineId };
      } else {
        nextLines[idx] = { ...line, quantity: line.quantity - qty };
        nextLines.push({ ...quarantined, lineId: nextCartonLineId(nextLines) });
      }

      cartonMoved += qty;
      movedQty += qty;
      applied.push({
        cartonId,
        cartonCode: carton.cartonCode,
        lineId: line.lineId,
        locationLabel: line.binId ? `Bin ${line.binId}` : line.stagingArea || "Unplaced",
        quantity: qty,
      });
    }

    if (cartonMoved === 0) continue;

    const rolled = rollCartonBinStateFromLines(carton, nextLines);
    const batch = writeBatch(db);
    batch.update(cartonRef, {
      lines: linesToFirestorePayload(nextLines),
      status: rolled.status,
      binId: rolled.binId,
      stagingArea: rollupCartonStagingArea(nextLines, carton),
      updatedAt: serverTimestamp(),
    });
    batch.set(doc(collection(db, "warehouses", warehouseId, "movementEvents")), {
      type: "quarantine_request_complete",
      requestId: input.request.id,
      requestKind: input.request.kind,
      cartonId,
      cartonCode: carton.cartonCode,
      sku: input.request.sku,
      quantity: cartonMoved,
      condition: "damaged",
      clientUserId: input.request.userId,
      toBinId: dest.kind === "bin" ? dest.binId : null,
      toBinPath: dest.kind === "bin" ? dest.binPath : null,
      toArea: dest.kind === "area" ? dest.areaCode : null,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
    await batch.commit();
  }

  await shiftClientQuantities({
    userId: input.request.userId,
    productId: input.request.productId,
    sku: input.request.sku,
    goodDelta: -movedQty,
    damagedDelta: movedQty,
  });

  return {
    movedQty,
    applied,
    dest: {
      binId: dest.kind === "bin" ? dest.binId : null,
      binPath: dest.kind === "bin" ? dest.binPath : null,
      areaCode: dest.kind === "area" ? dest.areaCode : null,
    },
  };
}

/** Apply signed deltas to the client's sellable / damaged on-hand counters. */
async function shiftClientQuantities(input: {
  userId: string;
  productId: string;
  sku: string;
  goodDelta: number;
  damagedDelta: number;
}): Promise<void> {
  if (input.goodDelta === 0 && input.damagedDelta === 0) return;

  let ref = doc(db, `users/${input.userId}/inventory`, input.productId);
  let snap = await getDoc(ref);
  if (!snap.exists() && input.sku.trim()) {
    const bySku = await getDocs(
      query(
        collection(db, `users/${input.userId}/inventory`),
        where("sku", "==", input.sku.trim()),
        limit(1)
      )
    );
    if (bySku.empty) return;
    ref = bySku.docs[0].ref;
    snap = await getDoc(ref);
  }
  if (!snap.exists()) return;

  const data = snap.data() as { quantity?: number; damagedQuantity?: number };
  const nextGood = Math.max(0, Number(data.quantity ?? 0) + input.goodDelta);
  const nextDamaged = Math.max(0, Number(data.damagedQuantity ?? 0) + input.damagedDelta);

  const patch: Record<string, unknown> = {
    quantity: nextGood,
    damagedQuantity: nextDamaged,
    status: nextGood > 0 ? "In Stock" : "Out of Stock",
    updatedAt: serverTimestamp(),
  };
  if (input.damagedDelta > 0) {
    patch.quarantineAt = serverTimestamp();
  }
  await updateDoc(ref, patch);
}

/**
 * Warehouse ops marks the request done after physically moving the stock.
 * `quarantine` writes the new good → quarantine path; `release` and `dispose`
 * delegate to the existing quarantine exit helpers so their audit trail is unchanged.
 */
export async function completeQuarantineRequest(input: {
  request: QuarantineRequest;
  warehouse: WarehouseDoc;
  picks: CompletePick[];
  /** Quarantine + release need a destination bin; area is the fallback for bin-less zones. */
  destBinPath?: string | null;
  destAreaCode?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
}): Promise<{ movedQty: number }> {
  const ref = doc(db, QUARANTINE_REQUESTS, input.request.id);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("This request no longer exists.");
  const current = parseRequest(snap.id, snap.data() as Record<string, unknown>);
  if (!quarantineRequestIsOpen(current)) {
    throw new Error(`This request was already ${current.status}.`);
  }

  let movedQty = 0;
  let applied: QuarantineRequestPick[] = [];
  let dest: { binId: string | null; binPath: string | null; areaCode: string | null } = {
    binId: null,
    binPath: null,
    areaCode: null,
  };

  if (input.request.kind === "quarantine") {
    const result = await applyMoveToQuarantine({
      warehouse: input.warehouse,
      request: input.request,
      picks: input.picks,
      destBinPath: input.destBinPath,
      destAreaCode: input.destAreaCode,
      operatorId: input.operatorId,
    });
    movedQty = result.movedQty;
    applied = result.applied;
    dest = result.dest;
  } else if (input.request.kind === "release") {
    const path = input.destBinPath?.trim();
    if (!path) throw new Error("Scan or select the storage bin the stock is going back into.");
    for (const pick of input.picks) {
      const qty = Math.floor(pick.quantity);
      if (qty < 1) continue;
      const result = await releaseQuarantineLineToStorage({
        warehouseId: input.warehouse.id,
        cartonId: pick.cartonId,
        lineId: pick.lineId,
        destBinPath: path,
        quantity: qty,
        operatorId: input.operatorId,
      });
      movedQty += result.releasedQty;
      applied.push({
        cartonId: pick.cartonId,
        cartonCode: pick.cartonId,
        lineId: pick.lineId,
        locationLabel: path,
        quantity: result.releasedQty,
      });
    }
    dest = { binId: null, binPath: path ?? null, areaCode: null };
  } else {
    for (const pick of input.picks) {
      const qty = Math.floor(pick.quantity);
      if (qty < 1) continue;
      const result = await disposeQuarantineLine({
        warehouseId: input.warehouse.id,
        cartonId: pick.cartonId,
        lineId: pick.lineId,
        quantity: qty,
        auto: false,
        operatorId: input.operatorId,
        operatorName: input.operatorName,
      });
      movedQty += result.disposedQty;
      applied.push({
        cartonId: pick.cartonId,
        cartonCode: pick.cartonId,
        lineId: pick.lineId,
        locationLabel: "Disposed",
        quantity: result.disposedQty,
      });
    }
  }

  if (movedQty < 1) throw new Error("Nothing was moved — check the picked quantities.");

  await updateDoc(ref, {
    status: "completed",
    completedBy: input.operatorId ?? null,
    completedByName: input.operatorName || "Warehouse operator",
    completedAt: Timestamp.now(),
    completedQty: movedQty,
    warehouseId: input.warehouse.id,
    warehouseCode: input.warehouse.code ?? null,
    destBinId: dest.binId,
    destBinPath: dest.binPath,
    destAreaCode: dest.areaCode,
    picks: applied,
  });

  await notifyUser(input.request.userId, {
    title: `${quarantineRequestKindLabel(input.request.kind)} completed`,
    message: `${movedQty} unit${movedQty === 1 ? "" : "s"} of "${
      input.request.productName
    }" ${input.request.kind === "dispose" ? "were disposed" : "were moved"} by the warehouse.`,
    requestId: input.request.id,
    createdBy: input.operatorId ?? "warehouse",
  });

  return { movedQty };
}
