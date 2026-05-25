import {
  collectionGroup,
  getDocs,
  query,
  where,
  limit,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InventoryItem } from "@/types";

export type ProductMatch = {
  /** Owning client (uid) of this product entry. */
  clientUserId: string;
  productId: string;
  productName: string;
  sku: string;
  retailIdentifier?: string | null;
  imageUrl?: string | null;
  /** Why this matched the query — used to rank suggestions. */
  matchReason: "sku_exact" | "upc_exact" | "sku_contains" | "name_contains";
};

function userIdFromInventoryPath(path: string): string {
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}

/**
 * Look up a product by SKU or UPC/EAN/FNSKU across every client's catalog.
 * Returns sorted matches (exact SKU > exact UPC > contains).
 *
 * Tries indexed queries first (sku ==, retailIdentifier ==). If a query
 * fails — usually because the relevant collection-group index doesn't
 * exist yet — falls back to a single-shot full collectionGroup scan.
 */
export async function lookupProductByCode(rawCode: string): Promise<ProductMatch[]> {
  const code = rawCode.trim();
  if (!code) return [];
  const codeUpper = code.toUpperCase();

  const results: ProductMatch[] = [];
  const seen = new Set<string>();

  function pushMatch(item: InventoryItem, ownerUid: string, reason: ProductMatch["matchReason"]) {
    const key = `${ownerUid}:${item.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    results.push({
      clientUserId: ownerUid,
      productId: item.id,
      productName: item.productName,
      sku: String(item.sku ?? ""),
      retailIdentifier: item.retailIdentifier ?? null,
      imageUrl: item.imageUrl ?? item.imageUrls?.[0] ?? null,
      matchReason: reason,
    });
  }

  async function runIndexed(field: "sku" | "retailIdentifier", reason: ProductMatch["matchReason"]) {
    try {
      const snap = await getDocs(
        query(collectionGroup(db, "inventory"), where(field, "==", code), limit(20))
      );
      for (const d of snap.docs) {
        const item = { ...(d.data() as Omit<InventoryItem, "id">), id: d.id };
        const owner = userIdFromInventoryPath(d.ref.path);
        if (!owner) continue;
        pushMatch(item, owner, reason);
      }
    } catch {
      // Index missing — caller may fall back.
    }
  }

  await Promise.all([runIndexed("sku", "sku_exact"), runIndexed("retailIdentifier", "upc_exact")]);

  if (results.length === 0) {
    // Fallback: full scan with contains-match (bounded by limit).
    try {
      const snap = await getDocs(query(collectionGroup(db, "inventory"), limit(500)));
      for (const d of snap.docs) {
        const item = { ...(d.data() as Omit<InventoryItem, "id">), id: d.id };
        const owner = userIdFromInventoryPath(d.ref.path);
        if (!owner) continue;
        const sku = String(item.sku ?? "").toUpperCase();
        const upc = String(item.retailIdentifier ?? "").toUpperCase();
        const name = String(item.productName ?? "").toUpperCase();
        if (sku === codeUpper) pushMatch(item, owner, "sku_exact");
        else if (upc === codeUpper) pushMatch(item, owner, "upc_exact");
        else if (sku && sku.includes(codeUpper)) pushMatch(item, owner, "sku_contains");
        else if (name.includes(codeUpper)) pushMatch(item, owner, "name_contains");
      }
    } catch {
      // ignored — no fallback possible
    }
  }

  const rank = { sku_exact: 0, upc_exact: 1, sku_contains: 2, name_contains: 3 } as const;
  results.sort((a, b) => rank[a.matchReason] - rank[b.matchReason]);
  return results.slice(0, 20);
}
