import { buildBinPath, isValidPathSegment } from "@/lib/warehouse-bin-path";

/** Padded row codes: `01`ΓÇª`12` (width scales with max row index). */
export function buildRowCodes(rowCount: number): string[] {
  if (!Number.isFinite(rowCount) || rowCount < 1 || rowCount > 999) {
    throw new Error("Row count must be between 1 and 999.");
  }
  const pad = String(rowCount).length >= 3 ? 3 : 2;
  return Array.from({ length: rowCount }, (_, i) => String(i + 1).padStart(pad, "0"));
}

export function parseRowIndex(rowCode: string): number {
  const n = Number.parseInt(String(rowCode).replace(/\D/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/** New row codes that continue after existing rows in an area (for “add shelving later”). */
export function buildRowCodesAfterExisting(existingRowCodes: string[], addCount: number): string[] {
  if (!Number.isFinite(addCount) || addCount < 1 || addCount > 999) {
    throw new Error("Row count must be between 1 and 999.");
  }
  let max = 0;
  for (const r of existingRowCodes) {
    max = Math.max(max, parseRowIndex(r));
  }
  const end = max + addCount;
  const pad = String(end).length >= 3 ? 3 : 2;
  return Array.from({ length: addCount }, (_, i) => String(max + 1 + i).padStart(pad, "0"));
}

/** Bays `A`ΓÇª`Z` for up to 26; beyond that use two-digit `01`ΓÇª (alphanumeric path segments). */
export function buildBayCodes(bayCount: number): string[] {
  if (!Number.isFinite(bayCount) || bayCount < 1 || bayCount > 99) {
    throw new Error("Bay count per row must be between 1 and 99.");
  }
  if (bayCount <= 26) {
    return Array.from({ length: bayCount }, (_, i) => String.fromCharCode(65 + i));
  }
  const pad = String(bayCount).length >= 3 ? 3 : 2;
  return Array.from({ length: bayCount }, (_, i) => String(i + 1).padStart(pad, "0"));
}

/** Level codes `1`ΓÇª`L` (single segment per path rules). */
export function buildLevelCodes(levelCount: number): string[] {
  if (!Number.isFinite(levelCount) || levelCount < 1 || levelCount > 99) {
    throw new Error("Level count must be between 1 and 99.");
  }
  return Array.from({ length: levelCount }, (_, i) => String(i + 1));
}

/** Slot codes `A1`ΓÇª`A{n}` (alphanumeric). */
export function buildBinSlotCodes(binCount: number): string[] {
  if (!Number.isFinite(binCount) || binCount < 1 || binCount > 999) {
    throw new Error("Bin count per level must be between 1 and 999.");
  }
  return Array.from({ length: binCount }, (_, i) => `A${i + 1}`);
}

export function buildBaysPerRowFromCounts(rowCodes: string[], bayCounts: number[]): string[][] {
  if (rowCodes.length !== bayCounts.length) {
    throw new Error("Each row must have a bay count.");
  }
  return bayCounts.map((m) => buildBayCodes(m));
}

export type BinCombo = { area: string; row: string; bay: string; level: string; binCode: string; path: string };

/** Quick count for UI previews (same cardinality as `buildBinCombinationsFromLayout` would return). */
export function countBinSlotsInLayout(
  baysByRow: string[][],
  levelCodes: string[],
  binCodes: string[]
): number {
  let n = 0;
  for (const bays of baysByRow) {
    n += bays.length * levelCodes.length * binCodes.length;
  }
  return n;
}

/** Sum of bin slots when each bay has its own level count and each level its own bin count. */
export function countBinSlotsInDetailedRack(
  baysByRow: string[][],
  levelsPerBay: number[][],
  binsPerLevel: number[][][]
): number {
  if (levelsPerBay.length !== baysByRow.length || binsPerLevel.length !== baysByRow.length) {
    return NaN;
  }
  let n = 0;
  for (let ri = 0; ri < baysByRow.length; ri++) {
    const bays = baysByRow[ri];
    const lvRow = levelsPerBay[ri];
    const binRow = binsPerLevel[ri];
    if (!lvRow || lvRow.length !== bays.length || !binRow || binRow.length !== bays.length) {
      return NaN;
    }
    for (let bi = 0; bi < bays.length; bi++) {
      const L = lvRow[bi];
      if (!Number.isFinite(L) || L < 1 || L > 99) return NaN;
      const binsForBay = binRow[bi];
      if (!binsForBay || binsForBay.length !== L) return NaN;
      for (let li = 0; li < L; li++) {
        const c = binsForBay[li];
        if (!Number.isFinite(c) || c < 1 || c > 999) return NaN;
        n += c;
      }
    }
  }
  return n;
}

/**
 * Per-bay level count and per-level bin count (slots A1ΓÇª).
 * Level codes are 1ΓÇªL within each bay independently.
 */
export function buildBinCombinationsFromDetailedRack(
  warehouseCode: string,
  areaCode: string,
  rowCodes: string[],
  baysByRow: string[][],
  levelsPerBay: number[][],
  binsPerLevel: number[][][]
): BinCombo[] {
  if (!isValidPathSegment(warehouseCode) || !isValidPathSegment(areaCode)) {
    throw new Error("Invalid warehouse or area code.");
  }
  if (rowCodes.length !== baysByRow.length) {
    throw new Error("Rows and bay rows length mismatch.");
  }
  if (levelsPerBay.length !== rowCodes.length || binsPerLevel.length !== rowCodes.length) {
    throw new Error("Rack detail rows length mismatch.");
  }
  const combinations: BinCombo[] = [];
  for (let ri = 0; ri < rowCodes.length; ri++) {
    const row = rowCodes[ri];
    const bays = baysByRow[ri];
    const lvRow = levelsPerBay[ri];
    const binRow = binsPerLevel[ri];
    if (!lvRow || lvRow.length !== bays.length) {
      throw new Error(`Row ${row}: set a level count for every bay.`);
    }
    if (!binRow || binRow.length !== bays.length) {
      throw new Error(`Row ${row}: set bin counts for every bay.`);
    }
    for (let bi = 0; bi < bays.length; bi++) {
      const bay = bays[bi];
      const levelCount = lvRow[bi];
      if (!Number.isFinite(levelCount) || levelCount < 1 || levelCount > 99) {
        throw new Error(`Row ${row} bay ${bay}: level count must be 1ΓÇô99.`);
      }
      const levelCodes = buildLevelCodes(levelCount);
      const binsForBay = binRow[bi];
      if (!binsForBay || binsForBay.length !== levelCount) {
        throw new Error(`Row ${row} bay ${bay}: enter one bin count per level.`);
      }
      for (let li = 0; li < levelCount; li++) {
        const binCount = binsForBay[li];
        if (!Number.isFinite(binCount) || binCount < 1 || binCount > 999) {
          throw new Error(`Row ${row} bay ${bay} level ${li + 1}: bin count must be 1ΓÇô999.`);
        }
        const level = levelCodes[li];
        for (const binCode of buildBinSlotCodes(binCount)) {
          const path = buildBinPath(warehouseCode, areaCode, row, bay, level, binCode);
          combinations.push({ area: areaCode, row, bay, level, binCode, path });
        }
      }
    }
  }
  return combinations;
}

export function buildBinCombinationsFromLayout(
  warehouseCode: string,
  areaCode: string,
  rowCodes: string[],
  baysByRow: string[][],
  levelCodes: string[],
  binCodes: string[]
): BinCombo[] {
  if (!isValidPathSegment(warehouseCode) || !isValidPathSegment(areaCode)) {
    throw new Error("Invalid warehouse or area code.");
  }
  if (rowCodes.length !== baysByRow.length) {
    throw new Error("Rows and bay rows length mismatch.");
  }
  const combinations: BinCombo[] = [];
  for (let ri = 0; ri < rowCodes.length; ri++) {
    const row = rowCodes[ri];
    const bays = baysByRow[ri];
    if (!bays.length) throw new Error(`Row ${row} has no bays.`);
    for (const bay of bays) {
      for (const level of levelCodes) {
        for (const binCode of binCodes) {
          const path = buildBinPath(warehouseCode, areaCode, row, bay, level, binCode);
          combinations.push({ area: areaCode, row, bay, level, binCode, path });
        }
      }
    }
  }
  return combinations;
}
