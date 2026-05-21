"use client";

import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { getOpsNavItems, isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import { hasFeature } from "@/lib/permissions";
import { ArrowRight, Package } from "lucide-react";

export default function WarehouseOpsHomePage() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();
  const navItems = getOpsNavItems(userProfile).filter((n) => n.href !== "/warehouse-ops");

  return (
    <div className="max-w-3xl">
      <WarehouseOpsHeader title="Warehouse Ops" />
      <Card className="border-orange-200/60 dark:border-orange-900/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-orange-600" />
            {selectedWarehouse ? `${selectedWarehouse.code} — ${selectedWarehouse.name}` : "No warehouse selected"}
          </CardTitle>
          <CardDescription>
            Scan-first floor workflows. Receive at the dock, then putaway into storage bins.
            {isOpsSupervisor(userProfile) ? " You have supervisor override access." : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {navItems.map((item) => (
            <Button
              key={item.href}
              variant={item.disabled ? "outline" : "default"}
              className="h-auto py-4 flex flex-col items-start gap-1"
              disabled={item.disabled || !selectedWarehouse}
              asChild={!item.disabled}
            >
              {item.disabled ? (
                <span>
                  <span className="font-semibold">{item.title}</span>
                  <span className="text-xs opacity-80">{item.description}</span>
                </span>
              ) : (
                <Link href={item.href}>
                  <span className="font-semibold flex items-center gap-2">
                    {item.title}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                  {item.description ? (
                    <span className="text-xs opacity-90 font-normal">{item.description}</span>
                  ) : null}
                </Link>
              )}
            </Button>
          ))}
        </CardContent>
      </Card>
      {hasFeature(userProfile, "ops_receive") && selectedWarehouse ? (
        <div className="mt-6">
          <Button size="lg" className="bg-orange-600 hover:bg-orange-700" asChild>
            <Link href="/warehouse-ops/receiving">Start receiving</Link>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
