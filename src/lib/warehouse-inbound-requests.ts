import { collection, collectionGroup, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isActiveWarehouseCarton } from "@/lib/warehouse-carton-states";
import { listWarehouseCartons } from "@/lib/warehouse-carton-firestore";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import { normalizeReturnTracking } from "@/lib/return-tracking-client";
import { resolveInboundTrackings } from "@/lib/inbound-tracking";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import type { InventoryRequest, UserProfile, WarehouseCartonDoc, WarehouseDoc } from "@/types";

export type ReceivingScenario = "client_request" | "walk_in" | "mixed_pallet" | "damaged";

export type InboundRequestRow = InventoryRequest & {
  clientUserId: string;
  clientDisplayName: string;
  expectedQty: number;
  cartonReceivedQty: number;
  remainingQty: number;
};

/** Requests already fulfilled when admin approved and added client inventory (legacy path). */
export async function loadClientInventoryByUser(
  clientUserIds: string[]
): Promise<Map<string, Array<Record<string, unknown>>>> {
  const map = new Map<string, Array<Record<string, unknown>>>();
  await Promise.all(
    clientUserIds.map(async (uid) => {
      const snap = await getDocs(collection(db, "users", uid, "inventory"));
      map.set(
        uid,
        snap.docs.map((d) => ({ id: d.id, ...(d.data() as Record<string, unknown>) }))
      );
    })
  );
  return map;
}

export function isLegacyAdminFulfilledInboundRequest(input: {
  clientUserId: string;
  requestId: string;
  req: Omit<InventoryRequest, "id">;
  inventoryByUser: Map<string, Array<Record<string, unknown>>>;
}): boolean {
  const { clientUserId, requestId, req, inventoryByUser } = input;
  const inventory = inventoryByUser.get(clientUserId) ?? [];

  if (req.status !== "approved") return false;

  // Warehouse inbound v2: approved product requests stay open until putaway syncs stock.
  if (req.fulfillmentStatus === "open") return false;

  if (
    inventory.some(
      (inv) => String(inv.sourceRequestId ?? "").trim() === requestId
    )
  ) {
    return true;
  }

  const reqSku = (req.sku ?? "").trim().toLowerCase();
  const reqName = (req.productName ?? "").trim().toLowerCase();
  const expected = expectedQuantity({ ...req, id: requestId });

  return inventory.some((inv) => {
    const status = String(inv.status ?? "").toLowerCase();
    if (status === "out of stock" || status === "rejected") return false;
    const qty = typeof inv.quantity === "number" ? inv.quantity : 0;
    if (qty <= 0) return false;

    const invSku = String(inv.sku ?? inv.SKU ?? "")
      .trim()
      .toLowerCase();
    if (reqSku && invSku && reqSku === invSku) return true;

    const invName = String(inv.productName ?? "")
      .trim()
      .toLowerCase();
    if (reqName && invName && reqName === invName && qty >= expected) {
      return true;
    }
    return false;
  });
}

