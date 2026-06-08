import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  writeBatch,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  warehouseCartonDocRef,
  warehouseCartonsCollectionRef,
  warehousePalletDocRef,
} from "@/lib/warehouse-carton-firestore";
import { warehouseBinsCollectionRef } from "@/lib/warehouse-firestore";
import { getWarehouseCarton } from "@/lib/warehouse-receive-corrections";
import {
  binStockKey,
  linesToFirestorePayload,
  moveLineQuantityBetweenBins,
  rollCartonBinStateFromLines,
} from "@/lib/warehouse-carton-line-utils";
import type {
  WarehouseBinDoc,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseCartonStatus,
  WarehousePalletDoc,
} from "@/types";
import {
  findBinByPath,
  inspectBinContents,
  validateLineToBin,
} from "@/lib/warehouse-putaway";

const WAREHOUSES = "warehouses";

async function findBinById(
  warehouseId: string,
  binId: string
): Promise<WarehouseBinDoc | null> {
  const snap = await getDoc(doc(warehouseBinsCollectionRef(warehouseId), binId));
  if (!snap.exists()) return null;
  const data = snap.data() as Record<string, unknown>;
  return {
    id: snap.id,
    area: String(data.area ?? ""),
    row: String(data.row ?? ""),
    bay: String(data.bay ?? ""),
    level: String(data.level ?? ""),
    binCode: String(data.binCode ?? ""),
    path: String(data.path ?? ""),
    barcode: String(data.barcode ?? ""),
    active: data.active !== false,
    storageAreaId: data.storageAreaId != null ? String(data.storageAreaId) : undefined,
    temporary: data.temporary === true,
    layoutBlockId: data.layoutBlockId != null ? String(data.layoutBlockId) : undefined,
  };
}

const LINE_BIN_STATUSES: WarehouseCartonStatus[] = [
  "stowed",
  "stowed_partial",
  "split",
  "available",
  "reserved",
  "on_hold",
];

export type CartonBinOccupancy = {
  carton: WarehouseCartonDoc;
  linesInBin: WarehouseCartonLine[];
};

/** Lines of this carton currently assigned to `binId`. */
export function linesInBinForCarton(
  carton: WarehouseCartonDoc,
  binId: string
): WarehouseCartonLine[] {
  const lines = carton.lines ?? [];
  if (lines.length === 0) {
    if (carton.binId === binId) {
      return [
        {
          lineId: "L1",
          sku: carton.sku,
          productTitle: carton.productTitle ?? null,
          quantity: carton.quantity,
          lot: carton.lot ?? null,
          expiry: carton.expiry ?? null,
          condition: carton.status === "damaged" ? "damaged" : "good",
          binId: carton.binId,
          allocationStatus: "unallocated",
          clientId: carton.clientId ?? null,
          inventoryRequestId: carton.inventoryRequestId ?? null,
        },
      ];
    }
    return [];
  }
  return lines.filter((l) => l.binId === binId);
}

export function cartonOccupiesBin(carton: WarehouseCartonDoc, binId: string): boolean {
  return linesInBinForCarton(carton, binId).length > 0;
}

/** Cartons (and their lines) occupying a bin — root `binId` query plus line-level scan. */
export async function listCartonsInBin(
  warehouseId: string,
  binId: string
): Promise<CartonBinOccupancy[]> {
  const seen = new Set<string>();
  const out: CartonBinOccupancy[] = [];

  const rootSnap = await getDocs(
    query(warehouseCartonsCollectionRef(warehouseId), where("binId", "==", binId))
  );
  for (const d of rootSnap.docs) {
    const carton = await getWarehouseCarton(warehouseId, d.id);
    if (!carton || carton.status === "voided" || carton.status === "closed") continue;
    const linesInBin = linesInBinForCarton(carton, binId);
    if (linesInBin.length === 0) continue;
    seen.add(carton.id);
    out.push({ carton, linesInBin });
  }

  const lineSnap = await getDocs(
    query(warehouseCartonsCollectionRef(warehouseId), where("status", "in", LINE_BIN_STATUSES))
  );
  for (const d of lineSnap.docs) {
    if (seen.has(d.id)) continue;
    const carton = await getWarehouseCarton(warehouseId, d.id);
    if (!carton || carton.status === "voided" || carton.status === "closed") continue;
    const linesInBin = linesInBinForCarton(carton, binId);
    if (linesInBin.length === 0) continue;
    seen.add(carton.id);
    out.push({ carton, linesInBin });
  }

  out.sort((a, b) => a.carton.cartonCode.localeCompare(b.carton.cartonCode));
  return out;
}

