"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";
import { WarehouseOpsSidebar } from "@/components/warehouse-ops/warehouse-ops-sidebar";
import { WarehouseOpsProvider } from "@/components/warehouse-ops/warehouse-ops-provider";
import { WarehouseOpsLiveProvider } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { WarehouseOpsTopbar } from "@/components/warehouse-ops/warehouse-ops-topbar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default function WarehouseOpsLayout({ children }: { children: React.ReactNode }) {
  const { user, userProfile, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user || !hasWarehouseOpsAccess(userProfile)) {
        router.replace("/login");
      }
    }
  }, [user, userProfile, loading, router]);

  if (loading || !user || !hasWarehouseOpsAccess(userProfile)) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-orange-600" />
      </div>
    );
  }

  return (
    <WarehouseOpsProvider>
      <WarehouseOpsLiveProvider>
        <SidebarProvider defaultOpen>
        <div className="flex min-h-screen w-full">
          <WarehouseOpsSidebar />
          <SidebarInset className="flex min-w-0 flex-1 flex-col">
            <WarehouseOpsTopbar />
            <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">{children}</main>
          </SidebarInset>
        </div>
        </SidebarProvider>
      </WarehouseOpsLiveProvider>
    </WarehouseOpsProvider>
  );
}
