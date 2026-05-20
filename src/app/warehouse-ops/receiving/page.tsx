"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { hasFeature } from "@/lib/permissions";
import { useAuth } from "@/hooks/use-auth";

export default function WarehouseOpsReceivingPage() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();
  const canSeeExpected = hasFeature(userProfile, "ops_view_expected_inbound");

  if (!selectedWarehouse) {
    return (
      <div>
        <WarehouseOpsHeader title="Receiving" />
        <p className="text-muted-foreground">Select a warehouse to continue.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <WarehouseOpsHeader title="Receiving" />
      <Card>
        <CardHeader>
          <CardTitle>Phase 3 — coming next</CardTitle>
          <CardDescription>
            Full receiving (ASN, client request, walk-in, mixed pallet, damaged) will be built here.
            Labels will print from this screen, not from Admin → Warehouses.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Warehouse: <strong className="text-foreground">{selectedWarehouse.code}</strong>
          </p>
          {canSeeExpected ? (
            <p>Expected inbound from client inventory requests will appear in the queue on this screen.</p>
          ) : (
            <p>You do not have the &quot;Expected inbound&quot; feature — walk-in receiving only when live.</p>
          )}
          <Button variant="outline" asChild>
            <Link href="/warehouse-ops">Back to home</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
