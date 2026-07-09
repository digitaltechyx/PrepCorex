/** Single-letter area codes A–Z, then AA, AB, … (Excel-style). */
export function areaCodeFromIndex(index: number): string {
  if (!Number.isFinite(index) || index < 0) {
    throw new Error("Area code index must be zero or greater.");
  }
  let n = index;
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function normalizeAreaCodeKey(code: string): string {
  return String(code || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** Next unused area codes for a warehouse (A, B, C … skipping existing). */
export function suggestNextAreaCodes(existingCodes: string[], count: number): string[] {
  if (!Number.isFinite(count) || count < 1 || count > 999) {
    throw new Error("Area count must be between 1 and 999.");
  }
  const used = new Set(existingCodes.map(normalizeAreaCodeKey).filter(Boolean));
  const reserved = new Set<string>();
  const out: string[] = [];

  for (let i = 0; out.length < count && i < 26_000; i++) {
    const code = areaCodeFromIndex(i);
    if (used.has(code) || reserved.has(code)) continue;
    reserved.add(code);
    out.push(code);
  }

  if (out.length < count) {
    throw new Error("Could not allocate enough unique area codes.");
  }
  return out;
}
