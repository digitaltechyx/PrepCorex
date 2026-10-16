"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem, InventoryRequest } from "@/types";
import { InventoryTable } from "@/components/dashboard/inventory-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, PackageCheck, Clock } from "lucide-react";
import { useEffect, useRef, useMemo, Suspense } from "react";
import { isIntegrationInventorySource } from "@/lib/integration-inventory-sources";

type InventoryItemWithSource = InventoryItem & { source?: string; ebayConnectionId?: string };

export default function InventoryPage() {
  const { userProfile, user: authUser } = useAuth();
  const ebayRefreshDone = useRef(false);

  const {
    data: inventoryData,
    loading: inventoryLoading,
  } = useCollection<InventoryItem>(
    userProfile ? `users/${userProfile.uid}/inventory` : ""
  );

  const { data: inventoryRequests } = useCollection<InventoryRequest>(
    userProfile ? `users/${userProfile.uid}/inventoryRequests` : ""
  );

  const warehouseInventory = useMemo(
    () =>
      (inventoryData as InventoryItemWithSource[]).filter(
        (item) => !isIntegrationInventorySource(item.source)
      ),
    [inventoryData]
  );

  const totalQuantity = useMemo(
    () => warehouseInventory.reduce((sum, item) => sum + (item.quantity || 0), 0),
    [warehouseInventory]
  );
  const inStockCount = useMemo(
    () => warehouseInventory.filter((i) => i.status === "In Stock").length,
    [warehouseInventory]
  );
  const outOfStockCount = useMemo(
    () => warehouseInventory.filter((i) => i.status === "Out of Stock").length,
    [warehouseInventory]
  );
  const pendingRequestsCount = useMemo(
    () => inventoryRequests.filter((r) => r.status === "pending").length,
    [inventoryRequests]
  );

  // Refresh eBay quantities from eBay when inventory page loads
  useEffect(() => {
    if (!authUser || !userProfile || inventoryLoading || ebayRefreshDone.current) return;
    const items = inventoryData as InventoryItemWithSource[];
    const connectionIds = [
      ...new Set(
        items
          .filter((i) => i.source === "ebay" && i.ebayConnectionId)
          .map((i) => i.ebayConnectionId!)
      ),
    ];
    if (connectionIds.length === 0) return;
    ebayRefreshDone.current = true;
    (async () => {
      const token = await authUser.getIdToken();
      for (const connectionId of connectionIds) {
        try {
          await fetch("/api/integrations/ebay/refresh-inventory", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({ connectionId }),
          });
        } catch {
          // ignore
        }
      }
    })();
  }, [authUser, userProfile, inventoryLoading, inventoryData]);

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      {/* Stat cards — compact 2×2 on mobile */}
      <div className="grid grid-cols-2 gap-1.5 sm:gap-4 lg:grid-cols-4">
        <Card className="min-w-0 overflow-hidden rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
            <CardTitle className="text-[10px] font-medium leading-tight text-blue-900 sm:text-sm">
              Total Quantity
            </CardTitle>
            <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-blue-500 shadow-sm sm:flex">
              <Package className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
            {inventoryLoading ? (
              <Skeleton className="h-5 w-10 rounded sm:h-8 sm:w-16" />
            ) : (
              <>
                <div className="text-base font-bold tabular-nums text-blue-900 sm:text-3xl">{totalQuantity}</div>
                <p className="mt-0.5 hidden text-xs text-blue-700 sm:mt-1 sm:block">Sum of all item quantities</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0 overflow-hidden rounded-lg border border-sky-200/60 bg-gradient-to-br from-sky-50 to-sky-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
            <CardTitle className="text-[10px] font-medium leading-tight text-sky-900 sm:text-sm">
              Products
            </CardTitle>
            <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-sky-500 shadow-sm sm:flex">
              <PackageCheck className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
            {inventoryLoading ? (
              <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-16" />
            ) : (
              <>
                <div className="text-base font-bold tabular-nums text-sky-900 sm:text-3xl">
                  {warehouseInventory.length}
                </div>
                <p className="mt-0.5 hidden text-xs text-sky-700 sm:mt-1 sm:block">Warehouse inventory items</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0 overflow-hidden rounded-lg border border-green-200/60 bg-gradient-to-br from-green-50 to-green-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
            <CardTitle className="text-[10px] font-medium leading-tight text-green-900 sm:text-sm">
              In Stock
            </CardTitle>
            <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-green-500 shadow-sm sm:flex">
              <PackageCheck className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
            {inventoryLoading ? (
              <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-16" />
            ) : (
              <>
                <div className="text-base font-bold tabular-nums text-green-900 sm:text-3xl">{inStockCount}</div>
                <p className="mt-0.5 text-[10px] leading-tight text-green-700 sm:mt-1 sm:text-xs">
                  {outOfStockCount > 0 ? `${outOfStockCount} out of stock` : "All in stock"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="min-w-0 overflow-hidden rounded-lg border border-amber-200/60 bg-gradient-to-br from-amber-50 to-amber-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
            <CardTitle className="text-[10px] font-medium leading-tight text-amber-900 sm:text-sm">
              Pending Requests
            </CardTitle>
            <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-amber-500 shadow-sm sm:flex">
              <Clock className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
            <div className="text-base font-bold tabular-nums text-amber-900 sm:text-3xl">{pendingRequestsCount}</div>
            <p className="mt-0.5 text-[10px] leading-tight text-amber-700 sm:mt-1 sm:text-xs">
              <span className="sm:hidden">Awaiting</span>
              <span className="hidden sm:inline">Awaiting admin approval</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-blue-500 to-blue-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold text-white">
                Inventory
              </CardTitle>
              <CardDescription className="text-blue-100 mt-1">
                Manage your product inventory
              </CardDescription>
            </div>
            <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Package className="h-6 w-6 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {inventoryLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <div className="p-6">
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <InventoryTable data={inventoryData} />
              </Suspense>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
