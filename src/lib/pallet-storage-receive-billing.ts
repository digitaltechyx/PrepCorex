/**
 * Storage billing at receive:
 * - Pallet mode → +1 billable pallet immediately
 * - Carton mode → accumulate per user; every 10 cartons → +1 billable pallet
 * Also: link putaway inventory to cycles, and close cycles when linked stock is OOS.
 */

import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  CARTONS_PER_STORAGE_PALLET,
  assignNewPalletStoragePositions,
} from "@/lib/pallet-storage-positions";

export type ReceiveStorageBillingMode = "pallet" | "carton";

export type ApplyReceiveStorageBillingResult = {
  palletsCreated: number;
  pendingCartons: number;
  cycles: Array<{ cycleId: string; label: string; positionId: string }>;
  mode: ReceiveStorageBillingMode;
};

async function readPendingCartons(userId: string): Promise<number> {
  const snap = await getDoc(doc(db, "users", userId));
  const n = Number(snap.exists() ? snap.data()?.pendingStorageCartons : 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function writePendingCartons(userId: string, pending: number): Promise<void> {
  await setDoc(
    doc(db, "users", userId),
    {
      pendingStorageCartons: Math.max(0, Math.floor(pending)),
      storageType: "pallet_base",
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
}

/**
 * Apply agreed storage billing after a warehouse receive (carton or pallet type only).
 */
export async function applyReceiveStorageBilling(input: {
  userId: string;
  mode: ReceiveStorageBillingMode;
  /** Physical CTN count for carton mode (ignored for pallet → always +1). */
  cartonCount?: number;
  warehouseId?: string | null;
  receiveBatchId?: string | null;
  receiveBatchIds?: string[] | null;
  receiveReference?: string | null;
  assignedBy?: string | null;
  contents?: Array<{ sku?: string; productName?: string; quantity?: number; notes?: string }>;
}): Promise<ApplyReceiveStorageBillingResult> {
  const userId = input.userId.trim();
  if (!userId) throw new Error("Client user is required for storage billing.");

  const batchIds = [
    ...new Set(
      [...(input.receiveBatchIds || []), input.receiveBatchId || ""]
        .map((id) => String(id || "").trim())
        .filter(Boolean)
    ),
  ];

  const base = {
    userId,
    warehouseId: input.warehouseId ?? null,
    receiveBatchId: batchIds[0] ?? null,
    receiveBatchIds: batchIds,
    receiveReference: input.receiveReference ?? null,
    assignedBy: input.assignedBy ?? null,
    contents: input.contents,
  };

  if (input.mode === "pallet") {
    const created = await assignNewPalletStoragePositions({
      ...base,
      count: 1,
      billingMode: "pallet_receive",
      cartonsPerNewPallet: [CARTONS_PER_STORAGE_PALLET],
      notes: "Pallet receive — 1 billable storage pallet",
    });
    // Ensure storageType is pallet_base; keep pending carton balance unchanged.
    const pending = await readPendingCartons(userId);
    await writePendingCartons(userId, pending);
    return {
      mode: "pallet",
      palletsCreated: created.length,
      pendingCartons: pending,
      cycles: created.map((c) => ({
        cycleId: c.cycleId,
        label: c.label,
        positionId: c.positionId,
      })),
    };
  }

  const addCartons = Math.max(0, Math.floor(input.cartonCount ?? 0));
  if (addCartons < 1) {
    const pending = await readPendingCartons(userId);
    return { mode: "carton", palletsCreated: 0, pendingCartons: pending, cycles: [] };
  }

  const prevPending = await readPendingCartons(userId);
  const total = prevPending + addCartons;
  const palletsToCreate = Math.floor(total / CARTONS_PER_STORAGE_PALLET);
  const nextPending = total % CARTONS_PER_STORAGE_PALLET;

  let created: Array<{ positionId: string; cycleId: string; label: string; cartonCount: number }> =
    [];
  if (palletsToCreate > 0) {
    created = await assignNewPalletStoragePositions({
      ...base,
      count: palletsToCreate,
      billingMode: "carton_receive",
      cartonsPerNewPallet: Array.from({ length: palletsToCreate }, () => CARTONS_PER_STORAGE_PALLET),
      notes: `Carton receive — ${CARTONS_PER_STORAGE_PALLET} cartons = 1 billable pallet`,
    });
  }

  await writePendingCartons(userId, nextPending);

  return {
    mode: "carton",
    palletsCreated: created.length,
    pendingCartons: nextPending,
    cycles: created.map((c) => ({
      cycleId: c.cycleId,
      label: c.label,
      positionId: c.positionId,
    })),
  };
}

/** Attach inventory doc id to open billing cycles for this receive carton/pallet id. */
export async function linkInventoryToBillingCycles(input: {
  userId: string;
  inventoryId: string;
  receiveBatchId?: string | null;
}): Promise<number> {
  const userId = input.userId.trim();
  const inventoryId = input.inventoryId.trim();
  const batchId = String(input.receiveBatchId || "").trim();
  if (!userId || !inventoryId) return 0;

  const cyclesRef = collection(db, `users/${userId}/palletStorageCycles`);
  let candidates: Array<{ id: string }> = [];

  if (batchId) {
    const byPrimary = await getDocs(
      query(cyclesRef, where("status", "==", "active"), where("receiveBatchId", "==", batchId))
    );
    candidates = byPrimary.docs.map((d) => ({ id: d.id }));

    // Also match cycles that store the id in receiveBatchIds (array-contains).
    try {
      const byArray = await getDocs(
        query(cyclesRef, where("status", "==", "active"), where("receiveBatchIds", "array-contains", batchId))
      );
      const seen = new Set(candidates.map((c) => c.id));
      for (const d of byArray.docs) {
        if (!seen.has(d.id)) candidates.push({ id: d.id });
      }
    } catch {
      // Older docs may lack the array field / index — primary match is enough.
    }
  }

  // Fallback: newest active warehouse_receive cycles with no inventory links yet.
  if (candidates.length === 0) {
    const active = await getDocs(query(cyclesRef, where("status", "==", "active")));
    type CycleLite = {
      id: string;
      source?: unknown;
      linkedInventoryIds?: unknown;
      assignedAt?: { toMillis?: () => number };
    };
    const unlinked: CycleLite[] = active.docs
      .map((d) => ({ id: d.id, ...(d.data() as Omit<CycleLite, "id">) }))
      .filter((c) => {
        const source = String(c.source || "");
        if (source === "admin_manual") return false;
        const linked = Array.isArray(c.linkedInventoryIds) ? c.linkedInventoryIds : [];
        return linked.length === 0;
      })
      .sort((a, b) => {
        const at = typeof a.assignedAt?.toMillis === "function" ? a.assignedAt.toMillis() : 0;
        const bt = typeof b.assignedAt?.toMillis === "function" ? b.assignedAt.toMillis() : 0;
        return bt - at;
      });
    if (unlinked[0]) candidates = [{ id: unlinked[0].id }];
  }

  let updated = 0;
  for (const c of candidates) {
    await updateDoc(doc(db, `users/${userId}/palletStorageCycles`, c.id), {
      linkedInventoryIds: arrayUnion(inventoryId),
      updatedAt: serverTimestamp(),
    });
    updated += 1;
  }
  return updated;
}

async function inventoryIsOutOfStock(userId: string, inventoryId: string): Promise<boolean> {
  const snap = await getDoc(doc(db, "users", userId, "inventory", inventoryId));
  if (!snap.exists()) return true;
  const qty = Number(snap.data()?.quantity ?? 0);
  const status = String(snap.data()?.status || "");
  return !(Number.isFinite(qty) && qty > 0) || status === "Out of Stock";
}

/**
 * When linked inventory hits out of stock, close billable pallets whose
 * linked inventory are all empty.
 */
export async function closeBillingPalletsForOutOfStockInventory(input: {
  userId: string;
  inventoryId: string;
}): Promise<number> {
  const userId = input.userId.trim();
  const inventoryId = input.inventoryId.trim();
  if (!userId || !inventoryId) return 0;

  const stillInStock = !(await inventoryIsOutOfStock(userId, inventoryId));
  if (stillInStock) return 0;

  const cyclesRef = collection(db, `users/${userId}/palletStorageCycles`);
  let matched: Array<{ id: string; data: Record<string, unknown> }> = [];

  try {
    const snap = await getDocs(
      query(
        cyclesRef,
        where("status", "==", "active"),
        where("linkedInventoryIds", "array-contains", inventoryId)
      )
    );
    matched = snap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }));
  } catch {
    const all = await getDocs(query(cyclesRef, where("status", "==", "active")));
    matched = all.docs
      .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
      .filter((c) => {
        const linked = Array.isArray(c.data.linkedInventoryIds)
          ? (c.data.linkedInventoryIds as unknown[]).map((x) => String(x))
          : [];
        return linked.includes(inventoryId);
      });
  }

  // Fallback: no links yet — close oldest non-manual receive cycle (FIFO) once.
  if (matched.length === 0) {
    const all = await getDocs(query(cyclesRef, where("status", "==", "active")));
    const receiveCycles = all.docs
      .map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
      .filter((c) => String(c.data.source || "") !== "admin_manual")
      .sort((a, b) => {
        const at =
          a.data.assignedAt &&
          typeof (a.data.assignedAt as { toMillis?: () => number }).toMillis === "function"
            ? (a.data.assignedAt as { toMillis: () => number }).toMillis()
            : 0;
        const bt =
          b.data.assignedAt &&
          typeof (b.data.assignedAt as { toMillis?: () => number }).toMillis === "function"
            ? (b.data.assignedAt as { toMillis: () => number }).toMillis()
            : 0;
        return at - bt;
      });
    if (receiveCycles[0]) matched = [receiveCycles[0]];
  }

  let closed = 0;
  const now = Timestamp.now();
  for (const cycle of matched) {
    const linked = Array.isArray(cycle.data.linkedInventoryIds)
      ? (cycle.data.linkedInventoryIds as unknown[]).map((x) => String(x).trim()).filter(Boolean)
      : [];

    if (linked.length > 0) {
      const statuses = await Promise.all(linked.map((id) => inventoryIsOutOfStock(userId, id)));
      if (statuses.some((oos) => !oos)) continue;
    }

    await updateDoc(doc(db, `users/${userId}/palletStorageCycles`, cycle.id), {
      status: "closed",
      closedAt: now,
      closeReason: "inventory_oos",
      updatedAt: now,
    });

    const positionId = String(cycle.data.positionId || "").trim();
    if (positionId) {
      try {
        await updateDoc(doc(db, `users/${userId}/palletStoragePositions`, positionId), {
          status: "closed",
          closedAt: now,
          closeReason: "inventory_oos",
          updatedAt: now,
        });
      } catch {
        // Position may already be closed.
      }
    }
    closed += 1;
  }

  return closed;
}
