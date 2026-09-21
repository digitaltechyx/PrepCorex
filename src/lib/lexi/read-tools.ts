import { adminDb } from "@/lib/firebase-admin";
import { assertLexiCanManageClient, loadManagedClientProfiles } from "@/lib/lexi/access";
import {
  isPendingReceiveInventoryRequest,
  pendingReceiveRemainingQty,
} from "@/lib/admin-pending-receive";
import type { InventoryRequest, UserProfile } from "@/types";

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
  const summary = outboundShipmentSummary(data);
  return {
    requestId: id,
    status: data.status ?? "",
    shipmentType: data.shipmentType ?? "product",
    service: data.service ?? null,
    productName: summary.productName,
    sku: summary.lines[0]?.sku ?? "",
    productId: summary.lines[0]?.productId ?? "",
    lineCount: summary.lineCount,
    quantity: summary.totalLineQty,
    totalUnits: summary.totalUnits,
    lines: summary.lines,
    warehousePickStatus: data.warehousePickStatus ?? null,
    warehouseDispatchStatus: data.warehouseDispatchStatus ?? null,
  };
}

/** Same normalization as admin Notifications tabs. */
function normRequestStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "")
    .replace(/_+/g, "_");
}

/** Notifications → Pending tab (awaiting admin approval). */
function isNotificationsPendingStatus(status: unknown): boolean {
  const s = normRequestStatus(status);
  return s === "pending" || s === "pending_approval";
}

function inboundRequestQty(data: FirebaseFirestore.DocumentData): number {
  return (
    Number(data.quantity) ||
    Number(data.requestedQty) ||
    Number(data.requestedQuantity) ||
    Number(data.receivedQuantity) ||
    0
  );
}

function outboundShipmentSummary(data: FirebaseFirestore.DocumentData): {
  productName: string;
  lineCount: number;
  totalLineQty: number;
  totalUnits: number;
  lines: Array<{
    productName: string;
    sku?: string;
    productId?: string;
    quantity: number;
    packOf: number;
    totalUnits: number;
  }>;
} {
  const shipments = Array.isArray(data.shipments) ? data.shipments : [];
  const lines = shipments.map((shipment) => {
    const quantity = Math.max(0, Number(shipment.quantity) || 0);
    const packOf = Math.max(1, Number(shipment.packOf) || 1);
    return {
      productName: String(shipment.productName ?? ""),
      sku: shipment.sku ? String(shipment.sku) : undefined,
      productId: shipment.productId ? String(shipment.productId) : undefined,
      quantity,
      packOf,
      totalUnits: quantity * packOf,
    };
  });
  const lineCount = lines.length;
  const totalLineQty = lines.reduce((sum, line) => sum + line.quantity, 0);
  const totalUnits = lines.reduce((sum, line) => sum + line.totalUnits, 0);
  const productName =
    lineCount === 0
      ? "Outbound request"
      : lineCount === 1
        ? lines[0].productName || "Outbound request"
        : `${lines[0].productName || "Outbound"} + ${lineCount - 1} more`;
  return { productName, lineCount, totalLineQty, totalUnits, lines };
}

async function loadMultiLineInboundBatchIds(
  db: FirebaseFirestore.Firestore,
  uid: string
): Promise<Set<string>> {
  const snap = await db.collection(`users/${uid}/inboundBatches`).get();
  return new Set(
    snap.docs
      .filter((d) => Number(d.data().totalLines || 0) > 1)
      .map((d) => d.id)
  );
}

async function loadMultiLineDisposeBatchIds(
  db: FirebaseFirestore.Firestore,
  uid: string
): Promise<Set<string>> {
  try {
    const snap = await db.collection(`users/${uid}/disposeBatches`).get();
    return new Set(
      snap.docs
        .filter((d) => Number(d.data().totalLines || 0) > 1)
        .map((d) => d.id)
    );
  } catch {
    return new Set();
  }
}

