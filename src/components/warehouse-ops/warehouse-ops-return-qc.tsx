"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { ArrowRight, Package } from "lucide-react";

/**
 * Legacy screen — good returns now go Receive → Putaway (no QC gate).
 * Still lists any cartons stuck in quarantine from older receives.
 */
export function WarehouseOpsReturnQc() {
  const { quarantineReturnCartons: cartons, liveLoading: loading } = useWarehouseOpsLive();

  return (
    <div className="max-w-xl space-y-4">
      <WarehouseOpsHeader title="Return QC" />
      <Card className="border-amber-200 bg-amber-50/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Putaway replaces Return QC</CardTitle>
          <CardDescription>
            New return receives go straight to{" "}
            <strong>Putaway</strong> (like inbound). Use Returns → Receive with
            carton/pallet/package + lot, then putaway.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/warehouse-ops/returns">
              Returns <ArrowRight className="h-4 w-4 ml-1" />
            </Link>
          </Button>
          <Button variant="secondary" asChild>
            <Link href="/warehouse-ops/putaway">
              <Package className="h-4 w-4 mr-1" />
              Putaway
            </Link>
          </Button>
        </CardContent>
      </Card>

      {loading ? null : cartons.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Legacy quarantine ({cartons.length})</CardTitle>
            <CardDescription>
              Older return cartons still in quarantine — putaway or handle in Quarantine.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {cartons.map((c) => (
              <div key={c.id} className="rounded border px-3 py-2 font-mono text-xs">
                {c.cartonCode} · {c.productTitle || c.sku} × {c.quantity}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : (
        <p className="text-sm text-muted-foreground text-center py-4">
          No legacy quarantine return cartons.
        </p>
      )}
    </div>
  );
}
