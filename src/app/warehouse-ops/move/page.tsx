"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsMove } from "@/components/warehouse-ops/warehouse-ops-move";
import { WarehouseOpsAreaMove } from "@/components/warehouse-ops/warehouse-ops-area-move";
import { WarehouseOpsAreaToAreaMove } from "@/components/warehouse-ops/warehouse-ops-area-to-area-move";
import { WarehouseOpsActivityLog } from "@/components/warehouse-ops/warehouse-ops-activity-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { hasFeature } from "@/lib/permissions";
import { useAuth } from "@/hooks/use-auth";

export default function WarehouseOpsMovePage() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();

  if (!hasFeature(userProfile, "ops_move")) {
    return (
      <div>
        <WarehouseOpsHeader title="Internal move" />
        <p className="text-muted-foreground">You do not have internal move access.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/warehouse-ops">Back</Link>
        </Button>
      </div>
    );
  }

  if (!selectedWarehouse) {
    return (
      <div>
        <WarehouseOpsHeader title="Internal move" />
        <p className="text-muted-foreground">Select a warehouse to continue.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WarehouseOpsHeader title="Internal move" />
      <Tabs defaultValue="bin-bin" className="w-full">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="bin-bin">Bin → bin</TabsTrigger>
          <TabsTrigger value="bin-area">Bin → area</TabsTrigger>
          <TabsTrigger value="area-area">Area → area</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="bin-bin" className="mt-4">
          <WarehouseOpsMove warehouse={selectedWarehouse} hideHeader />
        </TabsContent>
        <TabsContent value="bin-area" className="mt-4">
          <WarehouseOpsAreaMove warehouse={selectedWarehouse} />
        </TabsContent>
        <TabsContent value="area-area" className="mt-4">
          <WarehouseOpsAreaToAreaMove warehouse={selectedWarehouse} />
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <WarehouseOpsActivityLog warehouse={selectedWarehouse} module="move" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
