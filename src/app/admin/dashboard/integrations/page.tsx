"use client";

import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { AdminIntegrationsDashboard } from "@/components/admin/admin-integrations-dashboard";

export default function AdminIntegrationsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-[1440px] space-y-6">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-24 w-full" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-64 rounded-2xl" />
            ))}
          </div>
        </div>
      }
    >
      <AdminIntegrationsDashboard />
    </Suspense>
  );
}
