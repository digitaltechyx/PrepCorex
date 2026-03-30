"use client";

import { Suspense } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem, ShippedItem } from "@/types";
import { ShippedTable } from "@/components/dashboard/shipped-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Truck } from "lucide-react";

export default function ShippedOrdersPage() {
  const { userProfile } = useAuth();

  const { data: shippedData, loading: shippedLoading } = useCollection<ShippedItem>(
    userProfile ? `users/${userProfile.uid}/shipped` : ""
  );

  const { data: inventoryData } = useCollection<InventoryItem>(
    userProfile ? `users/${userProfile.uid}/inventory` : ""
  );

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-purple-500 to-purple-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold text-white">
                Shipped Orders ({shippedData.length})
              </CardTitle>
              <CardDescription className="text-purple-100 mt-1">
                Track your shipped orders
              </CardDescription>
            </div>
            <div className="h-12 w-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Truck className="h-6 w-6 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {shippedLoading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <div className="p-6">
              <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                <ShippedTable data={shippedData} inventory={inventoryData} />
              </Suspense>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
