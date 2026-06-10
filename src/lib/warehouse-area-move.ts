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
import { getAreaPurposes, purposeKey } from "@/lib/warehouse-area-purposes";
import {
  listCartonsByPalletId,
  warehouseCartonDocRef,
  warehouseCartonsCollectionRef,
  warehousePalletDocRef,
  warehousePalletsCollectionRef,
} from "@/lib/warehouse-carton-firestore";
import {
  aggregateBinSkuStock,
  listCartonsInBin,
  sortSourcesFefo,
  type BinSkuStockRow,
} from "@/lib/warehouse-internal-move";
import {
  binStockKey,
  lineEffectiveStagingArea,
  linesToFirestorePayload,
  moveLineQuantityBetweenAreas,
  moveLineQuantityBetweenBins,
  rollupCartonStagingArea,
  tagUnstowedLineStagingArea,
  rollCartonBinStateFromLines,
} from "@/lib/warehouse-carton-line-utils";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import { getWarehouseCarton, getWarehousePallet } from "@/lib/warehouse-receive-corrections";
import type {
  WarehouseAreaDoc,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseCartonStatus,
  WarehousePalletDoc,
  WarehousePalletStatus,
} from "@/types";

const WAREHOUSES = "warehouses";

const AREA_FLOOR_STATUSES: WarehouseCartonStatus[] = [
  "quarantine",
  "damaged",
  "on_hold",
  "stowed_partial",
  "received",
  "receiving",
  "available",
  "reserved",
  "split",
];

/** Carton status when all lines leave bins and sit in a non-storage area. */
export function cartonStatusForArea(area: WarehouseAreaDoc): WarehouseCartonStatus {
  const keys = getAreaPurposes(area).map(purposeKey);
  if (keys.some((k) => k === "quarantine" || k === "returns")) return "quarantine";
  if (keys.some((k) => k === "damaged")) return "damaged";
  if (keys.some((k) => k === "dispatch" || k === "packing")) return "on_hold";
  return "on_hold";
}

export function formatAreaOption(area: WarehouseAreaDoc): string {
  const purposes = getAreaPurposes(area);
  const label = area.name?.trim() || area.code;
  return purposes.length ? `${area.code} — ${label} (${purposes.join(", ")})` : `${area.code} — ${label}`;
}

export async function loadActiveWarehouseAreas(warehouseId: string): Promise<WarehouseAreaDoc[]> {
  const areas = await listWarehouseAreas(warehouseId);
  return areas
    .filter((a) => a.active !== false && a.code.trim())
    .sort((a, b) => a.code.localeCompare(b.code));
}

async function loadAreaDoc(warehouseId: string, areaId: string): Promise<WarehouseAreaDoc> {
  const areaSnap = await getDoc(doc(db, WAREHOUSES, warehouseId, "areas", areaId));
  if (!areaSnap.exists()) throw new Error("Area not found.");
  const areaData = areaSnap.data() as Record<string, unknown>;
  const area: WarehouseAreaDoc = {
    id: areaSnap.id,
    code: String(areaData.code ?? "").trim(),
    name: areaData.name != null ? String(areaData.name) : undefined,
    purposes: Array.isArray(areaData.purposes) ? (areaData.purposes as string[]) : undefined,
    areaType: areaData.areaType != null ? String(areaData.areaType) : undefined,
    active: areaData.active !== false,
  };
  if (!area.code) throw new Error("Area has no code.");
  if (area.active === false) throw new Error("Area is inactive.");
  return area;
}

export type CartonAreaOccupancy = {
  carton: WarehouseCartonDoc;
  linesInArea: WarehouseCartonLine[];
};

