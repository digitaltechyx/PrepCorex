/**
 * Shared Pending-count rules for:
 * - Notifications Pending tab
 * - Admin sidebar Notifications badge
 * - Admin dashboard "Pending Requests" card
 *
 * Keep these in sync — do not diverge client vs server filters.
 */

function normStatus(status: unknown): string {
  return String(status || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "")
    .replace(/_+/g, "_");
}

export function isPendingRequestStatus(status: unknown): boolean {
  return normStatus(status) === "pending";
}

/** Inbound/dispose batch parents stay actionable while pending or partial. */
export function isActionableBatchStatus(status: unknown): boolean {
  const s = normStatus(status);
  return s === "pending" || s === "partial";
}

export type PendingNotificationCountItem = {
  id: string;
  uid: string;
  status?: unknown;
  batchId?: string;
  totalLines?: number;
};

export type PendingNotificationCountBags = {
  ship: PendingNotificationCountItem[];
  inv: PendingNotificationCountItem[];
  ret: PendingNotificationCountItem[];
  dispose: PendingNotificationCountItem[];
  del: PendingNotificationCountItem[];
  quarantine: PendingNotificationCountItem[];
  labelRefund: PendingNotificationCountItem[];
  inboundBatches: PendingNotificationCountItem[];
  disposeBatches: PendingNotificationCountItem[];
  wallet: PendingNotificationCountItem[];
  apiFee: PendingNotificationCountItem[];
};

/**
 * Count rows that belong on Notifications → Pending (managed users only).
 * Dedupes multi-line inbound/dispose batches to one parent row.
 */
export function countPendingNotificationItems(
  managedUids: Set<string>,
  bags: PendingNotificationCountBags
): number {
  const multiLineInbound = new Set(
    bags.inboundBatches
      .filter((d) => managedUids.has(d.uid) && Number(d.totalLines || 0) > 1)
      .map((d) => d.id)
  );

  let count = 0;
  const addOwned = (
    docs: PendingNotificationCountItem[],
    skip?: (d: PendingNotificationCountItem) => boolean
  ) => {
    for (const d of docs) {
      if (!managedUids.has(d.uid)) continue;
      if (skip?.(d)) continue;
      count += 1;
    }
  };

  addOwned(bags.ship);
  addOwned(bags.ret);
  addOwned(bags.del);
  addOwned(bags.labelRefund);
  addOwned(bags.wallet);
  addOwned(bags.apiFee);
  addOwned(bags.inv, (d) => {
    const batchId = String(d.batchId || "");
    return Boolean(batchId && multiLineInbound.has(batchId));
  });
  // Any dispose line with batchId is represented by the dispose batch row.
  addOwned(bags.dispose, (d) => Boolean(String(d.batchId || "").trim()));
  addOwned(bags.quarantine);

  for (const d of bags.inboundBatches) {
    if (!managedUids.has(d.uid)) continue;
    if (!isActionableBatchStatus(d.status)) continue;
    if (Number(d.totalLines || 0) <= 1) continue;
    count += 1;
  }
  for (const d of bags.disposeBatches) {
    if (!managedUids.has(d.uid)) continue;
    if (!isActionableBatchStatus(d.status)) continue;
    count += 1;
  }

  return count;
}
