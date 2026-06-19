import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  listWarehouseCartons,
  warehouseCartonDocRef,
} from "@/lib/warehouse-carton-firestore";
import type {
  InventoryRequest,
  UserProfile,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";
import {
  describeProductLineLocation,
  locationKindMatchesStage,
  matchesProductSearchQuery,
  type ProductLocationKind,
} from "@/lib/warehouse-product-location";

const WAREHOUSES = "warehouses";

export type UnallocatedLine = {
  warehouseId: string;
  cartonId: string;
  cartonCode: string;
  palletId: string | null;
  /** Client captured at receive (carton root), before line allocation */
  cartonClientId: string | null;
  cartonClientLabel: string | null;
  line: WarehouseCartonLine;
  binId: string | null;
  binPath: string | null;
  receivedAt: Date | null;
  ageDays: number | null;
};

export type OpenInventoryRequest = InventoryRequest & {
  clientUserId: string;
  clientDisplayName: string;
  expectedQty: number;
  allocatedQty: number;
  remainingQty: number;
  /** Lines allocated to this request (across all cartons). */
  allocations: Array<{ cartonId: string; cartonCode: string; lineId: string; sku: string; quantity: number }>;
};

function dateFromTs(ts: unknown): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof ts === "object" && ts && "seconds" in (ts as Record<string, unknown>)) {
    const s = (ts as { seconds: number }).seconds;
    return new Date(s * 1000);
  }
  return null;
}