/** Lines of this carton currently on the floor in `areaCode` (not in a bin). */
export function linesInAreaForCarton(
  carton: WarehouseCartonDoc,
  areaCode: string
): WarehouseCartonLine[] {
  const code = areaCode.trim().toUpperCase();
  const lines = carton.lines ?? [];
  if (lines.length === 0) {
    if (!carton.binId && carton.stagingArea?.trim().toUpperCase() === code) {
      return [
        {
          lineId: "L1",
          sku: carton.sku,
          productTitle: carton.productTitle ?? null,
          quantity: carton.quantity,
          lot: carton.lot ?? null,
          expiry: carton.expiry ?? null,
          condition: carton.status === "damaged" ? "damaged" : "good",
          binId: null,
          stagingArea: carton.stagingArea ?? null,
          allocationStatus: "unallocated",
          clientId: carton.clientId ?? null,
          inventoryRequestId: carton.inventoryRequestId ?? null,
        },
      ];
    }
    return [];
  }
  return lines.filter((l) => {
    if (l.binId) return false;
    const la = lineEffectiveStagingArea(l, carton);
    return la?.trim().toUpperCase() === code;
  });
}

/** Cartons (and their lines) occupying an area floor — root `stagingArea` plus line-level scan. */
export async function listCartonsInArea(
  warehouseId: string,
  areaCode: string
): Promise<CartonAreaOccupancy[]> {
  const code = areaCode.trim();
  const seen = new Set<string>();
  const out: CartonAreaOccupancy[] = [];

  const rootSnap = await getDocs(
    query(warehouseCartonsCollectionRef(warehouseId), where("stagingArea", "==", code))
  );
  for (const d of rootSnap.docs) {
    const carton = await getWarehouseCarton(warehouseId, d.id);
    if (!carton || carton.status === "voided" || carton.status === "closed") continue;
    const linesInArea = linesInAreaForCarton(carton, code);
    if (linesInArea.length === 0) continue;
    seen.add(carton.id);
    out.push({ carton, linesInArea });
  }

  const lineSnap = await getDocs(
    query(warehouseCartonsCollectionRef(warehouseId), where("status", "in", AREA_FLOOR_STATUSES))
  );
  for (const d of lineSnap.docs) {
    if (seen.has(d.id)) continue;
    const carton = await getWarehouseCarton(warehouseId, d.id);
    if (!carton || carton.status === "voided" || carton.status === "closed") continue;
    const linesInArea = linesInAreaForCarton(carton, code);
    if (linesInArea.length === 0) continue;
    seen.add(carton.id);
    out.push({ carton, linesInArea });
  }

  out.sort((a, b) => a.carton.cartonCode.localeCompare(b.carton.cartonCode));
  return out;
}

export function aggregateAreaSkuStock(occupants: CartonAreaOccupancy[]): BinSkuStockRow[] {
  return aggregateBinSkuStock(
    occupants.map((o) => ({ carton: o.carton, linesInBin: o.linesInArea }))
  );
}

function resolveCartonFieldsAfterAreaMove(
  carton: WarehouseCartonDoc,
  nextLines: WarehouseCartonLine[],
  destArea: WarehouseAreaDoc
): { status: WarehouseCartonStatus; binId: string | null; stagingArea: string | null } {
  const rolled = rollCartonBinStateFromLines(carton, nextLines);
  const unstowed = nextLines.filter((l) => !l.binId);
  const stowed = nextLines.filter((l) => l.binId);
  const destCode = destArea.code.trim().toUpperCase();

  let status = rolled.status as WarehouseCartonStatus;
  const allUnstowedInDest =
    unstowed.length > 0 &&
    unstowed.every(
      (l) => lineEffectiveStagingArea(l, carton)?.trim().toUpperCase() === destCode
    );

  if (unstowed.length > 0 && stowed.length === 0) {
    status = allUnstowedInDest ? cartonStatusForArea(destArea) : "on_hold";
  } else if (unstowed.length > 0 && stowed.length > 0) {
    status = "stowed_partial";
  }

  return {
    status,
    binId: rolled.binId,
    stagingArea: rollupCartonStagingArea(nextLines, carton) ?? destArea.code.trim(),
  };
}

