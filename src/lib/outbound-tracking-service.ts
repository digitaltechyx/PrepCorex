import { Timestamp } from "firebase-admin/firestore";
import { getAdminDb, getAdminFieldValue } from "@/lib/firebase-admin";
import { detectCarrier } from "@/lib/carrier-detect";
import {
  OUTBOUND_TRACKING_COLLECTION,
  OUTBOUND_TRACKING_STALE_MS,
  isOutboundTrackingStale,
  normalizeTrackingNumber,
  outboundTrackerDocId,
} from "@/lib/outbound-tracking";
import { fetchShippoTracking, parseShippoTrackingStatus } from "@/lib/shippo-tracking-server";
import type { OutboundTrackerEntry } from "@/types";

function trackingNow(): Timestamp {
  return Timestamp.now();
}

function entryFromFirestore(id: string, raw: FirebaseFirestore.DocumentData): OutboundTrackerEntry {
  return {
    id,
    trackingNumber: String(raw.trackingNumber || ""),
    carrier: raw.carrier != null ? String(raw.carrier) : null,
    addedAt: raw.addedAt as OutboundTrackerEntry["addedAt"],
    addedBy: raw.addedBy != null ? String(raw.addedBy) : null,
    addedByName: raw.addedByName != null ? String(raw.addedByName) : null,
    baselineStatus: raw.baselineStatus != null ? String(raw.baselineStatus) : null,
    baselineStatusLabel: raw.baselineStatusLabel != null ? String(raw.baselineStatusLabel) : null,
    lastStatus: raw.lastStatus != null ? String(raw.lastStatus) : null,
    lastStatusLabel: raw.lastStatusLabel != null ? String(raw.lastStatusLabel) : null,
    lastStatusDetails: raw.lastStatusDetails != null ? String(raw.lastStatusDetails) : null,
    lastCheckedAt: raw.lastCheckedAt as OutboundTrackerEntry["lastCheckedAt"],
    lastError: raw.lastError != null ? String(raw.lastError) : null,
    isDelivered: raw.isDelivered === true,
    isClosed: raw.isClosed === true,
    firstChangeNotifiedAt: raw.firstChangeNotifiedAt as OutboundTrackerEntry["firstChangeNotifiedAt"],
    staleNotifiedAt: raw.staleNotifiedAt as OutboundTrackerEntry["staleNotifiedAt"],
    pendingFirstChangeDigest: raw.pendingFirstChangeDigest === true,
    pendingFirstChangeFromLabel:
      raw.pendingFirstChangeFromLabel != null ? String(raw.pendingFirstChangeFromLabel) : null,
    pendingFirstChangeToLabel:
      raw.pendingFirstChangeToLabel != null ? String(raw.pendingFirstChangeToLabel) : null,
  };
}

