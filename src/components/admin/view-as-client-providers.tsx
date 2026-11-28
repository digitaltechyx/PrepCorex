"use client";

import { Suspense, type ReactNode } from "react";
import { ViewAsClientProvider } from "@/contexts/view-as-client-context";
import { AdminImpersonationBanner } from "@/components/admin/admin-impersonation-banner";

export function ViewAsClientProviders({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<>{children}</>}>
      <ViewAsClientProvider>
        <AdminImpersonationBanner />
        {children}
      </ViewAsClientProvider>
    </Suspense>
  );
}