/** Move SKU qty from a storage bin into a floor area (no destination bin). */
export async function applyBinSkuToAreaMove(input: {
  warehouseId: string;
  sourceBinId: string;
  sourceBinPath: string;
  sourceAreaCode: string;
  destAreaId: string;
  sku: string;
  lot: string | null;
  condition: "good" | "damaged";
  quantity: number;
  operatorId?: string | null;
}): Promise<{ movedQty: number; cartonsUpdated: number; destAreaCode: string }> {
  const moveQty = Math.floor(input.quantity);
  if (moveQty < 1) throw new Error("Quantity must be at least 1.");

  const destArea = await loadAreaDoc(input.warehouseId, input.destAreaId);

  const sourceArea = input.sourceAreaCode.trim().toUpperCase();
  if (sourceArea && destArea.code.trim().toUpperCase() === sourceArea) {
    throw new Error(
      "This bin is already in the selected area. Use bin-to-bin move to relocate within storage."
    );
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

  const cartonsToUpdate = new Map<string, WarehouseCartonDoc>();
  for (const { carton } of occupants) {
    cartonsToUpdate.set(carton.id, carton);
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
      null
    );
    const tagged = tagUnstowedLineStagingArea(
      moved.nextLines,
      moved.movedLineId,
      destArea.code
    );
    cartonsToUpdate.set(carton.id, { ...current, lines: tagged });
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
      const nextLines = updated.lines ?? [];
      const { status, binId, stagingArea } = resolveCartonFieldsAfterAreaMove(
        updated,
        nextLines,
        destArea
      );
      batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
        lines: linesToFirestorePayload(nextLines),
        status,
        binId,
        stagingArea,
        updatedAt: serverTimestamp(),
      });
      touched.add(carton.id);
      cartonsUpdated += 1;
    }

    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "area_move",
      cartonId: carton.id,
      cartonCode: carton.cartonCode,
      lineId,
      sku: input.sku,
      quantity: qty,
      condition: input.condition,
      lot: input.lot,
      fromBinId: input.sourceBinId,
      fromBinPath: input.sourceBinPath,
      toBinId: null,
      toBinPath: null,
      toStagingArea: destArea.code,
      destAreaId: destArea.id,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }

  await batch.commit();
  return { movedQty: moveQty, cartonsUpdated, destAreaCode: destArea.code };
}

