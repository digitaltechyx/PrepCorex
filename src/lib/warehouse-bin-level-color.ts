import type { WarehouseBinDoc } from "@/types";

/** Matches printed bin label accents (see warehouse-bin-label-pdf). */
const LEVEL_GREEN = "#0f9e61";
const LEVEL_YELLOW = "#edc71a";
const LEVEL_BLUE = "#2e6be0";
const LEVEL_PURPLE = "#7a38c7";
const LEVEL_RED = "#d11f1f";

const OVERFLOW_LEVEL_COLORS = [
  "#f2731f",
  "#1fb8ad",
  "#e04794",
  "#8cb838",
  "#b8612e",
  "#4794eb",
  "#9e52d1",
] as const;

export function parseBinLevelNumber(level: string): number {
  const n = parseInt(String(level).replace(/\D/g, ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

export function bayLevelKey(bin: Pick<WarehouseBinDoc, "area" | "row" | "bay">): string {
  return `${bin.area}|${bin.row}|${bin.bay}`;
}

export function buildMaxLevelByBay(bins: WarehouseBinDoc[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const b of bins) {
    const key = bayLevelKey(b);
    const n = parseBinLevelNumber(b.level);
    map.set(key, Math.max(map.get(key) ?? 0, n));
  }
  return map;
}

function overflowLevelHex(levelNum: number, bayKey: string): string {
  let h = 2166136261;
  const seed = `${bayKey}#${levelNum}`;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return OVERFLOW_LEVEL_COLORS[Math.abs(h) % OVERFLOW_LEVEL_COLORS.length];
}

/**
 * Label accent by shelf height (level 1 = bottom).
 * Levels 1–4: green, yellow, blue, purple. Top level in bay: always red.
 */
export function getLevelAccentHex(
  levelNum: number,
  maxLevelInBay: number,
  bayKey: string
): string {
  const max = Math.max(1, maxLevelInBay);
  const level = Math.min(Math.max(1, levelNum), max);
  if (level === max) return LEVEL_RED;
  switch (level) {
    case 1:
      return LEVEL_GREEN;
    case 2:
      return LEVEL_YELLOW;
    case 3:
      return LEVEL_BLUE;
    case 4:
      return LEVEL_PURPLE;
    default:
      return overflowLevelHex(level, bayKey);
  }
}

export function getBinLevelAccentHex(
  bin: WarehouseBinDoc,
  maxLevelByBay: Map<string, number>
): string {
  const key = bayLevelKey(bin);
  const max = maxLevelByBay.get(key) ?? parseBinLevelNumber(bin.level);
  return getLevelAccentHex(parseBinLevelNumber(bin.level), max, key);
}
