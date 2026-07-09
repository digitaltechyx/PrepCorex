import { abbreviateStateOrProvince } from "@/lib/region-display";
import { formatWarehouseDisplayName } from "@/lib/warehouse-display";

export type WarehouseCodeCandidate = {
  code: string;
  stateOrProvince?: string;
  country?: string;
};

/** Extract trailing sequence from codes like NJ03, NJ-03, nj3 (must start with region prefix). */
export function parseWarehouseCodeSequence(code: string, regionPrefix: string): number | null {
  const prefix = regionPrefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const normalized = String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!prefix || !normalized.startsWith(prefix)) return null;
  const numPart = normalized.slice(prefix.length);
  if (!/^\d+$/.test(numPart)) return null;
  const n = Number.parseInt(numPart, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Alphanumeric warehouse code for bin paths (e.g. NJ03). */
export function formatWarehouseCode(regionPrefix: string, sequence: number): string {
  const prefix = regionPrefix.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!prefix) throw new Error("Region prefix is required.");
  if (!Number.isFinite(sequence) || sequence < 1 || sequence > 999) {
    throw new Error("Sequence must be between 1 and 999.");
  }
  return `${prefix}${String(sequence).padStart(2, "0")}`;
}

/** Human-friendly label (e.g. NJ-03). */
export function formatWarehouseCodeLabel(code: string): string {
  return formatWarehouseDisplayName(code.toLowerCase());
}

export function suggestNextWarehouseCode(input: {
  country: string;
  stateOrProvince: string;
  existing: WarehouseCodeCandidate[];
}): { code: string; label: string; sequence: number; regionPrefix: string } {
  const regionPrefix = abbreviateStateOrProvince(input.country, input.stateOrProvince);
  if (!regionPrefix) {
    throw new Error("Select a state or province to generate a warehouse code.");
  }

  const sameRegion = input.existing.filter((row) => {
    const rowPrefix = abbreviateStateOrProvince(row.country, row.stateOrProvince);
    return rowPrefix === regionPrefix;
  });

  let maxSeq = 0;
  for (const row of sameRegion) {
    const seq = parseWarehouseCodeSequence(row.code, regionPrefix);
    if (seq !== null && seq > maxSeq) maxSeq = seq;
  }

  const sequence = maxSeq + 1;
  const code = formatWarehouseCode(regionPrefix, sequence);
  return {
    code,
    label: formatWarehouseCodeLabel(code),
    sequence,
    regionPrefix,
  };
}