export type BinSkuStockRow = {
  key: string;
  sku: string;
  lot: string | null;
  expiry: string | null;
  condition: "good" | "damaged";
  productTitle: string | null;
  quantity: number;
  sources: Array<{ carton: WarehouseCartonDoc; line: WarehouseCartonLine }>;
};

/** Aggregate SKU + lot + condition quantities in a bin (floor view — no carton scan). */
export function aggregateBinSkuStock(occupants: CartonBinOccupancy[]): BinSkuStockRow[] {
  const map = new Map<string, BinSkuStockRow>();

  for (const { carton, linesInBin } of occupants) {
    for (const line of linesInBin) {
      if (line.allocationStatus === "picked") continue;
      const key = binStockKey(line);
      const existing = map.get(key);
      if (existing) {
        existing.quantity += line.quantity;
        existing.sources.push({ carton, line });
      } else {
        map.set(key, {
          key,
          sku: line.sku,
          lot: line.lot ?? null,
          expiry: line.expiry ?? null,
          condition: line.condition,
          productTitle: line.productTitle ?? null,
          quantity: line.quantity,
          sources: [{ carton, line }],
        });
      }
    }
  }

  return [...map.values()].sort((a, b) => {
    const sku = a.sku.localeCompare(b.sku);
    if (sku !== 0) return sku;
    return (a.lot ?? "").localeCompare(b.lot ?? "");
  });
}

function sortSourcesFefo(
  sources: Array<{ carton: WarehouseCartonDoc; line: WarehouseCartonLine }>
): Array<{ carton: WarehouseCartonDoc; line: WarehouseCartonLine }> {
  return [...sources].sort((a, b) => {
    const ea = a.line.expiry ?? "9999-99-99";
    const eb = b.line.expiry ?? "9999-99-99";
    if (ea !== eb) return ea.localeCompare(eb);
    return a.carton.cartonCode.localeCompare(b.carton.cartonCode);
  });
}

/** Move SKU qty from source bin to destination bin (splits carton lines as needed). */
export async function applyBinSkuMove(input: {
  warehouseId: string;
  sourceBinId: string;
  sourceBinPath: string;
  destBinId: string;
  destBinPath: string;
  sku: string;
  lot: string | null;
  condition: "good" | "damaged";
  quantity: number;
  operatorId?: string | null;
}): Promise<{ movedQty: number; cartonsUpdated: number }> {
  if (input.sourceBinId === input.destBinId) {
    throw new Error("Source and destination bins must be different.");
  }
  const moveQty = Math.floor(input.quantity);
  if (moveQty < 1) throw new Error("Quantity must be at least 1.");

  const destBin = await findBinByPath(input.warehouseId, input.destBinPath);
  if (!destBin || destBin.id !== input.destBinId) {
    throw new Error("Destination bin could not be verified.");
  }

  const occupants = await listCartonsInBin(input.warehouseId, input.sourceBinId);
  const rows = aggregateBinSkuStock(occupants);
  const key = binStockKey({ sku: input.sku, lot: input.lot, condition: input.condition });
  const row = rows.find((r) => r.key === key);
  if (!row || row.quantity < moveQty) {
    throw new Error(
      row
        ? `Only ${row.quantity} available for ${input.sku}${input.lot ? ` · Lot ${input.lot}` : ""}.`
        : `No stock for ${input.sku} in the source bin.`
    );
  }

  let destContents = await inspectBinContents(input.warehouseId, destBin.id);
  const simulatedSkus = [...destContents.skus];
  const probeLine: WarehouseCartonLine = {
    lineId: "probe",
    sku: input.sku,
    quantity: moveQty,
    lot: input.lot,
    expiry: row.expiry,
    condition: input.condition,
    binId: input.sourceBinId,
    allocationStatus: "unallocated",
  };
  const probe = validateLineToBin(probeLine, destBin, {
    skus: simulatedSkus,
    hasDamaged: destContents.hasDamaged,
    cartonCount: destContents.cartonCount,
  });
  if (!probe.ok) throw new Error(probe.reason);

  const cartonsToUpdate = new Map<string, WarehouseCartonDoc>();
  for (const { carton } of occupants) {
    if (!cartonsToUpdate.has(carton.id)) {
      cartonsToUpdate.set(carton.id, carton);
    }
  }

  const batch = writeBatch(db);
  let remaining = moveQty;
  let cartonsUpdated = 0;
  const events: Array<{
    carton: WarehouseCartonDoc;
    lineId: string;
    qty: number;
  }> = [];

  for (const { carton, line } of sortSourcesFefo(row.sources)) {
    if (remaining <= 0) break;

    const current = cartonsToUpdate.get(carton.id);
    if (!current?.lines?.length) continue;

    const liveLine = current.lines.find(
      (l) => l.lineId === line.lineId && l.binId === input.sourceBinId
    );
    if (!liveLine || liveLine.allocationStatus === "picked") continue;

    const take = Math.min(remaining, liveLine.quantity);
    const moved = moveLineQuantityBetweenBins(
      current.lines,
      liveLine.lineId,
      take,
      input.sourceBinId,
      input.destBinId
    );
    cartonsToUpdate.set(carton.id, { ...current, lines: moved.nextLines });
    events.push({ carton: current, lineId: moved.movedLineId, qty: moved.movedQty });
    remaining -= take;
  }

  if (remaining > 0) {
    throw new Error("Could not allocate the full quantity from source lines.");
  }

  const touched = new Set<string>();
  for (const { carton, lineId, qty } of events) {
    if (!touched.has(carton.id)) {
      const updated = cartonsToUpdate.get(carton.id)!;
      const { status, binId } = rollCartonBinStateFromLines(updated, updated.lines ?? []);
      batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
        lines: linesToFirestorePayload(updated.lines ?? []),
        status,
        binId,
        updatedAt: serverTimestamp(),
      });
      touched.add(carton.id);
      cartonsUpdated += 1;
    }

    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "move",
      cartonId: carton.id,
      cartonCode: carton.cartonCode,
      lineId,
      sku: input.sku,
      quantity: qty,
      condition: input.condition,
      lot: input.lot,
      fromBinId: input.sourceBinId,
      fromBinPath: input.sourceBinPath,
      toBinId: input.destBinId,
      toBinPath: input.destBinPath,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }

  await batch.commit();
  return { movedQty: moveQty, cartonsUpdated };
}

