import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  computeFirstInvoiceDate,
  computeFreeUntil,
} from "@/lib/pallet-storage-billing";
import type { PalletStoragePosition, PalletStoragePositionContent } from "@/types";

/** One billable storage pallet holds at most this many cartons. */
export const CARTONS_PER_STORAGE_PALLET = 10;

function activePositionsQuery(userId: string) {
  return query(
    collection(db, `users/${userId}/palletStoragePositions`),
    where("status", "==", "active")
  );
}

export function positionCartonCapacity(p: Pick<PalletStoragePosition, "cartonCapacity">): number {
  const n = Number(p.cartonCapacity);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : CARTONS_PER_STORAGE_PALLET;
}

export function positionCartonCount(p: Pick<PalletStoragePosition, "cartonCount" | "hasSpace">): number {
  if (typeof p.cartonCount === "number" && Number.isFinite(p.cartonCount)) {
    return Math.max(0, Math.floor(p.cartonCount));
  }
  // Legacy positions without cartonCount — treat "full" as at capacity.
  if (p.hasSpace === false) return CARTONS_PER_STORAGE_PALLET;
  return 0;
}

export function positionRemainingCartonSlots(p: PalletStoragePosition): number {
  return Math.max(0, positionCartonCapacity(p) - positionCartonCount(p));
}

export function isPositionFull(p: PalletStoragePosition): boolean {
  return positionRemainingCartonSlots(p) <= 0;
}

export async function listActivePalletStoragePositions(
  userId: string
): Promise<PalletStoragePosition[]> {
  const snap = await getDocs(activePositionsQuery(userId));
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<PalletStoragePosition, "id">) }))
    .sort((a, b) => String(a.label || "").localeCompare(String(b.label || ""), undefined, { numeric: true }));
}

async function nextPositionLabel(userId: string): Promise<string> {
  const active = await listActivePalletStoragePositions(userId);
  const used = new Set(active.map((p) => String(p.label || "").toUpperCase()));
  let n = 1;
  while (used.has(`P${n}`)) n += 1;
  return `P${n}`;
}

export type AssignPalletStorageInput = {
  userId: string;
  warehouseId?: string | null;
  receiveBatchId?: string | null;
  receiveReference?: string | null;
  notes?: string | null;
  contents?: Array<{ sku?: string; productName?: string; quantity?: number; notes?: string }>;
  assignedBy?: string | null;
  hasSpace?: boolean;
  /** Physical cartons added in this assignment. */
  cartonsToAdd?: number;
};

