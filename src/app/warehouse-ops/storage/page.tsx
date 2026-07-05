"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsStorage } from "@/components/warehouse-ops/warehouse-ops-storage";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { hasFeature } from "@/lib/permissions";
import { useAuth } from "@/hooks/use-auth";
import { Skeleton } from "@/components/ui/skeleton";

export default function WarehouseOpsStoragePage() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();
  const { clients, loading: clientsLoading } = useWarehouseOpsClients();

  if (!hasFeature(userProfile, "ops_receive")) {
    return (
      <div>
        <WarehouseOpsHeader title="Pallet storage" />
        <p className="text-muted-foreground">You do not have access to pallet storage management.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/warehouse-ops">Back</Link>
        </Button>
      </div>
    );
  }

  if (!selectedWarehouse) {
    return (
      <div>
        <WarehouseOpsHeader title="Pallet storage" />
        <p className="text-muted-foreground">Select a warehouse to continue.</p>
      </div>
    );
  }

  if (clientsLoading) {
    return <Skeleton className="h-64 w-full rounded-xl" />;
  }

  return (
    <div>
      <WarehouseOpsHeader title="Pallet storage" />
      <WarehouseOpsStorage warehouse={selectedWarehouse} clients={clients} />
    </div>
  );
}
