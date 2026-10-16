"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminIntegrationsDashboard } from "@/components/admin/admin-integrations-dashboard";

export default function AdminIntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto min-w-0 w-full max-w-[1440px] space-y-3 sm:space-y-6">
          <Skeleton className="h-36 w-full rounded-xl sm:h-48 sm:rounded-2xl" />
          <Skeleton className="h-20 w-full sm:h-24" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl sm:h-64 sm:rounded-2xl" />
            ))}
          </div>
        </div>
      }
    >
      <AdminIntegrationsDashboard />
    </Suspense>
  );
}