export async function lexiListPending(
  adminProfile: UserProfile,
  clientUserId: string
): Promise<Record<string, unknown>> {
  await assertLexiCanManageClient(adminProfile, clientUserId);
  const db = adminDb();
  const uid = clientUserId;
  const multiLineInboundBatchIds = await loadMultiLineInboundBatchIds(db, uid);
  const multiLineDisposeBatchIds = await loadMultiLineDisposeBatchIds(db, uid);

  async function pendingOf(
    path: string,
    type: string,
    nameOf: (data: FirebaseFirestore.DocumentData) => string,
    extra?: (data: FirebaseFirestore.DocumentData) => boolean,
    qtyOf?: (data: FirebaseFirestore.DocumentData) => number,
    mapExtra?: (id: string, data: FirebaseFirestore.DocumentData) => Record<string, unknown>
  ) {
    try {
      const snap = await db.collection(path).get();
      const rows = snap.docs
        .filter((d: FirebaseFirestore.QueryDocumentSnapshot) => {
          const data = d.data();
          if (extra && !extra(data)) return false;
          return isNotificationsPendingStatus(data.status);
        })
        .map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
          const data = d.data();
          return {
            type,
            clientUserId: uid,
            requestId: d.id,
            status: data.status ?? "",
            productName: nameOf(data),
            quantity: qtyOf ? qtyOf(data) : inboundRequestQty(data),
            ...(mapExtra ? mapExtra(d.id, data) : {}),
          };
        });
      return {
        count: rows.length,
        items: rows.slice(0, 25),
      };
    } catch (error) {
      return {
        count: 0,
        items: [],
        error: error instanceof Error ? error.message : "lookup failed",
      };
    }
  }

  const inbound = await pendingOf(
    `users/${uid}/inventoryRequests`,
    "inbound",
    (d) => String(d.productName ?? d.newProductName ?? ""),
    (d) => {
      const batchId = String(d.batchId ?? "");
      if (batchId && multiLineInboundBatchIds.has(batchId)) return false;
      return true;
    }
  );

  const inboundBatches = await pendingOf(
    `users/${uid}/inboundBatches`,
    "inbound_batch",
    (d) => `Inbound batch (${Number(d.totalLines || 0)} lines)`,
    (d) => Number(d.totalLines || 0) > 1
  );

  const outbound = await pendingOf(
    `users/${uid}/shipmentRequests`,
    "outbound",
    (d) => outboundShipmentSummary(d).productName,
    undefined,
    (d) => outboundShipmentSummary(d).totalLineQty,
    (_id, d) => {
      const summary = outboundShipmentSummary(d);
      return {
        lineCount: summary.lineCount,
        totalUnits: summary.totalUnits,
        lines: summary.lines,
      };
    }
  );

  const returns = await pendingOf(
    `users/${uid}/productReturns`,
    "return",
    (d) => String(d.productName ?? d.newProductName ?? "")
  );
  const dispose = await pendingOf(
    `users/${uid}/disposeRequests`,
    "dispose",
    (d) => String(d.productName ?? ""),
    (d) => {
      const batchId = String(d.batchId ?? "");
      if (batchId && multiLineDisposeBatchIds.has(batchId)) return false;
      return true;
    }
  );
  const disposeBatches = await pendingOf(
    `users/${uid}/disposeBatches`,
    "dispose_batch",
    (d) => `Dispose batch (${Number(d.totalLines || 0)} lines)`,
    (d) => Number(d.totalLines || 0) > 1
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

  let quarantine: { count: number; items: Array<Record<string, unknown>> } = { count: 0, items: [] };
  try {
    const qSnap = await db.collection("quarantineRequests").where("userId", "==", uid).get();
    const items = qSnap.docs
      .filter((d: FirebaseFirestore.QueryDocumentSnapshot) =>
        isNotificationsPendingStatus(d.data().status)
      )
      .map((d: FirebaseFirestore.QueryDocumentSnapshot) => ({
        type: "quarantine",
        requestId: d.id,
        status: d.data().status,
        productName: String(d.data().productName ?? ""),
        quantity: inboundRequestQty(d.data()),
      }));
    quarantine = { count: items.length, items: items.slice(0, 25) };
  } catch {
    quarantine = { count: 0, items: [] };
  }

  let pendingReceive: { count: number; items: Array<Record<string, unknown>> } = { count: 0, items: [] };
  try {
    const snap = await db.collection(`users/${uid}/inventoryRequests`).get();
    const items = snap.docs
      .filter((d: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = d.data() as InventoryRequest;
        const batchId = String((data as InventoryRequest & { batchId?: string }).batchId ?? "");
        if (batchId && multiLineInboundBatchIds.has(batchId)) return false;
        return isPendingReceiveInventoryRequest(data);
      })
      .map((d: FirebaseFirestore.QueryDocumentSnapshot) => {
        const data = d.data() as InventoryRequest;
        return {
          type: "inbound_pending_receive",
          clientUserId: uid,
          requestId: d.id,
          status: data.status ?? "",
          fulfillmentStatus: data.fulfillmentStatus ?? null,
          productName: String(data.productName ?? (data as InventoryRequest & { newProductName?: string }).newProductName ?? ""),
          quantity: pendingReceiveRemainingQty(data),
        };
      })
      .filter((row) => Number(row.quantity) > 0);
    pendingReceive = { count: items.length, items: items.slice(0, 25) };
  } catch {
    pendingReceive = { count: 0, items: [] };
  }

  const totalPending =
    Number(inbound.count) +
    Number(inboundBatches.count) +
    Number(outbound.count) +
    Number(returns.count) +
    Number(dispose.count) +
    Number(disposeBatches.count) +
    Number(deletes.count) +
    Number(quarantine.count) +
    Number(refunds.count) +
    Number(topups.count) +
    Number(apiFees.count);

  return {
    clientUserId: uid,
    totalPending,
    pendingReceive,
    inbound,
    inboundBatches,
    outbound,
    returns,
    dispose,
    disposeBatches,
    deletes,
    quarantine,
    labelRefunds: refunds,
    labelTopups: topups,
    labelApiFees: apiFees,
    note:
      "totalPending matches Admin → Notifications → Pending tab (awaiting approval). pendingReceive is separate (approved inbound awaiting warehouse receive). Outbound quantity comes from shipment lines, not the parent doc. Notifications rows labeled Unknown are orphaned under a wrong user path.",
  };
}

