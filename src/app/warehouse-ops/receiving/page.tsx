"use client";

import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsReceiving } from "@/components/warehouse-ops/warehouse-ops-receiving";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { hasFeature } from "@/lib/permissions";
import { useAuth } from "@/hooks/use-auth";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function WarehouseOpsReceivingPage() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();

  if (!hasFeature(userProfile, "ops_receive")) {
    return (
      <div>
        <WarehouseOpsHeader title="Receiving" />
        <p className="text-muted-foreground">You do not have receiving access.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/warehouse-ops">Back</Link>
        </Button>
      </div>
    );
  }

  if (!selectedWarehouse) {
    return (
      <div>
        <WarehouseOpsHeader title="Receiving" />
        <p className="text-muted-foreground">Select a warehouse to continue.</p>
      </div>
    );
  }

  return <WarehouseOpsReceiving warehouse={selectedWarehouse} />;
}