/** Warehouse dock: pending (needs review) + approved awaiting physical receive. */
function isAwaitingDockReceive(row: InboundRequestRow, legacyFulfilled: boolean): boolean {
  const status = String(row.status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (status === "rejected" || status === "cancelled") return false;
  // Pending always listed for dock review (match Notifications), even if qty is already 0.
  if (status === "pending") return true;
  if (status !== "approved") return false;
  if (row.remainingQty <= 0) return false;
  if (legacyFulfilled) return false;
  return true;
}

export function inboundRequestMatchesTracking(
  row: Pick<InventoryRequest, "inboundTrackings"> & { trackingNumber?: string; carrier?: string },
  trackingRaw: string
): boolean {
  const needle = normalizeReturnTracking(trackingRaw);
  if (!needle) return false;
  const trackings = resolveInboundTrackings(row);
  return trackings.some((t) => normalizeReturnTracking(t.trackingNumber) === needle);
}

function userIdFromDocPath(path: string): string {
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}

function displayClient(client: UserProfile | undefined, userId: string): string {
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

function expectedQuantity(req: InventoryRequest): number {
  if (typeof req.receivedQuantity === "number" && req.receivedQuantity > 0) {
    return req.receivedQuantity;
  }
  if (typeof req.requestedQuantity === "number" && req.requestedQuantity > 0) {
    return req.requestedQuantity;
  }
  return Math.max(0, req.quantity ?? 0);
}

/** Container handling is 1 unit; product qty inside must not zero-out remaining. */
function remainingInboundQty(
  data: Omit<InventoryRequest, "id">,
  cartonReceivedQty: number
): number {
  if (data.inventoryType === "container") {
    return data.fulfillmentStatus === "closed" ? 0 : Math.max(1, expectedQuantity({ ...data, id: "" }));
  }
  return Math.max(0, expectedQuantity({ ...data, id: "" }) - cartonReceivedQty);
}

/** Sum carton qty per inventory request id from an already-loaded carton list. */
export function buildCartonQtyByInventoryRequestId(
  cartons: WarehouseCartonDoc[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const c of cartons) {
    if (!isActiveWarehouseCarton(c)) continue;
    if (Array.isArray(c.lines) && c.lines.length > 0) {
      for (const l of c.lines) {
        const rid = (l.inventoryRequestId ?? "").trim();
        if (!rid) continue;
        map.set(rid, (map.get(rid) ?? 0) + Math.max(0, l.quantity));
      }
      continue;
    }
    const rid = c.inventoryRequestId?.trim();
    if (!rid) continue;
    map.set(rid, (map.get(rid) ?? 0) + Math.max(0, c.quantity));
  }
  return map;
}

/** Sum carton qty per inventory request id for a warehouse.
 *  Considers both the legacy root-level `inventoryRequestId` (single-SKU cartons)
 *  AND per-line allocations stamped during the new Receive → Allocate flow.
 */
export async function cartonQtyByInventoryRequestId(
  warehouseId: string
): Promise<Map<string, number>> {
  const cartons = await listWarehouseCartons(warehouseId);
  return buildCartonQtyByInventoryRequestId(cartons);
}

function inboundDockRowPassesFilters(input: {
  data: Omit<InventoryRequest, "id">;
  requestId: string;
  clientUserId: string;
  cartonReceivedQty: number;
  remainingQty: number;
  legacyFulfilled: boolean;
}): boolean {
  const { data, remainingQty, cartonReceivedQty, legacyFulfilled } = input;
  if (remainingQty <= 0) return false;

  const row = {
    ...data,
    id: input.requestId,
    clientUserId: input.clientUserId,
    clientDisplayName: "",
    expectedQty: 0,
    cartonReceivedQty,
    remainingQty,
  } satisfies InboundRequestRow;

  if (!isAwaitingDockReceive(row, legacyFulfilled)) return false;
  if (data.fulfillmentStatus === "closed") return false;
  if (data.status === "approved" && legacyFulfilled && cartonReceivedQty === 0) return false;
  if (data.fulfillmentStatus === "closed" && cartonReceivedQty === 0) return false;
  return true;
}

function inboundNeedsLegacyInventoryCheck(req: Omit<InventoryRequest, "id">): boolean {
  if (req.status !== "approved") return false;
  // Inbound v2 keeps requests open until warehouse receive — never legacy-fulfilled.
  if (req.fulfillmentStatus === "open") return false;
  return true;
}

/** Count approved inbound awaiting dock receive (dashboard metric). */
export async function countInboundDockQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons?: WarehouseCartonDoc[];
}): Promise<number> {
  const { warehouse, clients } = input;
  // Match Notifications / dock queue: all clients, not only warehouse-assigned.
  const eligibleClientIds = new Set(clients.map((c) => c.uid));

  const statuses = ["approved"];
  let docs: Array<{ id: string; data: () => Omit<InventoryRequest, "id">; ref: { path: string } }> = [];
  try {
    const snap = await getDocs(
      query(collectionGroup(db, "inventoryRequests"), where("status", "in", statuses))
    );
    docs = snap.docs as Array<{ id: string; data: () => Omit<InventoryRequest, "id">; ref: { path: string } }>;
  } catch {
    const eligible = Array.from(eligibleClientIds);
    const perUserSnaps = await Promise.all(
      eligible.map((uid) =>
        getDocs(
          query(
            collection(db, `users/${uid}/inventoryRequests`),
            where("status", "in", statuses)
          )
        )
      )
    );
    docs = perUserSnaps.flatMap((s) =>
      s.docs as Array<{ id: string; data: () => Omit<InventoryRequest, "id">; ref: { path: string } }>
    );
  }

  const cartonMap = input.cartons
    ? buildCartonQtyByInventoryRequestId(input.cartons)
    : await cartonQtyByInventoryRequestId(warehouse.id);

  type Candidate = {
    id: string;
    data: Omit<InventoryRequest, "id">;
    clientUserId: string;
    cartonReceivedQty: number;
    remainingQty: number;
    needsLegacy: boolean;
  };
  const candidates: Candidate[] = [];

  for (const d of docs) {
    const data = d.data() as Omit<InventoryRequest, "id">;
    if (data.inventoryType && data.inventoryType !== "product" && data.inventoryType !== "container") continue;

    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedQuantity({ ...data, id: d.id });
    const cartonReceivedQty = cartonMap.get(d.id) ?? 0;
    const remainingQty = remainingInboundQty(data, cartonReceivedQty);
    if (remainingQty <= 0) continue;

    candidates.push({
      id: d.id,
      data,
      clientUserId,
      cartonReceivedQty,
      remainingQty,
      needsLegacy: inboundNeedsLegacyInventoryCheck(data),
    });
  }

  const legacyClientIds = [
    ...new Set(candidates.filter((c) => c.needsLegacy).map((c) => c.clientUserId)),
  ];
  const inventoryByUser =
    legacyClientIds.length > 0
      ? await loadClientInventoryByUser(legacyClientIds)
      : new Map<string, Array<Record<string, unknown>>>();

  let count = 0;
  for (const c of candidates) {
    const legacyFulfilled = c.needsLegacy
      ? isLegacyAdminFulfilledInboundRequest({
          clientUserId: c.clientUserId,
          requestId: c.id,
          req: c.data,
          inventoryByUser,
        })
      : false;

    if (
      inboundDockRowPassesFilters({
        data: c.data,
        requestId: c.id,
        clientUserId: c.clientUserId,
        cartonReceivedQty: c.cartonReceivedQty,
        remainingQty: c.remainingQty,
        legacyFulfilled,
      })
    ) {
      count += 1;
    }
  }

  return count;
}

