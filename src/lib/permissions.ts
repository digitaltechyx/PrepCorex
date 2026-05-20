import type { UserProfile, UserRole, UserFeature } from "@/types";
import { getRequiredFeatureForPath } from "@/lib/dashboard-routes";

/**
 * Default features for client users after MSA activation (and for legacy users with features).
 * Includes Dashboard and Documents. New users get no features until they accept MSA.
 */
const DEFAULT_CLIENT_FEATURES_FOR_NEW_USERS: UserFeature[] = [
  "view_dashboard",     // Dashboard
  "client_documents",   // Documents tab
  "view_inventory",
  "create_shipment",
  "shipped_orders",
  "my_pricing",
  "view_invoices",
  "restock_summary",
  "modification_logs",
  "delete_logs",
];

export function getDefaultFeaturesForRole(role: UserRole): UserFeature[] {
  if (role === "user") {
    return [...DEFAULT_CLIENT_FEATURES_FOR_NEW_USERS];
  } else if (role === "commission_agent") {
    // Commission agents get affiliate dashboard by default
    return ["affiliate_dashboard"];
  } else if (role === "sub_admin") {
    // Sub admin default: Dashboard, Inventory, Notifications, Users, Invoices, Product Returns, Dispose, Shopify, eBay (data scoped to assigned users)
    return [
      "admin_dashboard",
      "manage_inventory_admin",
      "manage_notifications",
      "manage_users",
      "manage_invoices",
      "manage_product_returns",
      "manage_dispose_requests",
      "manage_shopify_orders",
      "manage_ebay_orders",
    ];
  } else if (role === "warehouse_operator") {
    return ["ops_dashboard", "ops_receive", "ops_view_expected_inbound"];
  }
  // Admin has all features (handled in hasFeature function)
  return [];
}

/**
 * Get all roles for a user (supports both legacy single role and new multiple roles)
 */
