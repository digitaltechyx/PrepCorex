"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  collection,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile } from "@/types";
import {
  parseWarehouseCartonDoc,
  parseWarehousePalletDoc,
  warehouseCartonsCollectionRef,
  warehousePalletsCollectionRef,
} from "@/lib/warehouse-carton-firestore";
import { buildCrossdockDispatchQueue, buildCrossdockHoldQueue, type CrossdockDispatchUnit } from "@/lib/warehouse-crossdock-dispatch";
import {
  buildCrossdockPackQueue,
  type CrossdockPackUnit,
} from "@/lib/warehouse-crossdock-pack";
import { buildReturnPackQueue, type ReturnPackUnit } from "@/lib/warehouse-unallocated-return";
import {
  buildPendingOutboundQueueLive,
  type PendingOutboundRequest,
} from "@/lib/warehouse-outbound-ops";
import { warehouseCycleCountTasksCollectionRef, isAssignedCycleCountTask } from "@/lib/warehouse-cycle-count";
import { mirrorUnlinkedPendingBatchLines } from "@/lib/inbound-batch";
import {
  computeWarehouseOpsLiveStats,
  getLiveOutboundQueues,
  clientIdsForProductMaps,
  legacyInventoryClientIds,
  buildInboundDockQueueLive,
  buildReturnDockQueueLive,
  filterQuarantineReturnCartons,
} from "@/lib/warehouse-ops-live-compute";
import {
  useWarehouseClientDocsLive,
  SHIPMENT_LIVE_CONSTRAINTS,
  INVENTORY_LIVE_CONSTRAINTS,
  RETURN_LIVE_CONSTRAINTS,
} from "@/lib/warehouse-ops-live-queries";
import type { InboundRequestRow } from "@/lib/warehouse-inbound-requests";
import type { ReturnRequestRow } from "@/lib/warehouse-returns";
import {
  rememberWarehouseOpsDashboardStats,
  peekCachedWarehouseOpsDashboardStats,
  type WarehouseOpsDashboardStats,
} from "@/lib/warehouse-ops-dashboard-stats";
import type { ClientProductMap } from "@/lib/warehouse-outbound-lines";
import { buildOrderLinesFromRequestData } from "@/lib/warehouse-outbound-lines";
import { reconcilePickOrderStatusIfComplete } from "@/lib/warehouse-pick";
import { pickStatusFromRequest } from "@/lib/warehouse-outbound-request-status";
import type { OutboundPickOrder } from "@/lib/warehouse-pick";
import type { OutboundPackOrder } from "@/lib/warehouse-pack";
import type { WarehouseCartonDoc, WarehousePalletDoc } from "@/types";

function inventoryDocToProductMap(
  docs: Array<{ id: string; data: Record<string, unknown> }>
): ClientProductMap {
  const map = new Map<string, { sku: string; productName: string }>();
  for (const d of docs) {
    const productName = String(d.data.productName ?? d.data.sku ?? "").trim();
    const sku = String(d.data.sku ?? "").trim() || productName || d.id;
    if (!sku) continue;
    map.set(d.id, {
      sku,
      productName: productName || sku,
    });
  }
  return map;
}