function ageInDays(d: Date | null): number | null {
  if (!d) return null;
  const ms = Date.now() - d.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function userIdFromDocPath(path: string): string {
  const parts = path.split("/");
  const idx = parts.indexOf("users");
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : "";
}

function clientMatchesWarehouse(client: UserProfile, warehouse: WarehouseDoc): boolean {
  const linked = String(warehouse.linkedLocationId ?? "").trim();
  if (!linked) return true;
  const locs = Array.isArray(client.locations) ? client.locations : [];
  return locs.map(String).includes(linked);
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

/** Build a bin id → path map for one warehouse. */
async function getBinPathMap(warehouseId: string): Promise<Map<string, string>> {
  const snap = await getDocs(collection(db, WAREHOUSES, warehouseId, "bins"));
  const map = new Map<string, string>();
  for (const d of snap.docs) {
    const data = d.data() as { path?: string };
    if (data.path) map.set(d.id, String(data.path));
  }
  return map;
}

/**
 * Walks every line of every carton in a warehouse and returns:
 *   - unallocatedLines: lines whose allocationStatus is "unallocated" and which
 *     have a binId (i.e. already stowed) or are still in staging (binId = null).
 *   - perRequest: a map from inventoryRequestId → list of allocated lines.
 */
export async function loadAllocateData(
  warehouse: WarehouseDoc
): Promise<{
  unallocatedLines: UnallocatedLine[];
  allCartons: WarehouseCartonDoc[];
  binPathById: Map<string, string>;
}> {
  const cartons = await listWarehouseCartons(warehouse.id);
  const binPath = await getBinPathMap(warehouse.id);
  const unallocatedLines: UnallocatedLine[] = [];

  for (const c of cartons) {
    if (c.status === "closed") continue;
    const lines = c.lines && c.lines.length > 0
      ? c.lines
      : [
          {
            lineId: "L1",
            sku: c.sku,
            productTitle: c.productTitle ?? null,
            quantity: c.quantity,
            lot: c.lot ?? null,
            expiry: c.expiry ?? null,
            condition: (c.status === "damaged" ? "damaged" : "good") as "good" | "damaged",
            binId: c.binId ?? null,
            allocationStatus: c.clientId ? "allocated" : ("unallocated" as const),
            clientId: c.clientId ?? null,
            inventoryRequestId: c.inventoryRequestId ?? null,
          } satisfies WarehouseCartonLine,
        ];

    const receivedAt = dateFromTs(c.receivedAt) ?? dateFromTs(c.createdAt);
    const age = ageInDays(receivedAt);

    for (const l of lines) {
      if (l.allocationStatus === "allocated" || l.allocationStatus === "picked") continue;
      unallocatedLines.push({
        warehouseId: warehouse.id,
        cartonId: c.id,
        cartonCode: c.cartonCode,
        palletId: c.palletId ?? null,
        cartonClientId: c.clientId ?? null,
        cartonClientLabel: c.receivedForClient?.trim() || null,
        line: l,
        binId: l.binId ?? null,
        binPath: l.binId ? binPath.get(l.binId) ?? null : null,
        receivedAt,
        ageDays: age,
      });
    }
  }

  unallocatedLines.sort((a, b) => {
    const aAge = a.ageDays ?? 0;
    const bAge = b.ageDays ?? 0;
    if (aAge !== bAge) return bAge - aAge;
    return a.cartonCode.localeCompare(b.cartonCode);
  });

  return { unallocatedLines, allCartons: cartons, binPathById: binPath };
}

/** Load all open inventory requests across all clients tied to this warehouse. */
export async function loadOpenRequests(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
}): Promise<OpenInventoryRequest[]> {
  const { warehouse, clients } = input;
  const clientById = new Map(clients.map((c) => [c.uid, c]));
  const eligibleClientIds = new Set(
    clients.filter((c) => clientMatchesWarehouse(c, warehouse)).map((c) => c.uid)
  );

  type RequestDoc = {
    id: string;
    data: () => Omit<InventoryRequest, "id">;
    ref: { path: string };
  };
  let docs: RequestDoc[] = [];
  try {
    const snap = await getDocs(
      query(
        collectionGroup(db, "inventoryRequests"),
        where("status", "in", ["pending", "approved"])
      )
    );
    docs = snap.docs as unknown as RequestDoc[];
  } catch {
    const eligible = Array.from(eligibleClientIds);
    const perUserSnaps = await Promise.all(
      eligible.map((uid) =>
        getDocs(
          query(
            collection(db, `users/${uid}/inventoryRequests`),
            where("status", "in", ["pending", "approved"])
          )
        )
      )
    );
    docs = perUserSnaps.flatMap((s) => s.docs as unknown as RequestDoc[]);
  }

  // Aggregate allocations from cartons
  const cartons = await listWarehouseCartons(warehouse.id);
  const allocByReq = new Map<
    string,
    Array<{ cartonId: string; cartonCode: string; lineId: string; sku: string; quantity: number }>
  >();
  for (const c of cartons) {
    const lines = c.lines ?? [];
    for (const l of lines) {
      if (l.allocationStatus === "allocated" && l.inventoryRequestId) {
        const arr = allocByReq.get(l.inventoryRequestId) ?? [];
        arr.push({
          cartonId: c.id,
          cartonCode: c.cartonCode,
          lineId: l.lineId,
          sku: l.sku,
          quantity: l.quantity,
        });
        allocByReq.set(l.inventoryRequestId, arr);
      }
    }
  }

  const rows: OpenInventoryRequest[] = [];
  for (const d of docs) {
    const data = d.data() as Omit<InventoryRequest, "id">;
    if (data.inventoryType && data.inventoryType !== "product") continue;
    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedQuantity({ ...data, id: d.id });
    const allocations = allocByReq.get(d.id) ?? [];
    const allocatedQty = allocations.reduce((s, a) => s + a.quantity, 0);
    const remainingQty = Math.max(0, expectedQty - allocatedQty);

    rows.push({
      ...data,
      id: d.id,
      userId: clientUserId,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      expectedQty,
      allocatedQty,
      remainingQty,
      allocations,
    });
  }

  rows.sort((a, b) => {
    if (a.remainingQty > 0 !== b.remainingQty > 0) {
      return a.remainingQty > 0 ? -1 : 1;
    }
    if (a.status !== b.status) {
      if (a.status === "pending") return -1;
      if (b.status === "pending") return 1;
    }
    return a.clientDisplayName.localeCompare(b.clientDisplayName);
  });

  return rows;
}

/**
 * Allocate one unallocated line to a (client, optional request).
 *
 * - If `inventoryRequestId` is provided, also stamps it on the line so we can
 *   reconcile "request → allocated lines".
 * - If `inventoryRequestId` is omitted, this is a "restock" → the line is
 *   reserved to the client without tying to a specific request.
 */
export async function allocateLine(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  clientId: string;
  inventoryRequestId?: string | null;
  operatorId?: string | null;
  /** Free-text note when SKUs don't match. */
  overrideReason?: string | null;
}): Promise<void> {
  const cartonRef = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(cartonRef);
  if (!snap.exists()) throw new Error("Carton not found.");
  const data = snap.data() as Record<string, unknown>;
  const linesRaw = Array.isArray(data.lines) ? (data.lines as Array<Record<string, unknown>>) : [];
  if (linesRaw.length === 0) throw new Error("Carton has no line-aware data.");

  let touched = false;
  const nextLines = linesRaw.map((l) => {
    if (l.lineId !== input.lineId) return l;
    if (l.allocationStatus === "picked") {
      throw new Error("Cannot allocate a picked line.");
    }
    touched = true;
    return {
      ...l,
      allocationStatus: "allocated",
      clientId: input.clientId,
      inventoryRequestId: input.inventoryRequestId ?? null,
    };
  });
  if (!touched) throw new Error("Line not found in carton.");

  // Update root clientId only when all (non-damaged) lines are allocated to a single client.
  const distinctClients = new Set<string>();
  for (const l of nextLines) {
    if (typeof l.clientId === "string" && l.clientId) distinctClients.add(l.clientId);
  }
  const rootClientId = distinctClients.size === 1 ? Array.from(distinctClients)[0] : null;

  const batch = writeBatch(db);
  batch.update(cartonRef, {
    lines: nextLines,
    clientId: rootClientId,
    inventoryRequestId: input.inventoryRequestId ?? null,
    updatedAt: serverTimestamp(),
  });

  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: input.inventoryRequestId ? "allocate" : "restock_allocate",
    cartonId: input.cartonId,
    cartonCode: String(data.cartonCode ?? ""),
    lineId: input.lineId,
    clientId: input.clientId,
    inventoryRequestId: input.inventoryRequestId ?? null,
    overrideReason: input.overrideReason ?? null,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });

  await batch.commit();
}

