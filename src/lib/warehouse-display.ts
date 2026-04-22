/** Normalize e.g. "NJ 1", "nj1" → "nj1" for matching. */
export function normalizeWarehouseKey(name: string): string {
  // Keep only letters/numbers so variants like "NJ-2", "NJ 2", "nj_2" all match "nj2".
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Default inbound warehouse: any active location whose name normalizes to `nj2`. */
export function isDefaultNj2Warehouse(name: string | undefined | null): boolean {
  return normalizeWarehouseKey(name ?? "") === "nj2";
}

/**
 * Show warehouse as NJ-01, NJ-02, CA-03 from admin names like `nj1`, `NJ 2`, `ca3`.
 * If the name does not match `[A-Za-z]{2}\\d+`, returns the trimmed original.
 */
export function formatWarehouseDisplayName(name: string | undefined | null): string {
  const raw = (name ?? "").trim();
  if (!raw) return "Unnamed";
  const compact = normalizeWarehouseKey(raw);
  const m = compact.match(/^([A-Za-z]{2})(\d+)$/);
  if (m) {
    const code = m[1].toUpperCase();
    const number = String(Number.parseInt(m[2], 10)).padStart(2, "0");
    return `${code}-${number}`;
  }
  return raw;
}
