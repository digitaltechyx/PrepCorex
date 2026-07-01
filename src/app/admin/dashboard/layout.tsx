"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { AdminSidebar } from "@/components/admin/admin-sidebar";
import { AdminHeader } from "@/components/admin/admin-header";
import {
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";
import { hasRole } from "@/lib/permissions";
import { UserAuditActivityTracker } from "@/components/audit/user-audit-activity-tracker";

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, userProfile, loading } = useAuth();
  const router = useRouter();
  const [showProfile, setShowProfile] = useState(false);
  const canAccessAdmin =
    hasRole(userProfile, "admin") ||
    hasRole(userProfile, "sub_admin") ||
    (userProfile as any)?.features?.includes?.("admin_dashboard");

  const handleProfileClick = () => {
    setShowProfile(!showProfile);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('toggle-profile'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  useEffect(() => {
    if (!loading) {
      // Allow both admin and sub_admin to access admin dashboard
      if (!user || !canAccessAdmin) {
        router.replace("/login");
      }
    }
  }, [user, canAccessAdmin, loading, router]);

  if (loading || !user || !canAccessAdmin) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <UserAuditActivityTracker />
      <div className="flex min-h-screen w-full">
        <AdminSidebar />
        <SidebarInset className="flex flex-col flex-1 min-w-0 overflow-x-hidden">
          <AdminHeader onProfileClick={handleProfileClick} />
          <main className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8 overflow-auto overflow-x-hidden w-full min-w-0 max-w-full">
            <div className="w-full min-w-0 max-w-full">
              {children}
            </div>
          </main>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
