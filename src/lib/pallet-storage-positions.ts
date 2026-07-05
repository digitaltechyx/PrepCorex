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
  addStorageCycleDays,
  computeFirstInvoiceDate,
  computeFreeUntil,
} from "@/lib/pallet-storage-billing";
import type { PalletStoragePosition, PalletStoragePositionContent } from "@/types";

function activePositionsQuery(userId: string) {
  return query(
    collection(db, `users/${userId}/palletStoragePositions`),
    where("status", "==", "active")
  );
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
};

async function createPositionWithCycle(
  input: AssignPalletStorageInput,
  label: string
): Promise<{ positionId: string; cycleId: string; label: string }> {
  const now = new Date();
  const assignedAt = Timestamp.fromDate(now);
  const freeUntil = Timestamp.fromDate(computeFreeUntil(now));
  const nextInvoiceDate = Timestamp.fromDate(computeFirstInvoiceDate(now));

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
    hasSpace: input.hasSpace !== false,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  const positionRef = await addDoc(collection(db, `users/${input.userId}/palletStoragePositions`), {
    label,
    status: "active",
    cycleId: cycleRef.id,
    hasSpace: input.hasSpace !== false,
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

  return { positionId: positionRef.id, cycleId: cycleRef.id, label };
}

/** Create one or more new billable pallet positions (+ cycles). */
export async function assignNewPalletStoragePositions(
  input: AssignPalletStorageInput & { count: number }
): Promise<Array<{ positionId: string; cycleId: string; label: string }>> {
  const count = Math.min(500, Math.max(1, Math.floor(input.count)));
  const created: Array<{ positionId: string; cycleId: string; label: string }> = [];
  for (let i = 0; i < count; i += 1) {
    const label = await nextPositionLabel(input.userId);
    created.push(await createPositionWithCycle(input, label));
  }
  return created;
}

/** Add receive contents to an existing pallet position (no new billing position). */
export async function addToExistingPalletPosition(
  input: AssignPalletStorageInput & { positionId: string; markHasSpace?: boolean }
): Promise<void> {
  const posRef = doc(db, `users/${input.userId}/palletStoragePositions`, input.positionId);
  const patch: Record<string, unknown> = {
    updatedAt: serverTimestamp(),
  };
  if (input.markHasSpace !== undefined) {
    patch.hasSpace = input.markHasSpace;
  }
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
  await updateDoc(doc(db, `users/${userId}/palletStoragePositions`, positionId), {
    hasSpace,
    updatedAt: serverTimestamp(),
  });
}
