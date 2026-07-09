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
import { createLocation, docToLocation, updateLocation } from "@/lib/locations";
import type { WarehouseAreaDoc, WarehouseDoc } from "@/types";
import { normalizePurposeLabel, purposeKey } from "@/lib/warehouse-area-purposes";
import {
  binSegmentsNeedMigration,
  buildBinPath,
  isValidPathSegment,
  normalizeBinSegments,
  parseTokenList,
} from "@/lib/warehouse-bin-path";
import {
  buildBinCombinationsFromDetailedRack,
  buildBinCombinationsFromLayout,
  type BinCombo,
} from "@/lib/warehouse-storage-layout";

const WAREHOUSES = "warehouses";

export type WarehouseAddressInput = {
  country?: string;
  stateOrProvince?: string;
  street1?: string;
  street2?: string;
  city?: string;
  zip?: string;
};

function addressFieldsPayload(input?: WarehouseAddressInput): Record<string, string> {
  if (!input) return {};
  const out: Record<string, string> = {};
  const put = (key: keyof WarehouseAddressInput, value?: string) => {
    const trimmed = value?.trim();
    if (trimmed) out[key] = trimmed;
  };
  put("country", input.country);
  put("stateOrProvince", input.stateOrProvince);
  put("street1", input.street1);
  put("street2", input.street2);
  put("city", input.city);
  put("zip", input.zip);
  return out;
}

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
  address?: WarehouseAddressInput;
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
    ...addressFieldsPayload(input.address),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

/** Creates a `locations` row and warehouse together (single admin flow). */
export async function createWarehouseWithLocation(input: {
  code: string;
  name: string;
  locationName: string;
  country: string;
  stateOrProvince: string;
  street1: string;
  street2?: string;
  city: string;
  zip: string;
  active?: boolean;
}): Promise<{ warehouseId: string; locationId: string }> {
  const locationId = await createLocation({
    name: input.locationName,
    country: input.country,
    stateOrProvince: input.stateOrProvince,
    street1: input.street1,
    street2: input.street2,
    city: input.city,
    zip: input.zip,
  });
  const address: WarehouseAddressInput = {
    country: input.country,
    stateOrProvince: input.stateOrProvince,
    street1: input.street1,
    street2: input.street2,
    city: input.city,
    zip: input.zip,
  };
  const warehouseId = await createWarehouse({
    code: input.code,
    name: input.name,
    linkedLocationId: locationId,
    active: input.active,
    address,
  });
  return { warehouseId, locationId };
}

/** Link an existing location (e.g. NJ-1) to a new warehouse for layout design. */
export async function createWarehouseFromExistingLocation(
  locationId: string,
  code: string,
  displayName?: string
): Promise<string> {
  const locSnap = await getDoc(doc(db, "locations", locationId));
  if (!locSnap.exists()) throw new Error("Location not found.");
  const loc = docToLocation({ id: locationId, ...locSnap.data() });
  const linked = query(warehousesCollectionRef(), where("linkedLocationId", "==", locationId), limit(1));
  const linkedSnap = await getDocs(linked);
  if (!linkedSnap.empty) {
    throw new Error("This location already has a warehouse record.");
  }
  return createWarehouse({
    code,
    name: (displayName || loc.name).trim(),
    linkedLocationId: locationId,
    address: {
      country: loc.country,
      stateOrProvince: loc.stateOrProvince,
      street1: loc.street1,
      street2: loc.street2,
      city: loc.city,
      zip: loc.zip,
    },
  });
}

export async function updateWarehouseWithLocation(
  warehouseId: string,
  input: {
    code?: string;
    name?: string;
    locationName?: string;
    country?: string;
    stateOrProvince?: string;
    street1?: string;
    street2?: string;
    city?: string;
    zip?: string;
    active?: boolean;
  }
): Promise<void> {
  const snap = await getDoc(warehouseDocRef(warehouseId));
  if (!snap.exists()) throw new Error("Warehouse not found.");
  const linkedLocationId = (snap.data() as { linkedLocationId?: string | null }).linkedLocationId;

  if (linkedLocationId) {
    await updateLocation(linkedLocationId, {
      name: input.locationName,
      country: input.country,
      stateOrProvince: input.stateOrProvince,
      street1: input.street1,
      street2: input.street2,
      city: input.city,
      zip: input.zip,
      active: input.active,
    });
  }

  await updateWarehouse(warehouseId, {
    code: input.code,
    name: input.name,
    active: input.active,
  });

  const addressPayload = addressFieldsPayload({
    country: input.country,
    stateOrProvince: input.stateOrProvince,
    street1: input.street1,
    street2: input.street2,
    city: input.city,
    zip: input.zip,
  });
  if (Object.keys(addressPayload).length) {
    await updateDoc(warehouseDocRef(warehouseId), {
      ...addressPayload,
      updatedAt: serverTimestamp(),
    });
  }
}