export type MoveLineValidation =
  | { ok: true; line: WarehouseCartonLine }
  | { ok: false; line: WarehouseCartonLine; reason: string };

export function validateLinesForMove(input: {
  lines: WarehouseCartonLine[];
  sourceBinId: string;
  destBin: WarehouseBinDoc;
  destContents: { skus: string[]; hasDamaged: boolean; cartonCount: number };
  /** When moving multiple lines in one commit, pass growing SKU list so bin-pool rules apply correctly. */
  destSkusOverride?: string[];
}): MoveLineValidation[] {
  const skus = [...(input.destSkusOverride ?? input.destContents.skus)];
  const hasDamaged = input.destContents.hasDamaged;
  const results: MoveLineValidation[] = [];

  for (const line of input.lines) {
    if (line.allocationStatus === "picked") {
      results.push({ ok: false, line, reason: "Line is picked — complete or undo pick first." });
      continue;
    }
    if (line.binId !== input.sourceBinId) {
      results.push({ ok: false, line, reason: "Line is not in the source bin." });
      continue;
    }
    const r = validateLineToBin(line, input.destBin, {
      skus,
      hasDamaged,
      cartonCount: input.destContents.cartonCount,
    });
    if (!r.ok) {
      results.push({ ok: false, line, reason: r.reason });
      continue;
    }
    results.push({ ok: true, line });
    if (line.condition !== "damaged" && line.sku && line.sku !== "MIXED") {
      const existing = skus.filter((s) => s && s !== "MIXED");
      if (existing.length === 0) skus.push(line.sku);
    }
  }
  return results;
}

function rollCartonBinState(
  carton: WarehouseCartonDoc,
  nextLines: WarehouseCartonLine[]
): { status: WarehouseCartonDoc["status"]; binId: string | null } {
  const stowedLines = nextLines.filter((l) => l.binId);
  const allStowed = stowedLines.length === nextLines.length && nextLines.length > 0;
  const distinctBins = new Set(stowedLines.map((l) => l.binId));

  let status = carton.status;
  if (allStowed) {
    if (distinctBins.size > 1 && carton.isMixed) {
      status = "split";
    } else if (carton.status === "stowed_partial") {
      status = distinctBins.size > 1 && carton.isMixed ? "split" : "stowed";
    } else if (
      status === "receiving" ||
      status === "received" ||
      status === "stowed_partial"
    ) {
      status = distinctBins.size > 1 && carton.isMixed ? "split" : "stowed";
    }
  }

  const binId =
    allStowed && distinctBins.size === 1 ? stowedLines[0].binId ?? null : carton.binId ?? null;

  if (distinctBins.size > 1) {
    return { status: carton.isMixed ? "split" : status, binId: null };
  }
  if (distinctBins.size === 1) {
    return { status, binId: stowedLines[0]?.binId ?? null };
  }
  return { status, binId: carton.binId ?? null };
}

