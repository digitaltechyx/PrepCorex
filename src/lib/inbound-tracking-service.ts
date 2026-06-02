import { getAdminDb, getAdminFieldValue } from "@/lib/firebase-admin";
import { detectCarrier } from "@/lib/carrier-detect";
import { INBOUND_TRACKING_REFRESH_MS, isInboundTrackingStale } from "@/lib/inbound-tracking";
import { fetchShippoTracking, parseShippoTrackingStatus } from "@/lib/shippo-tracking-server";
import type { InboundTrackingEntry, InventoryRequest } from "@/types";

const INDEX_COLLECTION = "inboundTrackingIndex";

function indexDocId(userId: string, requestId: string, entryId: string) {
  return `${userId}__${requestId}__${entryId}`;
}

function entryFromFirestore(raw: unknown): InboundTrackingEntry | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const trackingNumber = typeof o.trackingNumber === "string" ? o.trackingNumber : "";
  if (!id || !trackingNumber) return null;
  return {
    id,
    trackingNumber,
    carrier: o.carrier != null ? String(o.carrier) : null,
    addedAt: o.addedAt as InboundTrackingEntry["addedAt"],
    addedBy: o.addedBy != null ? String(o.addedBy) : null,
    lastStatus: o.lastStatus != null ? String(o.lastStatus) : null,
    lastStatusLabel: o.lastStatusLabel != null ? String(o.lastStatusLabel) : null,
    lastStatusDetails: o.lastStatusDetails != null ? String(o.lastStatusDetails) : null,
    lastCheckedAt: o.lastCheckedAt as InboundTrackingEntry["lastCheckedAt"],
    lastError: o.lastError != null ? String(o.lastError) : null,
  };
}

function parseTrackingsField(raw: unknown): InboundTrackingEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(entryFromFirestore).filter((e): e is InboundTrackingEntry => !!e);
}

async function findInventoryBySourceRequestId(userId: string, requestId: string) {
  const db = getAdminDb();
  const snap = await db
    .collection(`users/${userId}/inventory`)
    .where("sourceRequestId", "==", requestId)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return { id: snap.docs[0].id, ref: snap.docs[0].ref };
}

