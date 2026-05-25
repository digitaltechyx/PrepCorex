"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection } from "@/hooks/use-collection";
import type { WarehouseDoc } from "@/types";
import { WarehouseAllocate } from "@/components/admin/warehouse-allocate";
import { WarehouseInventorySearch } from "@/components/admin/warehouse-inventory-search";

export function WarehouseAllocatePage() {
  const { data: warehouses, loading } = useCollection<WarehouseDoc>("warehouses");
  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );
  const [selectedId, setSelectedId] = useState<string>("");

  useEffect(() => {
    if (!selectedId && activeWarehouses.length > 0) {
      setSelectedId(activeWarehouses[0].id);
    }
  }, [selectedId, activeWarehouses]);

  const warehouse = activeWarehouses.find((w) => w.id === selectedId);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="sr-only">Allocate &amp; search</h1>
        </div>
        {activeWarehouses.length > 0 ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Warehouse</span>
            <Select value={selectedId} onValueChange={setSelectedId} disabled={loading}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {activeWarehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.code} — {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </div>

      {!warehouse ? (
        <p className="text-sm text-muted-foreground">
          {loading ? "Loading warehouses…" : "No active warehouse found."}
        </p>
      ) : (
        <Tabs defaultValue="allocate">
          <TabsList>
            <TabsTrigger value="allocate">Allocate</TabsTrigger>
            <TabsTrigger value="search">Inventory search</TabsTrigger>
          </TabsList>
          <TabsContent value="allocate" className="pt-4">
            <WarehouseAllocate warehouse={warehouse} />
          </TabsContent>
          <TabsContent value="search" className="pt-4">
            <WarehouseInventorySearch warehouse={warehouse} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
