import { Timestamp, doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  ProductReturn,
  ReturnArrival,
  ReturnArrivalStatus,
  ReturnArrivalUnitType,
} from "@/types";

export function createReturnArrivalId(): string {
  return `arr_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeReturnArrivals(raw: unknown): ReturnArrival[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      const unitType = String(row.unitType || "carton") as ReturnArrivalUnitType;
      const status = String(row.status || "arrived") as ReturnArrivalStatus;
      return {
        id: String(row.id || createReturnArrivalId()),
        trackingNumber: String(row.trackingNumber || "").trim(),
        unitType:
          unitType === "pallet" || unitType === "package" ? unitType : "carton",
        status:
          status === "opened" || status === "received" ? status : "arrived",
        arrivedAt: row.arrivedAt as ReturnArrival["arrivedAt"],
        arrivedBy: row.arrivedBy ? String(row.arrivedBy) : undefined,
        openedAt: row.openedAt as ReturnArrival["openedAt"],
        openedBy: row.openedBy ? String(row.openedBy) : undefined,
        receivedAt: row.receivedAt as ReturnArrival["receivedAt"],
        receivedBy: row.receivedBy ? String(row.receivedBy) : undefined,
        goodQty:
          typeof row.goodQty === "number" ? Math.max(0, row.goodQty) : undefined,
        damagedQty:
          typeof row.damagedQty === "number"
            ? Math.max(0, row.damagedQty)
            : undefined,
        notes: row.notes ? String(row.notes) : undefined,
        receivePhotoUrls: Array.isArray(row.receivePhotoUrls)
          ? row.receivePhotoUrls.map((u) => String(u || "").trim()).filter(Boolean)
          : undefined,
        videoUrls: Array.isArray(row.videoUrls)
          ? row.videoUrls.map((u) => String(u || "").trim()).filter(Boolean)
          : undefined,
        videoSessionIds: Array.isArray(row.videoSessionIds)
          ? row.videoSessionIds.map((id) => String(id || "").trim()).filter(Boolean)
          : undefined,
      };
    });
}

/** Good plus damaged units already counted. Good alone is what can be added to inventory. */
export function countedReturnUnits(item: {
  receivedQuantity?: number;
  receivedGoodQuantity?: number;
  receivedDamagedQuantity?: number;
}) {
  const good = Math.max(0, item.receivedGoodQuantity ?? item.receivedQuantity ?? 0);
  const damaged = Math.max(0, item.receivedDamagedQuantity ?? 0);
  return { good, damaged, total: good + damaged };
}

export function summarizeReturnArrivals(arrivals: ReturnArrival[]) {
  let goodTotal = 0;
  let damagedTotal = 0;
  let arrivedOnly = 0;
  let receivedUnits = 0;

  for (const arrival of arrivals) {
    if (arrival.status === "received") {
      goodTotal += Math.max(0, arrival.goodQty ?? 0);
      damagedTotal += Math.max(0, arrival.damagedQty ?? 0);
      receivedUnits += 1;
    } else if (arrival.status === "arrived" || arrival.status === "opened") {
      arrivedOnly += 1;
    }
  }

  return {
    goodTotal,
    damagedTotal,
    arrivedOnly,
    receivedUnits,
    totalArrivals: arrivals.length,
  };
}

export function groupArrivalsByTracking(
  arrivals: ReturnArrival[]
): Map<string, ReturnArrival[]> {
  const map = new Map<string, ReturnArrival[]>();
  for (const arrival of arrivals) {
    const key = arrival.trackingNumber.trim().toUpperCase() || "(no tracking)";
    const list = map.get(key) ?? [];
    list.push(arrival);
    map.set(key, list);
  }
  return map;
}

export function formatReturnArrivalUnitType(unitType: ReturnArrivalUnitType): string {
  switch (unitType) {
    case "pallet":
      return "Pallet";
    case "package":
      return "Package";
    default:
      return "Carton";
  }
}

export function returnArrivalStatusLabel(status: ReturnArrivalStatus): string {
  switch (status) {
    case "opened":
      return "Opened";
    case "received":
      return "Counted";
    default:
      return "Arrived (not opened)";
  }
}

/** Firestore updateDoc rejects explicit `undefined` anywhere in the payload. */
function firestoreData<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) out[key] = entry;
  }
  return out;
}

function mergePhotoUrls(existing: unknown, incoming: string[]): string[] {
  const prev = Array.isArray(existing)
    ? existing.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  return [...new Set([...prev, ...incoming.map((u) => u.trim()).filter(Boolean)])];
}

function buildReceivingLogEntry(input: {
  arrival: ReturnArrival;
  goodQty: number;
  damagedQty: number;
  operatorId: string;
  now: Timestamp;
  notes?: string;
}): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    quantity: input.goodQty + input.damagedQty,
    goodQty: input.goodQty,
    damagedQty: input.damagedQty,
    arrivalId: input.arrival.id,
    trackingNumber: input.arrival.trackingNumber,
    unitType: input.arrival.unitType,
    receivedAt: input.now,
    receivedBy: input.operatorId,
  };
  if (input.notes?.trim()) entry.notes = input.notes.trim();
  return entry;
}

async function loadReturnDoc(ownerUserId: string, returnId: string) {
  const returnRef = doc(db, `users/${ownerUserId}/productReturns`, returnId);
  const snap = await getDoc(returnRef);
  if (!snap.exists()) throw new Error("Return request not found.");
  return { returnRef, data: snap.data() as ProductReturn };
}

export async function logReturnArrival(input: {
  ownerUserId: string;
  returnId: string;
  trackingNumber: string;
  unitType: ReturnArrivalUnitType;
  operatorId: string;
  notes?: string;
}): Promise<ReturnArrival> {
  const tracking = input.trackingNumber.trim();
  if (!tracking) throw new Error("Tracking number is required.");

  const { returnRef, data } = await loadReturnDoc(input.ownerUserId, input.returnId);
  if (data.status !== "approved" && data.status !== "in_progress") {
    throw new Error("Arrivals can only be logged on approved or in-progress returns.");
  }

  const now = Timestamp.now();
  const note = input.notes?.trim();
  const arrival: ReturnArrival = {
    id: createReturnArrivalId(),
    trackingNumber: tracking,
    unitType: input.unitType,
    status: "arrived",
    arrivedAt: now,
    arrivedBy: input.operatorId,
    ...(note ? { notes: note } : {}),
  };

  const arrivals = [...normalizeReturnArrivals(data.returnArrivals), arrival];
  const nextStatus = data.status === "approved" ? "in_progress" : data.status;

  await updateDoc(returnRef, {
    returnArrivals: arrivals.map((row) => firestoreData(row as unknown as Record<string, unknown>)),
    status: nextStatus,
    updatedAt: now,
  });

  return arrival;
}

export async function openReceiveReturnArrival(input: {
  ownerUserId: string;
  returnId: string;
  arrivalId: string;
  goodQty: number;
  damagedQty: number;
  operatorId: string;
  notes?: string;
  receivePhotoUrls?: string[];
  videoUrls?: string[];
  videoSessionIds?: string[];
}): Promise<void> {
  const goodQty = Math.max(0, Math.floor(input.goodQty));
  const damagedQty = Math.max(0, Math.floor(input.damagedQty));
  if (goodQty + damagedQty < 1) {
    throw new Error("Enter at least one good or damaged unit.");
  }

  const { returnRef, data } = await loadReturnDoc(input.ownerUserId, input.returnId);
  const arrivals = normalizeReturnArrivals(data.returnArrivals);
  const index = arrivals.findIndex((a) => a.id === input.arrivalId);
  if (index < 0) throw new Error("Arrival not found.");
  const target = arrivals[index];
  if (target.status === "received") {
    throw new Error("This arrival was already counted.");
  }

  const now = Timestamp.now();
  const updatedArrival: ReturnArrival = {
    ...target,
    status: "received",
    openedAt: target.openedAt ?? now,
    openedBy: target.openedBy ?? input.operatorId,
    receivedAt: now,
    receivedBy: input.operatorId,
    goodQty,
    damagedQty,
    notes: input.notes?.trim() || target.notes,
    receivePhotoUrls:
      input.receivePhotoUrls && input.receivePhotoUrls.length > 0
        ? input.receivePhotoUrls
        : target.receivePhotoUrls,
    videoUrls:
      input.videoUrls && input.videoUrls.length > 0
        ? input.videoUrls
        : target.videoUrls,
    videoSessionIds:
      input.videoSessionIds && input.videoSessionIds.length > 0
        ? input.videoSessionIds
        : target.videoSessionIds,
  };
  arrivals[index] = updatedArrival;

  const summary = summarizeReturnArrivals(arrivals);
  const currentLog = Array.isArray(data.receivingLog) ? [...data.receivingLog] : [];
  const logEntry = buildReceivingLogEntry({
    arrival: updatedArrival,
    goodQty,
    damagedQty,
    operatorId: input.operatorId,
    now,
    notes: input.notes,
  });

  const patch: Record<string, unknown> = {
    returnArrivals: arrivals.map((row) => firestoreData(row as unknown as Record<string, unknown>)),
    receivedQuantity: summary.goodTotal,
    receivedGoodQuantity: summary.goodTotal,
    receivedDamagedQuantity: summary.damagedTotal,
    receivingLog: [...currentLog, logEntry],
    status: "in_progress",
    updatedAt: now,
  };

  if (input.receivePhotoUrls && input.receivePhotoUrls.length > 0) {
    patch.receivePhotoUrls = mergePhotoUrls(data.receivePhotoUrls, input.receivePhotoUrls);
  }

  await updateDoc(returnRef, patch);
}
