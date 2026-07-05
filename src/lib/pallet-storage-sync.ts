/**
 * Shared pallet storage cycle sync + helpers for cron and admin test invoice routes.
 * Manual cycles (source admin_manual) are excluded from inventory reconciliation.
 */

import {
  getRateForPaidCycle,
  tierRatesFromStoragePricingDoc,
  type PalletStorageTierRates,
} from "@/lib/pallet-storage-billing";

export { getRateForPaidCycle, tierRatesFromStoragePricingDoc, type PalletStorageTierRates };

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export type PalletCycleDoc = {
  id: string;
  status?: string;
  source?: string;
  assignedAt?: any;
  freeUntil?: any;
  nextInvoiceDate?: any;
  lastInvoicedAt?: any;
  paidCycleCount?: number;
  positionId?: string;
  positionLabel?: string;
};

export function toDate(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value?.toDate === "function") {
    const d = value.toDate();
    return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
  }
  if (typeof value?.seconds === "number") {
    const d = new Date(value.seconds * 1000);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function add30Days(date: Date): Date {
  return new Date(date.getTime() + THIRTY_DAYS_MS);
}

function isAdminManualCycle(source: unknown): boolean {
  return String(source || "") === "admin_manual";
}

export async function getDesiredPalletCountFromInventory(db: any, userId: string): Promise<number> {
  const inventorySnapshot = await db
    .collection(`users/${userId}/inventory`)
    .where("inventoryType", "==", "pallet")
    .where("status", "==", "In Stock")
    .get();

  let total = 0;
  for (const doc of inventorySnapshot.docs) {
    const qty = Number(doc.data()?.quantity || 0);
    total += Number.isFinite(qty) && qty > 0 ? qty : 0;
  }
  return total;
}

export async function getLatestStoragePrice(db: any, userId: string): Promise<number | null> {
  const tiers = await getLatestStorageTierRates(db, userId);
  return tiers.month1Rate;
}

export async function getLatestStorageTierRates(db: any, userId: string): Promise<PalletStorageTierRates> {
  const storagePricingSnapshot = await db.collection(`users/${userId}/storagePricing`).get();
  if (storagePricingSnapshot.empty) {
    return tierRatesFromStoragePricingDoc(null);
  }

  const latestPricingDoc = [...storagePricingSnapshot.docs].sort((a, b) => {
    const ad: any = a.data();
    const bd: any = b.data();
    const at = Math.max(toDate(ad.updatedAt)?.getTime() || 0, toDate(ad.createdAt)?.getTime() || 0);
    const bt = Math.max(toDate(bd.updatedAt)?.getTime() || 0, toDate(bd.createdAt)?.getTime() || 0);
    return bt - at;
  })[0];

  return tierRatesFromStoragePricingDoc(latestPricingDoc.data() as Record<string, unknown>);
}

export async function listActivePalletCycles(db: any, userId: string): Promise<PalletCycleDoc[]> {
  const cyclesSnap = await db.collection(`users/${userId}/palletStorageCycles`).get();
  return cyclesSnap.docs
    .map((d: { id: string; data: () => unknown }) => ({ id: d.id, ...(d.data() as object) }))
    .filter((c: PalletCycleDoc) => c.status !== "closed");
}

export async function syncPalletCycles(db: any, userId: string, now: Date): Promise<PalletCycleDoc[]> {
  const invDesired = await getDesiredPalletCountFromInventory(db, userId);
  const cyclesSnap = await db.collection(`users/${userId}/palletStorageCycles`).get();
  const allCycles: PalletCycleDoc[] = cyclesSnap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
  const activeAll = allCycles.filter((c) => c.status !== "closed");
  const manualActive = activeAll.filter((c) => isAdminManualCycle(c.source));
  const invActive = activeAll.filter((c) => !isAdminManualCycle(c.source));

  const diff = invDesired - invActive.length;

  if (diff > 0) {
    for (let i = 0; i < diff; i += 1) {
      const payload = {
        status: "active",
        source: "inventory_sync",
        assignedAt: now,
        nextInvoiceDate: add30Days(now),
        createdAt: now,
        updatedAt: now,
      };
      await db.collection(`users/${userId}/palletStorageCycles`).add(payload);
    }
  } else if (diff < 0) {
    const closeCount = Math.abs(diff);
    const toClose = [...invActive]
      .sort((a, b) => (toDate(b.assignedAt)?.getTime() || 0) - (toDate(a.assignedAt)?.getTime() || 0))
      .slice(0, closeCount);
    for (const cycle of toClose) {
      await db.collection(`users/${userId}/palletStorageCycles`).doc(cycle.id).update({
        status: "closed",
        closedAt: now,
        closeReason: "inventory_sync_reduction",
        updatedAt: now,
      });
    }
  }

  const totalActiveCount = manualActive.length + invDesired;

  const storagePricingSnapshot = await db.collection(`users/${userId}/storagePricing`).get();
  if (!storagePricingSnapshot.empty) {
    const latestPricingDoc = [...storagePricingSnapshot.docs].sort((a, b) => {
      const ad: any = a.data();
      const bd: any = b.data();
      const at = Math.max(toDate(ad.updatedAt)?.getTime() || 0, toDate(ad.createdAt)?.getTime() || 0);
      const bt = Math.max(toDate(bd.updatedAt)?.getTime() || 0, toDate(bd.createdAt)?.getTime() || 0);
      return bt - at;
    })[0];
    await latestPricingDoc.ref.update({
      palletCount: totalActiveCount,
      updatedAt: now,
    });
  }

  const afterSnap = await db.collection(`users/${userId}/palletStorageCycles`).get();
  return afterSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((c: PalletCycleDoc) => c.status !== "closed");
}
