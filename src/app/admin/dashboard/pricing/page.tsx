"use client";

import { DollarSign } from "lucide-react";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PricingManagement } from "@/components/admin/pricing-management";
import { PrepMarketRatesPanel } from "@/components/admin/prep-market-rates-panel";

export default function AdminPricingPage() {
  const { data: users, loading: usersLoading } = useCollection<UserProfile>("users");

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-600 pb-3 text-white sm:pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
                <DollarSign className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                Pricing Management
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-amber-100 sm:mt-2 sm:text-sm">
                Configure user pricing and add-on rates
              </CardDescription>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:flex">
              <DollarSign className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          {usersLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-28 w-full" />
            </div>
          ) : (
            <PricingManagement users={users} />
          )}
        </CardContent>
      </Card>
      <PrepMarketRatesPanel />
    </div>
  );
}
