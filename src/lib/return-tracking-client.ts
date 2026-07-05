import { doc, getDoc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { detectCarrier } from "@/lib/carrier-detect";
import type { InboundTrackingEntry } from "@/types";

function parseReturnTrackings(raw: unknown): InboundTrackingEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const o = item as Record<string, unknown>;
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
      } satisfies InboundTrackingEntry;
    })
    .filter((e): e is InboundTrackingEntry => !!e);
}

/** Normalize carrier tracking for dock scan matching. */
export function normalizeReturnTracking(raw: string): string {
  return raw.trim().replace(/\s+/g, "").toUpperCase();
}

export async function addReturnTracking(input: {
  userId: string;
  returnId: string;
  trackingNumber: string;
  carrier?: string | null;
  addedBy?: string | null;
}): Promise<InboundTrackingEntry[]> {
  const tn = input.trackingNumber.trim();
  if (!tn) throw new Error("Tracking number is required.");

  const ref = doc(db, "users", input.userId, "productReturns", input.returnId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error("Return request not found.");

  const existing = parseReturnTrackings(snap.data().returnTrackings);
  const entry = buildReturnTrackingEntry({
    trackingNumber: tn,
    carrier: input.carrier,
    addedBy: input.addedBy,
  });
  const normalized = normalizeReturnTracking(tn);
  if (existing.some((e) => normalizeReturnTracking(e.trackingNumber) === normalized)) {
    throw new Error("This tracking number is already on the return.");
  }

  const next = [...existing, entry];
  await updateDoc(ref, {
    returnTrackings: next,
    updatedAt: serverTimestamp(),
  });
  return next;
}

/** Build one tracking entry for initial return submit (optional tracking). */
export function buildReturnTrackingEntry(input: {
  trackingNumber: string;
  carrier?: string | null;
  addedBy?: string | null;
}): InboundTrackingEntry {
  const tn = input.trackingNumber.trim();
  return {
    id: `rt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    trackingNumber: tn,
    carrier: input.carrier?.trim() || detectCarrier(tn) || null,
    addedAt: new Date(),
    addedBy: input.addedBy ?? null,
  };
}

export function buildReturnTrackingEntries(
  input: { trackingNumber: string; carrier?: string | null },
  addedBy?: string | null
): InboundTrackingEntry[] {
  const tn = input.trackingNumber.trim();
  if (!tn) return [];
  return [buildReturnTrackingEntry({ trackingNumber: tn, carrier: input.carrier, addedBy })];
}

export { parseReturnTrackings };
