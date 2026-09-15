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

export async function lexiGetOutboundRequest(
  adminProfile: UserProfile,
  clientUserId: string,
  requestId?: string,
  productName?: string
): Promise<Record<string, unknown> | null> {
  await assertLexiCanManageClient(adminProfile, clientUserId);
  const col = adminDb().collection(`users/${clientUserId}/shipmentRequests`);

  if (requestId?.trim()) {
    const snap = await col.doc(requestId.trim()).get();
    if (!snap.exists) return null;
    return formatOutbound(snap.id, snap.data()!);
  }

  const snap = await col.limit(50).get();
  const sorted = snap.docs.sort(
    (a: FirebaseFirestore.QueryDocumentSnapshot, b: FirebaseFirestore.QueryDocumentSnapshot) => {
      const aSec = Number(a.data().requestedAt?.seconds ?? a.data().date?.seconds ?? 0);
      const bSec = Number(b.data().requestedAt?.seconds ?? b.data().date?.seconds ?? 0);
      return bSec - aSec;
    }
  );
  const q = norm(productName);
  for (const doc of sorted) {
    const data = doc.data();
    const first = Array.isArray(data.shipments) ? data.shipments[0] : null;
    const name = String(first?.productName ?? data.productName ?? "");
    const sku = String(first?.sku ?? "");
    if (!q) return formatOutbound(doc.id, data);
    if (norm(name).includes(q) || norm(sku).includes(q)) {
      return formatOutbound(doc.id, data);
    }
  }
  return null;
}

function formatOutbound(id: string, data: FirebaseFirestore.DocumentData): Record<string, unknown> {
  const first = Array.isArray(data.shipments) ? data.shipments[0] : null;
  const quantity = Number(first?.quantity ?? 0);
  const packOf = Number(first?.packOf ?? 1) || 1;
  return {
    requestId: id,
    status: data.status ?? "",
    shipmentType: data.shipmentType ?? "product",
    service: data.service ?? null,
    productName: first?.productName ?? "",
    sku: first?.sku ?? "",
    productId: first?.productId ?? "",
    quantity,
    packOf,
    totalUnits: quantity * packOf,
    warehousePickStatus: data.warehousePickStatus ?? null,
    warehouseDispatchStatus: data.warehouseDispatchStatus ?? null,
  };
}

function isPendingStatus(status: unknown): boolean {
  const s = String(status ?? "").toLowerCase();
  return s === "pending" || s === "pending_receive" || s === "open";
}

export async function lexiListPending(
  adminProfile: UserProfile,
  clientUserId: string
): Promise<Record<string, unknown>> {
  await assertLexiCanManageClient(adminProfile, clientUserId);
  const db = adminDb();
  const uid = clientUserId;

  async function pendingOf(
    path: string,
    type: string,
    nameOf: (data: FirebaseFirestore.DocumentData) => string
  ) {
    const snap = await db.collection(path).limit(40).get();
    return snap.docs
      .filter((d: FirebaseFirestore.QueryDocumentSnapshot) => isPendingStatus(d.data().status))
      .slice(0, 8)
      .map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({
        type,
        requestId: d.id,
        status: d.data().status,
        productName: nameOf(d.data()),
      }));
  }

  const inbound = await pendingOf(
    `users/${uid}/inventoryRequests`,
    "inbound",
    (d) => String(d.productName ?? d.newProductName ?? "")
  );
  const outbound = await pendingOf(`users/${uid}/shipmentRequests`, "outbound", (d) => {
    const first = Array.isArray(d.shipments) ? d.shipments[0] : null;
    return String(first?.productName ?? "");
  });
  const returns = await pendingOf(
    `users/${uid}/productReturns`,
    "return",
    (d) => String(d.productName ?? d.newProductName ?? "")
  );
  const dispose = await pendingOf(
    `users/${uid}/disposeRequests`,
    "dispose",
    (d) => String(d.productName ?? "")
  );
  const deletes = await pendingOf(
    `users/${uid}/deleteRequests`,
    "delete",
    (d) => String(d.productName ?? "")
  );
  const refunds = await pendingOf(
    `users/${uid}/labelRefundRequests`,
    "label_refund",
    () => "Label refund"
  );
  const topups = await pendingOf(
    `users/${uid}/labelWalletTopupRequests`,
    "label_topup",
    () => "Wallet top-up"
  );
  const apiFees = await pendingOf(
    `users/${uid}/labelApiFeePaymentRequests`,
    "label_api_fee",
    () => "API fee"
  );

  let quarantine: Array<{ type: string; requestId: string; status: unknown; productName: string }> = [];
  try {
    const qSnap = await db.collection("quarantineRequests").where("userId", "==", uid).limit(20).get();
    quarantine = qSnap.docs
      .filter((d: FirebaseFirestore.QueryDocumentSnapshot) => isPendingStatus(d.data().status))
      .slice(0, 8)
      .map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({
        type: "quarantine",
        requestId: d.id,
        status: d.data().status,
        productName: String(d.data().productName ?? ""),
      }));
  } catch {
    quarantine = [];
  }

  return {
    inbound,
    outbound,
    returns,
    dispose,
    deletes,
    quarantine,
    labelRefunds: refunds,
    labelTopups: topups,
    labelApiFees: apiFees,
  };
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value !== null && "seconds" in value) {
    const sec = Number((value as { seconds: number }).seconds);
    if (Number.isFinite(sec)) return new Date(sec * 1000).toISOString();
  }
  return String(value);
}

