"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  collectionGroup,
  onSnapshot,
  query,
  where,
  type QueryConstraint,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { clientMatchesWarehouse } from "@/lib/warehouse-client-match";
import type { UserProfile, WarehouseDoc } from "@/types";
import type { LiveFirestoreDoc } from "@/lib/warehouse-ops-live-compute";

function docFromSnapshot(d: { id: string; ref: { path: string }; data: () => Record<string, unknown> }) {
  return {
    id: d.id,
    path: d.ref.path,
    data: d.data() as Record<string, unknown>,
  };
}

function mergeUserDocMaps(byUser: Map<string, LiveFirestoreDoc[]>): LiveFirestoreDoc[] {
  const out: LiveFirestoreDoc[] = [];
  for (const docs of byUser.values()) out.push(...docs);
  return out;
}

type UseWarehouseClientDocsLiveInput = {
  subcollection: "shipmentRequests" | "inventoryRequests" | "productReturns";
  constraints: QueryConstraint[];
  warehouse: WarehouseDoc | undefined;
  clients: UserProfile[];
  clientsLoading: boolean;
};

/**
 * Live docs from a client subcollection. Tries collectionGroup first; on failure
 * falls back to per-user listeners (same pattern as loadInboundRequestQueue).
 */
export function useWarehouseClientDocsLive(input: UseWarehouseClientDocsLiveInput) {
  const { subcollection, constraints, warehouse, clients, clientsLoading } = input;
  const [docs, setDocs] = useState<LiveFirestoreDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [usePerUser, setUsePerUser] = useState(false);
  const byUserRef = useRef(new Map<string, LiveFirestoreDoc[]>());
  const syncedUsersRef = useRef(new Set<string>());

  const eligibleClientIds = useMemo(() => {
    if (!warehouse) return [];
    return clients
      .filter((c) => clientMatchesWarehouse(c, warehouse))
      .map((c) => c.uid)
      .sort();
  }, [clients, warehouse]);

  const eligibleKey = eligibleClientIds.join(",");
  const scopeKey = `${warehouse?.id ?? ""}:${eligibleKey}:${subcollection}`;

  const groupQuery = useMemo(
    () => query(collectionGroup(db, subcollection), ...constraints),
    [subcollection, constraints]
  );

  // Restart from collectionGroup when warehouse or eligible client set changes.
  useEffect(() => {
    setUsePerUser(false);
    setDocs([]);
    setLoading(true);
    setSyncError(null);
    byUserRef.current = new Map();
    syncedUsersRef.current = new Set();
  }, [scopeKey]);

  // Collection-group listener (fast path when indexes + rules allow).
  useEffect(() => {
    if (!warehouse || clientsLoading || usePerUser) return;

    setLoading(true);
    setSyncError(null);

    const unsub = onSnapshot(
      groupQuery,
      (snap) => {
        setDocs(snap.docs.map((d) => docFromSnapshot(d)));
        setLoading(false);
        setSyncError(null);
      },
      (err) => {
        console.warn(
          `[warehouse-ops-live] collectionGroup ${subcollection} failed; using per-user listeners`,
          err
        );
        setUsePerUser(true);
        setSyncError(
          err instanceof Error ? err.message : "Collection query failed — using per-client sync"
        );
      }
    );

    return () => unsub();
  }, [groupQuery, warehouse, clientsLoading, usePerUser, subcollection]);

  // Per-user fallback listeners (works without collection-group indexes).
  useEffect(() => {
    if (!warehouse || clientsLoading || !usePerUser) return;

    if (eligibleClientIds.length === 0) {
      setDocs([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    byUserRef.current = new Map();
    syncedUsersRef.current = new Set();

    const unsubs = eligibleClientIds.map((uid) => {
      const userQuery = query(collection(db, "users", uid, subcollection), ...constraints);
      return onSnapshot(
        userQuery,
        (snap) => {
          byUserRef.current.set(
            uid,
            snap.docs.map((d) => docFromSnapshot(d))
          );
          syncedUsersRef.current.add(uid);
          setDocs(mergeUserDocMaps(byUserRef.current));
          if (syncedUsersRef.current.size >= eligibleClientIds.length) {
            setLoading(false);
          }
        },
        (err) => {
          console.warn(`[warehouse-ops-live] ${subcollection} listener failed for ${uid}`, err);
          byUserRef.current.set(uid, []);
          syncedUsersRef.current.add(uid);
          setDocs(mergeUserDocMaps(byUserRef.current));
          if (syncedUsersRef.current.size >= eligibleClientIds.length) {
            setLoading(false);
          }
        }
      );
    });

    return () => unsubs.forEach((u) => u());
  }, [
    warehouse,
    clientsLoading,
    usePerUser,
    scopeKey,
    eligibleClientIds,
    subcollection,
    constraints,
  ]);

  return { docs, loading: loading || clientsLoading, syncError };
}

export const SHIPMENT_LIVE_CONSTRAINTS = [where("status", "==", "confirmed")] as QueryConstraint[];
export const INVENTORY_LIVE_CONSTRAINTS = [where("status", "==", "approved")] as QueryConstraint[];
export const RETURN_LIVE_CONSTRAINTS = [
  where("status", "in", ["approved", "in_progress"]),
] as QueryConstraint[];