/** Move SKU qty from one floor area to another (no bins). */
export async function applyAreaSkuToAreaMove(input: {
  warehouseId: string;
  sourceAreaId: string;
  destAreaId: string;
  sku: string;
  lot: string | null;
  condition: "good" | "damaged";
  quantity: number;
  operatorId?: string | null;
}): Promise<{
  movedQty: number;
  cartonsUpdated: number;
  sourceAreaCode: string;
  destAreaCode: string;
}> {
  const moveQty = Math.floor(input.quantity);
  if (moveQty < 1) throw new Error("Quantity must be at least 1.");

  if (input.sourceAreaId === input.destAreaId) {
    throw new Error("Source and destination areas must be different.");
  }

  const sourceArea = await loadAreaDoc(input.warehouseId, input.sourceAreaId);
  const destArea = await loadAreaDoc(input.warehouseId, input.destAreaId);

  const occupants = await listCartonsInArea(input.warehouseId, sourceArea.code);
  const rows = aggregateAreaSkuStock(occupants);
  const key = binStockKey({ sku: input.sku, lot: input.lot, condition: input.condition });
  const row = rows.find((r) => r.key === key);
  if (!row || row.quantity < moveQty) {
    throw new Error(
      row
        ? `Only ${row.quantity} available for ${input.sku}${input.lot ? ` · Lot ${input.lot}` : ""}.`
        : `No stock for ${input.sku} in the source area.`
    );
  }

  const cartonsToUpdate = new Map<string, WarehouseCartonDoc>();
  for (const { carton } of occupants) {
    cartonsToUpdate.set(carton.id, carton);
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
    if (!current) continue;

    const baseLines =
      current.lines && current.lines.length > 0
        ? current.lines
        : linesInAreaForCarton(current, sourceArea.code);
    if (baseLines.length === 0) continue;

    const liveLine = baseLines.find((l) => l.lineId === line.lineId);
    if (!liveLine || liveLine.allocationStatus === "picked") continue;
    if (liveLine.binId) continue;
    const inSource =
      lineEffectiveStagingArea(liveLine, current)?.trim().toUpperCase() ===
      sourceArea.code.trim().toUpperCase();
    if (!inSource) continue;

    const take = Math.min(remaining, liveLine.quantity);
    const moved = moveLineQuantityBetweenAreas(
      baseLines,
      liveLine.lineId,
      take,
      sourceArea.code,
      destArea.code,
      current.stagingArea
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
      const nextLines = updated.lines ?? [];
      const { status, binId, stagingArea } = resolveCartonFieldsAfterAreaMove(
        updated,
        nextLines,
        destArea
      );
      batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
        lines: linesToFirestorePayload(nextLines),
        status,
        binId,
        stagingArea,
        updatedAt: serverTimestamp(),
      });
      touched.add(carton.id);
      cartonsUpdated += 1;
    }

    const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "area_move",
      cartonId: carton.id,
      cartonCode: carton.cartonCode,
      lineId,
      sku: input.sku,
      quantity: qty,
      condition: input.condition,
      lot: input.lot,
      fromBinId: null,
      fromBinPath: null,
      fromStagingArea: sourceArea.code,
      sourceAreaId: sourceArea.id,
      toBinId: null,
      toBinPath: null,
      toStagingArea: destArea.code,
      destAreaId: destArea.id,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }

  await batch.commit();
  return {
    movedQty: moveQty,
    cartonsUpdated,
    sourceAreaCode: sourceArea.code,
    destAreaCode: destArea.code,
  };
}

