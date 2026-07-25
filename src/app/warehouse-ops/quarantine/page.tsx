"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsQuarantine } from "@/components/warehouse-ops/warehouse-ops-quarantine";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { hasFeature } from "@/lib/permissions";
import { useAuth } from "@/hooks/use-auth";

function WarehouseOpsQuarantineContent() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const defaultTab = tabParam === "requests" ? "requests" : tabParam === "log" ? "log" : "work";

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

  return <WarehouseOpsQuarantine warehouse={selectedWarehouse} defaultTab={defaultTab} />;
}

export default function WarehouseOpsQuarantinePage() {
  return (
    <Suspense
      fallback={
        <div>
          <WarehouseOpsHeader title="Quarantine" />
          <p className="text-muted-foreground">Loading…</p>
        </div>
      }
    >
      <WarehouseOpsQuarantineContent />
    </Suspense>
  );
}
