"use client";

import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { ShopifyOrdersPanel } from "@/components/integrations/shopify-orders-panel";

function ShopifyOrdersFallback() {
  return (
    <div className="flex items-center justify-center py-24 text-muted-foreground">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
      Loading…
    </div>
  );
}

export default function AdminShopifyOrdersPage() {
  return (
    <Suspense fallback={<ShopifyOrdersFallback />}>
      <ShopifyOrdersPanel />
    </Suspense>
  );
}
