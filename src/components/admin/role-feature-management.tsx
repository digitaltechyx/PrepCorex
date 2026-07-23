"use client";

import { useState, useMemo, useEffect } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Shield, Zap, RotateCcw, MapPin, Users, UserCheck, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { UserProfile, UserRole, UserFeature, WarehouseDoc } from "@/types";
import { OPS_FEATURES_CONFIG, OPS_FEATURE_PRESETS } from "@/lib/warehouse-ops-permissions";
import { CSV_IMPORT_FEATURES_CONFIG } from "@/lib/csv-import-permissions";
import { getUserRoles, getDefaultFeaturesForRole } from "@/lib/permissions";
import { generateUniqueReferralCode } from "@/lib/commission-utils";
import { generateClientId } from "@/lib/client-id";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { normalizeUserLocationIds } from "@/lib/user-locations";
import {
  findDefaultWarehouseLocationId,
  invalidateDefaultWarehouseLocationCache,
} from "@/lib/default-warehouse";
import { formatWarehouseDisplayName } from "@/lib/warehouse-display";
import { useAuth } from "@/hooks/use-auth";
import { logRolesPermissionsEvent } from "@/lib/roles-permissions-audit";

interface RoleFeatureManagementProps {
  user: UserProfile;
  onSuccess?: () => void;
}

const ALL_ROLES: UserRole[] = ["user", "commission_agent", "sub_admin", "warehouse_operator"];

// Client features — all user-side modules
const CLIENT_FEATURES: { value: UserFeature; label: string; description: string }[] = [
  { value: "view_dashboard", label: "Dashboard", description: "Access to client dashboard overview" },
  { value: "view_inventory", label: "Inventory", description: "View and manage inventory" },
  { value: "shipped_orders", label: "Shipped Orders", description: "View shipped orders" },
  { value: "create_shipment", label: "Outbound Shipment", description: "Create outbound shipments with labels" },
  { value: "buy_labels", label: "Buy Labels", description: "Access to purchase labels" },
  { value: "upload_labels", label: "Upload Labels", description: "Upload shipping labels" },
  { value: "request_product_returns", label: "Product Returns", description: "Request and view product returns" },
  { value: "track_shipment", label: "Track Shipment", description: "Track shipment status" },
  { value: "view_invoices", label: "View Invoices", description: "View and manage invoices" },
  { value: "my_pricing", label: "My Pricing", description: "View my pricing" },
  { value: "restock_summary", label: "Restock Summary", description: "View restock history" },
  { value: "modification_logs", label: "Modification Logs", description: "View edit history" },
  { value: "delete_logs", label: "Delete Logs", description: "View deletion history" },
  { value: "disposed_inventory", label: "Disposed Inventory", description: "View disposed items and recycle bin" },
  { value: "client_documents", label: "Documents", description: "Access to document requests" },
  { value: "integrations", label: "Integrations", description: "Access to Shopify, eBay, ShipStation, WooCommerce, and TikTok Shop integrations" },
  { value: "view_shopify_orders", label: "Shopify Orders", description: "View orders synced from connected Shopify stores" },
  { value: "view_shipstation_orders", label: "ShipStation Orders", description: "View orders and purchased labels from ShipStation" },
  { value: "view_woocommerce_orders", label: "WooCommerce Orders", description: "View orders synced from connected WooCommerce stores" },
  { value: "view_tiktok_orders", label: "TikTok Shop Orders", description: "View orders from connected TikTok Shop stores" },
  { value: "affiliate_dashboard", label: "Affiliate Dashboard", description: "Access affiliate/commission dashboard" },
];

