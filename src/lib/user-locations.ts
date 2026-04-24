/**
 * Normalize Firestore `users.*.locations` into a string[] of location document ids.
 * Handles legacy single-string values and bad shapes so merges and UI never throw.
 */
export function normalizeUserLocationIds(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  return [];
}