async function createPositionWithCycle(
  input: AssignPalletStorageInput,
  label: string,
  cartonCount = 0
): Promise<{ positionId: string; cycleId: string; label: string; cartonCount: number }> {
  const now = new Date();
  const assignedAt = Timestamp.fromDate(now);
  const freeUntil = Timestamp.fromDate(computeFreeUntil(now));
  const nextInvoiceDate = Timestamp.fromDate(computeFirstInvoiceDate(now));
  const capacity = CARTONS_PER_STORAGE_PALLET;
  const count = Math.min(capacity, Math.max(0, Math.floor(cartonCount)));
  const hasSpace = count < capacity;

  const cycleRef = await addDoc(collection(db, `users/${input.userId}/palletStorageCycles`), {
    status: "active",
    source: "warehouse_receive",
    positionLabel: label,
    assignedAt,
    freeUntil,
    nextInvoiceDate,
    paidCycleCount: 0,
    warehouseId: input.warehouseId ?? null,
    receiveBatchId: input.receiveBatchId ?? null,
    receiveReference: input.receiveReference ?? null,
    assignedBy: input.assignedBy ?? null,
    note: input.notes?.trim() || "Assigned at warehouse receive",
    hasSpace,
    cartonCount: count,
    cartonCapacity: capacity,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const positionRef = await addDoc(collection(db, `users/${input.userId}/palletStoragePositions`), {
    label,
    status: "active",
    cycleId: cycleRef.id,
    hasSpace,
    cartonCount: count,
    cartonCapacity: capacity,
    warehouseId: input.warehouseId ?? null,
    receiveBatchId: input.receiveBatchId ?? null,
    notes: input.notes?.trim() || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    assignedBy: input.assignedBy ?? null,
  });

  await updateDoc(cycleRef, { positionId: positionRef.id });

  if (input.contents?.length) {
    for (const line of input.contents) {
      if (!line.sku && !line.productName && !line.notes) continue;
      await addDoc(
        collection(db, `users/${input.userId}/palletStoragePositions/${positionRef.id}/contents`),
        {
          sku: line.sku?.trim() || null,
          productName: line.productName?.trim() || null,
          quantity: Math.max(0, Number(line.quantity) || 0),
          notes: line.notes?.trim() || null,
          receiveBatchId: input.receiveBatchId ?? null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        } satisfies Omit<PalletStoragePositionContent, "id">
      );
    }
  }

  return { positionId: positionRef.id, cycleId: cycleRef.id, label, cartonCount: count };
}

/** Create one or more new billable pallet positions (+ cycles). */
export async function assignNewPalletStoragePositions(
  input: AssignPalletStorageInput & { count: number; cartonsPerNewPallet?: number[] }
): Promise<Array<{ positionId: string; cycleId: string; label: string; cartonCount: number }>> {
  const count = Math.min(500, Math.max(1, Math.floor(input.count)));
  const created: Array<{ positionId: string; cycleId: string; label: string; cartonCount: number }> =
    [];
  for (let i = 0; i < count; i += 1) {
    const label = await nextPositionLabel(input.userId);
    const startCartons = input.cartonsPerNewPallet?.[i] ?? 0;
    created.push(await createPositionWithCycle(input, label, startCartons));
  }
  return created;
}

/** Add receive contents / cartons to an existing pallet (enforces 10-carton limit). */
export async function addToExistingPalletPosition(
  input: AssignPalletStorageInput & { positionId: string; markHasSpace?: boolean }
): Promise<{ cartonCount: number; capacity: number; full: boolean }> {
  const posRef = doc(db, `users/${input.userId}/palletStoragePositions`, input.positionId);
  const snap = await getDoc(posRef);
  if (!snap.exists()) throw new Error("Pallet position not found.");
  const pos = { id: snap.id, ...(snap.data() as Omit<PalletStoragePosition, "id">) };
  const capacity = positionCartonCapacity(pos);
  const current = positionCartonCount(pos);
  const add = Math.max(0, Math.floor(input.cartonsToAdd ?? 0));
  if (add > 0 && current + add > capacity) {
    throw new Error(
      `${pos.label} only has ${capacity - current} carton slot${capacity - current === 1 ? "" : "s"} left (limit ${capacity} per pallet). Create a new pallet for the rest.`
    );
  }
  const nextCount = current + add;
  const full = nextCount >= capacity;
  const hasSpace =
    input.markHasSpace !== undefined ? input.markHasSpace && !full : !full;

  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
    cartonCount: nextCount,
    cartonCapacity: capacity,
    hasSpace,
  };
  if (input.notes?.trim()) {
    patch.notes = input.notes.trim();
  }
  await updateDoc(posRef, patch);

  if (input.contents?.length) {
    for (const line of input.contents) {
      if (!line.sku && !line.productName && !line.notes) continue;
      await addDoc(
        collection(db, `users/${input.userId}/palletStoragePositions/${input.positionId}/contents`),
        {
          sku: line.sku?.trim() || null,
          productName: line.productName?.trim() || null,
          quantity: Math.max(0, Number(line.quantity) || 0),
          notes: line.notes?.trim() || null,
          receiveBatchId: input.receiveBatchId ?? null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }
      );
    }
  }

  return { cartonCount: nextCount, capacity, full };
}

/**
 * Place physical cartons onto client storage pallets:
 * fill existing open pallets first (max 10 each), then create new pallets for overflow.
 */
export async function placeReceiveCartonsOnClientPallets(input: {
  userId: string;
  cartonCount: number;
  preferredPositionId?: string | null;
  warehouseId?: string | null;
  receiveBatchId?: string | null;
  receiveReference?: string | null;
  notes?: string | null;
  contents?: AssignPalletStorageInput["contents"];
  assignedBy?: string | null;
}): Promise<{
  placed: Array<{ label: string; added: number; cartonCount: number; capacity: number; created: boolean }>;
  palletsCreated: number;
  cartonsPlaced: number;
}> {
  const total = Math.max(0, Math.floor(input.cartonCount));
  if (total < 1) {
    throw new Error("Enter at least 1 carton to place on storage pallets.");
  }

  const positions = await listActivePalletStoragePositions(input.userId);
  let remaining = total;
  const placed: Array<{
    label: string;
    added: number;
    cartonCount: number;
    capacity: number;
    created: boolean;
  }> = [];

  const base: AssignPalletStorageInput = {
    userId: input.userId,
    warehouseId: input.warehouseId,
    receiveBatchId: input.receiveBatchId,
    receiveReference: input.receiveReference,
    notes: input.notes,
    contents: input.contents,
    assignedBy: input.assignedBy,
  };

  const tryFill = async (p: PalletStoragePosition) => {
    if (remaining <= 0) return;
    const free = positionRemainingCartonSlots(p);
    if (free <= 0) return;
    const add = Math.min(free, remaining);
    const result = await addToExistingPalletPosition({
      ...base,
      positionId: p.id,
      cartonsToAdd: add,
      contents: placed.length === 0 ? input.contents : undefined,
    });
    remaining -= add;
    placed.push({
      label: p.label,
      added: add,
      cartonCount: result.cartonCount,
      capacity: result.capacity,
      created: false,
    });
  };

  if (input.preferredPositionId) {
    const preferred = positions.find((p) => p.id === input.preferredPositionId);
    if (preferred) await tryFill(preferred);
  }

  for (const p of positions) {
    if (remaining <= 0) break;
    if (input.preferredPositionId && p.id === input.preferredPositionId) continue;
    await tryFill(p);
  }

  let palletsCreated = 0;
  while (remaining > 0) {
    const add = Math.min(CARTONS_PER_STORAGE_PALLET, remaining);
    const label = await nextPositionLabel(input.userId);
    const created = await createPositionWithCycle(
      {
        ...base,
        contents: placed.length === 0 ? input.contents : undefined,
      },
      label,
      add
    );
    remaining -= add;
    palletsCreated += 1;
    placed.push({
      label: created.label,
      added: add,
      cartonCount: created.cartonCount,
      capacity: CARTONS_PER_STORAGE_PALLET,
      created: true,
    });
  }

  return {
    placed,
    palletsCreated,
    cartonsPlaced: total,
  };
}

export async function listPositionContents(
  userId: string,
  positionId: string
): Promise<PalletStoragePositionContent[]> {
  const snap = await getDocs(
    collection(db, `users/${userId}/palletStoragePositions/${positionId}/contents`)
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PalletStoragePositionContent, "id">) }));
}

