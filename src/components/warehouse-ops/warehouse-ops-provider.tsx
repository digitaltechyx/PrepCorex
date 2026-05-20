"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import type { WarehouseDoc } from "@/types";
import { filterWarehousesForOpsUser } from "@/lib/warehouse-ops-permissions";

const STORAGE_KEY = "warehouse-ops-selected-id";

type WarehouseOpsContextValue = {
  warehouses: WarehouseDoc[];
  selectedWarehouse: WarehouseDoc | null;
  setSelectedWarehouseId: (id: string) => void;
  loading: boolean;
};

const WarehouseOpsContext = createContext<WarehouseOpsContextValue | undefined>(undefined);

export function WarehouseOpsProvider({ children }: { children: React.ReactNode }) {
  const { userProfile } = useAuth();
  const { data: allWarehouses, loading } = useCollection<WarehouseDoc>("warehouses");
  const warehouses = useMemo(
    () => filterWarehousesForOpsUser(userProfile, allWarehouses),
    [userProfile, allWarehouses]
  );

  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!warehouses.length) {
      setSelectedId("");
      return;
    }
    const stored =
      typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
    const validStored = stored && warehouses.some((w) => w.id === stored);
    if (validStored) {
      setSelectedId(stored!);
      return;
    }
    setSelectedId(warehouses[0].id);
  }, [warehouses]);

  const setSelectedWarehouseId = (id: string) => {
    setSelectedId(id);
    if (typeof window !== "undefined") {
      localStorage.setItem(STORAGE_KEY, id);
    }
  };

  const selectedWarehouse = warehouses.find((w) => w.id === selectedId) ?? warehouses[0] ?? null;

  const value = useMemo(
    () => ({
      warehouses,
      selectedWarehouse,
      setSelectedWarehouseId,
      loading,
    }),
    [warehouses, selectedWarehouse, loading]
  );

  return (
    <WarehouseOpsContext.Provider value={value}>{children}</WarehouseOpsContext.Provider>
  );
}

export function useWarehouseOps() {
  const ctx = useContext(WarehouseOpsContext);
  if (!ctx) throw new Error("useWarehouseOps must be used within WarehouseOpsProvider");
  return ctx;
}
