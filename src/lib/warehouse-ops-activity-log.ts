import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import type { UserProfile, WarehouseDoc } from "@/types";

const WAREHOUSES = "warehouses";

/** Event types written by each warehouse-ops module. */
export const OPS_LOG_EVENT_TYPES = {
  putaway: ["putaway"],
  pick: ["pick"],
  pack: ["dispatch", "crossdock_pack_complete", "dispatch_qc_return", "return_pack_complete"],
  quarantine: [
    "quarantine_release",
    "quarantine_return_putaway",
    "quarantine_return_pack",
    "quarantine_dispose",
    "quarantine_auto_dispose",
  ],
  returns: [
    "return_receive",
    "return_qc_restock",
    "return_qc_damaged",
    "return_qc_dispose",
    "unallocated_return_to_pack",
  ],
  move: ["move", "area_move"],
  cycle_count: ["cycle_count", "cycle_count_resolve"],
} as const;

export type OpsLogModule = keyof typeof OPS_LOG_EVENT_TYPES;

export type OpsActivityLogEntry = {
  id: string;
  type: string;
  typeLabel: string;
  at: Date | null;
  operatorId: string | null;
  operatorLabel: string | null;
  clientUserId: string | null;
  clientLabel: string | null;
  sku: string | null;
  cartonCode: string | null;
  productReturnId: string | null;
  condition: string | null;
  quantity: number | null;
  tracking: string | null;
  summary: string;
  details: Array<{ label: string; value: string }>;
  searchText: string;
  raw: Record<string, unknown>;
};

const TYPE_LABELS: Record<string, string> = {
  putaway: "Putaway",
  pick: "Pick",
  dispatch: "Pack complete",
  crossdock_pack_complete: "Cross-dock pack",
  dispatch_qc_return: "QC return to pack",
  return_pack_complete: "Return pack",
  quarantine_release: "Released (stowed)",
  quarantine_return_putaway: "Return → Putaway",
  quarantine_return_pack: "Send to Pack",
  quarantine_dispose: "Dispose",
  quarantine_auto_dispose: "Auto-dispose",
  return_receive: "Return receive",
  return_qc_restock: "QC restock",
  return_qc_damaged: "QC damaged",
  return_qc_dispose: "QC dispose",
  unallocated_return_to_pack: "Unallocated → Pack",
  move: "Bin move",
  area_move: "Area move",
  cycle_count: "Cycle count",
  cycle_count_resolve: "Variance resolve",
};

function displayOperator(
  users: UserProfile[],
  raw: string | null | undefined
): string | null {
  const value = raw?.trim();
  if (!value) return null;
  const byUid = users.find((u) => u.uid === value);
  if (byUid) return byUid.name || byUid.email || value;
  const byNameOrEmail = users.find((u) => u.name === value || u.email === value);
  if (byNameOrEmail) return byNameOrEmail.name || byNameOrEmail.email || value;
  return value;
}

