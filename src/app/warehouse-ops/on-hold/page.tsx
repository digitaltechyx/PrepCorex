"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsMobileOnHold } from "@/components/warehouse-ops/warehouse-ops-mobile-on-hold";
import { useAuth } from "@/hooks/use-auth";
import { hasFeature } from "@/lib/permissions";

export default function WarehouseOpsOnHoldPage() {
  const { userProfile } = useAuth();

  if (!hasFeature(userProfile, "ops_putaway")) {
    return (
      <div>
        <WarehouseOpsHeader title="On hold" />
        <p className="text-muted-foreground">You do not have putaway access.</p>
        <Button variant="outline" className="mt-4" asChild>
          <Link href="/warehouse-ops">Back</Link>
        </Button>
      </div>
    );
  }

  return <WarehouseOpsMobileOnHold />;
}
