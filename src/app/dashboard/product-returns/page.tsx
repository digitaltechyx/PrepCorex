 "use client";

import { useState } from "react";
import { ArrowLeftRight, Clock, Package, CheckCircle, FileStack } from "lucide-react";
 import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
 import { ProductReturnRequestForm } from "@/components/dashboard/product-return-request-form";
 import { ProductReturnTable } from "@/components/dashboard/product-return-table";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { ProductReturn } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

 export default function ProductReturnsPage() {
  const { userProfile } = useAuth();
  const [showNewRequestForm, setShowNewRequestForm] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>("all");

  const { data: returns = [], loading: returnsLoading } = useCollection<ProductReturn>(
    userProfile ? `users/${userProfile.uid}/productReturns` : ""
  );

  const pendingCount = returns.filter((r) => r.status === "pending").length;
  const inProgressCount = returns.filter((r) => r.status === "in_progress").length;
  const closedCount = returns.filter((r) => r.status === "closed").length;
  const totalCount = returns.length;

  const handleStatCardClick = (filter: string) => {
    setHistoryStatusFilter(filter);
  };

   return (
     <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden rounded-xl border-border/50">
        <CardHeader className="bg-gradient-to-r from-orange-500 to-amber-600 text-white pb-5">
          <div className="flex items-center justify-between gap-4">
             <div>
               <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                 <ArrowLeftRight className="h-6 w-6" />
                 Product Returns
               </CardTitle>
              <CardDescription className="text-orange-100 mt-1.5">
                 Create a return request and track its status
               </CardDescription>
             </div>
            <div className="h-14 w-14 rounded-xl bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
               <ArrowLeftRight className="h-7 w-7 text-white" />
             </div>
           </div>
         </CardHeader>
         <CardContent className="p-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card
              role="button"
              tabIndex={0}
              onClick={() => handleStatCardClick("pending")}
              onKeyDown={(e) => e.key === "Enter" && handleStatCardClick("pending")}
              className={cn(
                "border-2 border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 rounded-xl overflow-hidden",
                historyStatusFilter === "pending" && "ring-2 ring-amber-400"
              )}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-amber-900 dark:text-amber-100">Pending</CardTitle>
                <div className="h-9 w-9 rounded-lg bg-amber-500 flex items-center justify-center shadow-sm">
                  <Clock className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {returnsLoading ? (
                  <Skeleton className="h-8 w-12 rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingCount}</div>
                    <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Awaiting review</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => handleStatCardClick("in_progress")}
              onKeyDown={(e) => e.key === "Enter" && handleStatCardClick("in_progress")}
              className={cn(
                "border-2 border-blue-200/60 bg-gradient-to-br from-blue-50 to-sky-50/50 dark:from-blue-950/20 dark:to-sky-950/20 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 rounded-xl overflow-hidden",
                historyStatusFilter === "in_progress" && "ring-2 ring-blue-400"
              )}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-blue-900 dark:text-blue-100">In Progress</CardTitle>
                <div className="h-9 w-9 rounded-lg bg-blue-500 flex items-center justify-center shadow-sm">
                  <Package className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {returnsLoading ? (
                  <Skeleton className="h-8 w-12 rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{inProgressCount}</div>
                    <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">Receiving</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => handleStatCardClick("closed")}
              onKeyDown={(e) => e.key === "Enter" && handleStatCardClick("closed")}
              className={cn(
                "border-2 border-green-200/60 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 rounded-xl overflow-hidden",
                historyStatusFilter === "closed" && "ring-2 ring-green-400"
              )}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-green-900 dark:text-green-100">Closed</CardTitle>
                <div className="h-9 w-9 rounded-lg bg-green-500 flex items-center justify-center shadow-sm">
                  <CheckCircle className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {returnsLoading ? (
                  <Skeleton className="h-8 w-12 rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-green-900 dark:text-green-100">{closedCount}</div>
                    <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">Completed</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => handleStatCardClick("all")}
              onKeyDown={(e) => e.key === "Enter" && handleStatCardClick("all")}
              className={cn(
                "border-2 border-slate-200/60 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-900/30 dark:to-slate-800/30 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 rounded-xl overflow-hidden",
                historyStatusFilter === "all" && "ring-2 ring-slate-400"
              )}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-900 dark:text-slate-100">Total</CardTitle>
                <div className="h-9 w-9 rounded-lg bg-slate-500 flex items-center justify-center shadow-sm">
                  <FileStack className="h-4 w-4 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {returnsLoading ? (
                  <Skeleton className="h-8 w-12 rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{totalCount}</div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">All returns</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="flex items-center justify-end mb-4">
            <Button
              type="button"
              onClick={() => setShowNewRequestForm((prev) => !prev)}
              variant={showNewRequestForm ? "secondary" : "default"}
              className="rounded-lg"
            >
              {showNewRequestForm ? "Hide New Request" : "New Request"}
            </Button>
          </div>

          {showNewRequestForm && (
            <div className="mb-6">
              <ProductReturnRequestForm />
            </div>
          )}

          <ProductReturnTable
            statusFilter={historyStatusFilter}
            onStatusFilterChange={setHistoryStatusFilter}
          />
         </CardContent>
       </Card>
     </div>
   );
 }