// Admin features (for sub admins) — one per admin module
const ADMIN_FEATURES: { value: UserFeature; label: string; description: string }[] = [
  { value: "admin_dashboard", label: "Admin Dashboard", description: "Access to admin dashboard overview" },
  { value: "manage_users", label: "Manage Users", description: "Create, edit, and manage users" },
  { value: "manage_invoices", label: "Manage Invoices", description: "View and manage invoices and invoice management" },
  { value: "manage_labels", label: "Manage Labels", description: "View and manage uploaded labels" },
  { value: "manage_quotes", label: "Quote Management", description: "Access to quote management" },
  { value: "manage_pricing", label: "Pricing", description: "Access to pricing management" },
  { value: "manage_documents", label: "Documents", description: "Access to document requests" },
  { value: "manage_product_returns", label: "Product Returns", description: "Access to product returns" },
  { value: "manage_dispose_requests", label: "Dispose Requests", description: "Access to dispose requests" },
  { value: "manage_shopify_orders", label: "Shopify Orders", description: "Access to Shopify orders" },
  { value: "manage_ebay_orders", label: "eBay Orders", description: "Access to eBay orders" },
  { value: "manage_shipstation_orders", label: "ShipStation Orders", description: "Access to ShipStation orders and labels" },
  { value: "manage_woocommerce_orders", label: "WooCommerce Orders", description: "Access to WooCommerce orders and fulfillment" },
  { value: "manage_tiktok_orders", label: "TikTok Shop Orders", description: "Access to TikTok Shop orders and fulfillment" },
  { value: "manage_inventory_admin", label: "Inventory Management", description: "Access to admin inventory management" },
  { value: "manage_notifications", label: "Notifications", description: "Access to notifications and pending requests" },
];

// All features combined
const ALL_FEATURES = [...CLIENT_FEATURES, ...ADMIN_FEATURES];

type LocationDoc = { id: string; name?: string; active?: boolean };

