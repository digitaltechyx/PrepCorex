import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { InventoryRemarksLogEntry } from "@/types";

export type RemarksLogDraftEntry = {
  text?: string | null;
  imageUrls?: string[];
};

function newEntryId(prefix: string): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function buildRemarksLogEntry(input: {
  text?: string | null;
  imageUrls?: string[];
  by?: string | null;
  byName?: string | null;
  source: InventoryRemarksLogEntry["source"];
  inventoryRequestId?: string | null;
  goodQty?: number | null;
  idPrefix?: string;
}): InventoryRemarksLogEntry | null {
  const text = String(input.text ?? "").trim() || null;
  const imageUrls = [
    ...new Set(
      (input.imageUrls ?? []).map((u) => String(u || "").trim()).filter(Boolean)
    ),
  ];
  if (!text && imageUrls.length === 0) return null;
  return {
    id: newEntryId(input.idPrefix || "remark"),
    text,
    imageUrls,
    at: Timestamp.now(),
    by: input.by?.trim() || null,
    byName: input.byName?.trim() || null,
    source: input.source || "admin_receive",
    inventoryRequestId: input.inventoryRequestId?.trim() || null,
    goodQty:
      input.goodQty != null && Number.isFinite(Number(input.goodQty))
        ? Math.max(0, Math.floor(Number(input.goodQty)))
        : null,
  };
}

export function mergeRemarksLog(
  existing: InventoryRemarksLogEntry[] | undefined | null,
  incoming: InventoryRemarksLogEntry[]
): InventoryRemarksLogEntry[] {
  const prev = Array.isArray(existing)
    ? existing.map((e) => ({
        ...e,
        imageUrls: Array.isArray(e.imageUrls) ? [...e.imageUrls] : [],
      }))
    : [];
  const seen = new Set(prev.map((e) => e.id));
  for (const entry of incoming) {
    if (!entry?.id || seen.has(entry.id)) continue;
    seen.add(entry.id);
    prev.push(entry);
  }
  return prev;
}

export function flattenRemarksLogText(
  log: InventoryRemarksLogEntry[] | undefined | null,
  fallback?: string | null
): string {
  const lines = (Array.isArray(log) ? log : [])
    .map((e) => String(e.text || "").trim())
    .filter(Boolean);
  if (lines.length > 0) return lines.join("\n\n");
  return String(fallback || "").trim();
}

export function flattenRemarksLogImageUrls(
  log: InventoryRemarksLogEntry[] | undefined | null,
  fallback?: string[] | null
): string[] {
  const fromLog = (Array.isArray(log) ? log : []).flatMap((e) =>
    Array.isArray(e.imageUrls) ? e.imageUrls : []
  );
  const merged = [
    ...new Set(
      [...fromLog, ...(Array.isArray(fallback) ? fallback : [])]
        .map((u) => String(u || "").trim())
        .filter(Boolean)
    ),
  ];
  return merged;
}

function toSortMs(at: InventoryRemarksLogEntry["at"]): number {
  if (!at) return 0;
  if (typeof at === "string" || at instanceof Date) {
    const t = new Date(at).getTime();
    return Number.isFinite(t) ? t : 0;
  }
  if (typeof at === "object" && at !== null && "seconds" in at) {
    return Number((at as { seconds: number }).seconds) * 1000;
  }
  if (typeof at === "object" && at !== null && typeof (at as Timestamp).toMillis === "function") {
    return (at as Timestamp).toMillis();
  }
  return 0;
}

/** Newest first for UI. */
export function sortRemarksLogNewestFirst(
  log: InventoryRemarksLogEntry[] | undefined | null
): InventoryRemarksLogEntry[] {
  return [...(Array.isArray(log) ? log : [])].sort(
    (a, b) => toSortMs(b.at) - toSortMs(a.at)
  );
}

/**
 * Append structured receive/close remarks to the inventory request and linked inventory row.
 */
export async function appendInboundRemarksLog(input: {
  clientUserId: string;
  requestId: string;
  entries: RemarksLogDraftEntry[];
  by?: string | null;
  byName?: string | null;
  source: InventoryRemarksLogEntry["source"];
  goodQty?: number | null;
  /** Also flatten into legacy remarks / remarksImageUrls. */
  syncLegacyFields?: boolean;
}): Promise<InventoryRemarksLogEntry[]> {
  const built = input.entries
    .map((entry) =>
      buildRemarksLogEntry({
        text: entry.text,
        imageUrls: entry.imageUrls,
        by: input.by,
        byName: input.byName,
        source: input.source,
        inventoryRequestId: input.requestId,
        goodQty: input.goodQty,
        idPrefix: input.source || "remark",
      })
    )
    .filter((e): e is InventoryRemarksLogEntry => Boolean(e));

  if (built.length === 0) return [];

  const requestRef = doc(
    db,
    "users",
    input.clientUserId,
    "inventoryRequests",
    input.requestId
  );
  const reqSnap = await getDoc(requestRef);
  if (!reqSnap.exists()) return built;

  const reqData = reqSnap.data() as {
    remarks?: string;
    remarksImageUrls?: string[];
    remarksLog?: InventoryRemarksLogEntry[];
  };
  const nextReqLog = mergeRemarksLog(reqData.remarksLog, built);
  const reqPatch: Record<string, unknown> = {
    remarksLog: nextReqLog,
    updatedAt: serverTimestamp(),
  };
  if (input.syncLegacyFields !== false) {
    reqPatch.remarks = flattenRemarksLogText(nextReqLog, reqData.remarks);
    reqPatch.remarksImageUrls = flattenRemarksLogImageUrls(
      nextReqLog,
      reqData.remarksImageUrls
    );
  }
  await updateDoc(requestRef, reqPatch);

  const invSnap = await getDocs(
    query(
      collection(db, "users", input.clientUserId, "inventory"),
      where("sourceRequestId", "==", input.requestId),
      limit(1)
    )
  );
  const invDoc = invSnap.docs[0];
  if (!invDoc) return built;

  const invData = invDoc.data() as {
    remarks?: string;
    remarksImageUrls?: string[];
    remarksLog?: InventoryRemarksLogEntry[];
  };
  const nextInvLog = mergeRemarksLog(invData.remarksLog, built);
  const invPatch: Record<string, unknown> = {
    remarksLog: nextInvLog,
    updatedAt: serverTimestamp(),
  };
  if (input.syncLegacyFields !== false) {
    invPatch.remarks = flattenRemarksLogText(nextInvLog, invData.remarks);
    invPatch.remarksImageUrls = flattenRemarksLogImageUrls(
      nextInvLog,
      invData.remarksImageUrls
    );
  }
  await updateDoc(invDoc.ref, invPatch);
  return built;
}
