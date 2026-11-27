/**
 * Only allow same-app relative paths (blocks open redirects).
 * Accepts `/dashboard/...` and rejects `//evil.com`, `https://...`, etc.
 */
export function getSafeInternalPath(
  candidate: string | null | undefined
): string | null {
  const raw = String(candidate || "").trim();
  if (!raw) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null;
  if (raw.includes("://")) return null;
  if (raw.includes("\\")) return null;
  // Keep query + hash; strip CR/LF.
  const cleaned = raw.replace(/[\r\n\0]/g, "");
  if (!cleaned.startsWith("/") || cleaned.startsWith("//")) return null;
  return cleaned;
}

/** Build `/login?next=...` when a safe return path is known. */
export function loginPathWithNext(nextPath: string | null | undefined): string {
  const safe = getSafeInternalPath(nextPath);
  if (!safe) return "/login";
  return `/login?next=${encodeURIComponent(safe)}`;
}