function areaCodesMatch(a: string, b: string): boolean {
  return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function palletStatusForArea(area: WarehouseAreaDoc): WarehousePalletStatus {
  const keys = getAreaPurposes(area).map(purposeKey);
  if (keys.some((k) => k === "dispatch" || k === "packing")) return "on_hold";
  if (keys.some((k) => k === "quarantine" || k === "returns" || k === "damaged")) {
    return "on_hold";
  }
  return "on_hold";
}

export function palletIsOnAreaFloor(pallet: WarehousePalletDoc, areaCode: string): boolean {
  if (pallet.binId) return false;
  return areaCodesMatch(pallet.stagingArea ?? "", areaCode);
}

export async function listPalletsInArea(
  warehouseId: string,
  areaCode: string
): Promise<WarehousePalletDoc[]> {
  const code = areaCode.trim();
  const snap = await getDocs(
    query(warehousePalletsCollectionRef(warehouseId), where("stagingArea", "==", code))
  );
  const out: WarehousePalletDoc[] = [];
  for (const d of snap.docs) {
    const pallet = await getWarehousePallet(warehouseId, d.id);
    if (!pallet || pallet.binId) continue;
    if (!areaCodesMatch(pallet.stagingArea ?? "", code)) continue;
    out.push(pallet);
  }
  out.sort((a, b) => a.palletCode.localeCompare(b.palletCode));
  return out;
}

export type AreaFloorCartonSummary = {
  carton: WarehouseCartonDoc;
  linesInArea: WarehouseCartonLine[];
  units: number;
};

export async function listAreaFloorCartonSummaries(
  warehouseId: string,
  areaCode: string
): Promise<AreaFloorCartonSummary[]> {
  const occupants = await listCartonsInArea(warehouseId, areaCode);
  return occupants.map((o) => ({
    carton: o.carton,
    linesInArea: o.linesInArea,
    units: o.linesInArea.reduce((sum, l) => sum + l.quantity, 0),
  }));
}

type RelocatedLine = {
  lineId: string;
  sku: string;
  quantity: number;
  lot: string | null;
  condition: "good" | "damaged";
};

function relocateCartonFloorLinesInArea(
  carton: WarehouseCartonDoc,
  sourceAreaCode: string,
  destAreaCode: string
): { nextLines: WarehouseCartonLine[]; movedLines: RelocatedLine[] } {
  const dest = destAreaCode.trim();
  const baseLines =
    carton.lines && carton.lines.length > 0
      ? [...carton.lines]
      : linesInAreaForCarton(carton, sourceAreaCode);

  const movedLines: RelocatedLine[] = [];
  const nextLines = baseLines.map((line) => {
    if (line.binId) return line;
    const inSource = areaCodesMatch(
      lineEffectiveStagingArea(line, carton) ?? "",
      sourceAreaCode
    );
    if (!inSource) return line;
    if (line.allocationStatus === "picked") {
      throw new Error(`Line ${line.sku} is picked — complete or undo pick first.`);
    }
    movedLines.push({
      lineId: line.lineId,
      sku: line.sku,
      quantity: line.quantity,
      lot: line.lot ?? null,
      condition: line.condition,
    });
    return { ...line, binId: null, stagingArea: dest };
  });

  if (movedLines.length === 0) {
    throw new Error("This carton has no floor stock in the source area.");
  }

  return { nextLines, movedLines };
}

function writeAreaMoveEvents(
  batch: ReturnType<typeof writeBatch>,
  warehouseId: string,
  input: {
    sourceArea: WarehouseAreaDoc;
    destArea: WarehouseAreaDoc;
    carton: WarehouseCartonDoc;
    movedLines: RelocatedLine[];
    operatorId?: string | null;
    palletId?: string | null;
    palletCode?: string | null;
    moveUnit: "sku" | "carton" | "pallet";
  }
): void {
  for (const line of input.movedLines) {
    const eventsRef = collection(db, WAREHOUSES, warehouseId, "movementEvents");
    batch.set(doc(eventsRef), {
      type: "area_move",
      moveUnit: input.moveUnit,
      palletId: input.palletId ?? null,
      palletCode: input.palletCode ?? null,
      cartonId: input.carton.id,
      cartonCode: input.carton.cartonCode,
      lineId: line.lineId,
      sku: line.sku,
      quantity: line.quantity,
      condition: line.condition,
      lot: line.lot,
      fromBinId: null,
      fromBinPath: null,
      fromStagingArea: input.sourceArea.code,
      sourceAreaId: input.sourceArea.id,
      toBinId: null,
      toBinPath: null,
      toStagingArea: input.destArea.code,
      destAreaId: input.destArea.id,
      operatorId: input.operatorId ?? null,
      at: serverTimestamp(),
    });
  }
}

/** Move all floor stock for one carton from source area to destination area. */
export async function applyCartonAreaToAreaMove(input: {
  warehouseId: string;
  sourceAreaId: string;
  destAreaId: string;
  cartonId: string;
  operatorId?: string | null;
}): Promise<{
  cartonCode: string;
  linesMoved: number;
  unitsMoved: number;
  sourceAreaCode: string;
  destAreaCode: string;
}> {
  if (input.sourceAreaId === input.destAreaId) {
    throw new Error("Source and destination areas must be different.");
  }

  const sourceArea = await loadAreaDoc(input.warehouseId, input.sourceAreaId);
  const destArea = await loadAreaDoc(input.warehouseId, input.destAreaId);

  const carton = await getWarehouseCarton(input.warehouseId, input.cartonId);
  if (!carton) throw new Error("Carton not found.");
  if (carton.status === "voided" || carton.status === "closed") {
    throw new Error("This carton cannot be moved.");
  }

  const { nextLines, movedLines } = relocateCartonFloorLinesInArea(
    carton,
    sourceArea.code,
    destArea.code
  );
  const { status, binId, stagingArea } = resolveCartonFieldsAfterAreaMove(
    carton,
    nextLines,
    destArea
  );

  const batch = writeBatch(db);
  batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
    lines: linesToFirestorePayload(nextLines),
    status,
    binId,
    stagingArea,
    updatedAt: serverTimestamp(),
  });
  writeAreaMoveEvents(batch, input.warehouseId, {
    sourceArea,
    destArea,
    carton,
    movedLines,
    operatorId: input.operatorId,
    moveUnit: "carton",
  });
  await batch.commit();

  return {
    cartonCode: carton.cartonCode,
    linesMoved: movedLines.length,
    unitsMoved: movedLines.reduce((sum, l) => sum + l.quantity, 0),
    sourceAreaCode: sourceArea.code,
    destAreaCode: destArea.code,
  };
}