export async function loadInboundRequestQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  includePending?: boolean;
  /** Dock intake: pending + approved awaiting receive (with or without tracking). */
  dockQueue?: boolean;
}): Promise<InboundRequestRow[]> {
  const { warehouse, clients, dockQueue = false } = input;
  // Dock queue includes pending so warehouse ops can review/approve before receive.
  const includePending = dockQueue ? true : (input.includePending ?? true);
  const clientById = new Map(clients.map((c) => [c.uid, c]));
  // Dock: all clients (match Notifications). Other callers: warehouse-linked only.
  const eligibleClientIds = new Set(
    (dockQueue ? clients : clients.filter((c) => clientMatchesWarehouse(c, warehouse))).map(
      (c) => c.uid
    )
  );

  const statuses = includePending ? ["pending", "approved"] : ["approved"];
  let docs: Array<{ id: string; data: () => Omit<InventoryRequest, "id">; ref: { path: string } }> = [];
  try {
    const snap = await getDocs(
      query(collectionGroup(db, "inventoryRequests"), where("status", "in", statuses))
    );
    docs = snap.docs as Array<{ id: string; data: () => Omit<InventoryRequest, "id">; ref: { path: string } }>;
  } catch {
    // Fallback path when collection-group indexes are missing on a project.
    const eligible = Array.from(eligibleClientIds);
    const perUserSnaps = await Promise.all(
      eligible.map((uid) =>
        getDocs(
          query(
            collection(db, `users/${uid}/inventoryRequests`),
            where("status", "in", statuses)
          )
        )
      )
    );
    docs = perUserSnaps.flatMap((s) =>
      s.docs as Array<{ id: string; data: () => Omit<InventoryRequest, "id">; ref: { path: string } }>
    );
  }

  const cartonMap = await cartonQtyByInventoryRequestId(warehouse.id);
  const inventoryByUser = await loadClientInventoryByUser(Array.from(eligibleClientIds));

  const rows: InboundRequestRow[] = [];
  for (const d of docs) {
    const data = d.data() as Omit<InventoryRequest, "id">;
    if (data.inventoryType && data.inventoryType !== "product" && data.inventoryType !== "container") continue;

    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedQuantity({ ...data, id: d.id });
    const cartonReceivedQty = cartonMap.get(d.id) ?? 0;
    const remainingQty = remainingInboundQty(data, cartonReceivedQty);

    const legacyFulfilled = isLegacyAdminFulfilledInboundRequest({
      clientUserId,
      requestId: d.id,
      req: data,
      inventoryByUser,
    });

    const row: InboundRequestRow = {
      ...data,
      id: d.id,
      userId: clientUserId,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      expectedQty,
      cartonReceivedQty,
      remainingQty,
      inboundTrackings: resolveInboundTrackings(
        data as InventoryRequest & { trackingNumber?: string; carrier?: string }
      ),
    };

    if (dockQueue && !isAwaitingDockReceive(row, legacyFulfilled)) {
      continue;
    }

    if (dockQueue && data.fulfillmentStatus === "closed") {
      continue;
    }

    if (data.status === "approved" && legacyFulfilled && cartonReceivedQty === 0) {
      continue;
    }

    if (data.fulfillmentStatus === "closed" && cartonReceivedQty === 0) {
      continue;
    }

    rows.push(row);
  }

  return rows.sort((a, b) => {
    const at =
      (dateFromFirestore(a.requestedAt) ?? dateFromFirestore(a.addDate))?.getTime() ?? 0;
    const bt =
      (dateFromFirestore(b.requestedAt) ?? dateFromFirestore(b.addDate))?.getTime() ?? 0;
    if (at !== bt) return bt - at;
    return a.clientDisplayName.localeCompare(b.clientDisplayName);
  });
}

export function formatExpiryForInput(
  expiryDate: InventoryRequest["expiryDate"]
): string {
  if (!expiryDate) return "";
  if (typeof expiryDate === "string") return expiryDate.slice(0, 10);
  if (expiryDate instanceof Date) return expiryDate.toISOString().slice(0, 10);
  if (typeof expiryDate === "object" && "seconds" in expiryDate) {
    return new Date(expiryDate.seconds * 1000).toISOString().slice(0, 10);
  }
  return "";
}
