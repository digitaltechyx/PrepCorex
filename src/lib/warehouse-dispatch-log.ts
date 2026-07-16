import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { dateFromFirestore } from "@/lib/warehouse-stock-sort";
import type { UserProfile, WarehouseDoc } from "@/types";

const WAREHOUSES = "warehouses";

export type DispatchLogKind = "outbound" | "crossdock";

export type DispatchLogLine = {
  sku: string | null;
  productName: string;
  quantity: number;
  packOf?: number | null;
};

export type DispatchLogEntry = {
  id: string;
  kind: DispatchLogKind;
  dispatchedAt: Date | null;
  dispatcherId: string | null;
  dispatcherLabel: string | null;
  clientUserId: string | null;
  clientLabel: string | null;
  courierTracking: string | null;
  shipmentRequestId: string | null;
  unitCode: string | null;
  unitKind: string | null;
  qcUnitType: string | null;
  shippedQty: number | null;
  shipTo: string | null;
  shipFrom: string | null;
  service: string | null;
  lines: DispatchLogLine[];
  searchText: string;
};

function displayClient(client: UserProfile | undefined, userId: string | null): string | null {
  if (!userId) return null;
  if (!client) return userId.slice(0, 8);
  const name = client.name || client.email || userId;
  const cid = client.clientId ? ` (${client.clientId})` : "";
  return `${name}${cid}`;
}

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

function linesFromShipmentRequest(data: Record<string, unknown>): DispatchLogLine[] {
  const shipments = Array.isArray(data.shipments)
    ? (data.shipments as Array<Record<string, unknown>>)
    : [];
  return shipments.map((s) => {
    const qty = Math.max(0, Number(s.quantity) || 0);
    const packOf = Math.max(1, Number(s.packOf) || 1);
    return {
      sku: s.sku != null ? String(s.sku) : null,
      productName: String(s.productName ?? s.sku ?? "Product"),
      quantity: qty * packOf,
      packOf,
    };
  });
}

/**
 * Load recent warehouse dispatch events (outbound + cross-dock), newest first.
 * Enriches with shipment request contents when available.
 */
export async function loadDispatchLog(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  users?: UserProfile[];
  max?: number;
}): Promise<DispatchLogEntry[]> {
  const max = Math.max(20, Math.min(input.max ?? 200, 500));
  const eventsRef = collection(db, WAREHOUSES, input.warehouse.id, "movementEvents");

  const [outboundSnap, crossdockSnap] = await Promise.all([
    getDocs(query(eventsRef, where("type", "==", "dispatched"), limit(max))),
    getDocs(query(eventsRef, where("type", "==", "crossdock_dispatched"), limit(max))),
  ]);

  const clientById = new Map(input.clients.map((c) => [c.uid, c]));
  const users = input.users ?? input.clients;

  type RawEvent = {
    id: string;
    data: Record<string, unknown>;
    kind: DispatchLogKind;
  };

  const raw: RawEvent[] = [
    ...outboundSnap.docs.map((d) => ({
      id: d.id,
      data: d.data() as Record<string, unknown>,
      kind: "outbound" as const,
    })),
    ...crossdockSnap.docs.map((d) => ({
      id: d.id,
      data: d.data() as Record<string, unknown>,
      kind: "crossdock" as const,
    })),
  ];

  raw.sort((a, b) => {
    const at = dateFromFirestore(a.data.at)?.getTime() ?? 0;
    const bt = dateFromFirestore(b.data.at)?.getTime() ?? 0;
    return bt - at;
  });

  const sliced = raw.slice(0, max);

  const entries = await Promise.all(
    sliced.map(async (ev): Promise<DispatchLogEntry> => {
      const data = ev.data;
      const clientUserId =
        data.clientUserId != null ? String(data.clientUserId).trim() || null : null;
      const shipmentRequestId =
        data.shipmentRequestId != null
          ? String(data.shipmentRequestId).trim() || null
          : null;
      const dispatcherId =
        data.operatorId != null ? String(data.operatorId).trim() || null : null;
      const courierTracking =
        data.courierTracking != null
          ? String(data.courierTracking).trim() || null
          : null;
      const unitCode =
        data.crossdockUnitCode != null
          ? String(data.crossdockUnitCode).trim() || null
          : null;
      const unitKind =
        data.crossdockUnitKind != null
          ? String(data.crossdockUnitKind).trim() || null
          : null;
      const qcUnitType =
        data.qcUnitType != null ? String(data.qcUnitType).trim() || null : null;
      const shippedQty =
        data.shippedQty != null && Number.isFinite(Number(data.shippedQty))
          ? Number(data.shippedQty)
          : null;

      let lines: DispatchLogLine[] = [];
      let shipTo: string | null = null;
      let shipFrom: string | null = null;
      let service: string | null = null;

      if (clientUserId && shipmentRequestId) {
        try {
          const snap = await getDoc(
            doc(db, `users/${clientUserId}/shipmentRequests`, shipmentRequestId)
          );
          if (snap.exists()) {
            const req = snap.data() as Record<string, unknown>;
            lines = linesFromShipmentRequest(req);
            shipTo = req.shipTo != null ? String(req.shipTo) : null;
            shipFrom = req.shipFrom != null ? String(req.shipFrom) : null;
            service = req.service != null ? String(req.service) : null;
            if (!dispatcherId && req.warehouseDispatchedBy != null) {
              // prefer event operator; fallback already handled via dispatcherId
            }
          }
        } catch {
          // Detail enrichment is best-effort (permissions / missing docs).
        }
      }

      if (lines.length === 0 && unitCode) {
        lines = [
          {
            sku: null,
            productName: unitCode,
            quantity: shippedQty ?? 1,
          },
        ];
      }

      const clientLabel = displayClient(
        clientUserId ? clientById.get(clientUserId) : undefined,
        clientUserId
      );
      const dispatcherLabel = displayOperator(users, dispatcherId);

      const searchText = [
        clientLabel,
        dispatcherLabel,
        courierTracking,
        shipmentRequestId,
        unitCode,
        shipTo,
        shipFrom,
        service,
        ...lines.map((l) => `${l.sku ?? ""} ${l.productName}`),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return {
        id: ev.id,
        kind: ev.kind,
        dispatchedAt: dateFromFirestore(data.at),
        dispatcherId,
        dispatcherLabel,
        clientUserId,
        clientLabel,
        courierTracking,
        shipmentRequestId,
        unitCode,
        unitKind,
        qcUnitType,
        shippedQty,
        shipTo,
        shipFrom,
        service,
        lines,
        searchText,
      };
    })
  );

  return entries;
}

/** Count dispatches that happened today (local calendar day). */
export function countDispatchedToday(entries: DispatchLogEntry[]): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startMs = start.getTime();
  return entries.filter((e) => (e.dispatchedAt?.getTime() ?? 0) >= startMs).length;
}
