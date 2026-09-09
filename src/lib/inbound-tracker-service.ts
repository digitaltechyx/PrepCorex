import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb, getAdminFieldValue } from "@/lib/firebase-admin";
import { detectCarrier } from "@/lib/carrier-detect";
import {
  INBOUND_TRACKER_COLLECTION,
  isInboundTrackerStale,
  normalizeTrackingNumber,
  inboundTrackerDocId,
} from "@/lib/inbound-tracker";
import { fetchShippoTracking, parseShippoTrackingStatus } from "@/lib/shippo-tracking-server";
import type { InboundTrackerEntry } from "@/types";

function trackingNow(): Timestamp {
  return Timestamp.now();
}

function entryFromFirestore(id: string, raw: FirebaseFirestore.DocumentData): InboundTrackerEntry {
  return {
    id,
    trackingNumber: String(raw.trackingNumber || ""),
    carrier: raw.carrier != null ? String(raw.carrier) : null,
    addedAt: raw.addedAt as InboundTrackerEntry["addedAt"],
    addedVia:
      raw.addedVia === "scan" || raw.addedVia === "manual"
        ? raw.addedVia
        : "manual",
    addedBy: raw.addedBy != null ? String(raw.addedBy) : null,
    addedByName: raw.addedByName != null ? String(raw.addedByName) : null,
    baselineStatus: raw.baselineStatus != null ? String(raw.baselineStatus) : null,
    baselineStatusLabel: raw.baselineStatusLabel != null ? String(raw.baselineStatusLabel) : null,
    lastStatus: raw.lastStatus != null ? String(raw.lastStatus) : null,
    lastStatusLabel: raw.lastStatusLabel != null ? String(raw.lastStatusLabel) : null,
    lastStatusDetails: raw.lastStatusDetails != null ? String(raw.lastStatusDetails) : null,
    lastCheckedAt: raw.lastCheckedAt as InboundTrackerEntry["lastCheckedAt"],
    lastError: raw.lastError != null ? String(raw.lastError) : null,
    isDelivered: raw.isDelivered === true,
    isClosed: raw.isClosed === true,
    firstChangeNotifiedAt: raw.firstChangeNotifiedAt as InboundTrackerEntry["firstChangeNotifiedAt"],
    staleNotifiedAt: raw.staleNotifiedAt as InboundTrackerEntry["staleNotifiedAt"],
    pendingFirstChangeDigest: raw.pendingFirstChangeDigest === true,
    pendingFirstChangeFromLabel:
      raw.pendingFirstChangeFromLabel != null ? String(raw.pendingFirstChangeFromLabel) : null,
    pendingFirstChangeToLabel:
      raw.pendingFirstChangeToLabel != null ? String(raw.pendingFirstChangeToLabel) : null,
  };
}

async function refreshOneEntry(entry: InboundTrackerEntry): Promise<InboundTrackerEntry> {
  if (entry.isClosed) return entry;

  const result = await fetchShippoTracking(entry.trackingNumber, entry.carrier);
  const now = trackingNow();

  if (!result.ok) {
    return {
      ...entry,
      lastCheckedAt: now,
      lastError: result.error || "Failed to refresh",
    };
  }

  const parsed = parseShippoTrackingStatus(result.tracking);
  const baselineStatus = entry.baselineStatus || parsed.status;
  const baselineLabel = entry.baselineStatusLabel || parsed.statusLabel;

  return {
    ...entry,
    baselineStatus,
    baselineStatusLabel: baselineLabel,
    lastCheckedAt: now,
    lastStatus: parsed.status,
    lastStatusLabel: parsed.statusLabel,
    lastStatusDetails: parsed.statusDetails ?? null,
    lastError: parsed.isUnknown ? parsed.statusDetails || "Not found" : null,
    isDelivered: parsed.isDelivered,
    isClosed: parsed.isDelivered,
  };
}

async function persistEntry(entry: InboundTrackerEntry): Promise<void> {
  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  const { id, ...rest } = entry;
  await db
    .collection(INBOUND_TRACKER_COLLECTION)
    .doc(id)
    .set({ ...rest, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function listInboundTrackerEntries(limit = 500): Promise<InboundTrackerEntry[]> {
  const db = getAdminDb();
  const snap = await db
    .collection(INBOUND_TRACKER_COLLECTION)
    .orderBy("addedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => entryFromFirestore(doc.id, doc.data()));
}

export async function addInboundTrackerEntry(input: {
  trackingNumber: string;
  carrier?: string | null;
  addedBy: string;
  addedByName?: string | null;
  addedVia?: "scan" | "manual";
}): Promise<InboundTrackerEntry> {
  const tn = normalizeTrackingNumber(input.trackingNumber);
  if (!tn) throw new Error("Tracking number is required.");

  const id = inboundTrackerDocId(tn);
  const db = getAdminDb();
  const ref = db.collection(INBOUND_TRACKER_COLLECTION).doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error("This tracking number is already on Inbound Tracker.");
  }

  const detected = detectCarrier(tn);
  const carrier = input.carrier?.trim() || detected || "USPS";
  const now = trackingNow();

  let entry: InboundTrackerEntry = {
    id,
    trackingNumber: tn,
    carrier,
    addedAt: now,
    addedVia: input.addedVia === "scan" ? "scan" : "manual",
    addedBy: input.addedBy,
    addedByName: input.addedByName ?? null,
    isDelivered: false,
    isClosed: false,
  };

  entry = await refreshOneEntry(entry);
  entry = {
    ...entry,
    baselineStatus: entry.lastStatus ?? "UNKNOWN",
    baselineStatusLabel: entry.lastStatusLabel ?? "Unknown",
  };

  await persistEntry(entry);
  return entry;
}

export async function refreshInboundTrackerEntry(id: string): Promise<InboundTrackerEntry | null> {
  const db = getAdminDb();
  const snap = await db.collection(INBOUND_TRACKER_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const entry = entryFromFirestore(snap.id, snap.data()!);
  if (entry.isClosed) return entry;
  const updated = await refreshOneEntry(entry);
  await persistEntry(updated);
  return updated;
}

export async function deleteInboundTrackerEntry(id: string): Promise<boolean> {
  const db = getAdminDb();
  const ref = db.collection(INBOUND_TRACKER_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

export async function refreshOpenInboundTrackerEntries(limit = 200): Promise<number> {
  const db = getAdminDb();
  const snap = await db
    .collection(INBOUND_TRACKER_COLLECTION)
    .where("isClosed", "==", false)
    .limit(limit)
    .get();

  let count = 0;
  for (const doc of snap.docs) {
    const entry = entryFromFirestore(doc.id, doc.data());
    if (!isInboundTrackerStale(entry) && entry.lastCheckedAt) continue;
    const updated = await refreshOneEntry(entry);
    await persistEntry(updated);
    count += 1;
  }
  return count;
}