function str(data: Record<string, unknown>, key: string): string | null {
  const v = data[key];
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function num(data: Record<string, unknown>, key: string): number | null {
  const v = data[key];
  if (v == null || !Number.isFinite(Number(v))) return null;
  return Number(v);
}

function displayClient(
  users: UserProfile[],
  userId: string | null | undefined
): string | null {
  const id = userId?.trim();
  if (!id) return null;
  const u = users.find((x) => x.uid === id);
  if (!u) return id.slice(0, 8);
  const name = u.name || u.email || id;
  return u.clientId ? `${name} (${u.clientId})` : name;
}

function buildSummary(type: string, data: Record<string, unknown>): string {
  const carton = str(data, "cartonCode") ?? str(data, "crossdockUnitCode");
  const sku = str(data, "sku");
  const qty = num(data, "quantity") ?? num(data, "shippedQty");
  const toBin = str(data, "toBinPath") ?? str(data, "toBinId");
  const fromBin = str(data, "fromBinPath") ?? str(data, "fromBinId");
  const toArea = str(data, "toArea") ?? str(data, "stagingArea") ?? str(data, "toStagingArea");
  const fromArea = str(data, "fromArea") ?? str(data, "fromStagingArea");
  const binPath = str(data, "binPath");
  const tracking = str(data, "courierTracking") ?? str(data, "trackingNumber");

  const parts: string[] = [];
  if (carton) parts.push(carton);
  if (sku) parts.push(sku);
  if (qty != null) parts.push(`${qty} units`);
  if (fromBin && toBin) parts.push(`${fromBin} → ${toBin}`);
  else if (toBin) parts.push(`→ ${toBin}`);
  else if (fromBin) parts.push(`from ${fromBin}`);
  if (fromArea && toArea) parts.push(`${fromArea} → ${toArea}`);
  else if (toArea) parts.push(`area ${toArea}`);
  if (binPath) parts.push(binPath);
  if (tracking) parts.push(tracking);
  if (data.hasVariance === true) parts.push("variance");

  if (parts.length > 0) return parts.join(" · ");
  return TYPE_LABELS[type] ?? type;
}

function buildDetails(data: Record<string, unknown>): Array<{ label: string; value: string }> {
  const pairs: Array<[string, string | null]> = [
    ["Carton / unit", str(data, "cartonCode") ?? str(data, "crossdockUnitCode")],
    ["SKU", str(data, "sku")],
    ["Quantity", num(data, "quantity") != null ? String(num(data, "quantity")) : null],
    ["Condition", str(data, "condition")],
    ["Lot", str(data, "lot")],
    ["From bin", str(data, "fromBinPath") ?? str(data, "fromBinId")],
    ["To bin", str(data, "toBinPath") ?? str(data, "toBinId")],
    ["From area", str(data, "fromArea") ?? str(data, "fromStagingArea")],
    ["To area", str(data, "toArea") ?? str(data, "toStagingArea") ?? str(data, "stagingArea")],
    ["Bin", str(data, "binPath") ?? str(data, "binId")],
    ["Tracking", str(data, "courierTracking") ?? str(data, "trackingNumber")],
    ["Client", str(data, "clientUserId")],
    ["Order", str(data, "shipmentRequestId")],
    ["Return ID", str(data, "productReturnId")],
    ["Task", str(data, "taskId")],
    ["Putaway mode", str(data, "putawayMode")],
    ["QC unit", str(data, "qcUnitType")],
  ];

  const out: Array<{ label: string; value: string }> = [];
  for (const [label, value] of pairs) {
    if (value) out.push({ label, value });
  }

  if (data.hasVariance === true) {
    out.push({ label: "Variance", value: "Yes" });
  }

  const counted = data.countedLines;
  if (Array.isArray(counted) && counted.length > 0) {
    out.push({
      label: "Counted lines",
      value: counted
        .map((l) => {
          const row = l as Record<string, unknown>;
          const sku = row.sku != null ? String(row.sku) : "?";
          const expected = row.expectedQty ?? "?";
          const countedQty = row.countedQty ?? "?";
          return `${sku}: ${countedQty}/${expected}`;
        })
        .join(" · "),
    });
  }

  return out;
}

/**
 * Load warehouse movementEvents for a module, newest first.
 * Firestore `in` supports up to 30 values; our modules use far fewer.
 */
export async function loadOpsActivityLog(input: {
  warehouse: WarehouseDoc;
  eventTypes: readonly string[];
  users?: UserProfile[];
  max?: number;
  /** When set, only events linked to this product return. */
  productReturnId?: string | null;
}): Promise<OpsActivityLogEntry[]> {
  const types = [...new Set(input.eventTypes.filter(Boolean))];
  if (types.length === 0) return [];

  const max = Math.max(20, Math.min(input.max ?? 200, 500));
  const eventsRef = collection(db, WAREHOUSES, input.warehouse.id, "movementEvents");
  const users = input.users ?? [];
  const returnFilter = input.productReturnId?.trim() || null;

  // Firestore `in` max 30; chunk if needed (unlikely for our modules).
  const chunks: string[][] = [];
  for (let i = 0; i < types.length; i += 10) {
    chunks.push(types.slice(i, i + 10));
  }

  const snaps = await Promise.all(
    chunks.map((chunk) =>
      getDocs(query(eventsRef, where("type", "in", chunk), limit(max)))
    )
  );

  const seen = new Set<string>();
  const rows: OpsActivityLogEntry[] = [];

  for (const snap of snaps) {
    for (const d of snap.docs) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      const data = d.data() as Record<string, unknown>;
      const productReturnId = str(data, "productReturnId");
      if (returnFilter && productReturnId !== returnFilter) continue;

      const type = str(data, "type") ?? "unknown";
      const operatorId = str(data, "operatorId") ?? str(data, "receivedBy");
      const operatorLabel = displayOperator(users, operatorId);
      const clientUserId = str(data, "clientUserId") ?? str(data, "clientId");
      const clientLabel = displayClient(users, clientUserId);
      const sku = str(data, "sku");
      const cartonCode =
        str(data, "cartonCode") ?? str(data, "crossdockUnitCode") ?? str(data, "palletCode");
      const condition = str(data, "condition");
      const quantity = num(data, "quantity") ?? num(data, "shippedQty");
      const tracking = str(data, "courierTracking") ?? str(data, "trackingNumber");
      const summary = buildSummary(type, data);
      const details = buildDetails(data);
      const typeLabel = TYPE_LABELS[type] ?? type.replace(/_/g, " ");

      const searchText = [
        typeLabel,
        summary,
        operatorLabel,
        clientLabel,
        sku,
        cartonCode,
        productReturnId,
        tracking,
        condition,
        ...details.map((x) => x.value),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      rows.push({
        id: d.id,
        type,
        typeLabel,
        at: dateFromFirestore(data.at) ?? dateFromFirestore(data.createdAt),
        operatorId,
        operatorLabel,
        clientUserId,
        clientLabel,
        sku,
        cartonCode,
        productReturnId,
        condition,
        quantity,
        tracking,
        summary,
        details,
        searchText,
        raw: data,
      });
    }
  }

  rows.sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0));
  return rows.slice(0, max);
}

export function eventTypesForModule(module: OpsLogModule): readonly string[] {
  return OPS_LOG_EVENT_TYPES[module];
}
