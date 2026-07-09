/**
 * Bin path helpers — v2 segment prefixes (see docs/BARCODE_SCANNING/01_LOCATION_STRUCTURE.md)
 * Path: <Warehouse>-<Area>-<Row>-<Bay>-<Level>-<Bin>
 * Example: NJ03-A-R1-BA1-L1-B01
 */

const SEGMENT = /^[A-Za-z0-9]+$/;

export function isValidPathSegment(value: string): boolean {
  const s = String(value || "").trim();
  return s.length > 0 && SEGMENT.test(s);
}

export function assertValidPathSegment(label: string, value: string): string {
  const s = String(value || "").trim();
  if (!isValidPathSegment(s)) {
    throw new Error(`${label} must be a non-empty alphanumeric token (no spaces). Got: "${value}"`);
  }
  return s;
}

/** Area: plain code (e.g. A, B) — no prefix. */
export function normalizeAreaCode(raw: string): string {
  return assertValidPathSegment("Area", String(raw || "").trim().toUpperCase());
}

/** Row: R + index without leading zeros (R1, R2, R10). */
export function formatRowCode(index: number): string {
  if (!Number.isFinite(index) || index < 1 || index > 999) {
    throw new Error("Row index must be between 1 and 999.");
  }
  return `R${index}`;
}

export function normalizeRowCode(raw: string): string {
  const s = String(raw || "").trim().toUpperCase();
  if (/^R\d+$/i.test(s)) {
    const n = parseInt(s.slice(1), 10);
    if (n >= 1) return formatRowCode(n);
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 1) return formatRowCode(n);
  }
  const n = parseInt(s.replace(/\D/g, ""), 10);
  if (n >= 1) return formatRowCode(n);
  return assertValidPathSegment("Row", s);
}

/** Bay: BA + index (BA1, BA2). Legacy single letter A→BA1, B→BA2. */
export function formatBayCode(index: number): string {
  if (!Number.isFinite(index) || index < 1 || index > 99) {
    throw new Error("Bay index must be between 1 and 99.");
  }
  return `BA${index}`;
}

export function normalizeBayCode(raw: string): string {
  const s = String(raw || "").trim().toUpperCase();
  if (/^BA\d+$/i.test(s)) {
    const n = parseInt(s.slice(2), 10);
    if (n >= 1) return formatBayCode(n);
  }
  if (/^[A-Z]$/.test(s)) {
    return formatBayCode(s.charCodeAt(0) - 64);
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 1) return formatBayCode(n);
  }
  const n = parseInt(s.replace(/\D/g, ""), 10);
  if (n >= 1) return formatBayCode(n);
  return assertValidPathSegment("Bay", s);
}

/** Level: L + index (L1, L2). */
export function formatLevelCode(index: number): string {
  if (!Number.isFinite(index) || index < 1 || index > 99) {
    throw new Error("Level index must be between 1 and 99.");
  }
  return `L${index}`;
}

export function normalizeLevelCode(raw: string): string {
  const s = String(raw || "").trim().toUpperCase();
  if (/^L\d+$/i.test(s)) {
    const n = parseInt(s.slice(1), 10);
    if (n >= 1) return formatLevelCode(n);
  }
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (n >= 1) return formatLevelCode(n);
  }
  const n = parseInt(s.replace(/\D/g, ""), 10);
  if (n >= 1) return formatLevelCode(n);
  return assertValidPathSegment("Level", s);
}

/** Bin slot: B + two-digit index (B01, B02). Legacy A1→B01. */
export function formatBinSlotCode(index: number): string {
  if (!Number.isFinite(index) || index < 1 || index > 999) {
    throw new Error("Bin index must be between 1 and 999.");
  }
  return `B${String(index).padStart(2, "0")}`;
}

export function normalizeBinSlotCode(raw: string): string {
  const s = String(raw || "").trim().toUpperCase();
  if (/^B\d+$/i.test(s)) {
    const n = parseInt(s.slice(1), 10);
    if (n >= 1) return formatBinSlotCode(n);
  }
  const legacyA = s.match(/^A(\d+)$/);
  if (legacyA) {
    const n = parseInt(legacyA[1], 10);
    if (n >= 1) return formatBinSlotCode(n);
  }
  const n = parseInt(s.replace(/\D/g, ""), 10);
  if (n >= 1) return formatBinSlotCode(n);
  return assertValidPathSegment("Bin", s);
}

export function normalizeBinSegments(input: {
  area: string;
  row: string;
  bay: string;
  level: string;
  binCode: string;
}): { area: string; row: string; bay: string; level: string; binCode: string } {
  return {
    area: normalizeAreaCode(input.area),
    row: normalizeRowCode(input.row),
    bay: normalizeBayCode(input.bay),
    level: normalizeLevelCode(input.level),
    binCode: normalizeBinSlotCode(input.binCode),
  };
}

