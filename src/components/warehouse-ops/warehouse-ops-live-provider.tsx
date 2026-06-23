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
import {
  parseWarehouseCartonDoc,
  warehouseCartonsCollectionRef,
} from "@/lib/warehouse-carton-firestore";
import { warehouseCycleCountTasksCollectionRef, isAssignedCycleCountTask } from "@/lib/warehouse-cycle-count";
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
import type { OutboundPickOrder } from "@/lib/warehouse-pick";
import type { OutboundPackOrder } from "@/lib/warehouse-pack";
import type { WarehouseCartonDoc } from "@/types";

function inventoryDocToProductMap(
  docs: Array<{ id: string; data: Record<string, unknown> }>
): ClientProductMap {
  const map = new Map<string, { sku: string; productName: string }>();
  for (const d of docs) {
    const sku = String(d.data.sku ?? "").trim();
    if (!sku) continue;
    map.set(d.id, {
      sku,
      productName: String(d.data.productName ?? d.data.sku ?? "").trim() || sku,
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
  const { clients, loading: clientsLoading } = useWarehouseOpsClients();
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
    clients,
    clientsLoading,
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
    shipmentsLoading ||
    inventoryLoading ||
    returnsLoading ||
    cycleLoading;

  const syncError =
    cartonsSyncError ?? shipmentsSyncError ?? inventorySyncError ?? returnsSyncError ?? null;

  const { stats, pickQueue, packQueue, dispatchQueue, inboundDockQueue, returnDockQueue, quarantineReturnCartons } =
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
      inboundDockQueue: buildInboundDockQueueLive({
        warehouse: selectedWarehouse,
        clients,
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
    cartons,
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

  const outboundLoading = clientsLoading || shipmentsLoading;

  const value = useMemo(
    () => ({
      stats: displayStats,
      pickQueue,
      packQueue,
      dispatchQueue,
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
