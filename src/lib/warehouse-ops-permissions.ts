import type { UserFeature, UserProfile, WarehouseDoc } from "@/types";
import { hasAnyFeature, hasFeature, hasRole } from "@/lib/permissions";

export const OPS_FEATURES_CONFIG: { value: UserFeature; label: string; description: string }[] = [
  { value: "ops_dashboard", label: "Ops home", description: "Access Warehouse Ops app" },
  { value: "ops_receive", label: "Receiving", description: "Dock receiving and carton labels" },
  { value: "ops_view_expected_inbound", label: "Expected inbound", description: "See client inventory requests on receiving" },
  { value: "ops_putaway", label: "Putaway", description: "Scan carton to storage bin" },
  { value: "ops_move", label: "Internal move", description: "Bin-to-bin moves" },
  { value: "ops_pick", label: "Pick", description: "Outbound order picking (FEFO)" },
  { value: "ops_pack", label: "Pack", description: "Pack and verify (future)" },
  { value: "ops_count", label: "Cycle count", description: "Inventory counts (future)" },
  {
    value: "ops_supervisor",
    label: "Supervisor overrides",
    description: "Void/edit receives after putaway; undo restricted batches",
  },
];

export const OPS_FEATURE_PRESETS: { id: string; label: string; features: UserFeature[] }[] = [
  {
    id: "receiver",
    label: "Receiver",
    features: ["ops_dashboard", "ops_receive", "ops_view_expected_inbound"],
  },
  {
    id: "putaway",
    label: "Putaway",
    features: ["ops_dashboard", "ops_putaway", "ops_move"],
  },
  {
    id: "picker",
    label: "Picker",
    features: ["ops_dashboard", "ops_pick"],
  },
  {
    id: "supervisor",
    label: "Floor supervisor",
    features: [
      "ops_dashboard",
      "ops_receive",
      "ops_view_expected_inbound",
      "ops_putaway",
      "ops_move",
      "ops_pick",
      "ops_supervisor",
    ],
  },
];

const OPS_MENU_FEATURES: UserFeature[] = [
  "ops_receive",
  "ops_putaway",
  "ops_move",
  "ops_pick",
  "ops_pack",
  "ops_count",
];

export function hasWarehouseOpsAccess(userProfile: UserProfile | null | undefined): boolean {
  if (!userProfile) return false;
  if (hasRole(userProfile, "admin")) return true;
  if (hasRole(userProfile, "warehouse_operator") && hasFeature(userProfile, "ops_dashboard")) {
    return true;
  }
  return hasAnyFeature(userProfile, "ops_dashboard", ...OPS_MENU_FEATURES);
}

export function getAssignedWarehouseIds(userProfile: UserProfile | null | undefined): string[] {
  if (!userProfile) return [];
  if (hasRole(userProfile, "admin")) return [];
  const ids = userProfile.assignedWarehouseIds;
  if (!Array.isArray(ids)) return [];
  return ids.map((id) => String(id).trim()).filter(Boolean);
}

/** Warehouses this user may select in ops UI (admin: all active). */
export function filterWarehousesForOpsUser(
  userProfile: UserProfile | null | undefined,
  warehouses: WarehouseDoc[]
): WarehouseDoc[] {
  const active = warehouses.filter((w) => w.active !== false);
  if (!userProfile || hasRole(userProfile, "admin")) return active;
  const allowed = new Set(getAssignedWarehouseIds(userProfile));
  if (allowed.size === 0) return [];
  return active.filter((w) => allowed.has(w.id));
}

export type OpsNavItem = {
  title: string;
  href: string;
  feature: UserFeature;
  description?: string;
  disabled?: boolean;
};

export function getOpsNavItems(userProfile: UserProfile | null | undefined): OpsNavItem[] {
  const items: OpsNavItem[] = [
    {
      title: "Home",
      href: "/warehouse-ops",
      feature: "ops_dashboard",
    },
    {
      title: "Receiving",
      href: "/warehouse-ops/receiving",
      feature: "ops_receive",
    },
    {
      title: "Putaway",
      href: "/warehouse-ops/putaway",
      feature: "ops_putaway",
      description: "Scan carton → scan bin",
    },
    {
      title: "Internal move",
      href: "/warehouse-ops/move",
      feature: "ops_move",
      description: "Bin → bin, bin → area, or area → area",
    },
    {
      title: "Pick",
      href: "/warehouse-ops/pick",
      feature: "ops_pick",
      description: "Scan bin → carton for outbound",
    },
  ];
  return items.filter((item) => hasFeature(userProfile, item.feature));
}

export function isOpsSupervisor(userProfile: UserProfile | null | undefined): boolean {
  return hasRole(userProfile, "admin") || hasFeature(userProfile, "ops_supervisor");
}