export function binSegmentsNeedMigration(bin: {
  row?: string;
  bay?: string;
  level?: string;
  binCode?: string;
}): boolean {
  try {
    if (bin.row && normalizeRowCode(bin.row) !== bin.row.trim().toUpperCase()) return true;
    if (bin.bay && normalizeBayCode(bin.bay) !== bin.bay.trim().toUpperCase()) return true;
    if (bin.level && normalizeLevelCode(bin.level) !== bin.level.trim().toUpperCase()) return true;
    if (bin.binCode && normalizeBinSlotCode(bin.binCode) !== bin.binCode.trim().toUpperCase()) return true;
  } catch {
    return true;
  }
  return false;
}

export function buildBinPath(
  warehouseCode: string,
  area: string,
  row: string,
  bay: string,
  level: string,
  binCode: string
): string {
  const w = assertValidPathSegment("Warehouse code", warehouseCode);
  const norm = normalizeBinSegments({ area, row, bay, level, binCode });
  return [w, norm.area, norm.row, norm.bay, norm.level, norm.binCode].join("-");
}

export type FlexibleBinSegmentInput = {
  row?: string;
  bay?: string;
  level?: string;
  binCode: string;
};

/** Build path with only the hierarchy tiers that are present (row/bay/level optional). */
export function buildFlexibleBinPath(
  warehouseCode: string,
  area: string,
  segments: FlexibleBinSegmentInput
): string {
  const w = assertValidPathSegment("Warehouse code", warehouseCode);
  const parts: string[] = [w, normalizeAreaCode(area)];
  const row = String(segments.row || "").trim();
  const bay = String(segments.bay || "").trim();
  const level = String(segments.level || "").trim();
  if (row) parts.push(normalizeRowCode(row));
  if (bay) parts.push(normalizeBayCode(bay));
  if (level) parts.push(normalizeLevelCode(level));
  parts.push(normalizeBinSlotCode(segments.binCode));
  return parts.join("-");
}

function classifyPathMiddleSegment(segment: string): "row" | "bay" | "level" | null {
  const s = String(segment || "").trim().toUpperCase();
  if (!s) return null;
  if (/^R\d+$/.test(s)) return "row";
  if (/^BA\d+$/.test(s) || /^[A-Z]$/.test(s)) return "bay";
  if (/^L\d+$/.test(s)) return "level";
  return null;
}

/** Parse comma- or newline-separated tokens; trim; drop empties. */
export function parseTokenList(raw: string): string[] {
  return String(raw || "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sort bin paths for sheets and UI (walk order: row → bay → level → bin slot).
 * Uses `localeCompare` with `numeric: true` so embedded numbers sort naturally (1, 2, 10).
 */
export function compareBinPaths(pathA: string | undefined, pathB: string | undefined): number {
  return String(pathA || "").localeCompare(String(pathB || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/**
 * Label sheet order: row → bay → level high-to-low → bin (fills PDF rows by level, cols by bin slot).
 */
export function compareBinPathsForLabelPrint(pathA: string | undefined, pathB: string | undefined): number {
  const a = parseBinPath(String(pathA || ""));
  const b = parseBinPath(String(pathB || ""));
  if (!a || !b) return compareBinPaths(pathA, pathB);

  for (const key of ["warehouse", "area", "row", "bay"] as const) {
    const cmp = a[key].localeCompare(b[key], undefined, { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return cmp;
  }
  const levelA = parseInt(a.level.replace(/\D/g, ""), 10) || 0;
  const levelB = parseInt(b.level.replace(/\D/g, ""), 10) || 0;
  if (levelA !== levelB) return levelB - levelA;
  return a.pos.localeCompare(b.pos, undefined, { numeric: true, sensitivity: "base" });
}

/** Parsed `Warehouse-Area-Row-Bay-Level-Bin` (six hyphen-separated segments). */
export type ParsedBinPath = {
  warehouse: string;
  area: string;
  row: string;
  bay: string;
  level: string;
  pos: string;
};

export function parseBinPath(path: string): ParsedBinPath | null {
  const parts = String(path || "")
    .split("-")
    .map((s) => s.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 3) return null;

  const warehouse = parts[0];
  const area = parts[1];
  const pos = parts[parts.length - 1];
  let row = "";
  let bay = "";
  let level = "";

  for (const segment of parts.slice(2, -1)) {
    const kind = classifyPathMiddleSegment(segment);
    if (kind === "row") row = segment;
    else if (kind === "bay") bay = segment;
    else if (kind === "level") level = segment;
  }

  if (parts.length === 6) {
    return {
      warehouse: parts[0],
      area: parts[1],
      row: parts[2],
      bay: parts[3],
      level: parts[4],
      pos: parts[5],
    };
  }

  return { warehouse, area, row, bay, level, pos };
}

/** Display segment without leading zeros on pure numeric tokens (e.g. `01` → `1`). */
export function formatPathSegmentLabelCompact(segment: string): string {
  const s = String(segment || "").trim();
  if (!s) return s;
  if (/^\d+$/.test(s)) {
    const n = parseInt(s, 10);
    if (!Number.isFinite(n)) return s;
    return String(n);
  }
  return s;
}

/** Pad pure numeric segments for display (e.g. `1` → `01`). */
export function formatPathSegmentDisplay(segment: string, minDigits = 2): string {
  const s = String(segment || "").trim();
  if (/^\d+$/.test(s) && s.length < minDigits) {
    return s.padStart(minDigits, "0");
  }
  return s;
}
