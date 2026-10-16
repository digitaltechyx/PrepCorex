"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuyLabelsForm } from "@/components/dashboard/buy-labels-form";
import { AdminPurchasedLabelsSection } from "@/components/admin/admin-purchased-labels-section";
import { AdminLabelBillingPanel } from "@/components/admin/admin-label-billing-panel";
import { LabelMarketRatesPanel } from "@/components/admin/label-market-rates-panel";
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
  clearBuyLabelEbayPrefill,
  loadBuyLabelEbayPrefill,
  type BuyLabelEbayPrefill,
} from "@/lib/ebay-order-buy-label-prefill";
import {
  clearBuyLabelParcelPrefillFromSession,
  loadBuyLabelParcelPrefillFromSession,
  type BuyLabelParcelPrefill,
} from "@/lib/buy-label-parcel-prefill";

type LabelsTab = "buy" | "purchased" | "billing";

const tabTriggerClass =
  "gap-1 rounded-lg px-1.5 py-1.5 text-[10px] font-medium sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-sm data-[state=inactive]:text-muted-foreground data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:shadow-sm";

export default function AdminBuyLabelsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const fromShopify = searchParams.get("from") === "shopify";
  const fromEbay = searchParams.get("from") === "ebay";
  const fromOutbound = searchParams.get("from") === "outbound";
  const [activeTab, setActiveTab] = useState<LabelsTab>(
    tabParam === "purchased" ? "purchased" : tabParam === "billing" ? "billing" : "buy"
  );
  const [shopifyPrefill, setShopifyPrefill] = useState<BuyLabelShopifyPrefill | null>(null);
  const [ebayPrefill, setEbayPrefill] = useState<BuyLabelEbayPrefill | null>(null);
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
    if (!fromEbay) {
      setEbayPrefill(null);
      return;
    }
    const prefill = loadBuyLabelEbayPrefill();
    if (prefill) {
      setEbayPrefill(prefill);
      clearBuyLabelEbayPrefill();
    }
  }, [fromEbay]);

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
            : fromEbay
              ? "/admin/dashboard/buy-labels?from=ebay"
            : fromOutbound
              ? "/admin/dashboard/buy-labels?from=outbound"
              : "/admin/dashboard/buy-labels";
    router.replace(url, { scroll: false });
  };

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-cyan-500/5 via-background to-blue-600/5 px-3 py-3 shadow-sm sm:rounded-2xl sm:px-6 sm:py-6">
        <div className="relative min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:gap-3 sm:text-3xl">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500/15 text-cyan-700 shadow-inner dark:text-cyan-300 sm:h-11 sm:w-11 sm:rounded-xl">
              <Tag className="h-4 w-4 sm:h-6 sm:w-6" />
            </span>
            Buy Labels
          </h1>
          <p className="mt-0.5 max-w-xl text-xs text-muted-foreground sm:mt-2 sm:text-sm">
            Purchase shipping labels and view or download completed purchases.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="min-w-0 space-y-3 sm:space-y-6">
        <TabsList className="grid h-auto w-full grid-cols-3 gap-0.5 rounded-xl border border-border/60 bg-muted/50 p-1 sm:max-w-xl sm:gap-1 sm:rounded-2xl sm:border-2 sm:p-1.5">
          <TabsTrigger value="buy" className={tabTriggerClass}>
            <Tag className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Buy</span>
            <span className="hidden sm:inline">Buy Label</span>
          </TabsTrigger>
          <TabsTrigger value="purchased" className={tabTriggerClass}>
            <Package className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Labels</span>
            <span className="hidden sm:inline">Purchased Labels</span>
          </TabsTrigger>
          <TabsTrigger value="billing" className={tabTriggerClass}>
            <Wallet className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Billing</span>
            <span className="hidden sm:inline">Label billing</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buy" className="mt-0">
          <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
            <CardHeader className="rounded-t-lg bg-gradient-to-r from-cyan-500 to-blue-600 p-3 pb-3 text-white sm:p-6 sm:pb-4">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
                    <Tag className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                    Buy Label
                  </CardTitle>
                  <CardDescription className="mt-1 text-xs text-cyan-100 sm:mt-2 sm:text-sm">
                    Purchase shipping labels from the admin dashboard.
                  </CardDescription>
                </div>
                <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:flex">
                  <Tag className="h-7 w-7 text-white" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-0 overflow-visible p-3 sm:p-6">
              <BuyLabelsForm
                compactLayout
                successRedirect="/admin/dashboard/buy-labels?tab=purchased"
                enableClientInventoryPicker
                initialToAddress={shopifyPrefill?.toAddress ?? ebayPrefill?.toAddress ?? null}
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
                        platform: "shopify",
                      }
                    : ebayPrefill?.ownerUserId
                      ? {
                          orderId: ebayPrefill.orderId,
                          orderName: `#${ebayPrefill.orderId}`,
                          shop: "ebay",
                          shopName: "eBay",
                          ownerUserId: ebayPrefill.ownerUserId,
                          ownerName: ebayPrefill.ownerName,
                          customerName: ebayPrefill.customerName ?? null,
                          email: ebayPrefill.email ?? null,
                          shipToSummary: ebayPrefill.toAddress
                            ? [
                                ebayPrefill.toAddress.name,
                                ebayPrefill.toAddress.street1,
                                ebayPrefill.toAddress.city,
                                ebayPrefill.toAddress.state,
                                ebayPrefill.toAddress.zip,
                              ]
                                .filter(Boolean)
                                .join(", ")
                            : null,
                          lineItems: (ebayPrefill.lineItems || []).map((li) => ({
                            title: li.title,
                            sku: li.sku,
                            quantity: li.quantity,
                          })),
                          platform: "ebay" as const,
                          connectionId: ebayPrefill.connectionId,
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

        <TabsContent value="billing" className="mt-0 space-y-3 sm:space-y-6">
          <AdminLabelBillingPanel />
          <LabelMarketRatesPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
