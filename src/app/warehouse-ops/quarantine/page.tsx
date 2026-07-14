"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsQuarantine } from "@/components/warehouse-ops/warehouse-ops-quarantine";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { hasFeature } from "@/lib/permissions";
import { useAuth } from "@/hooks/use-auth";

export default function WarehouseOpsQuarantinePage() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();

  if (!hasFeature(userProfile, "ops_putaway") && !hasFeature(userProfile, "ops_returns")) {
    return (
      <div>
        <WarehouseOpsHeader title="Quarantine" />
        <p className="text-muted-foreground">You do not have quarantine / putaway access.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/warehouse-ops">Back</Link>
        </Button>
      </div>
    );
  }

  if (!selectedWarehouse) {
    return (
      <div>
        <WarehouseOpsHeader title="Quarantine" />
        <p className="text-muted-foreground">Select a warehouse to manage quarantine stock.</p>
      </div>
    );
  }

  return <WarehouseOpsQuarantine warehouse={selectedWarehouse} />;
}
