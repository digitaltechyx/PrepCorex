/**
 * Bin path helpers ΓÇö aligned with docs/BARCODE_SCANNING/01_LOCATION_STRUCTURE.md
 * Path: <Warehouse>-<Area>-<Row>-<Bay>-<Level>-<Bin>
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

export function buildBinPath(
  warehouseCode: string,
  area: string,
  row: string,
  bay: string,
  level: string,
  binCode: string
): string {
  const w = assertValidPathSegment("Warehouse code", warehouseCode);
  const a = assertValidPathSegment("Area", area);
  const r = assertValidPathSegment("Row", row);
  const b = assertValidPathSegment("Bay", bay);
  const l = assertValidPathSegment("Level", level);
  const bin = assertValidPathSegment("Bin", binCode);
  return [w, a, r, b, l, bin].join("-");
}

/** Parse comma- or newline-separated tokens; trim; drop empties. */
export function parseTokenList(raw: string): string[] {
  return String(raw || "")
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Sort bin paths for sheets and UI (walk order: row ΓåÆ bay ΓåÆ level ΓåÆ bin slot).
 * Uses `localeCompare` with `numeric: true` so embedded numbers sort naturally (1, 2, 10).
 */
export function compareBinPaths(pathA: string | undefined, pathB: string | undefined): number {
  return String(pathA || "").localeCompare(String(pathB || ""), undefined, {
    numeric: true,
    sensitivity: "base",
  });
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
  if (parts.length !== 6) return null;
  return {
    warehouse: parts[0],
    area: parts[1],
    row: parts[2],
    bay: parts[3],
    level: parts[4],
    pos: parts[5],
  };
}

/** Display segment without leading zeros on pure numeric tokens (e.g. `01` ΓåÆ `1`). */
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

/** Pad pure numeric segments for display (e.g. `1` ΓåÆ `01`). */
export function formatPathSegmentDisplay(segment: string, minDigits = 2): string {
  const s = String(segment || "").trim();
  if (/^\d+$/.test(s) && s.length < minDigits) {
    return s.padStart(minDigits, "0");
  }
  return s;
}
