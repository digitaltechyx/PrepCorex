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
        // Keep 0-qty lots so Expiry can still show "0 units" and restock can refill them.
        .filter((b) => Boolean(b.expiry))
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
 * Negative deltas remove units; lots at 0 are kept (shown as 0 units).
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
        .filter((b) => Boolean(b.expiry))
    : [];

  const lotKey = (change.lot ?? "").trim();
  const idx = next.findIndex(
    (b) => b.expiry === expiry && (b.lot ?? "").trim() === lotKey
  );

  if (idx >= 0) {
    const qty = Math.max(0, next[idx]!.quantity + delta);
    next[idx] = { ...next[idx]!, quantity: qty };
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

export type StockRotationPolicy = "fefo" | "fifo" | "manual";

/** Explicit units to take from a dated lot (outbound “choose lots”). */
export type ExpiryLotAllocation = {
  expiry: string;
  quantity: number;
  lot?: string | null;
};

export function normalizeExpiryLotAllocations(
  raw: unknown
): ExpiryLotAllocation[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((row) => {
      const rec = row as { expiry?: unknown; quantity?: unknown; lot?: unknown };
      return {
        expiry: String(rec.expiry || "").trim(),
        quantity: Math.max(0, Math.floor(Number(rec.quantity) || 0)),
        lot: rec.lot != null && String(rec.lot).trim() ? String(rec.lot).trim() : null,
      };
    })
    .filter((row) => Boolean(row.expiry) && row.quantity > 0);
}

export function sumExpiryLotAllocations(allocations: ExpiryLotAllocation[]): number {
  return allocations.reduce((sum, row) => sum + Math.max(0, row.quantity), 0);
}

function normalizeExpiryBatches(existing: ExpiryBatch[] | undefined | null): ExpiryBatch[] {
  if (!Array.isArray(existing)) return [];
  return existing
    .map((b) => ({
      expiry: String(b.expiry || "").trim(),
      quantity: Math.max(0, Math.floor(Number(b.quantity) || 0)),
      lot: b.lot ?? null,
      requestId: b.requestId ?? null,
    }))
    // Keep 0-qty lots so UI can show "Jun 6 · 0 units" after FEFO depletes a batch.
    .filter((b) => Boolean(b.expiry));
}

/**
 * Build working expiry lots before ship/restock.
 * - Empty/missing batches + legacy expiryDate → one lot with on-hand qty
 * - Batch sum short of on-hand → fill the gap onto legacy (or earliest) expiry
 * So FEFO can always split across dates (e.g. 23 from Jun 6, then 77 from Dec 12).
 */
export function prepareExpiryBatchesForDeduction(
  existing: ExpiryBatch[] | undefined | null,
  onHandQuantity: number,
  legacyExpiryDate?: unknown
): ExpiryBatch[] {
  const onHand = Math.max(0, Math.floor(Number(onHandQuantity) || 0));
  let next = normalizeExpiryBatches(existing);
  const legacy = expiryBatchIso(legacyExpiryDate);

  if (next.length === 0) {
    if (legacy && onHand > 0) {
      return [{ expiry: legacy, quantity: onHand, lot: null, requestId: null }];
    }
    return [];
  }

  const sum = next.reduce((total, batch) => total + Math.max(0, batch.quantity), 0);
  if (sum < onHand) {
    const fillExpiry = legacy || earliestExpiryFromBatches(next);
    if (fillExpiry) {
      next = mergeExpiryBatch(next, {
        expiry: fillExpiry,
        quantity: onHand - sum,
      });
    }
  }

  return next.sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/**
 * Prefer stored expiryBatches; if empty/missing, seed from legacy expiryDate + qty.
 * Used by restock/receive so an empty [] does not wipe older undated-as-batch stock.
 */
export function seedExpiryBatchesFromLegacy(
  existing: ExpiryBatch[] | undefined | null,
  onHandQuantityBeforeChange: number,
  legacyExpiryDate?: unknown
): ExpiryBatch[] {
  const normalized = normalizeExpiryBatches(existing);
  if (normalized.length > 0) return normalized;
  const legacy = expiryBatchIso(legacyExpiryDate);
  const qty = Math.max(0, Math.floor(Number(onHandQuantityBeforeChange) || 0));
  if (legacy && qty > 0) {
    return [{ expiry: legacy, quantity: qty, lot: null, requestId: null }];
  }
  return [];
}

/**
 * Ensure every known expiry date appears in the lot list.
 * Missing dates are added as quantity 0 so Expiry can show "Jun 6 · 0 units".
 */
export function preserveKnownExpiryLots(
  existing: ExpiryBatch[] | undefined | null,
  knownExpiries: Array<string | null | undefined> | undefined | null
): ExpiryBatch[] {
  const next = normalizeExpiryBatches(existing);
  const byExpiry = new Map(next.map((batch) => [batch.expiry, { ...batch }]));
  for (const raw of knownExpiries || []) {
    const expiry = expiryBatchIso(raw);
    if (!expiry) continue;
    if (!byExpiry.has(expiry)) {
      byExpiry.set(expiry, {
        expiry,
        quantity: 0,
        lot: null,
        requestId: null,
      });
    }
  }
  return Array.from(byExpiry.values()).sort((a, b) => a.expiry.localeCompare(b.expiry));
}

/**
 * When lot totals drifted above sellable on-hand (qty-only ships / quick fulfill),
 * FEFO-consume the excess so each expiry shows remaining units.
 * Example: lots 23 (Jun 6) + 348 (Dec 12), on-hand 267 → Jun 6 · 0 + Dec 12 · 267.
 * Pass knownExpiries to keep depleted dates that were previously dropped from the doc.
 */
export function reconcileExpiryBatchesToOnHand(
  existing: ExpiryBatch[] | undefined | null,
  onHandQuantity: number,
  legacyExpiryDate?: unknown,
  policy: StockRotationPolicy = "fefo",
  knownExpiries?: Array<string | null | undefined> | null
): {
  batches: ExpiryBatch[];
  expiryDate: string | null;
  adjusted: boolean;
  consumed: ExpiryBatch[];
} {
  const onHand = Math.max(0, Math.floor(Number(onHandQuantity) || 0));
  const prepared = preserveKnownExpiryLots(existing, knownExpiries);
  if (prepared.length === 0) {
    if (legacyExpiryDate && onHand > 0) {
      const legacy = expiryBatchIso(legacyExpiryDate);
      if (legacy) {
        return {
          batches: [{ expiry: legacy, quantity: onHand, lot: null, requestId: null }],
          expiryDate: legacy,
          adjusted: true,
          consumed: [],
        };
      }
    }
    return { batches: [], expiryDate: null, adjusted: false, consumed: [] };
  }

  const positiveSum = prepared.reduce(
    (total, batch) => total + Math.max(0, batch.quantity),
    0
  );
  const hadMissingKnown =
    (knownExpiries || []).some((raw) => {
      const expiry = expiryBatchIso(raw);
      return Boolean(expiry) && !normalizeExpiryBatches(existing).some((b) => b.expiry === expiry);
    });

  if (positiveSum === onHand) {
    return {
      batches: prepared.sort((a, b) => a.expiry.localeCompare(b.expiry)),
      expiryDate: earliestExpiryFromBatches(prepared),
      adjusted: hadMissingKnown,
      consumed: [],
    };
  }
  if (positiveSum < onHand) {
    // Do not invent lot qty on reconcile — only shrink when lots are ahead of on-hand.
    return {
      batches: prepared.sort((a, b) => a.expiry.localeCompare(b.expiry)),
      expiryDate: earliestExpiryFromBatches(prepared),
      adjusted: hadMissingKnown,
      consumed: [],
    };
  }

  const result = consumeExpiryBatches(prepared, positiveSum - onHand, policy);
  return {
    batches: preserveKnownExpiryLots(result.batches, [
      ...(knownExpiries || []),
      ...prepared.map((b) => b.expiry),
    ]),
    expiryDate: result.expiryDate,
    adjusted: true,
    consumed: result.consumed,
  };
}

function batchReceiveKey(batch: ExpiryBatch): string {
  const requestId = String(batch.requestId ?? "").trim();
  // FIFO: prefer inbound/restock request id order when present; else expiry.
  return requestId || batch.expiry;
}

export type ConsumeExpiryBatchesOptions = {
  /** Current sellable on-hand (seeds missing lots so FEFO can run). */
  onHandQuantity?: number;
  /** Legacy single expiryDate when expiryBatches is empty. */
  legacyExpiryDate?: unknown;
};

/**
 * Remove units from expiry lots by explicit allocation (manual lot pick).
 * Throws if a lot is missing or does not have enough remaining units.
 */
export function consumeExpiryBatchesFromAllocations(
  existing: ExpiryBatch[] | undefined | null,
  allocations: ExpiryLotAllocation[],
  options?: ConsumeExpiryBatchesOptions
): {
  batches: ExpiryBatch[];
  consumed: ExpiryBatch[];
  expiryDate: string | null;
} {
  const allocs = normalizeExpiryLotAllocations(allocations);
  const next =
    options && (options.onHandQuantity != null || options.legacyExpiryDate != null)
      ? prepareExpiryBatchesForDeduction(
          existing,
          options.onHandQuantity ?? 0,
          options.legacyExpiryDate
        )
      : normalizeExpiryBatches(existing);

  if (allocs.length === 0) {
    return {
      batches: next.sort((a, b) => a.expiry.localeCompare(b.expiry)),
      consumed: [],
      expiryDate: earliestExpiryFromBatches(next),
    };
  }

  const consumed: ExpiryBatch[] = [];
  for (const alloc of allocs) {
    const lotKey = (alloc.lot ?? "").trim();
    let idx = next.findIndex(
      (b) => b.expiry === alloc.expiry && (b.lot ?? "").trim() === lotKey
    );
    if (idx < 0 && !lotKey) {
      idx = next.findIndex((b) => b.expiry === alloc.expiry && b.quantity > 0);
    }
    if (idx < 0) {
      throw new Error(`Expiry lot ${alloc.expiry} is not available on this product.`);
    }
    if (next[idx]!.quantity < alloc.quantity) {
      throw new Error(
        `Not enough units on lot ${alloc.expiry}. Available: ${next[idx]!.quantity}, Requested: ${alloc.quantity}.`
      );
    }
    next[idx]!.quantity -= alloc.quantity;
    consumed.push({
      expiry: next[idx]!.expiry,
      quantity: alloc.quantity,
      lot: next[idx]!.lot ?? null,
      requestId: next[idx]!.requestId ?? null,
    });
  }

  const batches = next.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return {
    batches,
    consumed,
    expiryDate: earliestExpiryFromBatches(batches),
  };
}

/**
 * Remove units from expiry lots.
 * FEFO = earliest expiry first (split across lots: e.g. take all of Jun 6, then Dec 12).
 * FIFO = earliest received/request id, then expiry.
 * manual = use consumeExpiryBatchesFromAllocations instead.
 * Depleted lots stay at quantity 0 (shown as "0 units"); summary expiryDate = next lot with qty > 0.
 */
export function consumeExpiryBatches(
  existing: ExpiryBatch[] | undefined | null,
  units: number,
  policy: StockRotationPolicy = "fefo",
  options?: ConsumeExpiryBatchesOptions
): {
  batches: ExpiryBatch[];
  consumed: ExpiryBatch[];
  expiryDate: string | null;
} {
  const take = Math.max(0, Math.floor(units));
  const next =
    options && (options.onHandQuantity != null || options.legacyExpiryDate != null)
      ? prepareExpiryBatchesForDeduction(
          existing,
          options.onHandQuantity ?? 0,
          options.legacyExpiryDate
        )
      : normalizeExpiryBatches(existing);

  if (take <= 0 || next.length === 0) {
    return {
      batches: next.sort((a, b) => a.expiry.localeCompare(b.expiry)),
      consumed: [],
      expiryDate: earliestExpiryFromBatches(next),
    };
  }

  // "manual" without allocations falls back to FEFO.
  const effectivePolicy: "fefo" | "fifo" = policy === "fifo" ? "fifo" : "fefo";

  const ordered = [...next].sort((a, b) => {
    if (effectivePolicy === "fifo") {
      const byReceive = batchReceiveKey(a).localeCompare(batchReceiveKey(b));
      if (byReceive !== 0) return byReceive;
    }
    return a.expiry.localeCompare(b.expiry);
  });

  let remaining = take;
  const consumed: ExpiryBatch[] = [];
  for (const batch of ordered) {
    if (remaining <= 0) break;
    if (batch.quantity <= 0) continue;
    const qty = Math.min(batch.quantity, remaining);
    if (qty <= 0) continue;
    batch.quantity -= qty;
    remaining -= qty;
    consumed.push({
      expiry: batch.expiry,
      quantity: qty,
      lot: batch.lot ?? null,
      requestId: batch.requestId ?? null,
    });
  }

  const batches = ordered.sort((a, b) => a.expiry.localeCompare(b.expiry));

  return {
    batches,
    consumed,
    expiryDate: earliestExpiryFromBatches(batches),
  };
}

/** Put units back onto expiry lots (cancel / line restore). */
export function restoreExpiryBatches(
  existing: ExpiryBatch[] | undefined | null,
  units: number,
  preferred?: Array<{ expiry?: string | null; quantity?: number; lot?: string | null; requestId?: string | null }> | null
): ExpiryBatch[] {
  const restoreUnits = Math.max(0, Math.floor(units));
  if (restoreUnits <= 0) return normalizeExpiryBatches(existing);

  const preferredList = Array.isArray(preferred)
    ? preferred
        .map((b) => ({
          expiry: String(b.expiry || "").trim(),
          quantity: Math.max(0, Math.floor(Number(b.quantity) || 0)),
          lot: b.lot ?? null,
          requestId: b.requestId ?? null,
        }))
        .filter((b) => b.expiry && b.quantity > 0)
    : [];

  let next = normalizeExpiryBatches(existing);
  let remaining = restoreUnits;

  for (const batch of preferredList) {
    if (remaining <= 0) break;
    const qty = Math.min(batch.quantity, remaining);
    next = mergeExpiryBatch(next, {
      expiry: batch.expiry,
      quantity: qty,
      lot: batch.lot,
      requestId: batch.requestId,
    });
    remaining -= qty;
  }

  if (remaining > 0) {
    const fallbackExpiry =
      earliestExpiryFromBatches(next) ||
      preferredList[0]?.expiry ||
      null;
    if (fallbackExpiry) {
      next = mergeExpiryBatch(next, {
        expiry: fallbackExpiry,
        quantity: remaining,
      });
    }
  }

  return next;
}
