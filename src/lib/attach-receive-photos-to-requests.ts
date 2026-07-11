import { doc, getDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

/** Copy dock receive photos onto linked inbound requests as remarks photos (not product images). */
export async function attachReceivePhotosToInventoryRequests(input: {
  entries: Array<{ clientUserId: string; inventoryRequestId: string }>;
  photoUrls: string[];
}): Promise<void> {
  const urls = [...new Set(input.photoUrls.map((u) => String(u || "").trim()).filter(Boolean))];
  if (urls.length === 0) return;

  const seen = new Set<string>();
  for (const entry of input.entries) {
    const clientUserId = entry.clientUserId?.trim();
    const requestId = entry.inventoryRequestId?.trim();
    if (!clientUserId || !requestId) continue;
    const key = `${clientUserId}:${requestId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const ref = doc(db, "users", clientUserId, "inventoryRequests", requestId);
    const snap = await getDoc(ref);
    if (!snap.exists()) continue;
    const data = snap.data() as { remarksImageUrls?: string[] };
    const prev = Array.isArray(data.remarksImageUrls)
      ? data.remarksImageUrls.map((u) => String(u || "").trim()).filter(Boolean)
      : [];
    const merged = [...new Set([...prev, ...urls])];
    await updateDoc(ref, {
      remarksImageUrls: merged,
      updatedAt: serverTimestamp(),
    });
  }
}
