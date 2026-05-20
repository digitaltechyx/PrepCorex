"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";
import { WarehouseOpsSidebar } from "@/components/warehouse-ops/warehouse-ops-sidebar";
import { WarehouseOpsProvider } from "@/components/warehouse-ops/warehouse-ops-provider";

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
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-orange-600" />
      </div>
    );
  }

  return (
    <WarehouseOpsProvider>
      <div className="flex min-h-screen w-full flex-col sm:flex-row">
        <WarehouseOpsSidebar />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 overflow-auto">{children}</main>
      </div>
    </WarehouseOpsProvider>
  );
}