export async function applyCartonBinMove(input: {
  warehouseId: string;
  cartonId: string;
  sourceBinId: string;
  sourceBinPath: string;
  destBinId: string;
  destBinPath: string;
  operatorId?: string | null;
}): Promise<{ movedLines: number }> {
  if (input.sourceBinId === input.destBinId) {
    throw new Error("Source and destination bins must be different.");
  }

  const carton = await getWarehouseCarton(input.warehouseId, input.cartonId);
  if (!carton) throw new Error("Carton not found.");

  const linesToMove = linesInBinForCarton(carton, input.sourceBinId);
  if (linesToMove.length === 0) {
    throw new Error("This carton has no stock in the source bin.");
  }

  const destBin = await findBinByPath(input.warehouseId, input.destBinPath);
  if (!destBin || destBin.id !== input.destBinId) {
    throw new Error("Destination bin could not be verified.");
  }
  const destContents = await inspectBinContents(input.warehouseId, destBin.id);

  const validations = validateLinesForMove({
    lines: linesToMove,
    sourceBinId: input.sourceBinId,
    destBin,
    destContents,
  });
  const blocked = validations.filter((v) => !v.ok);
  if (blocked.length > 0) {
    throw new Error(blocked.map((b) => (!b.ok ? `${b.line.sku}: ${b.reason}` : "")).join(" • "));
  }

  const moveIds = new Set(linesToMove.map((l) => l.lineId));
  const baseLines =
    carton.lines && carton.lines.length > 0
      ? carton.lines
      : linesInBinForCarton(carton, input.sourceBinId);

  const nextLines = baseLines.map((l) =>
    moveIds.has(l.lineId) ? { ...l, binId: input.destBinId } : l
  );
  const { status, binId } = rollCartonBinState(carton, nextLines);

  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, input.cartonId), {
    lines: nextLines.map((l) => ({
      lineId: l.lineId,
      sku: l.sku,
      productTitle: l.productTitle ?? null,
      quantity: l.quantity,
      lot: l.lot ?? null,
      expiry: l.expiry ? l.expiry.slice(0, 10) : null,
      condition: l.condition,
      binId: l.binId ?? null,
      allocationStatus: l.allocationStatus ?? "unallocated",
      clientId: l.clientId ?? null,
      inventoryRequestId: l.inventoryRequestId ?? null,
    })),
    status,
    binId,
    updatedAt: serverTimestamp(),
  });

  const sourcePath = input.sourceBinPath.trim() || input.sourceBinId;

  for (const line of linesToMove) {
    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "move",
      cartonId: input.cartonId,
      cartonCode: carton.cartonCode,
      lineId: line.lineId,
      sku: line.sku,
      quantity: line.quantity,
      condition: line.condition,
      fromBinId: input.sourceBinId,
      fromBinPath: sourcePath,
      toBinId: input.destBinId,
      toBinPath: input.destBinPath,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }

  await batch.commit();
  return { movedLines: linesToMove.length };
}

export type PalletMoveLine = {
  carton: WarehouseCartonDoc;
  line: WarehouseCartonLine;
};

/** All stowed lines on a pallet (any bin). */
export function stowedLinesOnPallet(cartons: WarehouseCartonDoc[]): PalletMoveLine[] {
  const out: PalletMoveLine[] = [];
  for (const carton of cartons) {
    if (carton.status === "voided" || carton.status === "closed") continue;
    const lines = carton.lines ?? [];
    if (lines.length === 0) {
      if (carton.binId) {
        out.push({
          carton,
          line: {
            lineId: "L1",
            sku: carton.sku,
            productTitle: carton.productTitle ?? null,
            quantity: carton.quantity,
            lot: carton.lot ?? null,
            expiry: carton.expiry ?? null,
            condition: carton.status === "damaged" ? "damaged" : "good",
            binId: carton.binId,
            allocationStatus: "unallocated",
            clientId: carton.clientId ?? null,
            inventoryRequestId: carton.inventoryRequestId ?? null,
          },
        });
      }
      continue;
    }
    for (const line of lines) {
      if (line.binId) out.push({ carton, line });
    }
  }
  return out;
}

