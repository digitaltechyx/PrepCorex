"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BuyLabelsForm } from "@/components/dashboard/buy-labels-form";
import { AdminPurchasedLabelsSection } from "@/components/admin/admin-purchased-labels-section";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Package, Tag } from "lucide-react";

type LabelsTab = "buy" | "purchased";

export default function AdminBuyLabelsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<LabelsTab>(
    tabParam === "purchased" ? "purchased" : "buy"
  );

  useEffect(() => {
    setActiveTab(tabParam === "purchased" ? "purchased" : "buy");
  }, [tabParam]);

  const handleTabChange = (value: string) => {
    const tab = value as LabelsTab;
    setActiveTab(tab);
    const url = tab === "purchased" ? "/admin/dashboard/buy-labels?tab=purchased" : "/admin/dashboard/buy-labels";
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
        <TabsList className="grid h-auto w-full max-w-md grid-cols-2">
          <TabsTrigger value="buy" className="gap-2">
            <Tag className="h-4 w-4" />
            Buy Label
          </TabsTrigger>
          <TabsTrigger value="purchased" className="gap-2">
            <Package className="h-4 w-4" />
            Purchased Labels
          </TabsTrigger>
        </TabsList>

        <TabsContent value="buy" className="mt-0">
          <Card className="overflow-hidden border-2 shadow-xl">
            <CardHeader className="bg-gradient-to-r from-cyan-500 to-blue-600 pb-4 text-white">
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
            <CardContent className="p-6">
              <BuyLabelsForm successRedirect="/admin/dashboard/buy-labels?tab=purchased" />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="purchased" className="mt-0">
          <AdminPurchasedLabelsSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
