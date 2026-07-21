"use client";

import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { hasRole, hasFeature, getDefaultFeaturesForRole } from "@/lib/permissions";
import { getRequiredFeatureForPath } from "@/lib/dashboard-routes";
import type { UserFeature } from "@/types";
import { Lock } from "lucide-react";

function LockedOverlay() {
  return (
    <div className="relative flex min-h-[60vh] w-full flex-col items-center justify-center overflow-hidden rounded-xl p-6">
      {/* Soft gradient/mesh background so blur has something to work with */}
      <div
        className="absolute inset-0 rounded-xl"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(120, 119, 198, 0.12), transparent), radial-gradient(ellipse 60% 80% at 80% 20%, rgba(99, 102, 241, 0.08), transparent), radial-gradient(ellipse 50% 50% at 20% 80%, rgba(139, 92, 246, 0.06), transparent)",
        }}
      />
      {/* Glass card */}
      <div className="relative flex flex-col items-center justify-center gap-5 rounded-2xl border border-white/20 bg-white/70 px-10 py-10 text-center shadow-xl shadow-black/5 backdrop-blur-xl dark:border-white/10 dark:bg-white/10 dark:shadow-none">
        <div className="flex h-20 w-20 items-center justify-center rounded-full border border-white/30 bg-white/50 shadow-inner backdrop-blur-sm dark:bg-white/5">
          <Lock className="h-9 w-9 text-muted-foreground" />
        </div>
        <div className="space-y-2">
          <p className="text-xl font-semibold tracking-tight text-foreground">Unlock</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Contact with the admin to unlock this feature for your account.
          </p>
        </div>
      </div>
    </div>
  );
}

/** Strict check: for role "user", allow only if requiredFeature is in their features array (or default list if no array). */
function userHasFeature(
  features: UserFeature[] | undefined | null,
  roles: string[],
  requiredFeature: UserFeature
): boolean {
  const rolesLower = (roles || []).map((r) => String(r).toLowerCase().trim());
  const isUser = rolesLower.includes("user");
  if (!isUser) return false;
  const list = Array.isArray(features) ? features : [];
  if (list.length > 0) {
    return list.includes(requiredFeature);
  }
  return getDefaultFeaturesForRole("user").includes(requiredFeature);
}

export function ClientFeatureGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { userProfile } = useAuth();

  // Normalize path (no trailing slash) so it matches route config
  const path = (pathname ?? "").replace(/\/$/, "") || "/";
  const requiredFeature = getRequiredFeatureForPath(path);

  if (!requiredFeature) {
    return <>{children}</>;
  }

  // Only super-admin (role "admin") bypasses the feature list; no other role gets full client access
  const isSuperAdmin = userProfile && hasRole(userProfile, "admin");
  if (isSuperAdmin) {
    return <>{children}</>;
  }

  const isIntegrationsHubPath = path === "/dashboard/integrations" || path.startsWith("/dashboard/integrations/");
  if (
    isIntegrationsHubPath &&
    userProfile &&
    hasRole(userProfile, "sub_admin") &&
    (hasFeature(userProfile, "manage_shopify_orders") ||
      hasFeature(userProfile, "manage_ebay_orders") ||
      hasFeature(userProfile, "manage_shipstation_orders") ||
      hasFeature(userProfile, "manage_woocommerce_orders"))
  ) {
    return <>{children}</>;
  }

  if (requiredFeature === "affiliate_dashboard") {
    if (userProfile && hasFeature(userProfile, "affiliate_dashboard")) {
      return <>{children}</>;
    }
    return <LockedOverlay />;
  }

  // Client (user) route: strict check using profile.features and profile.roles directly
  const roles = (userProfile?.roles && Array.isArray(userProfile.roles)
    ? userProfile.roles
    : userProfile?.role
      ? [userProfile.role]
      : []) as string[];
  const features = Array.isArray(userProfile?.features) ? userProfile.features : [];

  const hasAccess =
    userProfile &&
    userHasFeature(features, roles, requiredFeature);

  if (hasAccess) {
    return <>{children}</>;
  }

  return <LockedOverlay />;
}
