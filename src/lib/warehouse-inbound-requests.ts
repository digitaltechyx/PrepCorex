import { collection, collectionGroup, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { listWarehouseCartons } from "@/lib/warehouse-carton-firestore";
import type { InventoryRequest, UserProfile, WarehouseDoc } from "@/types";

export type ReceivingScenario = "client_request" | "walk_in" | "mixed_pallet" | "damaged";

export type InboundRequestRow = InventoryRequest & {
  clientUserId: string;
  clientDisplayName: string;
  expectedQty: number;
  cartonReceivedQty: number;
  remainingQty: number;
};

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

/** Sum carton qty per inventory request id for a warehouse.
 *  Considers both the legacy root-level `inventoryRequestId` (single-SKU cartons)
 *  AND per-line allocations stamped during the new Receive → Allocate flow.
 */
export async function cartonQtyByInventoryRequestId(
  warehouseId: string
): Promise<Map<string, number>> {
  const cartons = await listWarehouseCartons(warehouseId);
  const map = new Map<string, number>();
  for (const c of cartons) {
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

export async function loadInboundRequestQueue(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  includePending?: boolean;
}): Promise<InboundRequestRow[]> {
  const { warehouse, clients, includePending = true } = input;
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

  const rows: InboundRequestRow[] = [];
  for (const d of docs) {
    const data = d.data() as Omit<InventoryRequest, "id">;
    if (data.inventoryType && data.inventoryType !== "product") continue;

    const clientUserId = userIdFromDocPath(d.ref.path);
    if (!clientUserId || !eligibleClientIds.has(clientUserId)) continue;

    const expectedQty = expectedQuantity({ ...data, id: d.id });
    const cartonReceivedQty = cartonMap.get(d.id) ?? 0;
    const remainingQty = Math.max(0, expectedQty - cartonReceivedQty);

    rows.push({
      ...data,
      id: d.id,
      userId: clientUserId,
      clientUserId,
      clientDisplayName: displayClient(clientById.get(clientUserId), clientUserId),
      expectedQty,
      cartonReceivedQty,
      remainingQty,
    });
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