/** Un-allocate a previously-allocated line (admin only). */
export async function unallocateLine(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  operatorId?: string | null;
}): Promise<void> {
  const cartonRef = warehouseCartonDocRef(input.warehouseId, input.cartonId);
  const snap = await getDoc(cartonRef);
  if (!snap.exists()) throw new Error("Carton not found.");
  const data = snap.data() as Record<string, unknown>;
  const linesRaw = Array.isArray(data.lines) ? (data.lines as Array<Record<string, unknown>>) : [];

  let touched = false;
  const nextLines = linesRaw.map((l) => {
    if (l.lineId !== input.lineId) return l;
    if (l.allocationStatus === "picked") {
      throw new Error("Cannot un-allocate a picked line.");
    }
    touched = true;
    return {
      ...l,
      allocationStatus: "unallocated",
      clientId: null,
      inventoryRequestId: null,
    };
  });
  if (!touched) throw new Error("Line not found.");

  const distinctClients = new Set<string>();
  for (const l of nextLines) {
    if (typeof l.clientId === "string" && l.clientId) distinctClients.add(l.clientId);
  }
  const rootClientId = distinctClients.size === 1 ? Array.from(distinctClients)[0] : null;

  const batch = writeBatch(db);
  batch.update(cartonRef, {
    lines: nextLines,
    clientId: rootClientId,
    updatedAt: serverTimestamp(),
  });
  const eventsRef = collection(db, WAREHOUSES, input.warehouseId, "movementEvents");
  batch.set(doc(eventsRef), {
    type: "unallocate",
    cartonId: input.cartonId,
    cartonCode: String(data.cartonCode ?? ""),
    lineId: input.lineId,
    operatorId: input.operatorId ?? null,
    at: serverTimestamp(),
  });
  await batch.commit();
}

/** Build aging buckets for display (0-7d, 8-30d, 30+d). */
export type AgingBucket = "fresh" | "aging" | "stale";
export function agingBucket(days: number | null): AgingBucket {
  if (days == null) return "fresh";
  if (days <= 7) return "fresh";
  if (days <= 30) return "aging";
  return "stale";
}

