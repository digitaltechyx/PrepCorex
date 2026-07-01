"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Loader2 } from "lucide-react";
import { ProfileDialog } from "@/components/dashboard/profile-dialog";
import { DashboardSidebar } from "@/components/dashboard/dashboard-sidebar";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { ClientFeatureGate } from "@/components/dashboard/client-feature-gate";
import { UserAuditActivityTracker } from "@/components/audit/user-audit-activity-tracker";
import { DashboardNavProvider } from "@/contexts/dashboard-nav-context";
import { hasRole, getUserRoles, isAccountActivated, hasFeature } from "@/lib/permissions";
import {
  SidebarProvider,
  SidebarInset,
} from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, userProfile, loading, signOut } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [showProfile, setShowProfile] = useState(false);

  const handleProfileClick = () => {
    setShowProfile(!showProfile);
    // Also notify the page to toggle its Profile section
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event('toggle-profile'));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Admin/sub_admin without a client role were linked to /dashboard/integrations (legacy) but the client
  // sidebar only lists items for "user" / "commission_agent", so nav appeared empty. Send them to the admin hub.
  useEffect(() => {
    if (loading || !user || !userProfile || !pathname) return;
    const hub =
      pathname === "/dashboard/integrations" || pathname === "/dashboard/integrations/";
    if (!hub) return;
    const hasAdminRole = hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin");
    const hasUserRole = hasRole(userProfile, "user");
    const hasAgentRole = hasRole(userProfile, "commission_agent");
    const canManageOrderIntegrations =
      hasFeature(userProfile, "manage_shopify_orders") || hasFeature(userProfile, "manage_ebay_orders");
    if (hasAdminRole && !hasUserRole && !hasAgentRole && canManageOrderIntegrations) {
      router.replace("/admin/dashboard/integrations");
    }
  }, [loading, user, userProfile, pathname, router]);

  useEffect(() => {
    // Wait for both auth and profile to finish loading
    if (!loading && user) {
      // If userProfile is still null but user exists, wait a bit more
      if (userProfile === null) {
        // User exists but profile not loaded yet - wait
        return;
      }
      
      // Now we have both user and userProfile
      const userRoles = getUserRoles(userProfile);
      const hasAdminRole = hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin");
      const hasUserRole = hasRole(userProfile, "user");
      const hasAgentRole = hasRole(userProfile, "commission_agent");
      const isOnIntegrations =
        pathname === "/dashboard/integrations" || pathname?.startsWith("/dashboard/integrations/");
      const adminCanUseClientIntegrationsHub =
        isOnIntegrations &&
        hasAdminRole &&
        (hasFeature(userProfile, "manage_shopify_orders") || hasFeature(userProfile, "manage_ebay_orders"));

      // Check if user is trying to access agent dashboard
      const isOnAgentDashboard = pathname?.startsWith("/dashboard/agent");

      // Allow access to client dashboard if user has "user" role (even if they also have sub_admin)
      // Allow access to agent dashboard if user has "commission_agent" role (even if they also have sub_admin)
      // Admin/sub_admin without client role may open Integrations (linked from admin sidebar) when they have order features
      if (hasAdminRole && !hasUserRole && !hasAgentRole && !adminCanUseClientIntegrationsHub) {
        router.replace("/admin/dashboard");
      } else if (isOnAgentDashboard && !hasAgentRole) {
        // User is trying to access agent dashboard but doesn't have agent role
        if (hasAdminRole) {
          router.replace("/admin/dashboard");
        } else if (hasUserRole) {
          router.replace("/dashboard");
        } else {
          router.replace("/login");
        }
      } else if (!isOnAgentDashboard && !hasUserRole && !hasAgentRole && !adminCanUseClientIntegrationsHub) {
        // User is on client dashboard but doesn't have user or agent role
        if (hasAdminRole) {
          router.replace("/admin/dashboard");
        } else {
          router.replace("/login");
        }
      } else if (userRoles.length === 0) {
        // Unknown role, redirect to login
        router.replace("/login");
      } else if (userProfile.status === "pending") {
        // Redirect pending users to a waiting page
        router.replace("/pending-approval");
      } else if (hasUserRole && !hasAgentRole && !isAccountActivated(userProfile)) {
        // Client (user only) must accept MSA before accessing dashboard
        const isOnActivatePage = pathname === "/dashboard/activate-account" || pathname?.startsWith("/dashboard/activate-account");
        if (!isOnActivatePage) {
          router.replace("/dashboard/activate-account");
        }
      } else if (userProfile.status === "deleted") {
        // Sign out deleted users
        signOut();
        router.replace("/login");
      }
    } else if (!loading && !user) {
      // No user and not loading - redirect to login
      router.replace("/login");
    }
  }, [user, userProfile, loading, router, signOut, pathname]);

  // Show loading while auth state is being determined
  if (loading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // If no user, show loading (redirect will happen in useEffect)
  if (!user) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // If user exists but profile not loaded yet, wait
  if (user && userProfile === null) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  // If profile loaded but user is not a regular user/agent or has invalid status, show loading (redirect will happen)
  const userRoles = userProfile ? getUserRoles(userProfile) : [];
  const isOnIntegrationsRoute =
    pathname === "/dashboard/integrations" || pathname?.startsWith("/dashboard/integrations/");
  const adminIntegrationsHubOk =
    !!userProfile &&
    isOnIntegrationsRoute &&
    (hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin")) &&
    (hasFeature(userProfile, "manage_shopify_orders") || hasFeature(userProfile, "manage_ebay_orders"));

  if (
    userProfile &&
    ((userRoles.length === 0 ||
      (!hasRole(userProfile, "user") && !hasRole(userProfile, "commission_agent") && !adminIntegrationsHubOk)) ||
      userProfile.status === "pending" ||
      userProfile.status === "deleted")
  ) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  const isOnActivatePage =
    pathname === "/dashboard/activate-account" || pathname?.startsWith("/dashboard/activate-account");
  const needsClientActivation =
    !!userProfile && hasRole(userProfile, "user") && !isAccountActivated(userProfile);

  if (needsClientActivation && isOnActivatePage) {
    return (
      <>
        <UserAuditActivityTracker />
        <main className="min-h-screen w-full bg-background">{children}</main>
      </>
    );
  }

  return (
    <SidebarProvider>
      <UserAuditActivityTracker />
      <DashboardNavProvider>
        <div className="flex min-h-screen w-full">
          <DashboardSidebar />
          <SidebarInset className="flex flex-col flex-1 min-w-0 overflow-x-hidden">
            <DashboardHeader onProfileClick={handleProfileClick} />
          <ProfileDialog open={showProfile} onOpenChange={setShowProfile} />
          <main className="flex flex-1 flex-col gap-4 sm:gap-6 p-4 sm:p-6 lg:p-8 overflow-auto overflow-x-hidden w-full min-w-0 max-w-full">
            <div className="w-full min-w-0 max-w-full">
              <ClientFeatureGate>{children}</ClientFeatureGate>
            </div>
          </main>
        </SidebarInset>
        </div>
      </DashboardNavProvider>
    </SidebarProvider>
  );
}