/** Merge source positions into target; close source cycles (stops billing). */
export async function consolidatePalletStoragePositions(input: {
  userId: string;
  targetPositionId: string;
  sourcePositionIds: string[];
  operatorId?: string | null;
  notes?: string | null;
}): Promise<void> {
  const sourceIds = [...new Set(input.sourcePositionIds.filter((id) => id && id !== input.targetPositionId))];
  if (sourceIds.length === 0) return;

  const batch = writeBatch(db);
  const now = serverTimestamp();

  for (const sourceId of sourceIds) {
    const posRef = doc(db, `users/${input.userId}/palletStoragePositions`, sourceId);
    batch.update(posRef, {
      status: "closed",
      closedAt: now,
      closeReason: "consolidation",
      consolidatedIntoPositionId: input.targetPositionId,
      updatedAt: now,
    });
  }

  const targetRef = doc(db, `users/${input.userId}/palletStoragePositions`, input.targetPositionId);
  batch.update(targetRef, {
    updatedAt: now,
    ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
    lastConsolidatedAt: now,
    lastConsolidatedBy: input.operatorId ?? null,
  });

  await batch.commit();

  for (const sourceId of sourceIds) {
    const posSnap = await getDoc(doc(db, `users/${input.userId}/palletStoragePositions`, sourceId));
    const cycleId = posSnap.exists() ? String((posSnap.data() as { cycleId?: string }).cycleId || "") : "";
    if (!cycleId) continue;
    await updateDoc(doc(db, `users/${input.userId}/palletStorageCycles`, cycleId), {
      status: "closed",
      closedAt: Timestamp.now(),
      closeReason: "consolidation",
      consolidatedIntoPositionId: input.targetPositionId,
      updatedAt: Timestamp.now(),
    });
  }
}

export async function updatePalletPositionHasSpace(
  userId: string,
  positionId: string,
  hasSpace: boolean
): Promise<void> {
  const ref = doc(db, `users/${userId}/palletStoragePositions`, positionId);
  const snap = await getDoc(ref);
  const patch: Record<string, unknown> = {
    hasSpace,
    updatedAt: serverTimestamp(),
  };
  if (snap.exists() && !hasSpace) {
    const pos = snap.data() as PalletStoragePosition;
    const capacity = positionCartonCapacity(pos);
    const current = positionCartonCount(pos);
    if (current < capacity) {
      patch.cartonCount = capacity;
    }
  }
  await updateDoc(ref, patch);
}

/** How many new pallets are needed for cartonCount given current open positions. */
export function estimateNewPalletsNeeded(
  positions: PalletStoragePosition[],
  cartonCount: number
): { freeSlots: number; newPalletsNeeded: number } {
  const freeSlots = positions.reduce((s, p) => s + positionRemainingCartonSlots(p), 0);
  const overflow = Math.max(0, Math.floor(cartonCount) - freeSlots);
  const newPalletsNeeded =
    overflow <= 0 ? 0 : Math.ceil(overflow / CARTONS_PER_STORAGE_PALLET);
  return { freeSlots, newPalletsNeeded };
}