export function RoleFeatureManagement({ user, onSuccess }: RoleFeatureManagementProps) {
  const { toast } = useToast();
  const { userProfile: adminUser } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  const { data: locationDocs } = useCollection<LocationDoc>("locations");
  const { data: allUsersList } = useCollection<UserProfile>("users");
  const { data: warehouseDocs } = useCollection<WarehouseDoc>("warehouses");
  const activeWarehouses = useMemo(
    () => warehouseDocs.filter((w) => w.active !== false),
    [warehouseDocs]
  );

  // Firestore may contain legacy values for some fields (e.g. strings/objects instead of arrays).
  // Normalize defensively so this component never crashes on spread/sort.
  const safeFeatures: UserFeature[] = Array.isArray(user.features) ? user.features : [];
  const safeManagedLocationIds: string[] = Array.isArray(user.managedLocationIds)
    ? user.managedLocationIds
    : [];
  const safeAssignedUserIds: string[] = Array.isArray(user.assignedUserIds) ? user.assignedUserIds : [];
  const safeAssignedWarehouseIds: string[] = Array.isArray(user.assignedWarehouseIds)
    ? user.assignedWarehouseIds
    : [];

  const [locationSearch, setLocationSearch] = useState("");
  const [assignedUserSearch, setAssignedUserSearch] = useState("");
  const [affiliateSearch, setAffiliateSearch] = useState("");

  const activeLocations = useMemo(
    () => locationDocs.filter((l) => l.active !== false).map((l) => ({ id: l.id, name: l.name ?? "" })),
    [locationDocs]
  );
  const assignableUsersList = useMemo(
    () =>
      allUsersList
        .filter((u) => u.uid && u.uid !== user.uid && u.status !== "deleted")
        .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "")),
    [allUsersList, user.uid]
  );

  const filteredManagedLocations = useMemo(() => {
    const q = locationSearch.trim().toLowerCase();
    if (!q) return activeLocations;
    return activeLocations.filter((loc) => (loc.name ?? "").toLowerCase().includes(q));
  }, [activeLocations, locationSearch]);

  const filteredAssignableUsers = useMemo(() => {
    const q = assignedUserSearch.trim().toLowerCase();
    if (!q) return assignableUsersList;
    return assignableUsersList.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.uid ?? "").toLowerCase().includes(q)
    );
  }, [assignableUsersList, assignedUserSearch]);

  const filteredAffiliateUsers = useMemo(() => {
    const q = affiliateSearch.trim().toLowerCase();
    if (!q) return assignableUsersList;
    return assignableUsersList.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.uid ?? "").toLowerCase().includes(q)
    );
  }, [assignableUsersList, affiliateSearch]);

  // Get current roles (support both legacy and new format)
  const currentRoles = getUserRoles(user);
  const [selectedRoles, setSelectedRoles] = useState<UserRole[]>(currentRoles);

  // Effective features: if user has no/empty features, use role default (user = 8 client features, sub_admin = default admin modules)
  const effectiveFeatures =
    safeFeatures && safeFeatures.length > 0
      ? safeFeatures
      : currentRoles.includes("user")
        ? getDefaultFeaturesForRole("user")
        : currentRoles.includes("sub_admin")
          ? getDefaultFeaturesForRole("sub_admin")
          : currentRoles.includes("warehouse_operator")
            ? getDefaultFeaturesForRole("warehouse_operator")
            : [];
  const [selectedFeatures, setSelectedFeatures] = useState<UserFeature[]>(effectiveFeatures);

  const [managedLocationIds, setManagedLocationIds] = useState<string[]>(safeManagedLocationIds);
  const [assignedUserIds, setAssignedUserIds] = useState<string[]>(safeAssignedUserIds);
  const [assignedWarehouseIds, setAssignedWarehouseIds] = useState<string[]>(safeAssignedWarehouseIds);

  const [clientLocationIds, setClientLocationIds] = useState<string[]>(() =>
    normalizeUserLocationIds(user.locations)
  );
  const [clientLocationSearch, setClientLocationSearch] = useState("");
  const locationsKey = useMemo(
    () => [...normalizeUserLocationIds(user.locations)].sort().join("\0"),
    [user.uid, user.locations]
  );
  useEffect(() => {
    setClientLocationIds(normalizeUserLocationIds(user.locations));
  }, [user.uid, locationsKey]);

  const filteredClientLocations = useMemo(() => {
    const q = clientLocationSearch.trim().toLowerCase();
    if (!q) return activeLocations;
    return activeLocations.filter((loc) => (loc.name ?? "").toLowerCase().includes(q));
  }, [activeLocations, clientLocationSearch]);

  // Commission agent: users who are assigned as this agent's affiliates (referredByAgentId === user.uid)
  const currentAffiliateIds = useMemo(
    () =>
      allUsersList
        .filter((u) => u.referredByAgentId === user.uid && typeof u.uid === "string" && u.uid.length > 0)
        .map((u) => u.uid as string),
    [allUsersList, user.uid]
  );
  const [assignedAffiliateIds, setAssignedAffiliateIds] = useState<string[]>([]);
  useEffect(() => {
    setAssignedAffiliateIds(
      allUsersList
        .filter((u) => u.referredByAgentId === user.uid && typeof u.uid === "string" && u.uid.length > 0)
        .map((u) => u.uid as string)
    );
  }, [user.uid, allUsersList]);

  const handleRoleToggle = (role: UserRole) => {
    setSelectedRoles((prev) => {
      if (prev.includes(role)) {
        if (role === "sub_admin") {
          setManagedLocationIds([]);
          setAssignedUserIds([]);
        }
        if (role === "commission_agent") {
          setAssignedAffiliateIds([]);
        }
        if (role === "warehouse_operator") {
          setAssignedWarehouseIds([]);
        }
        return prev.filter((r) => r !== role);
      } else {
        if (role === "sub_admin") {
          const defaults = getDefaultFeaturesForRole("sub_admin");
          setSelectedFeatures((f) => {
            const set = new Set([...f, ...defaults]);
            return Array.from(set);
          });
        }
        if (role === "warehouse_operator") {
          const defaults = getDefaultFeaturesForRole("warehouse_operator");
          setSelectedFeatures((f) => {
            const set = new Set([...f, ...defaults]);
            return Array.from(set);
          });
        }
        return [...prev, role];
      }
    });
  };

  const handleFeatureToggle = (feature: UserFeature) => {
    setSelectedFeatures((prev) => {
      if (prev.includes(feature)) {
        return prev.filter((f) => f !== feature);
      } else {
        return [...prev, feature];
      }
    });
  };

  const handleSave = async () => {
    setIsLoading(true);
    try {
      const updateData: any = {
        roles: selectedRoles,
        features: selectedFeatures,
      };

      // Check if commission_agent role is being added (wasn't in current roles, but is in selected roles)
      const hadCommissionAgentRole = currentRoles.includes("commission_agent");
      const hasCommissionAgentRole = selectedRoles.includes("commission_agent");
      const isAddingCommissionAgentRole = !hadCommissionAgentRole && hasCommissionAgentRole;

      // If commission_agent role is being added, generate a NEW referral code
      // (always generate new, even if they had one before - per user requirement)
      if (isAddingCommissionAgentRole) {
        const referralCode = await generateUniqueReferralCode(
          user.name || "AGENT",
          user.uid
        );
        updateData.referralCode = referralCode;
      }

      // If commission_agent role is being removed, we can optionally clear the referral code
      // But we'll keep it for historical purposes (in case they get access back later)
      // The user requirement says to generate NEW code when access is restored, so we don't clear it

      // If user has no roles, keep legacy role for backward compatibility
      if (selectedRoles.length === 0) {
        updateData.role = user.role || "user";
      } else {
        // Set primary role as legacy role for backward compatibility
        updateData.role = selectedRoles[0];
      }

      if (selectedRoles.includes("sub_admin")) {
        updateData.managedLocationIds = managedLocationIds;
        updateData.assignedUserIds = assignedUserIds;
      } else {
        updateData.managedLocationIds = [];
        updateData.assignedUserIds = [];
      }

      if (selectedRoles.includes("warehouse_operator")) {
        updateData.assignedWarehouseIds = assignedWarehouseIds;
      } else {
        updateData.assignedWarehouseIds = [];
      }

      if (selectedRoles.includes("user")) {
        invalidateDefaultWarehouseLocationCache();
        const defaultWarehouseId = await findDefaultWarehouseLocationId();
        const merged = new Set(clientLocationIds.map((id) => String(id).trim()).filter(Boolean));
        if (defaultWarehouseId) {
          merged.add(defaultWarehouseId);
        }
        updateData.locations = Array.from(merged);
        if (!user.clientId?.trim()) {
          updateData.clientId = await generateClientId();
        }
      }

      await updateDoc(doc(db, "users", user.uid), updateData);

      // Commission agent: update referredByAgentId on assigned/unassigned users
      if (selectedRoles.includes("commission_agent")) {
        const toAdd = assignedAffiliateIds.filter((id) => !currentAffiliateIds.includes(id));
        const toRemove = currentAffiliateIds.filter((id) => !assignedAffiliateIds.includes(id));
        for (const uid of toAdd) {
          await updateDoc(doc(db, "users", uid), { referredByAgentId: user.uid });
        }
        for (const uid of toRemove) {
          await updateDoc(doc(db, "users", uid), { referredByAgentId: null });
        }
      }

      void logRolesPermissionsEvent({
        action: "roles_features_updated",
        description: `Updated roles/features for ${formatUserDisplayName(user, { showEmail: false })}`,
        actorUid: adminUser?.uid ?? null,
        actorName: adminUser?.name ?? null,
        actorEmail: adminUser?.email ?? null,
        targetUserIds: user.uid ? [user.uid] : [],
        targetUserLabels: [formatUserDisplayName(user, { showEmail: false })],
        metadata: {
          roles: selectedRoles,
          features: selectedFeatures,
          locations: selectedRoles.includes("user") ? clientLocationIds : undefined,
        },
      });

      const successMessage = isAddingCommissionAgentRole
        ? `Roles and features updated successfully. New referral code: ${updateData.referralCode}`
        : "Roles and features have been updated successfully.";

      toast({
        title: "Success",
        description: successMessage,
      });

      onSuccess?.();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update roles and features.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleResetToDefaultAccess = async () => {
    setShowResetConfirm(false);
    setIsLoading(true);
    try {
      const defaultFeatures = getDefaultFeaturesForRole("user");
      invalidateDefaultWarehouseLocationCache();
      const defaultWarehouseId = await findDefaultWarehouseLocationId();
      const locationSet = new Set(normalizeUserLocationIds(user.locations));
      if (defaultWarehouseId) {
        locationSet.add(defaultWarehouseId);
      }
      const updateData: Record<string, unknown> = {
        roles: ["user"] as UserRole[],
        role: "user",
        features: defaultFeatures,
        managedLocationIds: [],
        assignedUserIds: [],
        locations: Array.from(locationSet),
      };
      if (!user.clientId?.trim()) {
        updateData.clientId = await generateClientId();
      }
      await updateDoc(doc(db, "users", user.uid), updateData);
      setSelectedRoles(["user"]);
      setSelectedFeatures(defaultFeatures);
      setManagedLocationIds([]);
      setAssignedUserIds([]);
      setClientLocationIds(Array.from(locationSet));
      void logRolesPermissionsEvent({
        action: "access_reset_to_default",
        description: `Reset access to client defaults for ${formatUserDisplayName(user, { showEmail: false })}`,
        actorUid: adminUser?.uid ?? null,
        actorName: adminUser?.name ?? null,
        actorEmail: adminUser?.email ?? null,
        targetUserIds: user.uid ? [user.uid] : [],
        targetUserLabels: [formatUserDisplayName(user, { showEmail: false })],
      });
      toast({
        title: "Reset complete",
        description: "User is now client only with the default 8 features. They may need to log out and back in to see changes.",
      });
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to reset access.",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const hasRoleOrFeatureChanges =
    JSON.stringify([...selectedRoles].sort()) !== JSON.stringify([...currentRoles].sort()) ||
    JSON.stringify([...selectedFeatures].sort()) !== JSON.stringify([...effectiveFeatures].sort());
  const hasSubAdminScopeChanges =
    selectedRoles.includes("sub_admin") &&
    (JSON.stringify([...managedLocationIds].sort()) !== JSON.stringify([...safeManagedLocationIds].sort()) ||
     JSON.stringify([...assignedUserIds].sort()) !== JSON.stringify([...safeAssignedUserIds].sort()));
  const hasCommissionAgentScopeChanges =
    selectedRoles.includes("commission_agent") &&
    (JSON.stringify([...assignedAffiliateIds].sort()) !== JSON.stringify([...currentAffiliateIds].sort()));
  const hasClientWarehouseChanges =
    selectedRoles.includes("user") &&
    JSON.stringify([...normalizeUserLocationIds(user.locations)].sort()) !==
      JSON.stringify([...clientLocationIds].sort());
  const hasOpsWarehouseChanges =
    selectedRoles.includes("warehouse_operator") &&
    JSON.stringify([...assignedWarehouseIds].sort()) !==
      JSON.stringify([...safeAssignedWarehouseIds].sort());
  const hasChanges =
    hasRoleOrFeatureChanges ||
    hasSubAdminScopeChanges ||
    hasCommissionAgentScopeChanges ||
    hasClientWarehouseChanges ||
    hasOpsWarehouseChanges;

  return (
    <div className="space-y-6">
      {/* Roles Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            <CardTitle>User Roles</CardTitle>
          </div>
          <CardDescription>
            Assign one or multiple roles to this user. Users with multiple roles will have access to all corresponding dashboards.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {ALL_ROLES.map((role) => {
            const isSelected = selectedRoles.includes(role);
            return (
              <div
                key={role}
                className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors"
              >
                <Checkbox
                  id={`role-${role}`}
                  checked={isSelected}
                  onCheckedChange={() => handleRoleToggle(role)}
                  className="mt-1"
                />
                <div className="flex-1 space-y-1">
                  <Label
                    htmlFor={`role-${role}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      {role === "user"
                        ? "Client/User"
                        : role === "commission_agent"
                          ? "Commission Agent"
                          : role === "warehouse_operator"
                            ? "Warehouse Operator"
                            : "Sub Admin"}
                      {isSelected && (
                        <Badge variant="secondary" className="text-xs">
                          Active
                        </Badge>
                      )}
                    </div>
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {role === "user"
                      ? "Access to client dashboard with inventory management, shipments, and invoices"
                      : role === "commission_agent"
                        ? "Access to affiliate dashboard with referral code, clients, and commissions"
                        : role === "warehouse_operator"
                          ? "Floor app at /warehouse-ops — assign warehouses and ops features below"
                          : "Access to admin dashboard with limited features (select features below)"}
                  </p>
                </div>
              </div>
            );
          })}
          {selectedRoles.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              User must have at least one role. Select a role to continue.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Client: warehouse locations (assign / unassign) */}
      {selectedRoles.includes("user") && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <CardTitle>Client warehouse locations</CardTitle>
            </div>
            <CardDescription>
              Choose which warehouses this client may use in the app. Uncheck to remove access to a location. The
              system default inbound warehouse is always kept when you save if one is configured.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {activeLocations.length > 6 && (
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search warehouses..."
                  value={clientLocationSearch}
                  onChange={(e) => setClientLocationSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              {filteredClientLocations.map((loc) => {
                const isSelected = clientLocationIds.includes(loc.id);
                return (
                  <div key={loc.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                    <Checkbox
                      id={`client-loc-${loc.id}`}
                      checked={isSelected}
                      onCheckedChange={(checked) => {
                        setClientLocationIds((prev) =>
                          checked === true
                            ? prev.includes(loc.id)
                              ? prev
                              : [...prev, loc.id]
                            : prev.filter((id) => id !== loc.id)
                        );
                      }}
                    />
                    <label htmlFor={`client-loc-${loc.id}`} className="text-sm cursor-pointer">
                      {formatWarehouseDisplayName(loc.name)}
                    </label>
                  </div>
                );
              })}
              {activeLocations.length === 0 && (
                <p className="text-sm text-muted-foreground">No locations. Add them in the Assign Location tab.</p>
              )}
              {activeLocations.length > 0 && filteredClientLocations.length === 0 && (
                <p className="text-sm text-muted-foreground">No locations match your search.</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Sub Admin: Locations & Assigned Users */}
      {selectedRoles.includes("sub_admin") && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-primary" />
              <CardTitle>Sub Admin: Locations & Assigned Users</CardTitle>
            </div>
            <CardDescription>
              Select which locations this sub admin manages, then assign users. Sub admin will only see data for assigned users (and users who have the selected locations).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label className="text-sm font-medium">Managed locations</Label>
              <p className="text-xs text-muted-foreground mb-2">Sub admin can manage users who have any of these locations.</p>
              {activeLocations.length > 3 && (
                <div className="relative mb-2">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search locations..."
                    value={locationSearch}
                    onChange={(e) => setLocationSearch(e.target.value)}
                    className="pl-8 h-9"
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {filteredManagedLocations.map((loc) => {
                  const isSelected = managedLocationIds.includes(loc.id);
                  return (
                    <div key={loc.id} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
                      <Checkbox
                        id={`loc-${loc.id}`}
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setManagedLocationIds((prev) =>
                            checked === true
                              ? prev.includes(loc.id)
                                ? prev
                                : [...prev, loc.id]
                              : prev.filter((id) => id !== loc.id)
                          );
                        }}
                      />
                      <label htmlFor={`loc-${loc.id}`} className="text-sm cursor-pointer">{loc.name}</label>
                    </div>
                  );
                })}
                {activeLocations.length === 0 && (
                  <p className="text-sm text-muted-foreground">No locations. Add them in the Assign Location tab.</p>
                )}
                {activeLocations.length > 0 && filteredManagedLocations.length === 0 && (
                  <p className="text-sm text-muted-foreground">No locations match your search.</p>
                )}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <Label className="text-sm font-medium">Assigned users</Label>
                  <p className="text-xs text-muted-foreground">Sub admin can manage only these users (and users with selected locations above).</p>
                </div>
                {managedLocationIds.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const ids = new Set(assignedUserIds);
                      assignableUsersList.forEach((u) => {
                        const userLocs = normalizeUserLocationIds(u.locations);
                        if (userLocs.some((lid) => managedLocationIds.includes(lid))) ids.add(u.uid!);
                      });
                      setAssignedUserIds(Array.from(ids));
                    }}
                  >
                    <Users className="h-4 w-4 mr-1" />
                    Auto-assign by location
                  </Button>
                )}
              </div>
              <div className="relative rounded-md border overflow-hidden">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  placeholder="Search users..."
                  value={assignedUserSearch}
                  onChange={(e) => setAssignedUserSearch(e.target.value)}
                  className="h-9 rounded-b-none border-0 border-b pl-8 focus-visible:ring-0"
                />
                <ScrollArea className="h-[160px] p-3">
                  <div className="space-y-2">
                    {filteredAssignableUsers.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">No users match your search.</p>
                    ) : (
                      filteredAssignableUsers.map((u) => {
                        const isSelected = assignedUserIds.includes(u.uid!);
                        return (
                          <div key={u.uid} className="flex items-center space-x-2">
                            <Checkbox
                              id={`assign-${u.uid}`}
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                setAssignedUserIds((prev) =>
                                  checked === true
                                    ? prev.includes(u.uid!)
                                      ? prev
                                      : [...prev, u.uid!]
                                    : prev.filter((id) => id !== u.uid)
                                );
                              }}
                            />
                            <label htmlFor={`assign-${u.uid}`} className="text-sm cursor-pointer">
                              {formatUserDisplayName(u, { showEmail: false })}
                              {(u.locations?.length ?? 0) > 0 && (
                                <Badge variant="secondary" className="ml-2 text-xs">{(u.locations?.length ?? 0)} loc</Badge>
                              )}
                            </label>
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commission Agent: Assigned Affiliates (same UI pattern as sub admin assign users) */}
      {selectedRoles.includes("commission_agent") && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <UserCheck className="h-5 w-5 text-primary" />
              <CardTitle>Commission Agent: Assigned Affiliates</CardTitle>
            </div>
            <CardDescription>
              Assign existing users to this commission agent so they become his affiliates. These users will show under this agent&apos;s referrals and count toward commissions.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <div>
                  <Label className="text-sm font-medium">Assigned users (affiliates)</Label>
                  <p className="text-xs text-muted-foreground">Users selected here will have this agent set as their referring agent.</p>
                </div>
              </div>
              <div className="relative rounded-md border overflow-hidden">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
                <Input
                  placeholder="Search users..."
                  value={affiliateSearch}
                  onChange={(e) => setAffiliateSearch(e.target.value)}
                  className="h-9 rounded-b-none border-0 border-b pl-8 focus-visible:ring-0"
                />
                <ScrollArea className="h-[160px] p-3">
                  <div className="space-y-2">
                    {filteredAffiliateUsers.length === 0 ? (
                      <p className="py-4 text-center text-sm text-muted-foreground">No users match your search.</p>
                    ) : (
                      filteredAffiliateUsers.map((u) => {
                        const isSelected = assignedAffiliateIds.includes(u.uid!);
                        return (
                          <div key={u.uid} className="flex items-center space-x-2">
                            <Checkbox
                              id={`affiliate-${u.uid}`}
                              checked={isSelected}
                              onCheckedChange={(checked) => {
                                setAssignedAffiliateIds((prev) =>
                                  checked === true
                                    ? prev.includes(u.uid!)
                                      ? prev
                                      : [...prev, u.uid!]
                                    : prev.filter((id) => id !== u.uid)
                                );
                              }}
                            />
                            <label htmlFor={`affiliate-${u.uid}`} className="text-sm cursor-pointer">
                              {formatUserDisplayName(u, { showEmail: false })}
                              {(u.locations?.length ?? 0) > 0 && (
                                <Badge variant="secondary" className="ml-2 text-xs">{(u.locations?.length ?? 0)} loc</Badge>
                              )}
                            </label>
                          </div>
                        );
                      })
                    )}
                  </div>
                </ScrollArea>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Features Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            <CardTitle>Feature Access</CardTitle>
          </div>
          <CardDescription>
            Grant specific feature access to this user. Features can be assigned to any role. 
            For sub admins, select admin features to grant access to specific admin pages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Client Features Section */}
          {selectedRoles.some(r => r === "user" || r === "commission_agent") && (
            <div className="mb-6">
              <h4 className="text-sm font-semibold mb-3 text-muted-foreground">Client Features</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CLIENT_FEATURES.map((feature) => {
                  const isSelected = selectedFeatures.includes(feature.value);
                  return (
                    <div
                      key={feature.value}
                      className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <Checkbox
                        id={`feature-${feature.value}`}
                        checked={isSelected}
                        onCheckedChange={() => handleFeatureToggle(feature.value)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-1">
                        <Label
                          htmlFor={`feature-${feature.value}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {feature.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {selectedRoles.some((r) => r === "user") && (
            <div className="mb-6">
              <h4 className="text-sm font-semibold mb-1 text-muted-foreground">CSV Import Access</h4>
              <p className="text-xs text-muted-foreground mb-3">
                Grant bulk CSV import on specific client modules. Users without these permissions will
                not see Import buttons.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {CSV_IMPORT_FEATURES_CONFIG.map((feature) => {
                  const isSelected = selectedFeatures.includes(feature.value);
                  return (
                    <div
                      key={feature.value}
                      className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                    >
                      <Checkbox
                        id={`feature-${feature.value}`}
                        checked={isSelected}
                        onCheckedChange={() => handleFeatureToggle(feature.value)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-1">
                        <Label
                          htmlFor={`feature-${feature.value}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {feature.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Admin Features Section */}
          {selectedRoles.includes("sub_admin") && (
            <div>
              <div className="mb-3 flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-blue-900 dark:text-blue-100 mb-1">Admin Features Required</h4>
                  <p className="text-xs text-blue-700 dark:text-blue-300">
                    Sub admins must have admin features explicitly granted to access admin pages. Select the features below to grant access.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {ADMIN_FEATURES.map((feature) => {
                  const isSelected = selectedFeatures.includes(feature.value);
                  return (
                    <div
                      key={feature.value}
                      className="flex items-start space-x-3 p-4 border rounded-lg hover:bg-accent/50 transition-colors border-primary/20"
                    >
                      <Checkbox
                        id={`feature-${feature.value}`}
                        checked={isSelected}
                        onCheckedChange={() => handleFeatureToggle(feature.value)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-1">
                        <Label
                          htmlFor={`feature-${feature.value}`}
                          className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                        >
                          {feature.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              {selectedRoles.includes("sub_admin") && 
               !selectedFeatures.some(f => ADMIN_FEATURES.some(af => af.value === f)) && (
                <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200 mb-1">
                    No admin features selected
                  </p>
                  <p className="text-xs text-amber-700 dark:text-amber-300">
                    This sub admin will not have access to any admin pages. Please select at least one admin feature above.
                  </p>
                </div>
              )}
            </div>
          )}

          {selectedRoles.includes("warehouse_operator") && (
            <div className="mt-6 space-y-4">
              <div className="p-3 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                <h4 className="text-sm font-semibold text-orange-900 dark:text-orange-100 mb-1">
                  Warehouse Ops (floor app)
                </h4>
                <p className="text-xs text-orange-800 dark:text-orange-200">
                  Grant ops features for /warehouse-ops. Supervisors: include{" "}
                  <strong>Supervisor overrides</strong>. Assign at least one warehouse below.
                </p>
                <div className="flex flex-wrap gap-2 mt-3">
                  {OPS_FEATURE_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedFeatures((f) => Array.from(new Set([...f, ...preset.features])))}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {OPS_FEATURES_CONFIG.map((feature) => {
                  const isSelected = selectedFeatures.includes(feature.value);
                  return (
                    <div
                      key={feature.value}
                      className="flex items-start space-x-3 p-4 border rounded-lg border-orange-200/50"
                    >
                      <Checkbox
                        id={`ops-feature-${feature.value}`}
                        checked={isSelected}
                        onCheckedChange={() => handleFeatureToggle(feature.value)}
                        className="mt-1"
                      />
                      <div className="flex-1 space-y-1">
                        <Label htmlFor={`ops-feature-${feature.value}`} className="cursor-pointer text-sm font-medium">
                          {feature.label}
                        </Label>
                        <p className="text-xs text-muted-foreground">{feature.description}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-lg border p-4 space-y-2">
                <Label className="text-sm font-medium">Assigned warehouses</Label>
                <div className="flex flex-wrap gap-2">
                  {activeWarehouses.map((w) => {
                    const on = assignedWarehouseIds.includes(w.id);
                    return (
                      <Badge
                        key={w.id}
                        variant={on ? "default" : "outline"}
                        className="cursor-pointer"
                        onClick={() =>
                          setAssignedWarehouseIds((prev) =>
                            on ? prev.filter((id) => id !== w.id) : [...prev, w.id]
                          )
                        }
                      >
                        {w.code} — {w.name}
                      </Badge>
                    );
                  })}
                </div>
                {assignedWarehouseIds.length === 0 ? (
                  <p className="text-xs text-amber-700">No warehouse assigned — operator cannot work until admin assigns one.</p>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Only show reset for users who have the client (user) role — resets them to client + default 8 features. Hidden for admin, and for commission-agent-only or sub-admin-only. */}
        {!selectedRoles.includes("admin") && selectedRoles.includes("user") && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setShowResetConfirm(true)}
            disabled={isLoading}
            className="gap-2"
          >
            <RotateCcw className="h-4 w-4" />
            Reset to default access
          </Button>
        )}
        {selectedRoles.includes("admin") && (
          <p className="text-sm text-muted-foreground">Super admin has full access; reset is not available.</p>
        )}
        {!selectedRoles.includes("admin") && !selectedRoles.includes("user") && (
          <p className="text-sm text-muted-foreground">Reset to default is only for users with Client/User role.</p>
        )}
        <Button
          onClick={handleSave}
          disabled={isLoading || selectedRoles.length === 0 || !hasChanges}
          className="min-w-[120px]"
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>

      <AlertDialog open={showResetConfirm} onOpenChange={setShowResetConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset to default access?</AlertDialogTitle>
            <AlertDialogDescription>
              This will set this user to <strong>Client/User</strong> role only and grant only the <strong>default 8 features</strong> (Inventory, Outbound Shipment, Shipped Orders, My Pricing, Invoices, Restock Summary, Modification Logs, Deleted Logs). Any other roles (e.g. Commission Agent, Sub Admin) and extra features will be removed. The user may need to log out and back in to see changes.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleResetToDefaultAccess} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Reset access
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