async function upsertIndexDoc(
  userId: string,
  requestId: string,
  entry: InboundTrackingEntry
) {
  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  await db.collection(INDEX_COLLECTION).doc(indexDocId(userId, requestId, entry.id)).set(
    {
      userId,
      requestId,
      entryId: entry.id,
      trackingNumber: entry.trackingNumber,
      carrier: entry.carrier ?? null,
      lastCheckedAt: entry.lastCheckedAt ?? FieldValue.serverTimestamp(),
      lastStatus: entry.lastStatus ?? null,
      lastStatusLabel: entry.lastStatusLabel ?? null,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
}

async function persistTrackings(
  userId: string,
  requestId: string,
  trackings: InboundTrackingEntry[]
) {
  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  const requestRef = db.doc(`users/${userId}/inventoryRequests/${requestId}`);
  await requestRef.set({ inboundTrackings: trackings }, { merge: true });

  const inv = await findInventoryBySourceRequestId(userId, requestId);
  if (inv) {
    await inv.ref.set({ inboundTrackings: trackings }, { merge: true });
  }

  for (const entry of trackings) {
    await upsertIndexDoc(userId, requestId, entry);
  }
}

export async function refreshOneInboundTrackingEntry(
  entry: InboundTrackingEntry
): Promise<InboundTrackingEntry> {
  const FieldValue = getAdminFieldValue();
  const result = await fetchShippoTracking(entry.trackingNumber, entry.carrier);
  const now = FieldValue.serverTimestamp();

  if (!result.ok) {
    return {
      ...entry,
      lastCheckedAt: now as InboundTrackingEntry["lastCheckedAt"],
      lastError: result.error || "Failed to refresh",
    };
  }

  const parsed = parseShippoTrackingStatus(result.tracking);
  return {
    ...entry,
    lastCheckedAt: now as InboundTrackingEntry["lastCheckedAt"],
    lastStatus: parsed.status,
    lastStatusLabel: parsed.statusLabel,
    lastStatusDetails: parsed.statusDetails ?? null,
    lastError: parsed.isUnknown ? parsed.statusDetails || "Not found" : null,
  };
}

export async function addInboundTracking(input: {
  userId: string;
  requestId: string;
  trackingNumber: string;
  carrier?: string | null;
  addedBy: string;
}): Promise<InboundTrackingEntry[]> {
  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  const requestRef = db.doc(`users/${input.userId}/inventoryRequests/${input.requestId}`);
  const snap = await requestRef.get();
  if (!snap.exists) throw new Error("Inventory request not found.");

  const data = snap.data() as InventoryRequest;
  const status = data.status;
  if (status !== "pending" && status !== "approved") {
    throw new Error("Tracking can only be added for pending or approved requests.");
  }

  const tn = input.trackingNumber.trim();
  if (!tn) throw new Error("Tracking number is required.");

  const detected = detectCarrier(tn);
  const carrier = input.carrier?.trim() || detected || "USPS";

  const existing = parseTrackingsField((data as { inboundTrackings?: unknown }).inboundTrackings);
  if (existing.some((e) => e.trackingNumber.toLowerCase() === tn.toLowerCase())) {
    throw new Error("This tracking number is already on the request.");
  }

  const entryId = `trk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let entry: InboundTrackingEntry = {
    id: entryId,
    trackingNumber: tn,
    carrier,
    addedAt: FieldValue.serverTimestamp() as InboundTrackingEntry["addedAt"],
    addedBy: input.addedBy,
  };

  entry = await refreshOneInboundTrackingEntry(entry);
  const trackings = [...existing, entry];
  await persistTrackings(input.userId, input.requestId, trackings);
  return trackings;
}

export async function refreshInboundTrackingsForRequest(
  userId: string,
  requestId: string,
  options?: { force?: boolean }
): Promise<InboundTrackingEntry[]> {
  const db = getAdminDb();
  const requestRef = db.doc(`users/${userId}/inventoryRequests/${requestId}`);
  const snap = await requestRef.get();
  if (!snap.exists) return [];

  const trackings = parseTrackingsField(snap.data()?.inboundTrackings);
  if (trackings.length === 0) return [];

  const updated: InboundTrackingEntry[] = [];
  for (const entry of trackings) {
    if (!options?.force && !isInboundTrackingStale(entry)) {
      updated.push(entry);
      continue;
    }
    updated.push(await refreshOneInboundTrackingEntry(entry));
  }

  await persistTrackings(userId, requestId, updated);
  return updated;
}

export async function refreshStaleInboundTrackingsForUser(userId: string): Promise<number> {
  const db = getAdminDb();
  const requestsSnap = await db.collection(`users/${userId}/inventoryRequests`).get();
  let refreshed = 0;

  for (const doc of requestsSnap.docs) {
    const status = doc.data().status;
    if (status !== "pending" && status !== "approved") continue;
    const trackings = parseTrackingsField(doc.data().inboundTrackings);
    if (trackings.length === 0) continue;
    const needs = trackings.some((e) => isInboundTrackingStale(e));
    if (!needs) continue;
    await refreshInboundTrackingsForRequest(userId, doc.id, { force: false });
    refreshed += 1;
  }

  return refreshed;
}

/** Cron: refresh all index entries stale > 6 hours. */
export async function refreshStaleInboundTrackingIndex(limit = 200): Promise<number> {
  const db = getAdminDb();
  const cutoff = Date.now() - INBOUND_TRACKING_REFRESH_MS;
  const cutoffDate = new Date(cutoff);

  const snap = await db
    .collection(INDEX_COLLECTION)
    .where("lastCheckedAt", "<", cutoffDate)
    .limit(limit)
    .get();

  let count = 0;
  for (const doc of snap.docs) {
    const data = doc.data();
    const userId = String(data.userId || "");
    const requestId = String(data.requestId || "");
    if (!userId || !requestId) continue;
    await refreshInboundTrackingsForRequest(userId, requestId, { force: false });
    count += 1;
  }

  // Also pick up entries never checked (missing lastCheckedAt) — full scan capped
  if (snap.size < limit) {
    const remaining = limit - snap.size;
    const allSnap = await db.collection(INDEX_COLLECTION).limit(500).get();
    for (const doc of allSnap.docs) {
      if (count >= remaining) break;
      const data = doc.data();
      if (data.lastCheckedAt) continue;
      const userId = String(data.userId || "");
      const requestId = String(data.requestId || "");
      if (!userId || !requestId) continue;
      await refreshInboundTrackingsForRequest(userId, requestId, { force: true });
      count += 1;
    }
  }

  return count;
}
