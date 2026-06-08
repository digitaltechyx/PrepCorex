"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsMove } from "@/components/warehouse-ops/warehouse-ops-move";
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

  return <WarehouseOpsMove warehouse={selectedWarehouse} />;
}
