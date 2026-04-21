"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
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
  SidebarMenuBadge,
  useSidebar,
} from "@/components/ui/sidebar";
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
  Truck,
  Users,
  UserCheck,
  DollarSign,
  Upload,
  FileUp,
  ArrowLeftRight,
  FolderOpen,
  Plug,
  ChevronLeft,
  Shield,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { Invoice, UploadedPDF } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { hasRole, hasFeature } from "@/lib/permissions";
import { brandLogoSrc } from "@/components/logo";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type LocationDoc = {
  id: string;
  name?: string;
  country?: string;
  stateOrProvince?: string;
  active?: boolean;
};

export function DashboardSidebar() {
  const pathname = usePathname();
  const { userProfile, user } = useAuth();
  const { setOpenMobile, isMobile } = useSidebar();

  // Get counts for badges
  const { data: invoices } = useCollection<Invoice>(
    userProfile ? `users/${userProfile.uid}/invoices` : ""
  );
  const { data: locationDocs } = useCollection<LocationDoc>("locations");
  const { data: allUploadedPDFs } = useCollection<UploadedPDF>("uploadedPDFs");
  const uploadedPDFs = userProfile?.role === "admin" 
    ? allUploadedPDFs 
    : allUploadedPDFs.filter((pdf) => pdf.uploadedBy === user?.uid);

  const pendingInvoicesCount = invoices.filter(inv => inv.status === 'pending').length;
  const labelsCount = uploadedPDFs.length;
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
  const assignedLocations = useMemo(
    () => allActiveLocations.filter((loc) => assignedLocationIds.has(loc.id)),
    [allActiveLocations, assignedLocationIds]
  );
  const countries = useMemo(
    () =>
      Array.from(
        new Set(
          allActiveLocations
            .map((loc) => (loc.country || "").trim() || "Uncategorized")
        )
      ).sort((a, b) => a.localeCompare(b)),
    [allActiveLocations]
  );
  const [selectedCountry, setSelectedCountry] = useState("");
  const statesForCountry = useMemo(
    () =>
      Array.from(
        new Set(
          allActiveLocations
            .filter((loc) => {
              const c = (loc.country || "").trim() || "Uncategorized";
              return c === selectedCountry;
            })
            .map((loc) => (loc.stateOrProvince || "").trim() || "Unspecified")
        )
      ).sort((a, b) => a.localeCompare(b)),
    [allActiveLocations, selectedCountry]
  );
  const [selectedStateOrProvince, setSelectedStateOrProvince] = useState("");
  const locationsForState = useMemo(
    () =>
      allActiveLocations
        .filter(
          (loc) =>
            ((loc.country || "").trim() || "Uncategorized") === selectedCountry &&
            ((loc.stateOrProvince || "").trim() || "Unspecified") === selectedStateOrProvince
        )
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [allActiveLocations, selectedCountry, selectedStateOrProvince]
  );
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");

  useEffect(() => {
    if (!userProfile?.uid) return;
    const key = `warehouseSelection:${userProfile.uid}`;
    try {
      const saved = localStorage.getItem(key);
      if (!saved) return;
      const parsed = JSON.parse(saved) as {
        country?: string;
        stateOrProvince?: string;
        locationId?: string;
      };
      if (parsed.country) setSelectedCountry(parsed.country);
      if (parsed.stateOrProvince) setSelectedStateOrProvince(parsed.stateOrProvince);
      if (parsed.locationId) setSelectedWarehouseId(parsed.locationId);
    } catch {
      // ignore malformed local storage values
    }
  }, [userProfile?.uid]);

  useEffect(() => {
    if (!userProfile?.uid || selectedWarehouseId) return;
    const all = allActiveLocations;
    if (all.length === 0) return;
    const preferred =
      all.find((loc) => /^nj[\s-]?2$/i.test((loc.name || "").trim())) || all[0];
    if (!preferred) return;
    const c = (preferred.country || "").trim() || "Uncategorized";
    const s = (preferred.stateOrProvince || "").trim() || "Unspecified";
    setSelectedCountry(c);
    setSelectedStateOrProvince(s);
    setSelectedWarehouseId(preferred.id);
  }, [userProfile?.uid, selectedWarehouseId, allActiveLocations]);

  useEffect(() => {
    if (!userProfile?.uid) return;
    const key = `warehouseSelection:${userProfile.uid}`;
    const payload = JSON.stringify({
      country: selectedCountry || undefined,
      stateOrProvince: selectedStateOrProvince || undefined,
      locationId: selectedWarehouseId || undefined,
    });
    localStorage.setItem(key, payload);
    window.dispatchEvent(new Event("warehouse-selection-changed"));
  }, [userProfile?.uid, selectedCountry, selectedStateOrProvince, selectedWarehouseId]);

  useEffect(() => {
    if (!selectedCountry || !statesForCountry.includes(selectedStateOrProvince)) {
      setSelectedStateOrProvince("");
      setSelectedWarehouseId("");
    }
  }, [selectedCountry, statesForCountry, selectedStateOrProvince]);

  useEffect(() => {
    if (!locationsForState.some((loc) => loc.id === selectedWarehouseId)) {
      setSelectedWarehouseId("");
    }
  }, [locationsForState, selectedWarehouseId]);

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
      requiredRole: "user" as const,
      requiredFeature: "view_inventory" as const,
    },
    {
      title: "Outbound Shipment",
      url: "/dashboard/create-shipment-with-labels",
      icon: Upload,
      color: "text-indigo-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "create_shipment" as const,
    },
    {
      title: "Buy Labels",
      url: "/dashboard/buy-labels",
      icon: ShoppingBag,
      color: "text-blue-600",
      badge: null,
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
      title: "Product Returns",
      url: "/dashboard/product-returns",
      icon: ArrowLeftRight,
      color: "text-orange-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "request_product_returns" as const,
    },
    {
      title: "Disposed Inventory",
      url: "/dashboard/recycle-bin",
      icon: RotateCcw,
      color: "text-orange-600",
      badge: null,
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
      badge: null,
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
      badge: null,
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
    (hasFeature(userProfile, "manage_shopify_orders") || hasFeature(userProfile, "manage_ebay_orders")) &&
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
      badge: null,
    });
  }
  if (hasUserRole && showAffiliateAccess) {
    otherWorkspaces.push({
      title: "Affiliate program",
      url: "/dashboard/agent",
      icon: UserCheck,
      color: "text-purple-600",
      badge: null,
    });
  }

  const menuItems = adminOnlyNeedsIntegrationsNav
    ? [
        {
          title: "Admin dashboard",
          url: "/admin/dashboard",
          icon: LayoutDashboard,
          color: "text-blue-600",
          badge: null as number | null | undefined,
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
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === "/dashboard/agent"}
                      tooltip="Overview"
                      className={cn(
                        "group relative h-11 rounded-lg transition-all duration-200",
                        pathname === "/dashboard/agent"
                          ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                          : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      <Link href="/dashboard/agent" className="flex items-center gap-3">
                        <UserCheck
                          className={cn(
                            "h-5 w-5 transition-transform group-hover:scale-110",
                            pathname === "/dashboard/agent" ? "text-purple-600" : "text-muted-foreground"
                          )}
                        />
                        <span
                          className={cn(
                            "font-medium transition-colors",
                            pathname === "/dashboard/agent" && "font-semibold"
                          )}
                        >
                          Overview
                        </span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
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
                    {allActiveLocations.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No warehouse available yet.
                      </p>
                    ) : (
                      <>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-muted-foreground">Country</Label>
                      <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select country" />
                        </SelectTrigger>
                        <SelectContent>
                          {countries.map((country) => (
                            <SelectItem key={country} value={country}>
                              {country}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-muted-foreground">State / Province</Label>
                      <Select
                        value={selectedStateOrProvince}
                        onValueChange={setSelectedStateOrProvince}
                        disabled={!selectedCountry}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select state/province" />
                        </SelectTrigger>
                        <SelectContent>
                          {statesForCountry.map((stateOrProvince) => (
                            <SelectItem key={stateOrProvince} value={stateOrProvince}>
                              {stateOrProvince}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] font-medium text-muted-foreground">Warehouse</Label>
                      <Select
                        value={selectedWarehouseId}
                        onValueChange={setSelectedWarehouseId}
                        disabled={!selectedCountry || !selectedStateOrProvince}
                      >
                        <SelectTrigger className="h-9">
                          <SelectValue placeholder="Select warehouse" />
                        </SelectTrigger>
                        <SelectContent>
                          {locationsForState.map((loc) => (
                            <SelectItem key={loc.id} value={loc.id}>
                              {loc.name || "Unnamed"}
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
                  {menuItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = pathname === item.url;

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
                          <Link href={item.url} className="flex items-center gap-3">
                            <Icon
                              className={cn(
                                "h-5 w-5 transition-transform group-hover:scale-110",
                                isActive ? item.color : "text-muted-foreground"
                              )}
                            />
                            <span
                              className={cn("font-medium transition-colors", isActive && "font-semibold")}
                            >
                              {item.title}
                            </span>
                            {item.badge !== null && item.badge !== undefined && (
                              <SidebarMenuBadge
                                className={cn(
                                  "ml-auto bg-primary text-primary-foreground shadow-sm",
                                  isActive && "bg-primary/90"
                                )}
                              >
                                {item.badge}
                              </SidebarMenuBadge>
                            )}
                          </Link>
                        </SidebarMenuButton>
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
                            <Link href={item.url} className="flex items-center gap-3">
                              <Icon
                                className={cn(
                                  "h-5 w-5 transition-transform group-hover:scale-110",
                                  isActive ? item.color : "text-muted-foreground"
                                )}
                              />
                              <span
                                className={cn("font-medium transition-colors", isActive && "font-semibold")}
                              >
                                {item.title}
                              </span>
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
