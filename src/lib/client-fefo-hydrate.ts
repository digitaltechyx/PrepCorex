import { collection, doc, getDocs, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  buildClientFefoStockRows,
  fefoLotsForProduct,
} from "@/lib/client-fefo-stock";
import { earliestExpiryFromBatches } from "@/lib/inventory-expiry-batches";

/**
 * When inventory.expiryBatches is empty but FEFO tab still shows lots (from
 * receive logs / inbound requests), write those lots onto the inventory doc
 * so Quick Ship UI and FEFO/FIFO deduction see the same batches.
 */
export async function hydrateMissingExpiryBatchesForProducts(
  clientUserId: string,
  productIds: string[]
): Promise<void> {
  const uid = clientUserId.trim();
  const ids = [...new Set(productIds.map((id) => String(id || "").trim()).filter(Boolean))];
  if (!uid || ids.length === 0) return;

  const [invSnap, reqSnap, logSnap] = await Promise.all([
    getDocs(collection(db, `users/${uid}/inventory`)),
    getDocs(collection(db, `users/${uid}/inventoryRequests`)),
    getDocs(collection(db, `users/${uid}/inboundReceiveLogs`)),
  ]);

  const inventoryDocs = invSnap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));

  const needsHydrate = inventoryDocs.filter((d) => {
    if (!ids.includes(d.id)) return false;
    const batches = d.data.expiryBatches;
    if (!Array.isArray(batches) || batches.length === 0) return true;
    return !batches.some(
      (b) =>
        b &&
        typeof b === "object" &&
        String((b as { expiry?: unknown }).expiry ?? "").trim() &&
        Math.max(0, Math.floor(Number((b as { quantity?: unknown }).quantity) || 0)) > 0
    );
  });
  if (needsHydrate.length === 0) return;

  const rows = buildClientFefoStockRows(
    inventoryDocs,
    reqSnap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> })),
    new Date(),
    logSnap.docs.map((d) => ({ id: d.id, data: d.data() as Record<string, unknown> }))
  );

  await Promise.all(
    needsHydrate.map(async (d) => {
      const lots = fefoLotsForProduct(rows, {
        id: d.id,
        sku: String(d.data.sku ?? ""),
        productName: String(d.data.productName ?? ""),
      });
      if (lots.length === 0) return;
      await updateDoc(doc(db, `users/${uid}/inventory`, d.id), {
        expiryBatches: lots.map((lot) => ({
          expiry: lot.expiry,
          quantity: lot.quantity,
          lot: null,
          requestId: null,
        })),
        expiryDate: earliestExpiryFromBatches(lots),
      });
    })
  );
}