/** Move a pallet and its cartons from source area floor to destination area. */
export async function applyPalletAreaToAreaMove(input: {
  warehouseId: string;
  sourceAreaId: string;
  destAreaId: string;
  palletId: string;
  operatorId?: string | null;
}): Promise<{
  palletCode: string;
  cartonsUpdated: number;
  linesMoved: number;
  unitsMoved: number;
  sourceAreaCode: string;
  destAreaCode: string;
}> {
  if (input.sourceAreaId === input.destAreaId) {
    throw new Error("Source and destination areas must be different.");
  }

  const sourceArea = await loadAreaDoc(input.warehouseId, input.sourceAreaId);
  const destArea = await loadAreaDoc(input.warehouseId, input.destAreaId);

  const pallet = await getWarehousePallet(input.warehouseId, input.palletId);
  if (!pallet) throw new Error("Pallet not found.");
  if (!palletIsOnAreaFloor(pallet, sourceArea.code)) {
    throw new Error("This pallet is not on the floor in the source area.");
  }

  const cartons = await listCartonsByPalletId(input.warehouseId, input.palletId);
  const batch = writeBatch(db);
  let cartonsUpdated = 0;
  let linesMoved = 0;
  let unitsMoved = 0;

  for (const carton of cartons) {
    if (carton.status === "voided" || carton.status === "closed") continue;
    try {
      const { nextLines, movedLines } = relocateCartonFloorLinesInArea(
        carton,
        sourceArea.code,
        destArea.code
      );
      const { status, binId, stagingArea } = resolveCartonFieldsAfterAreaMove(
        carton,
        nextLines,
        destArea
      );
      batch.update(warehouseCartonDocRef(input.warehouseId, carton.id), {
        lines: linesToFirestorePayload(nextLines),
        status,
        binId,
        stagingArea,
        updatedAt: serverTimestamp(),
      });
      writeAreaMoveEvents(batch, input.warehouseId, {
        sourceArea,
        destArea,
        carton,
        movedLines,
        operatorId: input.operatorId,
        palletId: pallet.id,
        palletCode: pallet.palletCode,
        moveUnit: "pallet",
      });
      cartonsUpdated += 1;
      linesMoved += movedLines.length;
      unitsMoved += movedLines.reduce((sum, l) => sum + l.quantity, 0);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (!msg.includes("no floor stock")) throw e;
    }
  }

  batch.update(warehousePalletDocRef(input.warehouseId, pallet.id), {
    stagingArea: destArea.code.trim(),
    status: palletStatusForArea(destArea),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  if (cartons.length > 0 && cartonsUpdated === 0) {
    throw new Error("No movable carton stock on this pallet in the source area.");
  }

  return {
    palletCode: pallet.palletCode,
    cartonsUpdated,
    linesMoved,
    unitsMoved,
    sourceAreaCode: sourceArea.code,
    destAreaCode: destArea.code,
  };
}
