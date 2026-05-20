import type { UserProfile } from "@/types";
import { hasRole } from "@/lib/permissions";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";

/** Post-login landing path from profile roles/status. */
export function getPostLoginPath(userProfile: UserProfile | null | undefined): string {
  if (!userProfile) return "/login";
  const userStatus = userProfile.status || "approved";
  if (userStatus === "pending") return "/pending-approval";
  if (userStatus === "deleted") return "/login";

  const isAdmin = hasRole(userProfile, "admin");
  const isSubAdmin = hasRole(userProfile, "sub_admin");
  const isOpsOnly =
    hasRole(userProfile, "warehouse_operator") && !isAdmin && !isSubAdmin;

  if (isAdmin || isSubAdmin) return "/admin/dashboard";
  if (isOpsOnly && hasWarehouseOpsAccess(userProfile)) return "/warehouse-ops";
  if (hasRole(userProfile, "user")) return "/dashboard";
  if (hasRole(userProfile, "commission_agent")) return "/dashboard/agent";
  if (hasWarehouseOpsAccess(userProfile)) return "/warehouse-ops";
  return "/dashboard";
}