export async function updateWarehouse(
  warehouseId: string,
  data: Partial<
    Pick<
      WarehouseDoc,
      | "code"
      | "name"
      | "active"
      | "linkedLocationId"
      | "customPurposes"
      | "country"
      | "stateOrProvince"
      | "street1"
      | "street2"
      | "city"
      | "zip"
    >
  >
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
  if (data.country !== undefined) payload.country = data.country?.trim() || null;
  if (data.stateOrProvince !== undefined) payload.stateOrProvince = data.stateOrProvince?.trim() || null;
  if (data.street1 !== undefined) payload.street1 = data.street1?.trim() || null;
  if (data.street2 !== undefined) payload.street2 = data.street2?.trim() || null;
  if (data.city !== undefined) payload.city = data.city?.trim() || null;
  if (data.zip !== undefined) payload.zip = data.zip?.trim() || null;
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

async function assertUniqueBinPath(
  warehouseId: string,
  path: string,
  excludeBinId?: string
): Promise<void> {
  const dup = query(warehouseBinsCollectionRef(warehouseId), where("path", "==", path), limit(2));
  const snap = await getDocs(dup);
  for (const d of snap.docs) {
    if (excludeBinId && d.id === excludeBinId) continue;
    throw new Error(`Another bin already uses path "${path}".`);
  }
}

export type WarehouseBinUpdateInput = {
  area?: string;
  row?: string;
  bay?: string;
  level?: string;
  binCode?: string;
  barcode?: string;
  active?: boolean;
  temporary?: boolean;
};

/** Admin edit of any bin field; path and barcode are rebuilt from segments unless barcode is set explicitly. */
export async function updateWarehouseBin(
  warehouseId: string,
  binId: string,
  warehouseCode: string,
  input: WarehouseBinUpdateInput
): Promise<void> {
  const binRef = doc(db, WAREHOUSES, warehouseId, "bins", binId);
  const snap = await getDoc(binRef);
  if (!snap.exists()) throw new Error("Bin not found.");
  const cur = snap.data() as {
    area?: string;
    row?: string;
    bay?: string;
    level?: string;
    binCode?: string;
    barcode?: string;
    active?: boolean;
    temporary?: boolean;
  };

  const norm = normalizeBinSegments({
    area: input.area !== undefined ? input.area : cur.area || "",
    row: input.row !== undefined ? input.row : cur.row || "",
    bay: input.bay !== undefined ? input.bay : cur.bay || "",
    level: input.level !== undefined ? input.level : cur.level || "",
    binCode: input.binCode !== undefined ? input.binCode : cur.binCode || "",
  });

  const path = buildBinPath(
    warehouseCode,
    norm.area,
    norm.row,
    norm.bay,
    norm.level,
    norm.binCode
  );
  await assertUniqueBinPath(warehouseId, path, binId);

  const payload: Record<string, unknown> = {
    area: norm.area,
    row: norm.row,
    bay: norm.bay,
    level: norm.level,
    binCode: norm.binCode,
    path,
    updatedAt: serverTimestamp(),
  };
  if (input.barcode !== undefined) {
    const b = String(input.barcode).trim();
    if (!b) throw new Error("Barcode cannot be empty.");
    payload.barcode = b;
  } else {
    payload.barcode = path;
  }
  if (input.active !== undefined) payload.active = Boolean(input.active);
  if (input.temporary !== undefined) payload.temporary = Boolean(input.temporary);

  await updateDoc(binRef, payload);
}

export async function deleteWarehouseBin(warehouseId: string, binId: string): Promise<void> {
  await deleteDoc(doc(db, WAREHOUSES, warehouseId, "bins", binId));
}

/** Rewrite all bins to v2 path segments (R1, BA1, L1, B01) and update path/barcode. */
export async function migrateWarehouseBinPathFormat(
  warehouseId: string,
  warehouseCode: string
): Promise<{ updated: number; skipped: number }> {
  const code = warehouseCode.trim();
  if (!isValidPathSegment(code)) {
    throw new Error("Invalid warehouse code.");
  }

  const snap = await getDocs(warehouseBinsCollectionRef(warehouseId));
  const pathOwners = new Map<string, string>();
  for (const d of snap.docs) {
    const p = (d.data() as { path?: string }).path;
    if (p) pathOwners.set(p, d.id);
  }

  let updated = 0;
  let skipped = 0;
  const BATCH_LIMIT = 400;
  let batch = writeBatch(db);
  let batchCount = 0;

  const flush = async () => {
    if (batchCount === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    batchCount = 0;
  };

  for (const d of snap.docs) {
    const data = d.data() as {
      area?: string;
      row?: string;
      bay?: string;
      level?: string;
      binCode?: string;
      path?: string;
    };
    if (!binSegmentsNeedMigration(data)) {
      skipped += 1;
      continue;
    }

    const norm = normalizeBinSegments({
      area: data.area || "",
      row: data.row || "",
      bay: data.bay || "",
      level: data.level || "",
      binCode: data.binCode || "",
    });
    const path = buildBinPath(code, norm.area, norm.row, norm.bay, norm.level, norm.binCode);

    const oldPath = data.path;
    if (oldPath && oldPath !== path) {
      pathOwners.delete(oldPath);
    }
    const otherId = pathOwners.get(path);
    if (otherId && otherId !== d.id) {
      throw new Error(
        `Cannot migrate: path "${path}" would duplicate another bin. Resolve conflicts manually.`
      );
    }
    pathOwners.set(path, d.id);

    batch.update(d.ref, {
      area: norm.area,
      row: norm.row,
      bay: norm.bay,
      level: norm.level,
      binCode: norm.binCode,
      path,
      barcode: path,
      updatedAt: serverTimestamp(),
    });
    updated += 1;
    batchCount += 1;
    if (batchCount >= BATCH_LIMIT) await flush();
  }

  await flush();
  return { updated, skipped };
}

async function deleteBinDocs(docs: { ref: ReturnType<typeof doc> }[]): Promise<number> {
  let removed = 0;
  const BATCH = 400;
  for (let i = 0; i < docs.length; i += BATCH) {
    const slice = docs.slice(i, i + BATCH);
    const batch = writeBatch(db);
    for (const d of slice) batch.delete(d.ref);
    await batch.commit();
    removed += slice.length;
  }
  return removed;
}

/** Remove all bins in an area (by area code segment). Area record is kept. */
export async function clearWarehouseAreaBins(
  warehouseId: string,
  areaCode: string
): Promise<number> {
  const code = areaCode.trim();
  const snap = await getDocs(
    query(warehouseBinsCollectionRef(warehouseId), where("area", "==", code))
  );
  return deleteBinDocs(snap.docs.map((d) => ({ ref: d.ref })));
}

/** Replace all bins on one row with a new rack layout (delete row bins, then regenerate). */
export async function replaceWarehouseAreaRow(
  params: GenerateBinsDetailedRackParams & { areaCode: string; rowCode: string }
): Promise<GenerateBinsResult> {
  const row = params.rowCode.trim();
  const area = params.areaCode.trim();
  await deleteWarehouseBinsByAreaRow(params.warehouseId, area, row);
  return generateWarehouseBinsFromDetailedRack({
    warehouseId: params.warehouseId,
    warehouseCode: params.warehouseCode,
    storageAreaId: params.storageAreaId,
    rowCodes: [row],
    baysByRow: params.baysByRow,
    levelsPerBay: params.levelsPerBay,
    binsPerLevel: params.binsPerLevel,
    temporary: params.temporary,
    layoutBlockId: params.layoutBlockId,
  });
}

/** Remove every bin on one row within an area (e.g. remove row 3 of 4). */
export async function deleteWarehouseBinsByAreaRow(
  warehouseId: string,
  areaCode: string,
  rowCode: string
): Promise<number> {
  const area = areaCode.trim();
  const row = rowCode.trim();
  if (!area || !row) throw new Error("Area and row are required.");
  const snap = await getDocs(query(warehouseBinsCollectionRef(warehouseId), where("area", "==", area)));
  const toDelete = snap.docs.filter((d) => String((d.data() as { row?: string }).row || "").trim() === row);
  return deleteBinDocs(toDelete.map((d) => ({ ref: d.ref })));
}

/** Remove bins added in one shelving run. */
export async function deleteWarehouseBinsByLayoutBlock(
  warehouseId: string,
  layoutBlockId: string
): Promise<number> {
  const id = layoutBlockId.trim();
  if (!id) throw new Error("Shelf block id is required.");
  const snap = await getDocs(
    query(warehouseBinsCollectionRef(warehouseId), where("layoutBlockId", "==", id))
  );
  return deleteBinDocs(snap.docs.map((d) => ({ ref: d.ref })));
}

/** Permanently delete an area and all bins tied to it (by area code or storageAreaId). */
export async function deleteWarehouseAreaCascade(
  warehouseId: string,
  areaId: string
): Promise<{ binsRemoved: number }> {
  const areaRef = doc(db, WAREHOUSES, warehouseId, "areas", areaId);
  const areaSnap = await getDoc(areaRef);
  if (!areaSnap.exists()) throw new Error("Area not found.");
  const areaCode = String((areaSnap.data() as { code?: string }).code || "").trim();

  const allBins = await getDocs(warehouseBinsCollectionRef(warehouseId));
  const toDelete = allBins.docs.filter((d) => {
    const data = d.data() as { area?: string; storageAreaId?: string };
    if (data.storageAreaId === areaId) return true;
    return areaCode && data.area === areaCode;
  });

  const binsRemoved = await deleteBinDocs(toDelete.map((d) => ({ ref: d.ref })));
  await deleteDoc(areaRef);
  return { binsRemoved };
}

/** When an area code changes, update every bin path under that area. */
export async function syncWarehouseBinPathsAfterAreaCodeChange(
  warehouseId: string,
  areaId: string,
  oldAreaCode: string,
  newAreaCode: string,
  warehouseCode: string
): Promise<number> {
  const oldCode = oldAreaCode.trim();
  const newCode = newAreaCode.trim();
  if (!isValidPathSegment(newCode)) throw new Error("New area code must be alphanumeric.");
  if (oldCode === newCode) return 0;

  const snap = await getDocs(warehouseBinsCollectionRef(warehouseId));
  const targets = snap.docs.filter((d) => {
    const data = d.data() as { area?: string; storageAreaId?: string };
    if (data.storageAreaId === areaId) return true;
    return oldCode && data.area === oldCode;
  });

  const pathsSeen = new Set<string>();
  const updates: { ref: ReturnType<typeof doc>; payload: Record<string, unknown> }[] = [];

  for (const d of targets) {
    const data = d.data() as {
      row?: string;
      bay?: string;
      level?: string;
      binCode?: string;
      barcode?: string;
    };
    const row = String(data.row || "").trim();
    const bay = String(data.bay || "").trim();
    const level = String(data.level || "").trim();
    const binCode = String(data.binCode || "").trim();
    const path = buildBinPath(warehouseCode, newCode, row, bay, level, binCode);
    if (pathsSeen.has(path)) {
      throw new Error(`Cannot rename area: duplicate path would be created (${path}).`);
    }
    pathsSeen.add(path);
    const barcodeWasPath =
      !data.barcode || data.barcode === buildBinPath(warehouseCode, oldCode, row, bay, level, binCode);
    updates.push({
      ref: d.ref,
      payload: {
        area: newCode,
        path,
        barcode: barcodeWasPath ? path : data.barcode,
        updatedAt: serverTimestamp(),
      },
    });
  }

  const BATCH = 400;
  for (let i = 0; i < updates.length; i += BATCH) {
    const slice = updates.slice(i, i + BATCH);
    const batch = writeBatch(db);
    for (const u of slice) batch.update(u.ref, u.payload);
    await batch.commit();
  }

  return updates.length;
}

export async function updateWarehouseAreaWithBinSync(
  warehouseId: string,
  areaId: string,
  warehouseCode: string,
  data: Partial<Pick<WarehouseAreaDoc, "code" | "name" | "purposes" | "active">>
): Promise<{ binsUpdated: number }> {
  const areaRef = doc(db, WAREHOUSES, warehouseId, "areas", areaId);
  const before = await getDoc(areaRef);
  if (!before.exists()) throw new Error("Area not found.");
  const oldCode = String((before.data() as { code?: string }).code || "").trim();

  await updateWarehouseArea(warehouseId, areaId, data);

  if (data.code !== undefined) {
    const newCode = String(data.code).trim();
    const binsUpdated = await syncWarehouseBinPathsAfterAreaCodeChange(
      warehouseId,
      areaId,
      oldCode,
      newCode,
      warehouseCode
    );
    return { binsUpdated };
  }
  return { binsUpdated: 0 };
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
