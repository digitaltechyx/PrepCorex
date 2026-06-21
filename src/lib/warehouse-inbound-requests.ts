import { collection, collectionGroup, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isActiveWarehouseCarton } from "@/lib/warehouse-carton-states";
import { listWarehouseCartons } from "@/lib/warehouse-carton-firestore";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import { normalizeReturnTracking } from "@/lib/return-tracking-client";
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

/** Warehouse dock should only show requests that need physical receive (not admin-notifications queue). */
function isAwaitingDockReceive(row: InboundRequestRow, legacyFulfilled: boolean): boolean {
  if (row.remainingQty <= 0) return false;
  // Pending → admin notifications only; not dock receive yet.
  if (row.status === "pending") return false;
  if (row.status !== "approved") return false;
  if (legacyFulfilled) return false;
  const hasTracking = (row.inboundTrackings ?? []).length > 0;
  const warehouseStarted = row.cartonReceivedQty > 0;
  return hasTracking || warehouseStarted;
}

export function inboundRequestMatchesTracking(
  row: Pick<InventoryRequest, "inboundTrackings">,
  trackingRaw: string
): boolean {
  const needle = normalizeReturnTracking(trackingRaw);
  if (!needle) return false;
  const trackings = row.inboundTrackings ?? [];
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

/** Count approved inbound awaiting dock receive (dashboard metric). */
export async function countInboundDockQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons?: WarehouseCartonDoc[];
}): Promise<number> {
  const { warehouse, clients } = input;
  const eligibleClientIds = new Set(
    clients.filter((c) => clientMatchesWarehouse(c, warehouse)).map((c) => c.uid)
  );

  const statuses = ["approved"];
  let docs: Array<{ id: string; data: () => Omit<InventoryRequest, "id">; ref: { path: string } }> = [];
  const inventoryPromise = loadClientInventoryByUser(Array.from(eligibleClientIds));
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

  const [cartonMap, inventoryByUser] = await Promise.all([
    input.cartons
      ? Promise.resolve(buildCartonQtyByInventoryRequestId(input.cartons))
      : cartonQtyByInventoryRequestId(warehouse.id),
    inventoryPromise,
  ]);

  let count = 0;
  for (const d of docs) {
    const data = d.data() as Omit<InventoryRequest, "id">;
    if (data.inventoryType && data.inventoryType !== "product") continue;

    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedQuantity({ ...data, id: d.id });
    const cartonReceivedQty = cartonMap.get(d.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - cartonReceivedQty);
    const legacyFulfilled = isLegacyAdminFulfilledInboundRequest({
      clientUserId,
      requestId: d.id,
      req: data,
      inventoryByUser,
    });

    if (
      inboundDockRowPassesFilters({
        data,
        requestId: d.id,
        clientUserId,
        cartonReceivedQty,
        remainingQty,
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
  /** Dock intake: approved + tracking (or receive started), excludes legacy admin-fulfilled stock. */
  dockQueue?: boolean;
}): Promise<InboundRequestRow[]> {
  const { warehouse, clients, dockQueue = false } = input;
  const includePending = dockQueue ? false : (input.includePending ?? true);
  const clientById = new Map(clients.map((c) => [c.uid, c]));
  const eligibleClientIds = new Set(
    clients.filter((c) => clientMatchesWarehouse(c, warehouse)).map((c) => c.uid)
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
    if (data.inventoryType && data.inventoryType !== "product") continue;

    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedQuantity({ ...data, id: d.id });
    const cartonReceivedQty = cartonMap.get(d.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - cartonReceivedQty);

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
    if (a.remainingQty > 0 !== b.remainingQty > 0) {
      return a.remainingQty > 0 ? -1 : 1;
    }
    if (a.status !== b.status) {
      if (a.status === "pending") return -1;
      if (b.status === "pending") return 1;
    }
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
