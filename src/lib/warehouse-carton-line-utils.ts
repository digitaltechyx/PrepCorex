import type { WarehouseCartonDoc, WarehouseCartonLine } from "@/types";

export type PutawayAssignment = {
  lineId: string;
  binId: string;
  binPath: string;
  /** When set and less than line qty, the line is split across bins. */
  quantity?: number;
};

export function nextCartonLineId(lines: WarehouseCartonLine[]): string {
  let n = lines.length + 1;
  while (lines.some((l) => l.lineId === `L${n}`)) n += 1;
  return `L${n}`;
}

export function linesToFirestorePayload(lines: WarehouseCartonLine[]) {
  return lines.map((l) => ({
    lineId: l.lineId,
    sku: l.sku,
    productTitle: l.productTitle ?? null,
    quantity: l.quantity,
    lot: l.lot ?? null,
    expiry: l.expiry ? l.expiry.slice(0, 10) : null,
    condition: l.condition,
    binId: l.binId ?? null,
    stagingArea: l.stagingArea ?? null,
    allocationStatus: l.allocationStatus ?? "unallocated",
    clientId: l.clientId ?? null,
    inventoryRequestId: l.inventoryRequestId ?? null,
  }));
}

/**
 * Assign `putQty` units from `lineId` to `destBinId`. Remaining qty stays on the
 * original line (same bin). Creates a new line when `putQty` < line quantity.
 */
export function assignLineQuantityToBin(
  lines: WarehouseCartonLine[],
  lineId: string,
  putQty: number,
  destBinId: string
): { nextLines: WarehouseCartonLine[]; assignedLineId: string; assignedQty: number } {
  const idx = lines.findIndex((l) => l.lineId === lineId);
  if (idx < 0) throw new Error(`Line ${lineId} not found.`);

  const line = lines[idx];
  if (line.allocationStatus === "picked") {
    throw new Error(`Line ${line.sku} is picked and cannot be moved.`);
  }
  const qty = Math.floor(putQty);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  if (qty > line.quantity) {
    throw new Error(`Only ${line.quantity} available on ${line.sku}.`);
  }

  const next = [...lines];
  if (qty === line.quantity) {
    next[idx] = { ...line, binId: destBinId };
    return { nextLines: next, assignedLineId: line.lineId, assignedQty: qty };
  }

  const newId = nextCartonLineId(next);
  next[idx] = { ...line, quantity: line.quantity - qty };
  next.push({ ...line, lineId: newId, quantity: qty, binId: destBinId });
  return { nextLines: next, assignedLineId: newId, assignedQty: qty };
}

/** Apply many putaway assignments (supports partial qty per assignment). */
export function applyPutawayAssignmentsToLines(
  lines: WarehouseCartonLine[],
  assignments: PutawayAssignment[]
): { nextLines: WarehouseCartonLine[]; applied: Array<PutawayAssignment & { quantity: number }> } {
  let nextLines = [...lines];
  const applied: Array<PutawayAssignment & { quantity: number }> = [];

  for (const a of assignments) {
    const sourceLine = nextLines.find((l) => l.lineId === a.lineId);
    const putQty = a.quantity ?? sourceLine?.quantity ?? 0;
    const result = assignLineQuantityToBin(nextLines, a.lineId, putQty, a.binId);
    nextLines = result.nextLines;
    applied.push({ ...a, quantity: result.assignedQty, lineId: result.assignedLineId });
  }

  return { nextLines, applied };
}

export function rollCartonBinStateFromLines(
  carton: { status: string; isMixed?: boolean },
  nextLines: WarehouseCartonLine[]
): { status: string; binId: string | null } {
  const stowedLines = nextLines.filter((l) => l.binId);
  const allStowed = stowedLines.length === nextLines.length && nextLines.length > 0;
  const someStowed = stowedLines.length > 0;
  const distinctBins = new Set(stowedLines.map((l) => l.binId));

  let status = carton.status;
  if (allStowed) {
    status = distinctBins.size > 1 && carton.isMixed ? "split" : "stowed";
  } else if (someStowed) {
    status = "stowed_partial";
  }

  if (allStowed && distinctBins.size === 1) {
    return { status, binId: stowedLines[0]?.binId ?? null };
  }
  if (distinctBins.size > 1) {
    return { status: carton.isMixed ? "split" : status, binId: null };
  }
  return { status, binId: null };
}

