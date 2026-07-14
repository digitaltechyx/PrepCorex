"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useMemo } from "react";
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
  Users,
  FileText,
  ShieldCheck,
  X,
  UserCheck,
  Briefcase,
  DollarSign,
  Bell,
  FolderOpen,
  ShoppingBag,
  RotateCcw,
  Package,
  Boxes,
  Tag,
  Plug,
  ShoppingCart,
  Warehouse,
  Handshake,
  BarChart3,
  ClipboardList,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { useAdminSidebarBadges } from "@/hooks/use-admin-sidebar-badges";
import { useClientSidebarBadges } from "@/hooks/use-client-sidebar-badges";
import type { UserFeature } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { hasFeature, hasRole } from "@/lib/permissions";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";
import { brandLogoSrc } from "@/components/logo";

export function AdminSidebar() {
  const pathname = usePathname();
  const { userProfile } = useAuth();
  const { setOpenMobile, isMobile } = useSidebar();

  // Use managed users so sub admin badge counts reflect only assigned users
  const { managedUsers } = useManagedUsers();
  const {
    productReturnsPendingCount,
    disposePendingCount,
    pendingDocumentRequestsCount,
    pendingRequestsCount,
    inventoryActionCount,
    pendingInvoicesCount,
    pendingLabelsCount,
    pendingUsersCount,
    pendingCommissionAgentsCount,
    unfulfilledShopifyOrdersCount,
    unfulfilledEbayOrdersCount,
  } = useAdminSidebarBadges(managedUsers, Boolean(userProfile?.uid));
  const {
    affiliateAttentionCount,
    pendingInvoicesCount: clientPendingInvoicesCount,
    inventoryActionCount: clientInventoryActionCount,
    pendingProductReturnsCount: clientProductReturnsCount,
    pendingDocumentsCount: clientDocumentsCount,
    pendingDisposeCount: clientDisposeCount,
    pendingLabelsCount: clientLabelsCount,
    pendingShopifyOrdersCount: clientShopifyOrdersCount,
  } = useClientSidebarBadges();
  const clientAttentionCount = useMemo(
    () =>
      clientPendingInvoicesCount +
      clientInventoryActionCount +
      clientProductReturnsCount +
      clientDocumentsCount +
      clientDisposeCount +
      clientLabelsCount +
      clientShopifyOrdersCount,
    [
      clientPendingInvoicesCount,
      clientInventoryActionCount,
      clientProductReturnsCount,
      clientDocumentsCount,
      clientDisposeCount,
      clientLabelsCount,
      clientShopifyOrdersCount,
    ]
  );

  // Filter menu items based on user's features
  // Admin has all features automatically, sub_admin needs explicit grants
  const allMenuItems = [
    {
      title: "Dashboard",
      url: "/admin/dashboard",
      icon: LayoutDashboard,
      color: "text-blue-600",
      requiredFeature: "admin_dashboard" as const,
    },
    {
      title: "Inventory",
      url: "/admin/dashboard/inventory-management",
      icon: Boxes,
      color: "text-violet-600",
      badge: inventoryActionCount > 0 ? inventoryActionCount : null,
      requiredFeature: "manage_inventory_admin" as const,
    },
    {
      title: "Warehouses",
      url: "/admin/dashboard/warehouses",
      icon: Warehouse,
      color: "text-fuchsia-600",
      requiredFeature: "manage_inventory_admin" as const,
    },
    {
      title: "Cycle Count Reports",
      url: "/admin/dashboard/cycle-count-reports",
      icon: ClipboardList,
      color: "text-teal-600",
      requiredFeature: "manage_inventory_admin" as const,
    },
    {
      title: "Allocate & Search",
      url: "/admin/dashboard/warehouse-allocate",
      icon: Boxes,
      color: "text-emerald-600",
      requiredFeature: "manage_inventory_admin" as const,
    },
    {
      title: "Warehouse Ops",
      url: "/warehouse-ops",
      icon: Package,
      color: "text-orange-600",
      warehouseOpsEntry: true as const,
    },
    {
      title: "Notification",
      url: "/admin/dashboard/notifications",
      icon: Bell,
      color: "text-purple-600",
      badge: pendingRequestsCount > 0 ? pendingRequestsCount : null,
      requiredFeature: "manage_notifications" as const,
    },
    {
      title: "Buy Labels",
      url: "/admin/dashboard/buy-labels",
      icon: Tag,
      color: "text-cyan-600",
      badge: pendingLabelsCount > 0 ? pendingLabelsCount : null,
      requiredFeature: "manage_labels" as const,
    },
    {
      title: "Product Returns",
      url: "/admin/dashboard/product-returns",
      icon: Package,
      color: "text-teal-600",
      badge: productReturnsPendingCount > 0 ? productReturnsPendingCount : null,
      requiredFeature: "manage_product_returns" as const,
    },
    {
      title: "Dispose Inventory",
      url: "/admin/dashboard/dispose-requests",
      icon: RotateCcw,
      color: "text-orange-600",
      badge: disposePendingCount > 0 ? disposePendingCount : null,
      requiredFeature: "manage_dispose_requests" as const,
    },
    {
      title: "Invoices",
      url: "/admin/dashboard/invoices",
      icon: FileText,
      color: "text-indigo-600",
      badge: pendingInvoicesCount > 0 ? pendingInvoicesCount : null,
      requiredFeature: "manage_invoices" as const,
    },
    {
      title: "Pricing Tariff",
      url: "/admin/dashboard/pricing",
      icon: DollarSign,
      color: "text-amber-600",
      requiredFeature: "manage_pricing" as const,
    },
    {
      title: "Documents",
      url: "/admin/dashboard/documents",
      icon: FolderOpen,
      color: "text-indigo-600",
      badge: pendingDocumentRequestsCount > 0 ? pendingDocumentRequestsCount : null,
      requiredFeature: "manage_documents" as const,
    },
    {
      title: "Users",
      url: "/admin/dashboard/users",
      icon: Users,
      color: "text-green-600",
      badge: pendingUsersCount > 0 ? pendingUsersCount : null,
      requiredFeature: "manage_users" as const,
    },
    {
      title: "Affiliate Management",
      url: "/admin/dashboard/affiliate-management",
      icon: Handshake,
      color: "text-purple-600",
      badge: pendingCommissionAgentsCount > 0 ? pendingCommissionAgentsCount : null,
      requiredFeature: "manage_users" as const,
      adminOnly: true,
    },
    {
      title: "Reports",
      url: "/admin/dashboard/reports",
      icon: BarChart3,
      color: "text-slate-700",
      requiredFeature: "admin_dashboard" as const,
    },
    {
      title: "Roles & Permissions",
      url: "/admin/dashboard/roles-permissions",
      icon: ShieldCheck,
      color: "text-slate-700",
      requiredFeature: "admin_dashboard" as const,
      adminOnly: true,
    },
    {
      title: "Integration",
      url: "/admin/dashboard/integrations",
      icon: Plug,
      color: "text-green-600",
      requiredFeaturesAnyOf: ["manage_shopify_orders", "manage_ebay_orders"] as const satisfies readonly UserFeature[],
    },
    {
      title: "Shopify Orders",
      url: "/admin/dashboard/shopify-orders",
      icon: ShoppingBag,
      color: "text-emerald-600",
      badge: unfulfilledShopifyOrdersCount > 0 ? unfulfilledShopifyOrdersCount : null,
      requiredFeature: "manage_shopify_orders" as const,
    },
    {
      title: "eBay Orders",
      url: "/admin/dashboard/ebay-orders",
      icon: ShoppingCart,
      color: "text-blue-600",
      badge: unfulfilledEbayOrdersCount > 0 ? unfulfilledEbayOrdersCount : null,
      requiredFeature: "manage_ebay_orders" as const,
    },
  ];

  // Filter menu items based on user's role and features
  const menuItems = allMenuItems.filter((item) => {
    if ((item as { warehouseOpsEntry?: boolean }).warehouseOpsEntry) {
      return hasRole(userProfile, "admin") || hasWarehouseOpsAccess(userProfile);
    }
    const adminOnly = (item as { adminOnly?: boolean }).adminOnly;
    if (adminOnly) return hasRole(userProfile, "admin");

    const canAccessAdmin =
      hasRole(userProfile, "admin") ||
      hasRole(userProfile, "sub_admin") ||
      (userProfile as any)?.features?.includes?.("admin_dashboard");

    // Admin always sees all items
    if (hasRole(userProfile, "admin") || ((userProfile as any)?.features?.includes?.("admin_dashboard") && !hasRole(userProfile, "sub_admin"))) {
      return true;
    }
    const anyOf = (item as { requiredFeaturesAnyOf?: readonly UserFeature[] }).requiredFeaturesAnyOf;
    const passesFeature = () => {
      if (anyOf?.length) return anyOf.some((f) => hasFeature(userProfile, f));
      return hasFeature(userProfile, (item as { requiredFeature: UserFeature }).requiredFeature);
    };

    // Sub admin only sees items for which they have the required feature
    if (hasRole(userProfile, "sub_admin")) {
      return passesFeature();
    }
    return canAccessAdmin ? passesFeature() : false;
  });

  // Check if user has other roles (client or commission agent) to show additional dashboard links
  const hasUserRole = hasRole(userProfile, "user");
  const hasAgentRole = hasRole(userProfile, "commission_agent");
  const hasOtherRoles = hasUserRole || hasAgentRole;

  return (
    <Sidebar className="border-r border-border/40 bg-gradient-to-b from-background to-muted/20">
      <SidebarHeader className="border-b border-border/40 pb-4">
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <div className="flex min-w-0 flex-1 pr-1">
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
        <SidebarGroup>
          <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            {menuItems.length > 0 ? (
              <SidebarMenu className="space-y-1">
                {menuItems.map((item) => {
                  const Icon = item.icon;
                  const isActive =
                    pathname === item.url ||
                    (item.url === "/admin/dashboard/integrations" &&
                      pathname.startsWith("/admin/dashboard/integrations"));
                  
                  return (
                    <SidebarMenuItem key={item.url}>
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
                          <Icon className={cn(
                            "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                            isActive ? item.color : "text-muted-foreground"
                          )} />
                          <span className={cn(
                            "min-w-0 flex-1 truncate font-medium transition-colors",
                            isActive && "font-semibold"
                          )}>
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
            ) : hasRole(userProfile, "sub_admin") ? (
              <div className="px-3 py-4 text-sm text-muted-foreground bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg">
                <p className="font-medium text-amber-800 dark:text-amber-200 mb-1">
                  No Admin Features Granted
                </p>
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  You have sub_admin role but no admin features have been granted. Please contact an administrator to grant you access to admin features.
                </p>
              </div>
            ) : null}
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Other Dashboards Section - Show if user has multiple roles */}
        {hasOtherRoles && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Other Dashboards
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {hasUserRole && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip="Client Dashboard"
                      className="group relative h-11 rounded-lg transition-all duration-200 hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                    >
                      <Link href="/dashboard" className="flex w-full min-w-0 items-center gap-3 pr-1">
                        <Briefcase className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium transition-colors">
                          Client Dashboard
                        </span>
                        {clientAttentionCount > 0 && (
                          <NavMenuCountBadge
                            count={clientAttentionCount}
                            className="bg-primary text-primary-foreground shadow-sm"
                          />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
                {hasAgentRole && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip="Affiliate Dashboard"
                      className="group relative h-11 rounded-lg transition-all duration-200 hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                    >
                      <Link href="/dashboard/agent" className="flex w-full min-w-0 items-center gap-3 pr-1">
                        <UserCheck className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate font-medium transition-colors">
                          Affiliate Dashboard
                        </span>
                        {affiliateAttentionCount > 0 && (
                          <NavMenuCountBadge
                            count={affiliateAttentionCount}
                            className="bg-primary text-primary-foreground shadow-sm"
                          />
                        )}
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