export async function applyPalletBinMove(input: {
  warehouseId: string;
  pallet: WarehousePalletDoc;
  cartons: WarehouseCartonDoc[];
  destBinId: string;
  destBinPath: string;
  operatorId?: string | null;
}): Promise<{ movedLines: number; cartonsUpdated: number }> {
  const entries = stowedLinesOnPallet(input.cartons);
  if (entries.length === 0) {
    throw new Error("This pallet has no stowed stock to move.");
  }

  const destBin = await findBinByPath(input.warehouseId, input.destBinPath);
  if (!destBin || destBin.id !== input.destBinId) {
    throw new Error("Destination bin could not be verified.");
  }
  const destContents = await inspectBinContents(input.warehouseId, destBin.id);

  const byCarton = new Map<string, PalletMoveLine[]>();
  for (const entry of entries) {
    const list = byCarton.get(entry.carton.id) ?? [];
    list.push(entry);
    byCarton.set(entry.carton.id, list);
  }

  const batch = writeBatch(db);
  let movedLines = 0;
  let cartonsUpdated = 0;
  const simulatedSkus = [...destContents.skus];

  for (const [cartonId, cartonEntries] of byCarton) {
    const carton = cartonEntries[0]?.carton;
    if (!carton) continue;

    const validations: MoveLineValidation[] = [];
    for (const { line } of cartonEntries) {
      if (!line.binId) continue;
      validations.push(
        ...validateLinesForMove({
          lines: [line],
          sourceBinId: line.binId,
          destBin,
          destContents,
          destSkusOverride: simulatedSkus,
        })
      );
      const last = validations[validations.length - 1];
      if (last?.ok && line.condition !== "damaged" && line.sku && line.sku !== "MIXED") {
        const existing = simulatedSkus.filter((s) => s && s !== "MIXED");
        if (existing.length === 0) simulatedSkus.push(line.sku);
      }
    }
    const blocked = validations.filter((v) => !v.ok);
    if (blocked.length > 0) {
      throw new Error(
        `${carton.cartonCode}: ${blocked.map((b) => (!b.ok ? b.reason : "")).join(" • ")}`
      );
    }

    const moveIds = new Set(cartonEntries.map((e) => e.line.lineId));
    const baseLines =
      carton.lines && carton.lines.length > 0 ? carton.lines : cartonEntries.map((e) => e.line);

    const nextLines = baseLines.map((l) =>
      moveIds.has(l.lineId) ? { ...l, binId: input.destBinId } : l
    );
    const { status, binId } = rollCartonBinState(carton, nextLines);

    batch.update(warehouseCartonDocRef(input.warehouseId, cartonId), {
      lines: nextLines.map((l) => ({
        lineId: l.lineId,
        sku: l.sku,
        productTitle: l.productTitle ?? null,
        quantity: l.quantity,
        lot: l.lot ?? null,
        expiry: l.expiry ? l.expiry.slice(0, 10) : null,
        condition: l.condition,
        binId: l.binId ?? null,
        allocationStatus: l.allocationStatus ?? "unallocated",
        clientId: l.clientId ?? null,
        inventoryRequestId: l.inventoryRequestId ?? null,
      })),
      status,
      binId,
      updatedAt: serverTimestamp(),
    });

    for (const { line } of cartonEntries) {
      if (!line.binId) continue;
      const sourceBin = await findBinById(input.warehouseId, line.binId);
      const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
      batch.set(doc(eventsRef), {
        type: "move",
        palletId: input.pallet.id,
        palletCode: input.pallet.palletCode,
        cartonId,
        cartonCode: carton.cartonCode,
        lineId: line.lineId,
        sku: line.sku,
        quantity: line.quantity,
        condition: line.condition,
        fromBinId: line.binId,
        fromBinPath: sourceBin?.path ?? line.binId,
        toBinId: input.destBinId,
        toBinPath: input.destBinPath,
        operatorId: input.operatorId ?? null,
        at: serverTimestamp(),
      });
      movedLines += 1;
    }
    cartonsUpdated += 1;
  }

  batch.update(warehousePalletDocRef(input.warehouseId, input.pallet.id), {
    binId: input.destBinId,
    updatedAt: serverTimestamp(),
  });

  await batch.commit();
  return { movedLines, cartonsUpdated };
}

export { findBinByPath, inspectBinContents };
