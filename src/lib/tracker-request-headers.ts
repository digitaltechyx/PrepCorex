import type { User } from "firebase/auth";

/** Optional Firebase token when signed in; public tracker pages work without auth. */
export async function buildTrackerRequestHeaders(user: User | null | undefined): Promise<HeadersInit> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (!user) return headers;
  try {
    const token = await user.getIdToken();
    return { ...headers, Authorization: `Bearer ${token}` };
  } catch {
    return headers;
  }
}