const PENDING_ITEM_KEYS = [
  "inbound",
  "inboundBatches",
  "outbound",
  "returns",
  "dispose",
  "disposeBatches",
  "deletes",
  "quarantine",
  "labelRefunds",
  "labelTopups",
  "labelApiFees",
] as const;

function flattenPendingItems(pending: Record<string, unknown>, limit = 12): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const key of PENDING_ITEM_KEYS) {
    const block = pending[key] as { items?: Array<Record<string, unknown>> } | undefined;
    if (block?.items?.length) items.push(...block.items);
  }
  return items.slice(0, limit);
}

/** Platform-wide pending across all managed clients (matches Notifications → Pending tab). */
export async function lexiListAllPending(
  adminProfile: UserProfile
): Promise<Record<string, unknown>> {
  const clients = await loadManagedClientProfiles(adminProfile);
  const BATCH_SIZE = 8;
  const byClient: Array<{
    clientUserId: string;
    clientUserName: string;
    totalPending: number;
    pendingReceiveCount: number;
    items: Array<Record<string, unknown>>;
  }> = [];

  let grandTotalPending = 0;
  let grandPendingReceive = 0;

  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const chunk = clients.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      chunk.map(async (client) => {
        const uid = String(client.uid ?? "").trim();
        if (!uid) return null;
        const pending = await lexiListPending(adminProfile, uid);
        const totalPending = Number(pending.totalPending) || 0;
        const pendingReceiveCount = Number(
          (pending.pendingReceive as { count?: number } | undefined)?.count
        ) || 0;
        return {
          clientUserId: uid,
          clientUserName: displayName(client),
          totalPending,
          pendingReceiveCount,
          items: flattenPendingItems(pending),
        };
      })
    );

    for (const row of results) {
      if (!row) continue;
      grandTotalPending += row.totalPending;
      grandPendingReceive += row.pendingReceiveCount;
      if (row.totalPending > 0) {
        byClient.push(row);
      }
    }
  }

  byClient.sort((a, b) => b.totalPending - a.totalPending || a.clientUserName.localeCompare(b.clientUserName));

  return {
    grandTotalPending,
    grandPendingReceive,
    clientsWithPending: byClient.length,
    managedClientCount: clients.length,
    byClient: byClient.slice(0, 25),
    note:
      "grandTotalPending matches Admin → Notifications → Pending tab across all managed clients. pendingReceive is separate (Notifications → Pending receive). When grandTotalPending > 0, never say there are no pending requests. Use list_pending_requests for one client's full breakdown.",
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
