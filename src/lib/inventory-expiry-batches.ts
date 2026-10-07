/**
 * Helpers for multi-expiry inventory batches (FEFO clarity).
 */

export type ExpiryBatch = {
  expiry: string;
  quantity: number;
  lot?: string | null;
  requestId?: string | null;
};

/** Normalize unknown date values to YYYY-MM-DD, or null. */
export function expiryBatchIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    const d = new Date(trimmed.includes("T") ? trimmed : `${trimmed}T12:00:00`);
    if (Number.isNaN(d.getTime())) return null;
    return toIsoDate(d);
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toIsoDate(value);
  }
  if (typeof value === "object" && value !== null) {
    const timestamp = value as { seconds?: unknown; toDate?: () => Date };
    let date: Date | null = null;
    if (typeof timestamp.toDate === "function") date = timestamp.toDate();
    else if (Number.isFinite(Number(timestamp.seconds))) {
      date = new Date(Number(timestamp.seconds) * 1000);
    }
    if (!date || Number.isNaN(date.getTime())) return null;
    return toIsoDate(date);
  }
  return null;
}

function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function mergeExpiryBatch(
  existing: ExpiryBatch[] | undefined | null,
  incoming: { expiry: string; quantity: number; lot?: string | null; requestId?: string | null }
): ExpiryBatch[] {
  const qty = Math.max(0, Math.floor(incoming.quantity));
  if (!incoming.expiry || qty <= 0) {
    return Array.isArray(existing) ? existing.map((b) => ({ ...b })) : [];
  }
  const next = Array.isArray(existing)
    ? existing
        .map((b) => ({
          expiry: String(b.expiry || "").trim(),
          quantity: Math.max(0, Math.floor(Number(b.quantity) || 0)),
          lot: b.lot ?? null,
          requestId: b.requestId ?? null,
        }))
        .filter((b) => b.expiry && b.quantity > 0)
    : [];

  const lotKey = (incoming.lot ?? "").trim();
  const idx = next.findIndex(
    (b) => b.expiry === incoming.expiry && (b.lot ?? "").trim() === lotKey
  );
  if (idx >= 0) {
    next[idx] = {
      ...next[idx]!,
      quantity: next[idx]!.quantity + qty,
      requestId: incoming.requestId ?? next[idx]!.requestId ?? null,
    };
  } else {
    next.push({
      expiry: incoming.expiry,
      quantity: qty,
      lot: incoming.lot ?? null,
      requestId: incoming.requestId ?? null,
    });
  }
  return next.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/**
 * Add or remove quantity from a single expiry lot (lot key optional).
 * Negative deltas remove units; empty lots are dropped.
 */
export function adjustExpiryBatchQuantity(
  existing: ExpiryBatch[] | undefined | null,
  change: { expiry: string; quantityDelta: number; lot?: string | null }
): ExpiryBatch[] {
  const expiry = String(change.expiry || "").trim();
  const delta = Math.trunc(Number(change.quantityDelta) || 0);
  if (!expiry || delta === 0) {
    return Array.isArray(existing) ? existing.map((b) => ({ ...b })) : [];
  }

  const next = Array.isArray(existing)
    ? existing
        .map((b) => ({
          expiry: String(b.expiry || "").trim(),
          quantity: Math.max(0, Math.floor(Number(b.quantity) || 0)),
          lot: b.lot ?? null,
          requestId: b.requestId ?? null,
        }))
        .filter((b) => b.expiry && b.quantity > 0)
    : [];

  const lotKey = (change.lot ?? "").trim();
  const idx = next.findIndex(
    (b) => b.expiry === expiry && (b.lot ?? "").trim() === lotKey
  );

  if (idx >= 0) {
    const qty = next[idx]!.quantity + delta;
    if (qty <= 0) next.splice(idx, 1);
    else next[idx] = { ...next[idx]!, quantity: qty };
  } else if (delta > 0) {
    next.push({
      expiry,
      quantity: delta,
      lot: change.lot ?? null,
      requestId: null,
    });
  }

  return next.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/** Earliest expiry among batches (for inventory.expiryDate summary field). */
export function earliestExpiryFromBatches(batches: ExpiryBatch[]): string | null {
  const dates = batches
    .filter((b) => b.quantity > 0 && b.expiry)
    .map((b) => b.expiry)
    .sort();
  return dates[0] ?? null;
}
