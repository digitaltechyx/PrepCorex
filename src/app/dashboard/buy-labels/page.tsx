"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { BuyLabelsForm } from "@/components/dashboard/buy-labels-form";
import { Button } from "@/components/ui/button";
import { Package } from "lucide-react";
import Link from "next/link";
import {
  clearBuyLabelParcelPrefillFromSession,
  loadBuyLabelParcelPrefillFromSession,
  type BuyLabelParcelPrefill,
} from "@/lib/buy-label-parcel-prefill";

function BuyLabelsPageContent() {
  const searchParams = useSearchParams();
  const fromOutbound = searchParams.get("from") === "outbound";
  const [parcelPrefill, setParcelPrefill] = useState<BuyLabelParcelPrefill | null>(null);

  useEffect(() => {
    if (!fromOutbound) {
      setParcelPrefill(null);
      return;
    }
    const prefill = loadBuyLabelParcelPrefillFromSession();
    if (prefill) {
      setParcelPrefill(prefill);
      clearBuyLabelParcelPrefillFromSession();
    }
  }, [fromOutbound]);

  const parcelBanner = parcelPrefill
    ? parcelPrefill.productName
      ? `Dimensions and weight loaded from outbound product “${parcelPrefill.productName}”`
      : "Dimensions and weight loaded from your outbound shipment product"
    : null;

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Buy Shipping Labels</h1>
          <p className="text-muted-foreground mt-2">
            Purchase shipping labels for your packages. Enter shipment details, select a carrier, and complete payment.
          </p>
        </div>
        <Link href="/dashboard/purchased-labels">
          <Button variant="default" size="lg" className="shadow-md hover:shadow-lg transition-shadow">
            <Package className="h-5 w-5 mr-2" />
            View Purchased Labels
          </Button>
        </Link>
      </div>
      <BuyLabelsForm
        initialParcel={parcelPrefill}
        parcelPrefillBanner={parcelBanner}
      />
    </div>
  );
}

function BuyLabelsFallback() {
  return (
    <div className="container mx-auto py-6">
      <p className="text-sm text-muted-foreground">Loading Buy Labels…</p>
    </div>
  );
}

export default function BuyLabelsPage() {
  return (
    <Suspense fallback={<BuyLabelsFallback />}>
      <BuyLabelsPageContent />
    </Suspense>
  );
}
