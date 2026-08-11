"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuyLabelsForm } from "@/components/dashboard/buy-labels-form";
import { AdminPurchasedLabelsSection } from "@/components/admin/admin-purchased-labels-section";
import { AdminLabelBillingPanel } from "@/components/admin/admin-label-billing-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, Tag, Wallet } from "lucide-react";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { hasRole } from "@/lib/permissions";
import {
  clearBuyLabelPrefillFromSession,
  loadBuyLabelPrefillFromSession,
  type BuyLabelShopifyPrefill,
} from "@/lib/shopify-order-buy-label-prefill";
import {
  clearBuyLabelParcelPrefillFromSession,
  loadBuyLabelParcelPrefillFromSession,
  type BuyLabelParcelPrefill,
} from "@/lib/buy-label-parcel-prefill";

type LabelsTab = "buy" | "purchased" | "billing";

export default function AdminBuyLabelsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const fromShopify = searchParams.get("from") === "shopify";
  const fromOutbound = searchParams.get("from") === "outbound";
  const [activeTab, setActiveTab] = useState<LabelsTab>(
    tabParam === "purchased" ? "purchased" : tabParam === "billing" ? "billing" : "buy"
  );
  const [shopifyPrefill, setShopifyPrefill] = useState<BuyLabelShopifyPrefill | null>(null);
  const [parcelPrefill, setParcelPrefill] = useState<BuyLabelParcelPrefill | null>(null);
  const { managedUsers } = useManagedUsers();

  const clientOptions = useMemo(
    () =>
      (managedUsers || [])
        .filter((u) => hasRole(u, "user") || hasRole(u, "commission_agent"))
        .filter((u) => u.status === "approved" || !u.status)
        .filter((u) => u.status !== "deleted")
        .map((u) => ({
          uid: u.uid,
          label: formatUserDisplayName(u, { showEmail: true }),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [managedUsers]
  );

  useEffect(() => {
    setActiveTab(
      tabParam === "purchased" ? "purchased" : tabParam === "billing" ? "billing" : "buy"
    );
  }, [tabParam]);

  useEffect(() => {
    if (!fromShopify) {
      setShopifyPrefill(null);
      return;
    }
    const prefill = loadBuyLabelPrefillFromSession();
    if (prefill) {
      setShopifyPrefill(prefill);
      clearBuyLabelPrefillFromSession();
    }
  }, [fromShopify]);

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

  const handleTabChange = (value: string) => {
    const tab = value as LabelsTab;
    setActiveTab(tab);
    const url =
      tab === "purchased"
        ? "/admin/dashboard/buy-labels?tab=purchased"
        : tab === "billing"
          ? "/admin/dashboard/buy-labels?tab=billing"
          : fromShopify
            ? "/admin/dashboard/buy-labels?from=shopify"
            : fromOutbound
              ? "/admin/dashboard/buy-labels?from=outbound"
              : "/admin/dashboard/buy-labels";
    router.replace(url, { scroll: false });
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold tracking-tight">Buy Labels</h1>
        <p className="text-sm text-muted-foreground">
          Purchase shipping labels and view or download completed purchases.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid h-auto w-full max-w-xl grid-cols-3">
          <TabsTrigger value="buy" className="gap-2">
            <Tag className="h-4 w-4" />
            Buy Label
          </TabsTrigger>
          <TabsTrigger value="purchased" className="gap-2">
            <Package className="h-4 w-4" />
            Purchased Labels
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2">
            <Wallet className="h-4 w-4" />
            Label billing
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buy" className="mt-0">
          <Card className="border-2 shadow-xl">
            <CardHeader className="rounded-t-lg bg-gradient-to-r from-cyan-500 to-blue-600 pb-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-2xl font-bold text-white">
                    <Tag className="h-6 w-6" />
                    Buy Label
                  </CardTitle>
                  <CardDescription className="mt-2 text-cyan-100">
                    Purchase shipping labels from the admin dashboard.
                  </CardDescription>
                </div>
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm">
                  <Tag className="h-7 w-7 text-white" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-0 overflow-visible p-6">
              <BuyLabelsForm
                successRedirect="/admin/dashboard/buy-labels?tab=purchased"
                enableClientInventoryPicker
                initialToAddress={shopifyPrefill?.toAddress ?? null}
                shopifyOrderContext={
                  shopifyPrefill?.ownerUserId
                    ? {
                        orderId: shopifyPrefill.orderId,
                        orderName: shopifyPrefill.orderName,
                        shop: shopifyPrefill.shop,
                        shopName: shopifyPrefill.shopName || shopifyPrefill.shop,
                        ownerUserId: shopifyPrefill.ownerUserId,
                        ownerName: shopifyPrefill.ownerName,
                        customerName: shopifyPrefill.customerName ?? null,
                        email: shopifyPrefill.email ?? null,
                        shipToSummary: shopifyPrefill.toAddress
                          ? [
                              shopifyPrefill.toAddress.name,
                              shopifyPrefill.toAddress.street1,
                              shopifyPrefill.toAddress.city,
                              shopifyPrefill.toAddress.state,
                              shopifyPrefill.toAddress.zip,
                            ]
                              .filter(Boolean)
                              .join(", ")
                          : null,
                        lineItems: shopifyPrefill.lineItems || [],
                      }
                    : null
                }
                clientOptions={clientOptions}
                initialParcel={parcelPrefill}
                parcelPrefillBanner={
                  parcelPrefill
                    ? parcelPrefill.productName
                      ? `Dimensions and weight loaded from outbound product “${parcelPrefill.productName}”`
                      : "Dimensions and weight loaded from outbound shipment product"
                    : null
                }
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchased" className="mt-0">
          <AdminPurchasedLabelsSection />
        </TabsContent>

        <TabsContent value="billing" className="mt-0">
          <AdminLabelBillingPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
