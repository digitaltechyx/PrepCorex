import type { WarehouseBinDoc } from "@/types";
import { formatRowCode } from "@/lib/warehouse-bin-path";
import {
  buildBayCodes,
  buildRowCodes,
  buildRowCodesAfterExisting,
  parseRowIndex,
} from "@/lib/warehouse-storage-layout";

export type RowAssignMode = "continue" | "fill-gaps";

/** Row numbers that used to exist but have no bins now (e.g. 01, 02 missing while 03, 04 remain). */
export function listGapRowCodes(existingRowCodes: string[]): string[] {
  const used = new Set<number>();
  let max = 0;
  for (const r of existingRowCodes) {
    const n = parseRowIndex(r);
    if (n > 0) used.add(n);
    max = Math.max(max, n);
  }
  if (max === 0) return [];
  const gaps: string[] = [];
  for (let i = 1; i <= max; i++) {
    if (!used.has(i)) gaps.push(formatRowCode(i));
  }
  return gaps;
}

/** New row codes when adding shelving: continue after max, or fill gaps first then continue. */
export function buildRowCodesWithAssignment(
  existingRowCodes: string[],
  addCount: number,
  mode: RowAssignMode
): string[] {
  if (mode === "continue") {
    return buildRowCodesAfterExisting(existingRowCodes, addCount);
  }
  const gaps = listGapRowCodes(existingRowCodes);
  const result: string[] = [];
  for (const g of gaps) {
    if (result.length >= addCount) break;
    result.push(g);
  }
  if (result.length < addCount) {
    const tail = buildRowCodesAfterExisting(existingRowCodes, addCount - result.length);
    result.push(...tail);
  }
  return result;
}

export type InferredRowRackLayout = {
  bayCodes: string[];
  levelsPerBay: number[];
  binsPerLevel: number[][];
};

const DEFAULT_BAYS = 1;
const DEFAULT_LEVELS = 4;
const DEFAULT_BINS_PER_LEVEL = 3;

/** Rebuild bay / level / bin counts from bins on one row (for edit row UI). */
export function inferRowRackLayoutFromBins(
  bins: WarehouseBinDoc[],
  areaCode: string,
  rowCode: string
): InferredRowRackLayout {
  const rowBins = bins
    .filter((b) => b.area === areaCode && b.row === rowCode)
    .slice()
    .sort((a, b) => {
      const bay = a.bay.localeCompare(b.bay, undefined, { numeric: true });
      if (bay !== 0) return bay;
      const lv = a.level.localeCompare(b.level, undefined, { numeric: true });
      if (lv !== 0) return lv;
      return a.binCode.localeCompare(b.binCode, undefined, { numeric: true });
    });

  if (!rowBins.length) {
    return {
      bayCodes: buildBayCodes(DEFAULT_BAYS),
      levelsPerBay: [DEFAULT_LEVELS],
      binsPerLevel: [Array.from({ length: DEFAULT_LEVELS }, () => DEFAULT_BINS_PER_LEVEL)],
    };
  }

  const bayOrder: string[] = [];
  const seenBay = new Set<string>();
  for (const b of rowBins) {
    if (!seenBay.has(b.bay)) {
      seenBay.add(b.bay);
      bayOrder.push(b.bay);
    }
  }

  const levelsPerBay: number[] = [];
  const binsPerLevel: number[][] = [];

  for (const bay of bayOrder) {
    const bayBins = rowBins.filter((b) => b.bay === bay);
    const levelOrder: string[] = [];
    const seenLevel = new Set<string>();
    for (const b of bayBins) {
      if (!seenLevel.has(b.level)) {
        seenLevel.add(b.level);
        levelOrder.push(b.level);
      }
    }
    levelsPerBay.push(levelOrder.length);
    binsPerLevel.push(levelOrder.map((lv) => bayBins.filter((b) => b.level === lv).length));
  }

  return { bayCodes: bayOrder, levelsPerBay, binsPerLevel };
}

export function emptyRowRackDefaults(bayCount = DEFAULT_BAYS): InferredRowRackLayout {
  const bayCodes = buildBayCodes(bayCount);
  return {
    bayCodes,
    levelsPerBay: bayCodes.map(() => DEFAULT_LEVELS),
    binsPerLevel: bayCodes.map(() => Array.from({ length: DEFAULT_LEVELS }, () => DEFAULT_BINS_PER_LEVEL)),
  };
}