function useWarehouseCartonsLive(warehouseId: string | undefined) {
  const [cartons, setCartons] = useState<WarehouseCartonDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!warehouseId) {
      setCartons([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      warehouseCartonsCollectionRef(warehouseId),
      (snap) => {
        setCartons(
          snap.docs.map((d) => parseWarehouseCartonDoc(d.id, d.data() as Record<string, unknown>))
        );
        setLoading(false);
      },
      () => {
        setCartons([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [warehouseId]);

  return { cartons, loading, syncError: null as string | null };
}

function useWarehousePalletsLive(warehouseId: string | undefined) {
  const [pallets, setPallets] = useState<WarehousePalletDoc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!warehouseId) {
      setPallets([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const unsub = onSnapshot(
      warehousePalletsCollectionRef(warehouseId),
      (snap) => {
        setPallets(
          snap.docs.map((d) => parseWarehousePalletDoc(d.id, d.data() as Record<string, unknown>))
        );
        setLoading(false);
      },
      () => {
        setPallets([]);
        setLoading(false);
      }
    );
    return () => unsub();
  }, [warehouseId]);

  return { pallets, loading };
}

function useClientInventoryLive(clientUserIds: string[]) {
  const [productMaps, setProductMaps] = useState<Map<string, ClientProductMap>>(new Map());
  const [inventoryByUser, setInventoryByUser] = useState<
    Map<string, Array<Record<string, unknown>>>
  >(new Map());
  const key = clientUserIds.slice().sort().join(",");

  useEffect(() => {
    if (clientUserIds.length === 0) {
      setProductMaps(new Map());
      setInventoryByUser(new Map());
      return;
    }
    const unsubs = clientUserIds.map((uid) =>
      onSnapshot(collection(db, "users", uid, "inventory"), (snap) => {
        const docs = snap.docs.map((d) => ({
          id: d.id,
          data: d.data() as Record<string, unknown>,
        }));
        const productMap = inventoryDocToProductMap(docs);
        const inventoryRows = docs.map((d) => ({ id: d.id, ...d.data }));
        setProductMaps((prev) => {
          const next = new Map(prev);
          next.set(uid, productMap);
          return next;
        });
        setInventoryByUser((prev) => {
          const next = new Map(prev);
          next.set(uid, inventoryRows);
          return next;
        });
      })
    );
    return () => unsubs.forEach((u) => u());
  }, [key, clientUserIds]);

  return { productMaps, inventoryByUser };
}

type WarehouseOpsLiveContextValue = {
  stats: WarehouseOpsDashboardStats;
  pickQueue: OutboundPickOrder[];
  packQueue: OutboundPackOrder[];
  dispatchQueue: OutboundPackOrder[];
  pendingOutboundQueue: PendingOutboundRequest[];
  crossdockDispatchQueue: CrossdockDispatchUnit[];
  crossdockHoldQueue: CrossdockDispatchUnit[];
  crossdockPackQueue: CrossdockPackUnit[];
  returnPackQueue: ReturnPackUnit[];
  inboundDockQueue: InboundRequestRow[];
  returnDockQueue: ReturnRequestRow[];
  quarantineReturnCartons: WarehouseCartonDoc[];
  cartons: WarehouseCartonDoc[];
  liveLoading: boolean;
  outboundLoading: boolean;
  clientsLoading: boolean;
  syncError: string | null;
};

const WarehouseOpsLiveContext = createContext<WarehouseOpsLiveContextValue | undefined>(
  undefined
);

export function WarehouseOpsLiveProvider({ children }: { children: React.ReactNode }) {
  const { selectedWarehouse } = useWarehouseOps();
  const { user } = useAuth();
  const { clients, loading: clientsLoading } = useWarehouseOpsClients({
    includeUnapproved: true,
  });
  // Notifications includes every user account; inbound receiving must too (not only role=user clients).
  const { data: allUsers = [], loading: allUsersLoading } = useCollection<UserProfile>("users");
  const inboundUsers = useMemo(() => {
    const byId = new Map<string, UserProfile>();
    for (const u of allUsers) {
      const uid = String(u.uid || (u as UserProfile & { id?: string }).id || "").trim();
      if (!uid) continue;
      byId.set(uid, { ...u, uid });
    }
    // Ensure warehouse-ops clients are present even if users collection is briefly empty.
    for (const c of clients) {
      if (c.uid && !byId.has(c.uid)) byId.set(c.uid, c);
    }
    return Array.from(byId.values());
  }, [allUsers, clients]);
  const inboundUsersLoading = allUsersLoading || clientsLoading;
  const warehouseId = selectedWarehouse?.id;

  const cycleQuery = useMemo(
    () =>
      warehouseId
        ? query(
            warehouseCycleCountTasksCollectionRef(warehouseId),
            where("status", "in", ["open", "in_progress"])
          )
        : null,
    [warehouseId]
  );

  const { cartons, loading: cartonsLoading, syncError: cartonsSyncError } =
    useWarehouseCartonsLive(warehouseId);
  const { pallets, loading: palletsLoading } = useWarehousePalletsLive(warehouseId);

  // Older inbound batches only stored lines under inboundBatches — mirror them so receiving sees them.
  // Client SDK create was self-only; API uses admin SDK. Also retry client mirror after rules allow ops create.
  useEffect(() => {
    if (inboundUsersLoading || inboundUsers.length === 0 || !user) return;
    let cancelled = false;
    const userIds = inboundUsers.map((c) => c.uid).filter(Boolean);
    const key = `wh-ops-batch-mirror-v4:${userIds
      .slice()
      .sort()
      .join(",")
      .slice(0, 200)}`;
    try {
      if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(key) === "1") {
        return;
      }
    } catch {
      /* ignore */
    }

    void (async () => {
      let created = 0;
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/inbound-batches/mirror-lines", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ userIds }),
        });
        if (res.ok) {
          const data = (await res.json()) as { created?: number; repaired?: number };
          created = (data.created ?? 0) + (data.repaired ?? 0);
        } else {
          // Fallback: client mirror (works after firestore.rules allow ops create).
          created = await mirrorUnlinkedPendingBatchLines(userIds);
        }
      } catch (err) {
        console.warn("[warehouse-ops] Batch line mirror API failed; trying client", err);
        try {
          created = await mirrorUnlinkedPendingBatchLines(userIds);
        } catch (err2) {
          console.warn("[warehouse-ops] Batch line mirror failed", err2);
        }
      }
      if (cancelled) return;
      try {
        sessionStorage.setItem(key, "1");
      } catch {
        /* ignore */
      }
      if (created > 0) {
        console.info(`[warehouse-ops] Mirrored ${created} batch line(s) into inventory requests`);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inboundUsers, inboundUsersLoading, user]);

  const {
    docs: shipmentDocs,
    loading: shipmentsLoading,
    syncError: shipmentsSyncError,
  } = useWarehouseClientDocsLive({
    subcollection: "shipmentRequests",
    constraints: SHIPMENT_LIVE_CONSTRAINTS,
    warehouse: selectedWarehouse ?? undefined,
    clients,
    clientsLoading,
  });
  const {
    docs: inventoryDocs,
    loading: inventoryLoading,
    syncError: inventorySyncError,
  } = useWarehouseClientDocsLive({
    subcollection: "inventoryRequests",
    constraints: INVENTORY_LIVE_CONSTRAINTS,
    warehouse: selectedWarehouse ?? undefined,
    clients: inboundUsers,
    clientsLoading: inboundUsersLoading,
    // Match admin Notifications: all accounts' inbound, not only warehouse-assigned clients.
    matchWarehouseClients: false,
  });
  const {
    docs: returnDocs,
    loading: returnsLoading,
    syncError: returnsSyncError,
  } = useWarehouseClientDocsLive({
    subcollection: "productReturns",
    constraints: RETURN_LIVE_CONSTRAINTS,
    warehouse: selectedWarehouse ?? undefined,
    clients,
    clientsLoading,
  });

  const [cycleCountOpen, setCycleCountOpen] = useState(0);
  const [cycleLoading, setCycleLoading] = useState(true);

  useEffect(() => {
    if (!cycleQuery) {
      setCycleCountOpen(0);
      setCycleLoading(false);
      return;
    }
    setCycleLoading(true);
    const unsub = onSnapshot(
      cycleQuery,
      (snap) => {
        const openAssigned = snap.docs.filter((d) => {
          const type = String((d.data() as { type?: string }).type ?? "");
          return isAssignedCycleCountTask({ type: type as "spot" | "abc" | "full" | "quick" });
        }).length;
        setCycleCountOpen(openAssigned);
        setCycleLoading(false);
      },
      () => {
        setCycleCountOpen(0);
        setCycleLoading(false);
      }
    );
    return () => unsub();
  }, [cycleQuery]);

  const productMapClientIds = useMemo(() => {
    if (!selectedWarehouse) return [];
    return clientIdsForProductMaps({
      warehouse: selectedWarehouse,
      clients,
      shipmentDocs,
    });
  }, [selectedWarehouse, clients, shipmentDocs]);

  const legacyClientIds = useMemo(() => {
    if (!selectedWarehouse) return [];
    return legacyInventoryClientIds({
      warehouse: selectedWarehouse,
      clients,
      inventoryDocs,
    });
  }, [selectedWarehouse, clients, inventoryDocs]);

  const inventoryListenerClientIds = useMemo(() => {
    const ids = new Set([...productMapClientIds, ...legacyClientIds]);
    return [...ids];
  }, [productMapClientIds, legacyClientIds]);

  const { productMaps, inventoryByUser: legacyInventoryByUser } =
    useClientInventoryLive(inventoryListenerClientIds);

  const liveLoading =
    clientsLoading ||
    cartonsLoading ||
    palletsLoading ||
    shipmentsLoading ||
    inventoryLoading ||
    returnsLoading ||
    cycleLoading;

  const syncError =
    cartonsSyncError ?? shipmentsSyncError ?? inventorySyncError ?? returnsSyncError ?? null;

  const { stats, pickQueue, packQueue, dispatchQueue, pendingOutboundQueue, crossdockDispatchQueue, crossdockHoldQueue, crossdockPackQueue, returnPackQueue, inboundDockQueue, returnDockQueue, quarantineReturnCartons } =
    useMemo(() => {
    if (!selectedWarehouse) {
      const empty: WarehouseOpsDashboardStats = {
        inboundDock: 0,
        awaitingPutaway: 0,
        activeCartons: 0,
        quarantineUnits: 0,
        pickQueue: 0,
        packQueue: 0,
        dispatchReady: 0,
        cycleCountOpen: 0,
        returnQc: 0,
      };
      return {
        stats: empty,
        pickQueue: [] as OutboundPickOrder[],
        packQueue: [] as OutboundPackOrder[],
        dispatchQueue: [] as OutboundPackOrder[],
        pendingOutboundQueue: [] as PendingOutboundRequest[],
        crossdockDispatchQueue: [] as CrossdockDispatchUnit[],
        crossdockHoldQueue: [] as CrossdockDispatchUnit[],
        crossdockPackQueue: [] as CrossdockPackUnit[],
        returnPackQueue: [] as ReturnPackUnit[],
        inboundDockQueue: [] as InboundRequestRow[],
        returnDockQueue: [] as ReturnRequestRow[],
        quarantineReturnCartons: [] as WarehouseCartonDoc[],
      };
    }

    const queues = getLiveOutboundQueues({
      warehouse: selectedWarehouse,
      clients,
      shipmentDocs,
      productMaps,
    });

    const crossdockQueue = buildCrossdockDispatchQueue({
      cartons,
      pallets,
      clients,
    });
    const crossdockHold = buildCrossdockHoldQueue({
      cartons,
      pallets,
      clients,
    });
    const crossdockPack = buildCrossdockPackQueue({
      cartons,
      pallets,
      clients,
      shipmentDocs,
    });
    const returnPack = buildReturnPackQueue({ cartons, clients });
    const pendingOutbound = buildPendingOutboundQueueLive({
      warehouse: selectedWarehouse,
      clients,
      shipmentDocs,
      productMaps,
      inventoryDocs,
    });

    const nextStats = computeWarehouseOpsLiveStats({
      warehouse: selectedWarehouse,
      clients,
      cartons,
      shipmentDocs,
      inventoryDocs,
      returnDocs,
      cycleCountOpen,
      productMaps,
      legacyInventoryByUser,
    });

    return {
      stats: nextStats,
      pickQueue: queues.pickQueue,
      packQueue: queues.packQueue,
      dispatchQueue: queues.dispatchQueue,
      pendingOutboundQueue: pendingOutbound,
      crossdockDispatchQueue: crossdockQueue,
      crossdockHoldQueue: crossdockHold,
      crossdockPackQueue: crossdockPack,
      returnPackQueue: returnPack,
      inboundDockQueue: buildInboundDockQueueLive({
        warehouse: selectedWarehouse,
        clients: inboundUsers,
        cartons,
        inventoryDocs,
        legacyInventoryByUser,
      }),
      returnDockQueue: buildReturnDockQueueLive({
        warehouse: selectedWarehouse,
        clients,
        cartons,
        returnDocs,
      }),
      quarantineReturnCartons: filterQuarantineReturnCartons(cartons),
    };
  }, [
    selectedWarehouse,
    clients,
    inboundUsers,
    cartons,
    pallets,
    shipmentDocs,
    inventoryDocs,
    returnDocs,
    cycleCountOpen,
    productMaps,
    legacyInventoryByUser,
  ]);

  const displayStats = useMemo(() => {
    if (!liveLoading || !warehouseId) return stats;
    const cached = peekCachedWarehouseOpsDashboardStats(warehouseId);
    return cached ?? stats;
  }, [stats, liveLoading, warehouseId]);

  useEffect(() => {
    if (!selectedWarehouse || liveLoading) return;
    if (syncError) return;
    rememberWarehouseOpsDashboardStats(selectedWarehouse.id, stats);
  }, [selectedWarehouse, stats, liveLoading, syncError]);

  // Orders can stay stuck in "picking" after the last pick step — reconcile from movement events.
  useEffect(() => {
    if (!selectedWarehouse || liveLoading || shipmentDocs.length === 0) return;

    let cancelled = false;
    void (async () => {
      for (const shipmentDoc of shipmentDocs) {
        if (cancelled) return;
        const data = shipmentDoc.data;
        if (data.status !== "confirmed") continue;
        if (pickStatusFromRequest(data) !== "picking") continue;

        const clientUserId = shipmentDoc.path.split("/")[1] ?? "";
        if (!clientUserId) continue;

        const products = productMaps.get(clientUserId) ?? new Map();
        const lines = buildOrderLinesFromRequestData(data, products);
        if (lines.length === 0) continue;

        await reconcilePickOrderStatusIfComplete({
          warehouseId: selectedWarehouse.id,
          clientUserId,
          shipmentRequestId: shipmentDoc.id,
          lines,
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [selectedWarehouse, shipmentDocs, productMaps, liveLoading]);

  const outboundLoading = clientsLoading || shipmentsLoading;

  const value = useMemo(
    () => ({
      stats: displayStats,
      pickQueue,
      packQueue,
      dispatchQueue,
      pendingOutboundQueue,
      crossdockDispatchQueue,
      crossdockHoldQueue,
      crossdockPackQueue,
      returnPackQueue,
      inboundDockQueue,
      returnDockQueue,
      quarantineReturnCartons,
      cartons,
      liveLoading,
      outboundLoading,
      clientsLoading,
      syncError,
    }),
    [
      displayStats,
      pickQueue,
      packQueue,
      dispatchQueue,
      pendingOutboundQueue,
      crossdockDispatchQueue,
      crossdockHoldQueue,
      crossdockPackQueue,
      returnPackQueue,
      inboundDockQueue,
      returnDockQueue,
      quarantineReturnCartons,
      cartons,
      liveLoading,
      outboundLoading,
      clientsLoading,
      syncError,
    ]
  );

  return (
    <WarehouseOpsLiveContext.Provider value={value}>{children}</WarehouseOpsLiveContext.Provider>
  );
}

export function useWarehouseOpsLive() {
  const ctx = useContext(WarehouseOpsLiveContext);
  if (!ctx) {
    throw new Error("useWarehouseOpsLive must be used within WarehouseOpsLiveProvider");
  }
  return ctx;
}