export async function lexiGetClientProfile(
  adminProfile: UserProfile,
  clientUserId: string
): Promise<Record<string, unknown> | null> {
  await assertLexiCanManageClient(adminProfile, clientUserId);
  const snap = await adminDb().collection("users").doc(clientUserId).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  return {
    uid: snap.id,
    name: d.name ?? null,
    email: d.email ?? null,
    companyName: d.companyName ?? null,
    phone: d.phone ?? null,
    status: d.status ?? d.accountStatus ?? null,
    roles: d.roles ?? null,
  };
}

export async function lexiListWarehouses(): Promise<
  Array<{ id: string; name: string; active: boolean }>
> {
  const snap = await adminDb().collection("warehouses").limit(40).get();
  return snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
    const data = d.data();
    return {
      id: d.id,
      name: String(data.name ?? d.id),
      active: data.active !== false,
    };
  });
}

export async function lexiLookupClientRecords(
  adminProfile: UserProfile,
  clientUserId: string,
  topic: string,
  query?: string
): Promise<unknown> {
  await assertLexiCanManageClient(adminProfile, clientUserId);
  const db = adminDb();
  const q = norm(query);
  const uid = clientUserId;

  async function recent(path: string, limitN: number, mapFn: (id: string, data: FirebaseFirestore.DocumentData) => Record<string, unknown>) {
    try {
      const snap = await db.collection(path).limit(40).get();
      const rows = snap.docs.map((d: FirebaseFirestore.QueryDocumentSnapshot) => mapFn(d.id, d.data()));
      const filtered = q
        ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q))
        : rows;
      return filtered.slice(0, limitN);
    } catch {
      return [];
    }
  }

  switch (topic) {
    case "profile":
      return lexiGetClientProfile(adminProfile, uid);
    case "invoices":
      return recent(`users/${uid}/invoices`, 10, (id, d) => ({
        invoiceId: id,
        invoiceNumber: d.invoiceNumber ?? d.number ?? null,
        status: d.status ?? null,
        total: d.total ?? d.amount ?? d.grandTotal ?? null,
        createdAt: toIso(d.createdAt ?? d.date ?? d.invoiceDate),
      }));
    case "shipped":
      return recent(`users/${uid}/shipped`, 10, (id, d) => ({
        shippedId: id,
        productName: d.productName ?? null,
        shippedQty: d.shippedQty ?? d.quantity ?? null,
        service: d.service ?? null,
        date: toIso(d.date ?? d.createdAt ?? d.dispatchedAt),
      }));
    case "restock_history":
      return recent(`users/${uid}/restockHistory`, 10, (id, d) => ({
        id,
        productName: d.productName ?? null,
        restockedQuantity: d.restockedQuantity ?? null,
        newQuantity: d.newQuantity ?? null,
        restockedBy: d.restockedBy ?? null,
        restockedAt: toIso(d.restockedAt),
      }));
    case "inventory":
      return lexiFindProducts(adminProfile, uid, query ?? "");
    case "returns":
      return recent(`users/${uid}/productReturns`, 10, (id, d) => ({
        requestId: id,
        productName: d.productName ?? d.newProductName ?? null,
        status: d.status ?? null,
        quantity: d.quantity ?? null,
      }));
    default:
      return { error: `Unknown topic "${topic}". Use profile, inventory, invoices, shipped, restock_history, or returns.` };
  }
}