export function getUserRoles(userProfile: UserProfile | null | undefined): UserRole[] {
  if (!userProfile) return [];
  
  const normalizeRole = (r: any): UserRole | null => {
    const s = String(r || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");

    if (s === "admin") return "admin";
    if (s === "sub_admin" || s === "subadmin") return "sub_admin";
    if (s === "commission_agent" || s === "commissionagent") return "commission_agent";
    if (s === "user") return "user";
    if (s === "warehouse_operator" || s === "warehouseoperator") return "warehouse_operator";
    return null;
  };

  // If roles array exists, use it
  if (userProfile.roles && Array.isArray(userProfile.roles)) {
    return userProfile.roles.map(normalizeRole).filter(Boolean) as UserRole[];
  }
  
  // Fallback to legacy single role
  if (userProfile.role) {
    const n = normalizeRole(userProfile.role);
    return n ? [n] : [];
  }
  
  return [];
}

/**
 * Check if user has a specific role
 */
export function hasRole(userProfile: UserProfile | null | undefined, role: UserRole): boolean {
  const roles = getUserRoles(userProfile);
  return roles.includes(role);
}

/**
 * Check if user has any of the specified roles
 */
export function hasAnyRole(userProfile: UserProfile | null | undefined, ...roles: UserRole[]): boolean {
  const userRoles = getUserRoles(userProfile);
  return roles.some(role => userRoles.includes(role));
}

/**
 * Check if user has all of the specified roles
 */
export function hasAllRoles(userProfile: UserProfile | null | undefined, ...roles: UserRole[]): boolean {
  const userRoles = getUserRoles(userProfile);
  return roles.every(role => userRoles.includes(role));
}

/**
 * True if client (user role) has accepted MSA and account is activated.
 * Both new and existing users must have accountActivatedAt set (i.e. complete the MSA flow).
 */
export function isAccountActivated(userProfile: UserProfile | null | undefined): boolean {
  if (!userProfile) return false;
  if (!hasRole(userProfile, "user")) return true; // non-clients not gated by MSA
  if (hasRole(userProfile, "warehouse_operator")) return true;
  return !!(userProfile.accountActivatedAt != null);
}

/**
 * Check if user has a specific feature.
 * For clients (role "user"): must be activated (MSA accepted) or have explicit features; then grant from features array or default list.
 */
export function hasFeature(userProfile: UserProfile | null | undefined, feature: UserFeature): boolean {
  if (!userProfile) return false;

  if (hasRole(userProfile, "admin")) return true;

  const features = userProfile.features;
  const hasExplicitFeatures = Array.isArray(features) && features.length > 0;

  if (hasRole(userProfile, "user")) {
    if (!isAccountActivated(userProfile)) return false;
    if (hasExplicitFeatures) return features.includes(feature);
    return DEFAULT_CLIENT_FEATURES_FOR_NEW_USERS.includes(feature);
  }

  // admin_dashboard is only for admin/sub_admin; don't grant to others unless in their list
  if (feature === "admin_dashboard") {
    return hasExplicitFeatures && features.includes("admin_dashboard");
  }

  if (hasRole(userProfile, "warehouse_operator")) {
    if (hasExplicitFeatures) return features.includes(feature);
    return getDefaultFeaturesForRole("warehouse_operator").includes(feature);
  }

  // Sub admins and others: only if explicitly in features array
  if (hasExplicitFeatures) {
    return features.includes(feature);
  }

  return false;
}

/**
 * Check if user has any of the specified features
 */
export function hasAnyFeature(userProfile: UserProfile | null | undefined, ...requestedFeatures: UserFeature[]): boolean {
  if (!userProfile) return false;

  if (hasRole(userProfile, "admin")) return true;

  const userFeatures = userProfile.features;
  const hasExplicitFeatures = Array.isArray(userFeatures) && userFeatures.length > 0;

  if (hasRole(userProfile, "user")) {
    if (!isAccountActivated(userProfile)) return false;
    if (hasExplicitFeatures) {
      return requestedFeatures.some((f) => userFeatures.includes(f));
    }
    return requestedFeatures.some((f) => DEFAULT_CLIENT_FEATURES_FOR_NEW_USERS.includes(f));
  }

  if (hasRole(userProfile, "warehouse_operator")) {
    if (hasExplicitFeatures) {
      return requestedFeatures.some((f) => userFeatures.includes(f));
    }
    const defaults = getDefaultFeaturesForRole("warehouse_operator");
    return requestedFeatures.some((f) => defaults.includes(f));
  }

  if (hasExplicitFeatures) {
    return requestedFeatures.some((f) => userFeatures.includes(f));
  }
  return false;
}

/**
 * Get primary role for display purposes (first role in array, or legacy role)
 */
export function getPrimaryRole(userProfile: UserProfile | null | undefined): UserRole | null {
  const roles = getUserRoles(userProfile);
  return roles.length > 0 ? roles[0] : null;
}

/**
 * For a sub admin, returns the list of user UIDs they can manage.
 * Combines: explicitly assignedUserIds + any user whose locations intersect managedLocationIds.
 * For non–sub admin (e.g. super admin), returns null (meaning no filter / all users).
 */
export function getSubAdminManagedUserIds(
  profile: UserProfile | null | undefined,
  allUsers: UserProfile[]
): string[] | null {
  if (!profile) return null;
  if (hasRole(profile, "admin")) return null;

  if (!hasRole(profile, "sub_admin")) return null;

  const managedIds = new Set<string>();
  const locIds = profile.managedLocationIds ?? [];
  const assignedIds = profile.assignedUserIds ?? [];

  assignedIds.forEach((uid) => managedIds.add(uid));

  allUsers.forEach((u) => {
    if (!u.uid || u.uid === profile.uid) return;
    const userLocs = u.locations ?? [];
    if (userLocs.some((lid) => locIds.includes(lid))) managedIds.add(u.uid);
  });

  return Array.from(managedIds);
}

/**
 * Returns true if the user is allowed to access the given dashboard path (client dashboard).
 * Used by layout to redirect when the user lacks the required feature.
 */
export function canAccessDashboardPath(
  userProfile: UserProfile | null | undefined,
  pathname: string | null
): boolean {
  if (!userProfile) return false;
  const path = (pathname ?? "").replace(/\/$/, "") || "/";
  const required = getRequiredFeatureForPath(path);
  if (!required) return true;
  if (hasRole(userProfile, "admin")) return true;
  if (required === "affiliate_dashboard") return hasFeature(userProfile, "affiliate_dashboard");
  return hasFeature(userProfile, required);
}

