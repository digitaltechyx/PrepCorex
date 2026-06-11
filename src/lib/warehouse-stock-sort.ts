import type { WarehouseCartonDoc, WarehouseCartonLine } from "@/types";

export function dateFromFirestore(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === "object" && ts && "seconds" in (ts as Record<string, unknown>)) {
    return new Date((ts as { seconds: number }).seconds * 1000);
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function hasLineExpiry(expiry: string | null | undefined): boolean {
  return Boolean(expiry?.trim());
}

/** ISO timestamp for FIFO — oldest receive first. Unknown dates sort last. */
export function cartonReceivedIso(
  carton: Pick<WarehouseCartonDoc, "receivedAt" | "createdAt">
): string {
  const d = dateFromFirestore(carton.receivedAt) ?? dateFromFirestore(carton.createdAt);
  return d ? d.toISOString() : "9999-12-31T23:59:59.999Z";
}

export type CartonLineSource = {
  carton: Pick<WarehouseCartonDoc, "cartonCode" | "receivedAt" | "createdAt">;
  line: Pick<WarehouseCartonLine, "expiry">;
};

/**
 * FEFO when the line has an expiry date; FIFO by carton receive date when it does not.
 * Expiry-managed lines are preferred before non-dated lines when mixed.
 */
export function compareFefoFifo(a: CartonLineSource, b: CartonLineSource): number {
  const aExp = hasLineExpiry(a.line.expiry) ? a.line.expiry!.trim().slice(0, 10) : null;
  const bExp = hasLineExpiry(b.line.expiry) ? b.line.expiry!.trim().slice(0, 10) : null;

  if (aExp && bExp) {
    const c = aExp.localeCompare(bExp);
    if (c !== 0) return c;
  } else if (aExp && !bExp) {
    return -1;
  } else if (!aExp && bExp) {
    return 1;
  } else {
    const c = cartonReceivedIso(a.carton).localeCompare(cartonReceivedIso(b.carton));
    if (c !== 0) return c;
  }

  return a.carton.cartonCode.localeCompare(b.carton.cartonCode);
}

export function sortCartonLineSourcesFefoFifo<T extends CartonLineSource>(sources: T[]): T[] {
  return [...sources].sort(compareFefoFifo);
}

export type FlatStockSortRow = {
  expiry: string | null;
  receivedAtIso: string;
  cartonCode: string;
  binPath?: string;
};

export function compareFlatStockFefoFifo(a: FlatStockSortRow, b: FlatStockSortRow): number {
  const aExp = hasLineExpiry(a.expiry) ? a.expiry!.trim().slice(0, 10) : null;
  const bExp = hasLineExpiry(b.expiry) ? b.expiry!.trim().slice(0, 10) : null;

  if (aExp && bExp) {
    const c = aExp.localeCompare(bExp);
    if (c !== 0) return c;
  } else if (aExp && !bExp) {
    return -1;
  } else if (!aExp && bExp) {
    return 1;
  } else {
    const c = a.receivedAtIso.localeCompare(b.receivedAtIso);
    if (c !== 0) return c;
  }

  if (a.binPath && b.binPath) {
    const bin = a.binPath.localeCompare(b.binPath);
    if (bin !== 0) return bin;
  }

  return a.cartonCode.localeCompare(b.cartonCode);
}

/** Walk order: bin path first, then FEFO/FIFO within the bin. */
export function comparePickStepWalkOrder(
  a: FlatStockSortRow & { binPath: string },
  b: FlatStockSortRow & { binPath: string }
): number {
  const binCmp = a.binPath.localeCompare(b.binPath);
  if (binCmp !== 0) return binCmp;
  return compareFlatStockFefoFifo(a, b);
}