export type InventorySearchFilters = {
  /** Matches SKU, product title, carton code, bin path, or location label. */
  query?: string;
  sku?: string;
  clientId?: string;
  cartonCode?: string;
  inventoryRequestId?: string;
  binPath?: string;
  condition?: "good" | "damaged" | "all";
  status?: "unallocated" | "allocated" | "picked" | "any";
  locationStage?: "all" | "receiving" | "bin" | "area" | "picked" | "quarantine" | "pack";
};

export type InventorySearchRow = {
  warehouseId: string;
  cartonId: string;
  cartonCode: string;
  cartonStatus: WarehouseCartonDoc["status"];
  palletId: string | null;
  line: WarehouseCartonLine;
  productTitle: string | null;
  binPath: string | null;
  stagingArea: string | null;
  locationLabel: string;
  locationKind: ProductLocationKind;
  receivedAt: Date | null;
  ageDays: number | null;
};

/** Free-form inventory search across all line items in a warehouse. */
export async function searchInventory(
  warehouse: WarehouseDoc,
  filters: InventorySearchFilters
): Promise<InventorySearchRow[]> {
  const cartons = await listWarehouseCartons(warehouse.id);
  const binPath = await getBinPathMap(warehouse.id);
  const out: InventorySearchRow[] = [];

  const skuQ = filters.sku?.trim().toUpperCase();
  const queryQ = filters.query?.trim() ?? "";
  const ccQ = filters.cartonCode?.trim().toUpperCase();
  const reqQ = filters.inventoryRequestId?.trim();
  const cliQ = filters.clientId?.trim();
  const binQ = filters.binPath?.trim().toUpperCase();
  const cond = filters.condition ?? "all";
  const status = filters.status ?? "any";
  const locationStage = filters.locationStage ?? "all";

  for (const c of cartons) {
    if (c.status === "closed") continue;
    if (ccQ && !c.cartonCode.toUpperCase().includes(ccQ)) continue;
    const receivedAt = dateFromTs(c.receivedAt) ?? dateFromTs(c.createdAt);
    const lines = c.lines && c.lines.length > 0
      ? c.lines
      : [
          {
            lineId: "L1",
            sku: c.sku,
            productTitle: c.productTitle ?? null,
            quantity: c.quantity,
            lot: c.lot ?? null,
            expiry: c.expiry ?? null,
            condition: (c.status === "damaged" ? "damaged" : "good") as "good" | "damaged",
            binId: c.binId ?? null,
            allocationStatus: c.clientId ? "allocated" : ("unallocated" as const),
            clientId: c.clientId ?? null,
            inventoryRequestId: c.inventoryRequestId ?? null,
          } satisfies WarehouseCartonLine,
        ];
    for (const l of lines) {
      if (skuQ && !l.sku.toUpperCase().includes(skuQ)) continue;
      if (reqQ && (l.inventoryRequestId ?? "") !== reqQ) continue;
      if (cliQ && (l.clientId ?? "") !== cliQ) continue;
      if (cond !== "all" && l.condition !== cond) continue;
      if (status !== "any") {
        const lineStatus = l.allocationStatus ?? "unallocated";
        if (lineStatus !== status) continue;
      }
      const binP = l.binId ? binPath.get(l.binId) ?? null : null;
      const loc = describeProductLineLocation({ line: l, carton: c, binPath: binP });

      if (binQ) {
        const binHay = [binP ?? "", loc.stagingArea ?? "", loc.label]
          .join(" ")
          .toUpperCase();
        if (!binHay.includes(binQ)) continue;
      }

      if (!locationKindMatchesStage(loc.kind, locationStage)) continue;

      const productTitle = l.productTitle?.trim() || c.productTitle?.trim() || null;

      if (
        queryQ &&
        !matchesProductSearchQuery({
          query: queryQ,
          sku: l.sku,
          productTitle,
          cartonCode: c.cartonCode,
          binPath: binP,
          locationLabel: loc.label,
        })
      ) {
        continue;
      }

      out.push({
        warehouseId: warehouse.id,
        cartonId: c.id,
        cartonCode: c.cartonCode,
        cartonStatus: c.status,
        palletId: c.palletId ?? null,
        line: l,
        productTitle,
        binPath: binP,
        stagingArea: loc.stagingArea,
        locationLabel: loc.label,
        locationKind: loc.kind,
        receivedAt,
        ageDays: ageInDays(receivedAt),
      });
    }
  }

  out.sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  return out;
}
