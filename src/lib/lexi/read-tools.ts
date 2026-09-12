import { adminDb } from "@/lib/firebase-admin";
import { assertLexiCanManageClient, loadManagedClientProfiles } from "@/lib/lexi/access";
import type { UserProfile } from "@/types";

function norm(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function displayName(user: UserProfile): string {
  return String(user.name ?? user.email ?? user.uid ?? "Unknown").trim();
}

export async function lexiFindClients(
  adminProfile: UserProfile,
  query: string
): Promise<Array<{ uid: string; name: string; email?: string }>> {
  const q = norm(query);
  const clients = await loadManagedClientProfiles(adminProfile);
  const filtered = clients.filter((u) => {
    if (!q) return true;
    const name = norm(u.name);
    const email = norm(u.email);
    return name.includes(q) || email.includes(q) || norm(u.uid).includes(q);
  });
  return filtered.slice(0, 10).map((u) => ({
    uid: u.uid!,
    name: displayName(u),
    email: u.email ?? undefined,
    note: "Always pass uid (not name) as clientUserId in later tools.",
  }));
}

export async function lexiFindProducts(
  adminProfile: UserProfile,
  clientUserId: string,
  query: string
): Promise<
  Array<{
    id: string;
    productName: string;
    sku?: string;
    quantity: number;
  }>
> {
  await assertLexiCanManageClient(adminProfile, clientUserId);
  const q = norm(query);
  const snap = await adminDb().collection(`users/${clientUserId}/inventory`).get();
  const items = snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({
    id: d.id,
    ...d.data(),
  })) as Array<{
    id: string;
    productName?: string;
    sku?: string;
    quantity?: number;
  }>;

  const filtered = items.filter((item) => {
    if (!q) return true;
    return norm(item.productName).includes(q) || norm(item.sku).includes(q);
  });

  return filtered.slice(0, 15).map((item) => ({
    id: item.id,
    productName: String(item.productName ?? "Unknown"),
    sku: item.sku ? String(item.sku) : undefined,
    quantity: Math.max(0, Number(item.quantity) || 0),
  }));
}

export async function lexiGetInboundRequest(
  adminProfile: UserProfile,
  clientUserId: string,
  requestId?: string,
  productName?: string
): Promise<Record<string, unknown> | null> {
  await assertLexiCanManageClient(adminProfile, clientUserId);
  const col = adminDb().collection(`users/${clientUserId}/inventoryRequests`);

  if (requestId?.trim()) {
    const snap = await col.doc(requestId.trim()).get();
    if (!snap.exists) return null;
    return formatRequest(snap.id, snap.data()!);
  }

  const snap = await col.limit(50).get();
  const sorted = snap.docs.sort((a: FirebaseFirestore.QueryDocumentSnapshot, b: FirebaseFirestore.QueryDocumentSnapshot) => {
    const aSec = Number(a.data().requestedAt?.seconds ?? a.data().addDate?.seconds ?? 0);
    const bSec = Number(b.data().requestedAt?.seconds ?? b.data().addDate?.seconds ?? 0);
    return bSec - aSec;
  });
  const q = norm(productName);
  for (const doc of sorted) {
    const data = doc.data();
    if (!q) return formatRequest(doc.id, data);
    if (norm(data.productName).includes(q) || norm(data.sku).includes(q)) {
      return formatRequest(doc.id, data);
    }
  }
  return null;
}

function formatRequest(id: string, data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const expected =
    Number(data.receivedQuantity) ||
    Number(data.requestedQuantity) ||
    Number(data.quantity) ||
    0;
  const received = Math.max(0, Number(data.warehouseGoodReceivedQty) || 0);
  const remaining = Math.max(0, expected - received);

  return {
    requestId: id,
    productName: data.productName ?? "",
    sku: data.sku ?? "",
    status: data.status ?? "",
    fulfillmentStatus: data.fulfillmentStatus ?? null,
    quantity: expected,
    remainingToReceive: remaining,
    productSubType: data.productSubType ?? null,
    inventoryType: data.inventoryType ?? "product",
  };
}
