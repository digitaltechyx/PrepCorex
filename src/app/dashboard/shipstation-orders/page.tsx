"use client";

import { Suspense } from "react";
import { ShipStationOrdersPanel } from "@/components/integrations/shipstation-orders-panel";
import { Loader2 } from "lucide-react";

function ShipStationOrdersFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading…
    </div>
  );
}

export default function DashboardShipStationOrdersPage() {
  return (
    <Suspense fallback={<ShipStationOrdersFallback />}>
      <ShipStationOrdersPanel
        mode="user"
        backHref="/dashboard/integrations"
        backLabel="Integrations"
      />
    </Suspense>
  );
}
