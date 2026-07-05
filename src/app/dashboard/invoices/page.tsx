"use client";

import { useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { DiscountTrailEntry, Invoice } from "@/types";
import { InvoicesSection } from "@/components/dashboard/invoices-section";
import { DiscountTrailPanel } from "@/components/invoices/discount-trail-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Receipt, DollarSign, Info, Mail, Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import { mergeDiscountTrailEntries, sumDiscountTrailAmount } from "@/lib/discount-trail";

export default function InvoicesPage() {
  const { userProfile } = useAuth();
  const [invoiceListTab, setInvoiceListTab] = useState<"pending" | "paid">("pending");
  const [pageTab, setPageTab] = useState<"invoices" | "discount-trail">("invoices");

  const {
    data: invoices,
    loading: invoicesLoading,
  } = useCollection<Invoice>(
    userProfile ? `users/${userProfile.uid}/invoices` : ""
  );

  const {
    data: storedTrail,
    loading: trailLoading,
  } = useCollection<DiscountTrailEntry>(
    userProfile ? `users/${userProfile.uid}/discountTrail` : ""
  );

  const discountTrailEntries = useMemo(
    () => mergeDiscountTrailEntries(storedTrail, invoices),
    [storedTrail, invoices]
  );

  const totalDiscount = useMemo(
    () => sumDiscountTrailAmount(discountTrailEntries),
    [discountTrailEntries]
  );

  const pendingInvoices = invoices.filter((inv) => inv.status === "pending");
  const paidInvoices = invoices.filter((inv) => inv.status === "paid");
  const pendingAmount = pendingInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);

  const handleStatsCardTabClick = (tab: "pending" | "paid") => {
    setPageTab("invoices");
    setInvoiceListTab(tab);
    document.getElementById("invoices-section")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-4">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleStatsCardTabClick("paid")}
          onKeyDown={(e) => e.key === "Enter" && handleStatsCardTabClick("paid")}
          className={cn(
            "border-2 border-purple-200/50 bg-gradient-to-br from-purple-50 to-purple-100/50 shadow-lg cursor-pointer transition-all hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-offset-2",
            pageTab === "invoices" && invoiceListTab === "paid" && "ring-2 ring-purple-400"
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-purple-900">Paid Invoices</CardTitle>
            <div className="h-10 w-10 rounded-full bg-purple-500 flex items-center justify-center shadow-md">
              <Receipt className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-purple-900">{paidInvoices.length}</div>
            <p className="text-xs text-purple-700 mt-1">Paid invoices</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => handleStatsCardTabClick("pending")}
          onKeyDown={(e) => e.key === "Enter" && handleStatsCardTabClick("pending")}
          className={cn(
            "border-2 border-orange-200/50 bg-gradient-to-br from-orange-50 to-orange-100/50 shadow-lg cursor-pointer transition-all hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2",
            pageTab === "invoices" && invoiceListTab === "pending" && "ring-2 ring-orange-400"
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-orange-900">Pending Invoices</CardTitle>
            <div className="h-10 w-10 rounded-full bg-orange-500 flex items-center justify-center shadow-md">
              <Receipt className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-orange-900">{pendingInvoices.length}</div>
            <p className="text-xs text-orange-700 mt-1">Awaiting payment</p>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-200/50 bg-gradient-to-br from-green-50 to-green-100/50 shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-900">Total Pending Amount</CardTitle>
            <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shadow-md">
              <DollarSign className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-green-900">${pendingAmount.toFixed(2)}</div>
            <p className="text-xs text-green-700 mt-1">Pending invoices total</p>
          </CardContent>
        </Card>

        <Card
          role="button"
          tabIndex={0}
          onClick={() => setPageTab("discount-trail")}
          onKeyDown={(e) => e.key === "Enter" && setPageTab("discount-trail")}
          className={cn(
            "border-2 border-emerald-200/50 bg-gradient-to-br from-emerald-50 to-emerald-100/50 shadow-lg cursor-pointer transition-all hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:ring-offset-2",
            pageTab === "discount-trail" && "ring-2 ring-emerald-400"
          )}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-emerald-900">Total Discounts</CardTitle>
            <div className="h-10 w-10 rounded-full bg-emerald-500 flex items-center justify-center shadow-md">
              <Tag className="h-5 w-5 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-emerald-900">${totalDiscount.toFixed(2)}</div>
            <p className="text-xs text-emerald-700 mt-1">Savings to date</p>
          </CardContent>
        </Card>
      </div>

      <Alert className="border-2 border-blue-200 bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50">
        <Info className="h-5 w-5 text-blue-600" />
        <AlertTitle className="text-base font-semibold text-blue-900 mb-2">
          Auto Invoice Generation Feature - Coming Soon
        </AlertTitle>
        <AlertDescription className="text-sm text-blue-800 space-y-2">
          <p>
            The automatic invoice generation feature is currently under development and will be launched in{" "}
            <strong>January 2026</strong>. Please ignore any related functionality for the time being.
          </p>
          <p className="flex items-center gap-2 pt-1">
            <Mail className="h-4 w-4" />
            <span>
              If you have any questions or encounter any issues, please contact our development team at:{" "}
              <a
                href="mailto:onlywork0308@gmail.com"
                className="font-semibold text-blue-900 hover:text-blue-700 underline"
              >
                onlywork0308@gmail.com
              </a>
            </span>
          </p>
        </AlertDescription>
      </Alert>

      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <Receipt className="h-6 w-6" />
                Invoices & discounts
              </CardTitle>
              <CardDescription className="text-purple-100 mt-2">
                View invoices and track admin discounts ({invoices.length} invoice{invoices.length === 1 ? "" : "s"})
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <DollarSign className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <Tabs value={pageTab} onValueChange={(v) => setPageTab(v as typeof pageTab)}>
            <TabsList className="grid w-full grid-cols-2 mb-6 h-12 p-1 rounded-xl bg-slate-100/90 border">
              <TabsTrigger value="invoices" className="rounded-lg gap-2">
                <Receipt className="h-4 w-4" />
                Invoices
              </TabsTrigger>
              <TabsTrigger value="discount-trail" className="rounded-lg gap-2">
                <Tag className="h-4 w-4" />
                Discount trail
                {discountTrailEntries.length > 0 && (
                  <span className="ml-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                    {discountTrailEntries.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="invoices" id="invoices-section">
              <InvoicesSection
                invoices={invoices}
                loading={invoicesLoading}
                activeStatusTab={invoiceListTab}
                onActiveStatusTabChange={setInvoiceListTab}
              />
            </TabsContent>

            <TabsContent value="discount-trail">
              <DiscountTrailPanel
                entries={discountTrailEntries}
                loading={trailLoading || invoicesLoading}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
