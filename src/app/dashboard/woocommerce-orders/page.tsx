"use client";

import { Suspense } from "react";
import { WooCommerceOrdersPanel } from "@/components/integrations/woocommerce-orders-panel";
import { Loader2 } from "lucide-react";

function WooCommerceOrdersFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading…
    </div>
  );
}

export default function DashboardWooCommerceOrdersPage() {
  return (
    <Suspense fallback={<WooCommerceOrdersFallback />}>
      <WooCommerceOrdersPanel
        mode="user"
        backHref="/dashboard/integrations"
        backLabel="Integrations"
      />
    </Suspense>
  );
}
