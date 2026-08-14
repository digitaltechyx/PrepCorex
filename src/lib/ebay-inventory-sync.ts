/**
 * Shared eBay inventory quantity setter (PrepCorex → eBay).
 */

/** Payload for client → `/api/integrations/ebay/sync-inventory` after PrepCorex qty changes. */
export type EbayInventoryPushHint = {
  userId: string;
  connectionId: string;
  offerId?: string | null;
  listingId?: string | null;
  newQuantity: number;
};

/** Push PrepCorex quantities to eBay (staff or owner bearer token). */
export async function pushEbayInventoryHints(
  token: string,
  hints: EbayInventoryPushHint[]
): Promise<{ ok: number; errors: string[] }> {
  const unique = new Map<string, EbayInventoryPushHint>();
  for (const h of hints) {
    if (!h.userId || !h.connectionId) continue;
    if (!h.offerId && !h.listingId) continue;
    const key = `${h.userId}|${h.connectionId}|${h.offerId || ""}|${h.listingId || ""}`;
    unique.set(key, h);
  }
  let ok = 0;
  const errors: string[] = [];
  for (const h of unique.values()) {
    try {
      const res = await fetch("/api/integrations/ebay/sync-inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: h.userId,
          connectionId: h.connectionId,
          offerId: h.offerId ?? undefined,
          listingId: h.listingId ?? undefined,
          newQuantity: h.newQuantity,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        errors.push(typeof data.error === "string" ? data.error : "eBay sync failed");
        continue;
      }
      ok += 1;
    } catch (e) {
      errors.push(e instanceof Error ? e.message : "eBay sync failed");
    }
  }
  return { ok, errors };
}
