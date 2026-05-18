import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  limit,
  getCountFromServer,
} from "firebase/firestore";
import type { CollectionReference, DocumentData } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { WarehouseAreaDoc, WarehouseDoc } from "@/types";
import { normalizePurposeLabel, purposeKey } from "@/lib/warehouse-area-purposes";
import { buildBinPath, isValidPathSegment, parseTokenList } from "@/lib/warehouse-bin-path";
import {
  buildBinCombinationsFromDetailedRack,
  buildBinCombinationsFromLayout,
  type BinCombo,
} from "@/lib/warehouse-storage-layout";

const WAREHOUSES = "warehouses";

export function warehousesCollectionRef() {
  return collection(db, WAREHOUSES);
}

export function warehouseDocRef(warehouseId: string) {
  return doc(db, WAREHOUSES, warehouseId);
}

export function warehouseBinsCollectionRef(warehouseId: string) {
  return collection(db, WAREHOUSES, warehouseId, "bins");
}

export function warehouseAreasCollectionRef(warehouseId: string) {
  return collection(db, WAREHOUSES, warehouseId, "areas");
}

export async function createWarehouse(input: {
  code: string;
  name: string;
  active?: boolean;
  linkedLocationId?: string | null;
}): Promise<string> {
  const code = input.code.trim();
  const name = input.name.trim();
  if (!isValidPathSegment(code)) throw new Error("Warehouse code must be alphanumeric.");
  if (!name) throw new Error("Warehouse name is required.");

  const dup = query(warehousesCollectionRef(), where("code", "==", code), limit(1));
  const dupSnap = await getDocs(dup);
  if (!dupSnap.empty) {
    throw new Error(`A warehouse with code "${code}" already exists.`);
  }

  const ref = await addDoc(warehousesCollectionRef(), {
    code,
    name,
    active: input.active !== false,
    linkedLocationId: input.linkedLocationId?.trim() || null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateWarehouse(
  warehouseId: string,
  data: Partial<Pick<WarehouseDoc, "code" | "name" | "active" | "linkedLocationId" | "customPurposes">>
): Promise<void> {
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (data.code !== undefined) {
    const c = String(data.code).trim();
    if (!isValidPathSegment(c)) throw new Error("Warehouse code must be alphanumeric.");
    payload.code = c;
  }
  if (data.name !== undefined) payload.name = String(data.name).trim();
  if (data.active !== undefined) payload.active = Boolean(data.active);
  if (data.linkedLocationId !== undefined) {
    payload.linkedLocationId = data.linkedLocationId ? String(data.linkedLocationId).trim() : null;
  }
  if (data.customPurposes !== undefined) {
    payload.customPurposes = data.customPurposes.map(normalizePurposeLabel).filter(Boolean);
  }
  await updateDoc(warehouseDocRef(warehouseId), payload);
}

/** Save a custom purpose label on the warehouse for reuse in area pickers. */
export async function addWarehouseCustomPurpose(warehouseId: string, label: string): Promise<void> {
  const n = normalizePurposeLabel(label);
  if (!n) throw new Error("Purpose label is required.");
  const snap = await getDoc(warehouseDocRef(warehouseId));
  if (!snap.exists()) throw new Error("Warehouse not found.");
  const existing = (snap.data() as { customPurposes?: string[] }).customPurposes || [];
  const k = purposeKey(n);
  if (existing.some((p) => purposeKey(p) === k)) return;
  await updateWarehouse(warehouseId, { customPurposes: [...existing, n] });
}

export async function createWarehouseArea(
  warehouseId: string,
  input: { code: string; name?: string; purposes: string[] }
): Promise<string> {
  const code = input.code.trim();
  if (!isValidPathSegment(code)) throw new Error("Area code must be alphanumeric.");
  const purposes = input.purposes.map(normalizePurposeLabel).filter(Boolean);
  if (!purposes.length) throw new Error("Select at least one purpose for this area.");
  const ref = await addDoc(warehouseAreasCollectionRef(warehouseId), {
    code,
    name: input.name?.trim() || "",
    purposes,
    areaType: purposes[0]?.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "storage",
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export async function updateWarehouseArea(
  warehouseId: string,
  areaId: string,
  data: Partial<Pick<WarehouseAreaDoc, "code" | "name" | "purposes" | "active">>
): Promise<void> {
  const ref = doc(db, WAREHOUSES, warehouseId, "areas", areaId);
  const payload: Record<string, unknown> = { updatedAt: serverTimestamp() };
  if (data.code !== undefined) {
    const c = String(data.code).trim();
    if (!isValidPathSegment(c)) throw new Error("Area code must be alphanumeric.");
    payload.code = c;
  }
  if (data.name !== undefined) payload.name = String(data.name).trim();
  if (data.purposes !== undefined) {
    const purposes = data.purposes.map(normalizePurposeLabel).filter(Boolean);
    if (!purposes.length) throw new Error("At least one purpose is required.");
    payload.purposes = purposes;
    payload.areaType = purposes[0]?.toLowerCase().replace(/[^a-z0-9]+/g, "_") || "storage";
  }
  if (data.active !== undefined) payload.active = Boolean(data.active);
  await updateDoc(ref, payload);
}

async function resolveAreaForBinGeneration(
  warehouseId: string,
  areaId: string
): Promise<{ areaCode: string }> {
  const areaRef = doc(db, WAREHOUSES, warehouseId, "areas", areaId);
  const areaSnap = await getDoc(areaRef);
  if (!areaSnap.exists()) {
    throw new Error("Selected area was not found.");
  }
  const areaData = areaSnap.data() as { code?: string; active?: boolean };
  if (areaData.active === false) {
    throw new Error("Cannot generate bins in an inactive area.");
  }
  const areaCode = String(areaData.code || "").trim();
  if (!isValidPathSegment(areaCode)) {
    throw new Error("Area has an invalid code. Edit the area and set a short alphanumeric code (e.g. A).");
  }
  return { areaCode };
}

export type GenerateBinsParams = {
  warehouseId: string;
  warehouseCode: string;
  /** Must reference an `areas` document with `areaType === "storage"` (see 03 Part 0, 04 Phase 1). */
  storageAreaId: string;
  rowsRaw: string;
  baysRaw: string;
  levelsRaw: string;
  binCodesRaw: string;
};

export type GenerateBinsResult = {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
};

async function persistBinCombinations(
  warehouseId: string,
  storageAreaId: string,
  combinations: BinCombo[],
  options?: { temporary?: boolean; layoutBlockId?: string }
): Promise<GenerateBinsResult> {
  const MAX_COMBOS = 25_000;
  if (combinations.length > MAX_COMBOS) {
    throw new Error(
      `Too many combinations (${combinations.length}). Reduce rows, bays, levels, or bin codes (max ${MAX_COMBOS}).`
    );
  }

  const existingSnap = await getDocs(warehouseBinsCollectionRef(warehouseId));
  const existingPaths = new Set<string>();
  existingSnap.forEach((d) => {
    const p = (d.data() as { path?: string }).path;
    if (typeof p === "string" && p) existingPaths.add(p);
  });

  let skipped = 0;
  const pending: BinCombo[] = [];
  for (const c of combinations) {
    if (existingPaths.has(c.path)) skipped += 1;
    else pending.push(c);
  }

  const errors: string[] = [];
  let created = 0;
  const BATCH = 450;
  for (let i = 0; i < pending.length; i += BATCH) {
    const slice = pending.slice(i, i + BATCH);
    const batch = writeBatch(db);
    try {
      for (const c of slice) {
        const binRef = doc(warehouseBinsCollectionRef(warehouseId));
        batch.set(binRef, {
          area: c.area,
          row: c.row,
          bay: c.bay,
          level: c.level,
          binCode: c.binCode,
          path: c.path,
          barcode: c.path,
          storageAreaId,
          active: true,
          ...(options?.temporary ? { temporary: true } : {}),
          ...(options?.layoutBlockId ? { layoutBlockId: options.layoutBlockId } : {}),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
      await batch.commit();
      created += slice.length;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`Batch starting at ${i} (${slice.length} bins): ${msg}`);
    }
  }

  const failed = pending.length - created;
  return { created, skipped, failed, errors };
}

/** Cartesian bin generator for one storage area: Row ├ù Bay ├ù Level ├ù Bin (idempotent by path). */
export async function generateWarehouseBins(params: GenerateBinsParams): Promise<GenerateBinsResult> {
  const { areaCode } = await resolveAreaForBinGeneration(params.warehouseId, params.storageAreaId);

  const rows = parseTokenList(params.rowsRaw);
  const bays = parseTokenList(params.baysRaw);
  const levels = parseTokenList(params.levelsRaw);
  const binCodes = parseTokenList(params.binCodesRaw);

  if (!rows.length || !bays.length || !levels.length || !binCodes.length) {
    throw new Error("Each of Rows, Bays, Levels, and Bin codes must have at least one value.");
  }

  for (const list of [rows, bays, levels, binCodes]) {
    for (const token of list) {
      if (!isValidPathSegment(token)) {
        throw new Error(`Invalid token "${token}" ΓÇö use letters and numbers only, no spaces.`);
      }
    }
  }

  const combinations: BinCombo[] = [];
  for (const row of rows) {
    for (const bay of bays) {
      for (const level of levels) {
        for (const binCode of binCodes) {
          const path = buildBinPath(params.warehouseCode, areaCode, row, bay, level, binCode);
          combinations.push({ area: areaCode, row, bay, level, binCode, path });
        }
      }
    }
  }

  return persistBinCombinations(params.warehouseId, params.storageAreaId, combinations);
}

export type GenerateBinsLayoutParams = {
  warehouseId: string;
  warehouseCode: string;
  storageAreaId: string;
  rowCodes: string[];
  baysByRow: string[][];
  levelCodes: string[];
  binCodes: string[];
};

/**
 * Same as token lists, but supports a different bay set per row (rack layout wizard).
 */
export async function generateWarehouseBinsFromLayout(
  params: GenerateBinsLayoutParams
): Promise<GenerateBinsResult> {
  const { areaCode } = await resolveAreaForBinGeneration(params.warehouseId, params.storageAreaId);

  for (const list of [
    params.rowCodes,
    ...params.baysByRow,
    params.levelCodes,
    params.binCodes,
  ]) {
    for (const token of list) {
      if (!isValidPathSegment(token)) {
        throw new Error(`Invalid token "${token}" ΓÇö use letters and numbers only, no spaces.`);
      }
    }
  }

  if (!params.rowCodes.length) {
    throw new Error("At least one row is required.");
  }
  if (params.rowCodes.length !== params.baysByRow.length) {
    throw new Error("Rows and bay rows length mismatch.");
  }
  if (!params.levelCodes.length || !params.binCodes.length) {
    throw new Error("Levels and bin codes must each have at least one value.");
  }

  const combinations = buildBinCombinationsFromLayout(
    params.warehouseCode,
    areaCode,
    params.rowCodes,
    params.baysByRow,
    params.levelCodes,
    params.binCodes
  );

  return persistBinCombinations(params.warehouseId, params.storageAreaId, combinations);
}

export type GenerateBinsDetailedRackParams = {
  warehouseId: string;
  warehouseCode: string;
  storageAreaId: string;
  rowCodes: string[];
  baysByRow: string[][];
  levelsPerBay: number[][];
  binsPerLevel: number[][][];
  temporary?: boolean;
  layoutBlockId?: string;
};

/** Per-bay levels and per-level bin counts (guided wizard detailed rack). */
export async function generateWarehouseBinsFromDetailedRack(
  params: GenerateBinsDetailedRackParams
): Promise<GenerateBinsResult> {
  const { areaCode } = await resolveAreaForBinGeneration(params.warehouseId, params.storageAreaId);

  const combinations = buildBinCombinationsFromDetailedRack(
    params.warehouseCode,
    areaCode,
    params.rowCodes,
    params.baysByRow,
    params.levelsPerBay,
    params.binsPerLevel
  );

  return persistBinCombinations(params.warehouseId, params.storageAreaId, combinations, {
    temporary: params.temporary,
    layoutBlockId: params.layoutBlockId,
  });
}

export async function setWarehouseBinActive(
  warehouseId: string,
  binId: string,
  active: boolean
): Promise<void> {
  await updateDoc(doc(db, WAREHOUSES, warehouseId, "bins", binId), {
    active,
    updatedAt: serverTimestamp(),
  });
}

/** Optional: count bins for summary (uses aggregation). */
export async function countBins(warehouseId: string): Promise<number> {
  const snap = await getCountFromServer(warehouseBinsCollectionRef(warehouseId));
  return snap.data().count;
}

async function deleteAllDocsInCollection(
  coll: CollectionReference<DocumentData>,
  batchSize = 400
): Promise<number> {
  let removed = 0;
  for (;;) {
    const snap = await getDocs(query(coll, limit(batchSize)));
    if (snap.empty) break;
    const batch = writeBatch(db);
    for (const d of snap.docs) {
      batch.delete(d.ref);
    }
    await batch.commit();
    removed += snap.docs.length;
    if (snap.docs.length < batchSize) break;
  }
  return removed;
}

/**
 * Permanently removes a warehouse and all `bins` and `areas` under it.
 * Firestore does not cascade parent deletes to subcollections; this deletes children first.
 */
export async function deleteWarehouseCascade(warehouseId: string): Promise<{
  binsRemoved: number;
  areasRemoved: number;
}> {
  const binsRemoved = await deleteAllDocsInCollection(warehouseBinsCollectionRef(warehouseId));
  const areasRemoved = await deleteAllDocsInCollection(warehouseAreasCollectionRef(warehouseId));
  await deleteDoc(warehouseDocRef(warehouseId));
  return { binsRemoved, areasRemoved };
}
