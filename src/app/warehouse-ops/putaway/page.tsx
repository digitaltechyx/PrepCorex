"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";

export default function WarehouseOpsPutawayPlaceholderPage() {
  return (
    <div className="max-w-xl">
      <WarehouseOpsHeader title="Putaway" />
      <p className="text-muted-foreground mb-4">Phase 4 — scan carton, then bin.</p>
      <Button variant="outline" asChild>
        <Link href="/warehouse-ops">Back to home</Link>
      </Button>
    </div>
  );
}