async function refreshOneEntry(entry: OutboundTrackerEntry): Promise<OutboundTrackerEntry> {
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

  let updated: OutboundTrackerEntry = {
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

  const statusChanged =
    !parsed.isUnknown &&
    baselineStatus !== parsed.status &&
    baselineLabel !== parsed.statusLabel;

  if (statusChanged && !entry.firstChangeNotifiedAt && !entry.pendingFirstChangeDigest) {
    updated = {
      ...updated,
      pendingFirstChangeDigest: true,
      pendingFirstChangeFromLabel: baselineLabel,
      pendingFirstChangeToLabel: parsed.statusLabel,
    };
  }

  return updated;
}

async function persistEntry(entry: OutboundTrackerEntry): Promise<void> {
  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  const { id, ...rest } = entry;
  await db
    .collection(OUTBOUND_TRACKING_COLLECTION)
    .doc(id)
    .set({ ...rest, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

export async function listOutboundTrackerEntries(limit = 500): Promise<OutboundTrackerEntry[]> {
  const db = getAdminDb();
  const snap = await db
    .collection(OUTBOUND_TRACKING_COLLECTION)
    .orderBy("addedAt", "desc")
    .limit(limit)
    .get();
  return snap.docs.map((doc) => entryFromFirestore(doc.id, doc.data()));
}

export async function addOutboundTrackerEntry(input: {
  trackingNumber: string;
  carrier?: string | null;
  addedBy: string;
  addedByName?: string | null;
}): Promise<OutboundTrackerEntry> {
  const tn = normalizeTrackingNumber(input.trackingNumber);
  if (!tn) throw new Error("Tracking number is required.");

  const id = outboundTrackerDocId(tn);
  const db = getAdminDb();
  const ref = db.collection(OUTBOUND_TRACKING_COLLECTION).doc(id);
  const existing = await ref.get();
  if (existing.exists) {
    throw new Error("This tracking number is already on Outbound Tracker.");
  }

  const detected = detectCarrier(tn);
  const carrier = input.carrier?.trim() || detected || "USPS";
  const now = trackingNow();

  let entry: OutboundTrackerEntry = {
    id,
    trackingNumber: tn,
    carrier,
    addedAt: now,
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
    pendingFirstChangeDigest: false,
  };

  await persistEntry(entry);
  return entry;
}

export async function refreshOutboundTrackerEntry(id: string): Promise<OutboundTrackerEntry | null> {
  const db = getAdminDb();
  const snap = await db.collection(OUTBOUND_TRACKING_COLLECTION).doc(id).get();
  if (!snap.exists) return null;
  const entry = entryFromFirestore(snap.id, snap.data()!);
  if (entry.isClosed) return entry;
  const updated = await refreshOneEntry(entry);
  await persistEntry(updated);
  return updated;
}

export async function deleteOutboundTrackerEntry(id: string): Promise<boolean> {
  const db = getAdminDb();
  const ref = db.collection(OUTBOUND_TRACKING_COLLECTION).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return false;
  await ref.delete();
  return true;
}

export async function refreshOpenOutboundTrackerEntries(limit = 200): Promise<number> {
  const db = getAdminDb();
  const snap = await db
    .collection(OUTBOUND_TRACKING_COLLECTION)
    .where("isClosed", "==", false)
    .limit(limit)
    .get();

  let count = 0;
  for (const doc of snap.docs) {
    const entry = entryFromFirestore(doc.id, doc.data());
    if (!isOutboundTrackingStale(entry) && entry.lastCheckedAt) continue;
    const updated = await refreshOneEntry(entry);
    await persistEntry(updated);
    count += 1;
  }
  return count;
}

export type OutboundDigestFirstChange = {
  id: string;
  trackingNumber: string;
  fromLabel: string;
  toLabel: string;
  addedAt: OutboundTrackerEntry["addedAt"];
};

export type OutboundDigestStale = {
  id: string;
  trackingNumber: string;
  statusLabel: string;
  addedAt: OutboundTrackerEntry["addedAt"];
};

export async function collectAndMarkOutboundDigestItems(): Promise<{
  firstChanges: OutboundDigestFirstChange[];
  stale: OutboundDigestStale[];
}> {
  const db = getAdminDb();
  const now = Date.now();
  const snap = await db.collection(OUTBOUND_TRACKING_COLLECTION).get();

  const firstChanges: OutboundDigestFirstChange[] = [];
  const stale: OutboundDigestStale[] = [];

  for (const doc of snap.docs) {
    const entry = entryFromFirestore(doc.id, doc.data());
    let patch: Partial<OutboundTrackerEntry> | null = null;

    if (entry.pendingFirstChangeDigest && !entry.firstChangeNotifiedAt) {
      firstChanges.push({
        id: entry.id,
        trackingNumber: entry.trackingNumber,
        fromLabel: entry.pendingFirstChangeFromLabel || entry.baselineStatusLabel || "Unknown",
        toLabel: entry.pendingFirstChangeToLabel || entry.lastStatusLabel || "Unknown",
        addedAt: entry.addedAt,
      });
      patch = {
        ...patch,
        firstChangeNotifiedAt: trackingNow(),
        pendingFirstChangeDigest: false,
        pendingFirstChangeFromLabel: null,
        pendingFirstChangeToLabel: null,
      };
    }

    const addedMs = entry.addedAt
      ? typeof entry.addedAt === "object" && "seconds" in entry.addedAt
        ? entry.addedAt.seconds * 1000
        : new Date(entry.addedAt as string).getTime()
      : null;

    const unchanged =
      (entry.baselineStatus || "") === (entry.lastStatus || "") &&
      (entry.baselineStatusLabel || "") === (entry.lastStatusLabel || "");

    if (
      addedMs &&
      now - addedMs >= OUTBOUND_TRACKING_STALE_MS &&
      unchanged &&
      !entry.staleNotifiedAt &&
      !entry.isClosed
    ) {
      stale.push({
        id: entry.id,
        trackingNumber: entry.trackingNumber,
        statusLabel: entry.lastStatusLabel || entry.baselineStatusLabel || "Unknown",
        addedAt: entry.addedAt,
      });
      patch = { ...patch, staleNotifiedAt: trackingNow() };
    }

    if (patch) {
      await persistEntry({ ...entry, ...patch });
    }
  }

  return { firstChanges, stale };
}

export async function runOutboundTrackerDailyDigest(): Promise<{
  refreshed: number;
  firstChanges: number;
  stale: number;
  emailSent: boolean;
}> {
  const refreshed = await refreshOpenOutboundTrackerEntries(500);
  const { firstChanges, stale } = await collectAndMarkOutboundDigestItems();

  let emailSent = false;
  if (firstChanges.length > 0 || stale.length > 0) {
    const { sendOutboundTrackerDigestEmail } = await import("@/lib/outbound-tracking-digest-email");
    await sendOutboundTrackerDigestEmail({ firstChanges, stale });
    emailSent = true;
  }

  return {
    refreshed,
    firstChanges: firstChanges.length,
    stale: stale.length,
    emailSent,
  };
}
