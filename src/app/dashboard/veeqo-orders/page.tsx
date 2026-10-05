"use client";

import { Suspense } from "react";
import { VeeqoOrdersPanel } from "@/components/integrations/veeqo-orders-panel";
import { Loader2 } from "lucide-react";

function VeeqoOrdersFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading…
    </div>
  );
}

export default function DashboardVeeqoOrdersPage() {
  return (
    <Suspense fallback={<VeeqoOrdersFallback />}>
      <VeeqoOrdersPanel
        mode="user"
        backHref="/dashboard/integrations"
        backLabel="Integrations"
      />
    </Suspense>
  );
}