export function moveLineQuantityBetweenBins(
  lines: WarehouseCartonLine[],
  lineId: string,
  moveQty: number,
  sourceBinId: string,
  destBinId: string | null
): { nextLines: WarehouseCartonLine[]; movedLineId: string; movedQty: number } {
  const idx = lines.findIndex((l) => l.lineId === lineId);
  if (idx < 0) throw new Error(`Line ${lineId} not found.`);

  const line = lines[idx];
  if (line.binId !== sourceBinId) {
    throw new Error(`Line ${line.sku} is not in the source bin.`);
  }
  if (line.allocationStatus === "picked") {
    throw new Error(`Line ${line.sku} is picked and cannot be moved.`);
  }

  const qty = Math.floor(moveQty);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  if (qty > line.quantity) {
    throw new Error(`Only ${line.quantity} available on ${line.sku}.`);
  }

  const next = [...lines];
  if (qty === line.quantity) {
    next[idx] = { ...line, binId: destBinId };
    return { nextLines: next, movedLineId: line.lineId, movedQty: qty };
  }

  const newId = nextCartonLineId(next);
  next[idx] = { ...line, quantity: line.quantity - qty, binId: sourceBinId };
  next.push({ ...line, lineId: newId, quantity: qty, binId: destBinId });
  return { nextLines: next, movedLineId: newId, movedQty: qty };
}

export function binStockKey(line: Pick<WarehouseCartonLine, "sku" | "lot" | "condition">): string {
  return `${line.sku}::${line.lot ?? ""}::${line.condition}`;
}

export function lineEffectiveStagingArea(
  line: WarehouseCartonLine,
  carton: Pick<WarehouseCartonDoc, "stagingArea">
): string | null {
  if (line.binId) return null;
  const sa = line.stagingArea ?? carton.stagingArea ?? null;
  return sa?.trim() || null;
}

/** Roll up carton `stagingArea` from unstowed lines (null when mixed or none). */
export function rollupCartonStagingArea(
  nextLines: WarehouseCartonLine[],
  carton: Pick<WarehouseCartonDoc, "stagingArea">
): string | null {
  const unstowed = nextLines.filter((l) => !l.binId);
  if (unstowed.length === 0) return null;
  const areas = new Set(
    unstowed
      .map((l) => lineEffectiveStagingArea(l, carton))
      .filter((a): a is string => Boolean(a))
  );
  if (areas.size === 1) return [...areas][0];
  return null;
}

export function moveLineQuantityBetweenAreas(
  lines: WarehouseCartonLine[],
  lineId: string,
  moveQty: number,
  sourceAreaCode: string,
  destAreaCode: string,
  cartonFallbackStaging?: string | null
): { nextLines: WarehouseCartonLine[]; movedLineId: string; movedQty: number } {
  const src = sourceAreaCode.trim().toUpperCase();
  const dest = destAreaCode.trim();
  if (!dest) throw new Error("Destination area is required.");

  const idx = lines.findIndex((l) => l.lineId === lineId);
  if (idx < 0) throw new Error(`Line ${lineId} not found.`);

  const line = lines[idx];
  if (line.binId) {
    throw new Error(`Line ${line.sku} is stowed in a bin — use bin → area move.`);
  }
  const effective = (line.stagingArea ?? cartonFallbackStaging ?? "").trim().toUpperCase();
  if (effective !== src) {
    throw new Error(`Line ${line.sku} is not in the source area.`);
  }
  if (line.allocationStatus === "picked") {
    throw new Error(`Line ${line.sku} is picked and cannot be moved.`);
  }

  const qty = Math.floor(moveQty);
  if (qty < 1) throw new Error("Quantity must be at least 1.");
  if (qty > line.quantity) {
    throw new Error(`Only ${line.quantity} available on ${line.sku}.`);
  }

  const sourceStaging = line.stagingArea ?? cartonFallbackStaging ?? sourceAreaCode.trim();
  const next = [...lines];
  if (qty === line.quantity) {
    next[idx] = { ...line, binId: null, stagingArea: dest };
    return { nextLines: next, movedLineId: line.lineId, movedQty: qty };
  }

  const newId = nextCartonLineId(next);
  next[idx] = { ...line, quantity: line.quantity - qty, stagingArea: sourceStaging };
  next.push({
    ...line,
    lineId: newId,
    quantity: qty,
    binId: null,
    stagingArea: dest,
  });
  return { nextLines: next, movedLineId: newId, movedQty: qty };
}

/** After bin → area move, tag unstowed lines with their floor area. */
export function tagUnstowedLineStagingArea(
  lines: WarehouseCartonLine[],
  movedLineId: string,
  destAreaCode: string
): WarehouseCartonLine[] {
  const dest = destAreaCode.trim();
  return lines.map((l) =>
    l.lineId === movedLineId && !l.binId ? { ...l, stagingArea: dest } : l
  );
}
