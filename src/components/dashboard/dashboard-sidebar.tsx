"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { NavMenuCountBadge } from "@/components/ui/nav-menu-count-badge";
import {
  LayoutDashboard,
  History,
  Trash2,
  Edit,
  RotateCcw,
  FileText,
  Package,
  PackageCheck,
  X,
  ShoppingBag,
  Store,
  Truck,
  Users,
  UserCheck,
  DollarSign,
  Upload,
  FileUp,
  ArrowLeftRight,
  FolderOpen,
  Plug,
  Ship,
  ChevronLeft,
  ChevronDown,
  Shield,
  XCircle,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useClientSidebarBadges } from "@/hooks/use-client-sidebar-badges";
import { useAdminSidebarBadges } from "@/hooks/use-admin-sidebar-badges";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { hasRole, hasFeature } from "@/lib/permissions";
import { brandLogoSrc } from "@/components/logo";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findDefaultWarehouseLocationIdInList } from "@/lib/default-warehouse";
import { formatWarehouseDisplayName, isDefaultNj2Warehouse, normalizeWarehouseKey } from "@/lib/warehouse-display";

type LocationDoc = {
  id: string;
  name?: string;
  country?: string;
  stateOrProvince?: string;
  active?: boolean;
};

export function DashboardSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { userProfile } = useAuth();
  const { setOpenMobile, isMobile } = useSidebar();
  const { managedUsers } = useManagedUsers();
  const {
    pendingInvoicesCount,
    pendingShopifyOrdersCount,
    pendingInboundCount,
    pendingOutboundCount,
    inventoryActionCount,
    pendingProductReturnsCount,
    pendingDocumentsCount,
    pendingDisposeCount,
    pendingLabelsCount,
    pendingAffiliateClientsCount,
    affiliateAttentionCount,
  } = useClientSidebarBadges();
  const { totalAdminAttentionCount } = useAdminSidebarBadges(
    managedUsers,
    Boolean(userProfile?.uid && (hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin")))
  );

  const { data: locationDocs } = useCollection<LocationDoc>("locations");
  const assignedLocationIds = useMemo(
    () => new Set((userProfile?.locations ?? []).filter(Boolean)),
    [userProfile?.locations]
  );
  const allActiveLocations = useMemo(
    () =>
      locationDocs.filter(
        (loc) => loc.active !== false
      ),
    [locationDocs]
  );
  /** Warehouse dropdown lists all active locations (assigned + unassigned). */
  const warehouseOptionsSorted = useMemo(
    () =>
      [...allActiveLocations].sort((a, b) =>
        formatWarehouseDisplayName(a.name).localeCompare(formatWarehouseDisplayName(b.name))
      ),
    [allActiveLocations]
  );
  const firstAssignedLocation = useMemo(() => {
    const orderedAssignedIds = userProfile?.locations ?? [];
    for (const id of orderedAssignedIds) {
      const loc = allActiveLocations.find((candidate) => candidate.id === id);
      if (loc) return loc;
    }
    return undefined;
  }, [userProfile?.locations, allActiveLocations]);
  const nj2Location = useMemo(
    () =>
      allActiveLocations.find((loc) => {
        const display = formatWarehouseDisplayName(loc.name);
        const normalized = normalizeWarehouseKey(loc.name ?? "");
        return (
          display === "NJ-02" ||
          display.startsWith("NJ-02") ||
          isDefaultNj2Warehouse(loc.name) ||
          /^nj0*2/.test(normalized)
        );
      }),
    [allActiveLocations]
  );
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");
  const [inventoryMenuOpen, setInventoryMenuOpen] = useState(() =>
    pathname === "/dashboard/inventory" || pathname?.startsWith("/dashboard/create-shipment-with-labels")
  );
  useEffect(() => {
    if (
      pathname === "/dashboard/inventory" ||
      pathname?.startsWith("/dashboard/inventory/") ||
      pathname === "/dashboard/create-shipment-with-labels" ||
      pathname?.startsWith("/dashboard/create-shipment-with-labels/")
    ) {
      setInventoryMenuOpen(true);
    }
  }, [pathname]);
  const pickNj2FromPool = (pool: LocationDoc[]) =>
    pool.find((loc) => {
      const display = formatWarehouseDisplayName(loc.name);
      const normalized = normalizeWarehouseKey(loc.name ?? "");
      return (
        display === "NJ-02" ||
        display.startsWith("NJ-02") ||
        isDefaultNj2Warehouse(loc.name) ||
        /^nj0*2/.test(normalized)
      );
    });

  useEffect(() => {
    if (!userProfile?.uid) return;

    // Client users: warehouse dropdown should show all active locations.
    if (hasRole(userProfile, "user")) {
      const pool = warehouseOptionsSorted;
      if (pool.length === 0) {
        setSelectedWarehouseId("");
        return;
      }
      if (selectedWarehouseId && pool.some((loc) => loc.id === selectedWarehouseId)) {
        return;
      }

      const key = `warehouseSelection:${userProfile.uid}`;
      let storedId = "";
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw) as { locationId?: string };
          storedId = parsed.locationId?.trim() || "";
        }
      } catch {
        storedId = "";
      }
      if (storedId && pool.some((loc) => loc.id === storedId)) {
        setSelectedWarehouseId(storedId);
        return;
      }

      const defaultId = findDefaultWarehouseLocationIdInList(pool);
      const preferred =
        pickNj2FromPool(pool) ||
        (firstAssignedLocation && pool.some((l) => l.id === firstAssignedLocation.id)
          ? firstAssignedLocation
          : undefined) ||
        (defaultId ? pool.find((loc) => loc.id === defaultId) : undefined) ||
        pool[0];
      if (preferred) setSelectedWarehouseId(preferred.id);
      return;
    }

    const all = allActiveLocations;
    if (all.length === 0) {
      setSelectedWarehouseId("");
      return;
    }

    if (selectedWarehouseId && all.some((loc) => loc.id === selectedWarehouseId)) {
      return;
    }

    const key = `warehouseSelection:${userProfile.uid}`;
    let storedId = "";
    try {
      const raw = localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as { locationId?: string };
        storedId = parsed.locationId?.trim() || "";
      }
    } catch {
      storedId = "";
    }
    if (storedId && all.some((loc) => loc.id === storedId)) {
      setSelectedWarehouseId(storedId);
      return;
    }

    const defaultId = findDefaultWarehouseLocationIdInList(all);
    const preferred =
      nj2Location ||
      firstAssignedLocation ||
      (defaultId ? all.find((loc) => loc.id === defaultId) : undefined) ||
      all[0];
    if (!preferred) return;
    setSelectedWarehouseId(preferred.id);
  }, [
    userProfile,
    userProfile?.uid,
    allActiveLocations,
    warehouseOptionsSorted,
    selectedWarehouseId,
    firstAssignedLocation,
    nj2Location,
  ]);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const key = `warehouseSelection:${userProfile.uid}`;
    const payload = JSON.stringify({
      locationId: selectedWarehouseId || undefined,
    });
    localStorage.setItem(key, payload);
    window.dispatchEvent(new Event("warehouse-selection-changed"));
  }, [userProfile?.uid, selectedWarehouseId]);

  useEffect(() => {
    if (!selectedWarehouseId) return;
    if (hasRole(userProfile, "user")) {
      if (!warehouseOptionsSorted.some((loc) => loc.id === selectedWarehouseId)) {
        setSelectedWarehouseId("");
      }
      return;
    }
    if (!allActiveLocations.some((loc) => loc.id === selectedWarehouseId)) {
      setSelectedWarehouseId("");
    }
  }, [allActiveLocations, selectedWarehouseId, userProfile, warehouseOptionsSorted]);

  // Safety fallback: never leave warehouse unselected when options are available.
  useEffect(() => {
    if (!hasRole(userProfile, "user")) return;
    if (selectedWarehouseId) return;
    const pool = warehouseOptionsSorted;
    if (pool.length === 0) return;
    const defaultId = findDefaultWarehouseLocationIdInList(pool);
    const preferredId =
      pickNj2FromPool(pool)?.id ||
      (firstAssignedLocation && pool.some((l) => l.id === firstAssignedLocation.id)
        ? firstAssignedLocation.id
        : undefined) ||
      (defaultId ? pool.find((l) => l.id === defaultId)?.id : undefined) ||
      pool[0]?.id;
    if (preferredId) {
      setSelectedWarehouseId(preferredId);
    }
  }, [
    userProfile,
    selectedWarehouseId,
    firstAssignedLocation,
    warehouseOptionsSorted,
  ]);

  // Check if user has "user" role - if yes, show full client dashboard
  // If only commission_agent, show only affiliate menu
  const hasUserRole = hasRole(userProfile, "user");
  const hasAgentRole = hasRole(userProfile, "commission_agent");

  // Build menu items based on roles and features
  const allMenuItems = [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
      color: "text-blue-600",
      requiredRole: "user" as const,
      requiredFeature: "view_dashboard" as const,
    },
    {
      title: "Inventory",
      url: "/dashboard/inventory",
      icon: PackageCheck,
      color: "text-sky-600",
      badge: inventoryActionCount > 0 ? inventoryActionCount : null,
      requiredRole: "user" as const,
      requiredFeature: "view_inventory" as const,
    },
    {
      title: "Outbound Shipment",
      url: "/dashboard/create-shipment-with-labels",
      icon: Upload,
      color: "text-indigo-600",
      badge: pendingOutboundCount > 0 ? pendingOutboundCount : null,
      requiredRole: "user" as const,
      requiredFeature: "create_shipment" as const,
    },
    {
      title: "Buy Labels",
      url: "/dashboard/buy-labels",
      icon: ShoppingBag,
      color: "text-blue-600",
      badge: pendingLabelsCount > 0 ? pendingLabelsCount : null,
      requiredRole: "user" as const,
      requiredFeature: "buy_labels" as const,
    },
    {
      title: "Shipped Orders",
      url: "/dashboard/shipped-orders",
      icon: Truck,
      color: "text-teal-600",
      requiredRole: "user" as const,
      requiredFeature: "shipped_orders" as const,
    },
    {
      title: "Shopify Orders",
      url: "/dashboard/shopify-orders",
      icon: Store,
      color: "text-emerald-600",
      badge: pendingShopifyOrdersCount > 0 ? pendingShopifyOrdersCount : null,
      requiredRole: "user" as const,
      requiredFeature: "view_shopify_orders" as const,
    },
    {
      title: "TikTok Shop Orders",
      url: "/dashboard/tiktok-orders",
      icon: ShoppingBag,
      color: "text-fuchsia-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "view_tiktok_orders" as const,
    },
    {
      title: "ShipStation Orders",
      url: "/dashboard/shipstation-orders",
      icon: Ship,
      color: "text-indigo-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "integrations" as const,
    },
    {
      title: "WooCommerce Orders",
      url: "/dashboard/woocommerce-orders",
      icon: ShoppingBag,
      color: "text-violet-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "integrations" as const,
    },
    {
      title: "Product Returns",
      url: "/dashboard/product-returns",
      icon: ArrowLeftRight,
      color: "text-orange-600",
      badge: pendingProductReturnsCount > 0 ? pendingProductReturnsCount : null,
      requiredRole: "user" as const,
      requiredFeature: "request_product_returns" as const,
    },
    {
      title: "Disposed Inventory",
      url: "/dashboard/recycle-bin",
      icon: RotateCcw,
      color: "text-orange-600",
      badge: pendingDisposeCount > 0 ? pendingDisposeCount : null,
      requiredRole: "user" as const,
      requiredFeature: "disposed_inventory" as const,
    },
    {
      title: "Invoices",
      url: "/dashboard/invoices",
      icon: FileText,
      color: "text-purple-600",
      badge: pendingInvoicesCount > 0 ? pendingInvoicesCount : null,
      requiredRole: "user" as const,
      requiredFeature: "view_invoices" as const,
    },
    {
      title: "Restock Summary",
      url: "/dashboard/restock-history",
      icon: History,
      color: "text-green-600",
      requiredRole: "user" as const,
      requiredFeature: "restock_summary" as const,
    },
    {
      title: "Modification Logs",
      url: "/dashboard/edit-logs",
      icon: Edit,
      color: "text-blue-600",
      requiredRole: "user" as const,
      requiredFeature: "modification_logs" as const,
    },
    {
      title: "Deleted Logs",
      url: "/dashboard/delete-logs",
      icon: Trash2,
      color: "text-red-600",
      requiredRole: "user" as const,
      requiredFeature: "delete_logs" as const,
    },
    {
      title: "My Pricing",
      url: "/dashboard/pricing",
      icon: DollarSign,
      color: "text-green-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "my_pricing" as const,
    },
    {
      title: "Track Shipment",
      url: "/dashboard/track-shipment",
      icon: Truck,
      color: "text-teal-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "track_shipment" as const,
    },
    {
      title: "Documents",
      url: "/dashboard/documents",
      icon: FolderOpen,
      color: "text-indigo-600",
      badge: pendingDocumentsCount > 0 ? pendingDocumentsCount : null,
      requiredRole: "user" as const,
      requiredFeature: "client_documents" as const,
    },
    {
      title: "Integrations",
      url: "/dashboard/integrations",
      icon: Plug,
      color: "text-emerald-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "integrations" as const,
    },
    {
      title: "Affiliate",
      url: "/dashboard/agent",
      icon: UserCheck,
      color: "text-purple-600",
      badge: affiliateAttentionCount > 0 ? affiliateAttentionCount : null,
      requiredRole: "commission_agent" as const,
      requiredFeature: "affiliate_dashboard" as const,
    },
  ];

  // Filter menu items: show all client items to users (so they see full nav; locked ones show blur on click)
  // Commission-agent items only show when user has that role and the affiliate feature
  const filteredClientMenu = allMenuItems.filter((item) => {
    const hasRequiredRole =
      (item.requiredRole === "user" && hasUserRole) ||
      (item.requiredRole === "commission_agent" && hasAgentRole);

    if (!hasRequiredRole) return false;

    // User-role items: show all to clients so they can see and click; lack of feature shows blur overlay on page
    if (item.requiredRole === "user") {
      return true;
    }

    // Commission-agent: only show if they have the affiliate feature
    if (item.requiredRole === "commission_agent" && item.requiredFeature) {
      return hasFeature(userProfile, item.requiredFeature);
    }

    return true;
  }).map(({ requiredRole, requiredFeature, ...item }) => item); // Remove internal fields

  const hasAdminRole = hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin");
  const onClientIntegrationsSubtree =
    pathname === "/dashboard/integrations" || pathname?.startsWith("/dashboard/integrations/");
  const adminOnlyNeedsIntegrationsNav =
    hasAdminRole &&
    !hasUserRole &&
    !hasAgentRole &&
    (hasFeature(userProfile, "manage_shopify_orders") ||
      hasFeature(userProfile, "manage_ebay_orders") ||
      hasFeature(userProfile, "manage_shipstation_orders") ||
      hasFeature(userProfile, "manage_woocommerce_orders") ||
      hasFeature(userProfile, "manage_tiktok_orders")) &&
    onClientIntegrationsSubtree;

  const showAffiliateAccess =
    hasAgentRole && hasFeature(userProfile, "affiliate_dashboard");
  const isAffiliateZone =
    pathname === "/dashboard/agent" || pathname?.startsWith("/dashboard/agent/");
  const showAffiliateShell =
    !adminOnlyNeedsIntegrationsNav && isAffiliateZone && showAffiliateAccess;

  const affiliateBackHref = hasUserRole ? "/dashboard" : hasAdminRole ? "/admin/dashboard" : "/dashboard";
  const affiliateBackLabel = hasUserRole ? "Client dashboard" : hasAdminRole ? "Admin dashboard" : "Dashboard";

  // Client + affiliate: keep affiliate out of the main list so opening it feels like a separate workspace (with back).
  const mainClientNavItems =
    hasUserRole && showAffiliateAccess
      ? filteredClientMenu.filter((item) => item.url !== "/dashboard/agent")
      : filteredClientMenu;

  type NavItem = (typeof filteredClientMenu)[number];
  const otherWorkspaces: NavItem[] = [];
  if (hasAdminRole && (hasUserRole || hasAgentRole)) {
    otherWorkspaces.push({
      title: "Admin dashboard",
      url: "/admin/dashboard",
      icon: Shield,
      color: "text-blue-600",
      badge: totalAdminAttentionCount > 0 ? totalAdminAttentionCount : null,
    });
  }
  if (hasUserRole && showAffiliateAccess) {
    otherWorkspaces.push({
      title: "Affiliate program",
      url: "/dashboard/agent",
      icon: UserCheck,
      color: "text-purple-600",
      badge: affiliateAttentionCount > 0 ? affiliateAttentionCount : null,
    });
  }

  const menuItems = adminOnlyNeedsIntegrationsNav
    ? [
        {
          title: "Admin dashboard",
          url: "/admin/dashboard",
          icon: LayoutDashboard,
          color: "text-blue-600",
          badge: totalAdminAttentionCount > 0 ? totalAdminAttentionCount : null,
        },
        {
          title: "Integrations",
          url: "/admin/dashboard/integrations",
          icon: Plug,
          color: "text-emerald-600",
          badge: null as number | null | undefined,
        },
      ]
    : mainClientNavItems;
  const isInventoryPath =
    pathname === "/dashboard/inventory" || pathname?.startsWith("/dashboard/inventory/");
  const isOutboundPath =
    pathname === "/dashboard/create-shipment-with-labels" ||
    pathname?.startsWith("/dashboard/create-shipment-with-labels/");
  const isAddInventoryPath =
    pathname === "/dashboard/inventory" && searchParams?.get?.("action") === "add-inventory";
  const navMenuItems = menuItems.filter((item) => item.url !== "/dashboard/create-shipment-with-labels");

  return (
    <Sidebar className="border-r border-border/40 bg-gradient-to-b from-background to-muted/20">
      <SidebarHeader className="border-b border-border/40 pb-4">
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2 pr-1">
            <img
              src={brandLogoSrc}
              alt="PrepCorex"
              className="h-auto w-full max-h-[5.5rem] object-contain object-left sm:max-h-28"
              width={418}
              height={100}
              decoding="async"
            />
          </div>
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 md:hidden"
              onClick={() => setOpenMobile(false)}
            >
              <X className="h-5 w-5" />
              <span className="sr-only">Close sidebar</span>
            </Button>
          )}
        </div>
      </SidebarHeader>
      <SidebarContent className="px-2 py-4">
        {showAffiliateShell ? (
          <>
            <div className="mb-4 border-b border-border/40 px-1 pb-4">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip={affiliateBackLabel}
                    className="group h-11 rounded-lg border border-border/50 bg-muted/30 text-muted-foreground transition-all hover:bg-muted/60 hover:text-foreground"
                  >
                    <Link href={affiliateBackHref} className="flex items-center gap-2">
                      <ChevronLeft className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
                      <span className="font-medium">Back to {affiliateBackLabel}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </div>
            <SidebarGroup>
              <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Affiliate
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {[
                    { title: "Overview", href: "/dashboard/agent", icon: UserCheck, color: "text-purple-600", badge: affiliateAttentionCount > 0 ? affiliateAttentionCount : null },
                    { title: "Active Clients", href: "/dashboard/agent/active-clients", icon: UserCheck, color: "text-emerald-600", badge: null },
                    { title: "Pending Clients", href: "/dashboard/agent/pending-clients", icon: Users, color: "text-amber-600", badge: pendingAffiliateClientsCount > 0 ? pendingAffiliateClientsCount : null },
                    { title: "Rejected Clients", href: "/dashboard/agent/rejected-clients", icon: XCircle, color: "text-rose-600", badge: null },
                    { title: "Paid Invoices", href: "/dashboard/agent/paid-invoices", icon: FileText, color: "text-blue-600", badge: null },
                    { title: "Policies & Rules", href: "/dashboard/agent/policies", icon: Shield, color: "text-indigo-600", badge: null },
                  ].map((item) => {
                    const isActive = pathname === item.href;
                    const Icon = item.icon;
                    return (
                      <SidebarMenuItem key={item.href}>
                        <SidebarMenuButton
                          asChild
                          isActive={isActive}
                          tooltip={item.title}
                          className={cn(
                            "group relative h-11 rounded-lg transition-all duration-200",
                            isActive
                              ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                              : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                          )}
                        >
                          <Link href={item.href} className="flex w-full min-w-0 items-center gap-3 pr-1">
                            <Icon
                              className={cn(
                                "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                isActive ? item.color : "text-muted-foreground"
                              )}
                            />
                            <span className={cn("min-w-0 flex-1 truncate font-medium transition-colors", isActive && "font-semibold")}>
                              {item.title}
                            </span>
                            {item.badge !== null && item.badge !== undefined && (
                              <NavMenuCountBadge
                                count={item.badge}
                                className={cn(
                                  "bg-primary text-primary-foreground shadow-sm",
                                  isActive && "bg-primary/90"
                                )}
                              />
                            )}
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        ) : (
          <>
            {hasUserRole && (
              <SidebarGroup>
                <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Warehouse Location
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
                    {warehouseOptionsSorted.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No warehouse available yet.
                      </p>
                    ) : (
                      <>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-muted-foreground">Warehouse</Label>
                      <Select
                        value={selectedWarehouseId}
                        onValueChange={setSelectedWarehouseId}
                        disabled={warehouseOptionsSorted.length === 0}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select warehouse" />
                        </SelectTrigger>
                        <SelectContent>
                          {warehouseOptionsSorted.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id}>
                              {formatWarehouseDisplayName(loc.name)}
                              {assignedLocationIds.has(loc.id) ? "" : " (unassigned)"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedWarehouseId && !assignedLocationIds.has(selectedWarehouseId) && (
                      <p className="text-[11px] text-amber-700">
                        Selected warehouse is not assigned to your account.
                      </p>
                    )}
                    {warehouseOptionsSorted.length === 0 && (
                      <p className="text-[11px] text-muted-foreground">
                        No warehouse assigned yet. If you just signed in, wait a moment—NJ-02 is added to your
                        account automatically—or contact support.
                      </p>
                    )}
                      </>
                    )}
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>
            )}

            <SidebarGroup>
              <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                Navigation
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu className="space-y-1">
                  {navMenuItems.map((item) => {
                    const Icon = item.icon;
                    const isInventoryRoot = item.url === "/dashboard/inventory";
                    const isActive = isInventoryRoot ? isInventoryPath || isOutboundPath : pathname === item.url;

                    return (
                      <SidebarMenuItem key={item.url}>
                        {isInventoryRoot ? (
                          <div className="space-y-1">
                            <SidebarMenuButton
                              isActive={isActive}
                              tooltip={item.title}
                              onClick={() => {
                                if (pathname === "/dashboard/inventory" || pathname?.startsWith("/dashboard/inventory/")) {
                                  setInventoryMenuOpen((prev) => !prev);
                                }
                              }}
                              className={cn(
                                "group relative h-11 rounded-lg transition-all duration-200",
                                isActive
                                  ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                                  : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                              )}
                            >
                              <Link href="/dashboard/inventory" className="flex w-full min-w-0 items-center gap-3 pr-1">
                                <Icon
                                  className={cn(
                                    "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                    isActive ? item.color : "text-muted-foreground"
                                  )}
                                />
                                <span className={cn("min-w-0 flex-1 truncate font-medium transition-colors", isActive && "font-semibold")}>
                                  {item.title}
                                </span>
                                {item.badge !== null && item.badge !== undefined && (
                                  <NavMenuCountBadge
                                    count={item.badge}
                                    className={cn(
                                      "bg-primary text-primary-foreground shadow-sm",
                                      isActive && "bg-primary/90"
                                    )}
                                  />
                                )}
                                <ChevronDown
                                  className={cn(
                                    "h-4 w-4 shrink-0 transition-transform",
                                    inventoryMenuOpen && "rotate-180"
                                  )}
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setInventoryMenuOpen((prev) => !prev);
                                  }}
                                />
                              </Link>
                            </SidebarMenuButton>
                            {inventoryMenuOpen && (
                              <div className="ml-6 space-y-1 border-l border-border/50 pl-3">
                                <SidebarMenuButton
                                  asChild
                                  isActive={isAddInventoryPath}
                                  className={cn(
                                    "h-9 rounded-md text-sm",
                                    isAddInventoryPath
                                      ? "bg-primary/10 text-primary"
                                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                  )}
                                >
                                  <Link
                                    href="/dashboard/inventory?action=add-inventory"
                                    className="flex w-full min-w-0 items-center gap-2 pr-1"
                                  >
                                    <span className="min-w-0 flex-1 truncate">Inbound Shipment</span>
                                    {pendingInboundCount > 0 && (
                                      <NavMenuCountBadge count={pendingInboundCount} className="bg-primary text-primary-foreground shadow-sm" />
                                    )}
                                  </Link>
                                </SidebarMenuButton>
                                <SidebarMenuButton
                                  asChild
                                  isActive={isOutboundPath}
                                  className={cn(
                                    "h-9 rounded-md text-sm",
                                    isOutboundPath
                                      ? "bg-primary/10 text-primary"
                                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                  )}
                                >
                                  <Link
                                    href="/dashboard/create-shipment-with-labels"
                                    className="flex w-full min-w-0 items-center gap-2 pr-1"
                                  >
                                    <span className="min-w-0 flex-1 truncate">Outbound Shipment</span>
                                    {pendingOutboundCount > 0 && (
                                      <NavMenuCountBadge count={pendingOutboundCount} className="bg-primary text-primary-foreground shadow-sm" />
                                    )}
                                  </Link>
                                </SidebarMenuButton>
                              </div>
                            )}
                          </div>
                        ) : (
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            tooltip={item.title}
                            className={cn(
                              "group relative h-11 overflow-visible rounded-lg transition-all duration-200",
                              isActive
                                ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Link href={item.url} className="flex w-full min-w-0 items-center gap-3 pr-1">
                              <Icon
                                className={cn(
                                  "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                  isActive ? item.color : "text-muted-foreground"
                                )}
                              />
                              <span
                                className={cn(
                                  "min-w-0 flex-1 truncate font-medium transition-colors",
                                  isActive && "font-semibold"
                                )}
                              >
                                {item.title}
                              </span>
                              {item.badge !== null && item.badge !== undefined && (
                                <NavMenuCountBadge
                                  count={item.badge}
                                  className={cn(
                                    "bg-primary text-primary-foreground shadow-sm",
                                    isActive && "bg-primary/90"
                                  )}
                                />
                              )}
                            </Link>
                          </SidebarMenuButton>
                        )}
                      </SidebarMenuItem>
                    );
                  })}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {!adminOnlyNeedsIntegrationsNav && otherWorkspaces.length > 0 && (
              <SidebarGroup className="mt-6">
                <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
                  Other workspaces
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu className="space-y-1">
                    {otherWorkspaces.map((item) => {
                      const Icon = item.icon;
                      const isActive =
                        pathname === item.url ||
                        (item.url === "/dashboard/agent" && pathname?.startsWith("/dashboard/agent"));

                      return (
                        <SidebarMenuItem key={item.url}>
                          <SidebarMenuButton
                            asChild
                            isActive={isActive}
                            tooltip={item.title}
                            className={cn(
                              "group relative h-11 rounded-lg transition-all duration-200",
                              isActive
                                ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Link href={item.url} className="flex w-full min-w-0 items-center gap-3 pr-1">
                              <Icon
                                className={cn(
                                  "h-5 w-5 transition-transform group-hover:scale-110",
                                  isActive ? item.color : "text-muted-foreground"
                                )}
                              />
                              <span
                                className={cn("min-w-0 flex-1 truncate font-medium transition-colors", isActive && "font-semibold")}
                              >
                                {item.title}
                              </span>
                              {item.badge !== null && item.badge !== undefined && (
                                <NavMenuCountBadge
                                  count={item.badge}
                                  className={cn(
                                    "bg-primary text-primary-foreground shadow-sm",
                                    isActive && "bg-primary/90"
                                  )}
                                />
                              )}
                            </Link>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      );
                    })}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
