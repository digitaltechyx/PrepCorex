"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem, InventoryRequest } from "@/types";
import { InventoryTable } from "@/components/dashboard/inventory-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Package, PackageCheck, Clock } from "lucide-react";
import { useEffect, useRef, useMemo, Suspense } from "react";

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

  const totalQuantity = useMemo(
    () => inventoryData.reduce((sum, item) => sum + (item.quantity || 0), 0),
    [inventoryData]
  );
  const inStockCount = useMemo(
    () => inventoryData.filter((i) => i.status === "In Stock").length,
    [inventoryData]
  );
  const outOfStockCount = useMemo(
    () => inventoryData.filter((i) => i.status === "Out of Stock").length,
    [inventoryData]
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
    <div className="space-y-6">
      {/* Stat cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-2 border-blue-200/50 bg-gradient-to-br from-blue-50 to-blue-100/50 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-900">Total Quantity</CardTitle>
            <div className="h-10 w-10 rounded-full bg-blue-500 flex items-center justify-center shadow-md">
              <Package className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            {inventoryLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-3xl font-bold text-blue-900">{totalQuantity}</div>
                <p className="text-xs text-blue-700 mt-1">Sum of all item quantities</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="border-2 border-sky-200/50 bg-gradient-to-br from-sky-50 to-sky-100/50 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-sky-900">Products</CardTitle>
            <div className="h-10 w-10 rounded-full bg-sky-500 flex items-center justify-center shadow-md">
              <PackageCheck className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            {inventoryLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-3xl font-bold text-sky-900">{inventoryData.length}</div>
                <p className="text-xs text-sky-700 mt-1">Items in inventory</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="border-2 border-green-200/50 bg-gradient-to-br from-green-50 to-green-100/50 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-900">In Stock</CardTitle>
            <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shadow-md">
              <PackageCheck className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            {inventoryLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-3xl font-bold text-green-900">{inStockCount}</div>
                <p className="text-xs text-green-700 mt-1">
                  {outOfStockCount > 0 ? `${outOfStockCount} out of stock` : "All items in stock"}
                </p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="border-2 border-amber-200/50 bg-gradient-to-br from-amber-50 to-amber-100/50 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-amber-900">Pending Requests</CardTitle>
            <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center shadow-md">
              <Clock className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-amber-900">{pendingRequestsCount}</div>
            <p className="text-xs text-amber-700 mt-1">Awaiting admin approval</p>
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
