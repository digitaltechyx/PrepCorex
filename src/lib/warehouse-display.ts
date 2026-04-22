/** Normalize e.g. "NJ 1", "nj1" → "nj1" for matching. */
export function normalizeWarehouseKey(name: string): string {
  return name.trim().replace(/\s+/g, "").toLowerCase();
}

/** Default inbound warehouse: any active location whose name normalizes to `nj1`. */
export function isDefaultNj1Warehouse(name: string | undefined | null): boolean {
  return normalizeWarehouseKey(name ?? "") === "nj1";
}

/**
 * Show warehouse as NJ1, NJ2, CA3 from admin names like `nj1`, `NJ 2`, `ca3`.
 * If the name does not match `[A-Za-z]{2}\\d+`, returns the trimmed original.
 */
export function formatWarehouseDisplayName(name: string | undefined | null): string {
  const raw = (name ?? "").trim();
  if (!raw) return "Unnamed";
  const compact = raw.replace(/\s+/g, "");
  const m = compact.match(/^([A-Za-z]{2})(\d+)$/);
  if (m) return `${m[1].toUpperCase()}${m[2]}`;
  return raw;
}
