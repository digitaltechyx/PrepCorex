"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
import { NavMenuTruncatedLabel } from "@/components/ui/nav-menu-truncated-label";
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
  Ship,
  Store,
  Warehouse,
  Handshake,
  BarChart3,
  ClipboardList,
  ArrowRightLeft,
  Search,
  PackageSearch,
  ChevronDown,
  MoreHorizontal,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { useAdminSidebarBadges } from "@/hooks/use-admin-sidebar-badges";
import { useClientSidebarBadges } from "@/hooks/use-client-sidebar-badges";
import type { UserFeature } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { hasFeature, hasRole } from "@/lib/permissions";
import { hasWarehouseOpsAccess } from "@/lib/warehouse-ops-permissions";
import { brandLogoSrc } from "@/components/logo";

/** Sentinel url — Operations parent is a dropdown, not its own page. */
const OPERATIONS_MENU_ROOT = "/__operations_menu__";

const OPERATION_CHILD_PATHS = [
  "/admin/dashboard/warehouses",
  "/admin/dashboard/internal-move",
  "/admin/dashboard/cycle-count-reports",
  "/admin/dashboard/warehouse-allocate",
  "/admin/dashboard/outbound-tracker",
  "/warehouse-ops",
];

/** Sentinel url — Users & Access parent is a dropdown, not its own page. */
const USERS_ACCESS_MENU_ROOT = "/__users_access_menu__";

const USERS_ACCESS_CHILD_PATHS = [
  "/admin/dashboard/users",
  "/admin/dashboard/affiliate-management",
  "/admin/dashboard/roles-permissions",
];

/** Sentinel url — Inventory parent is a dropdown, not its own page. */
const INVENTORY_MENU_ROOT = "/__inventory_menu__";

const INVENTORY_CHILD_PATHS = [
  "/admin/dashboard/inventory-management",
  "/admin/dashboard/product-returns",
  "/admin/dashboard/dispose-requests",
];

/** Sentinel url — Marketplace Orders parent is a dropdown, not its own page. */
const MARKETPLACE_ORDERS_MENU_ROOT = "/__marketplace_orders_menu__";

const MARKETPLACE_ORDER_CHILD_PATHS = [
  "/admin/dashboard/shopify-orders",
  "/admin/dashboard/tiktok-orders",
  "/admin/dashboard/amazon-orders",
  "/admin/dashboard/ebay-orders",
  "/admin/dashboard/shipstation-orders",
  "/admin/dashboard/woocommerce-orders",
];

/** Sentinel url — More parent is a dropdown, not its own page. */
const MORE_MENU_ROOT = "/__more_menu__";

const MORE_CHILD_PATHS = [
  "/admin/dashboard/buy-labels",
  "/admin/dashboard/documents",
  "/admin/dashboard/integrations",
  "/admin/dashboard/reports",
];

type AdminMenuItem = {
  title: string;
  url: string;
  icon: typeof LayoutDashboard;
  color: string;
  badge?: number | null;
  requiredFeature?: UserFeature;
  requiredFeaturesAnyOf?: readonly UserFeature[];
  adminOnly?: boolean;
  warehouseOpsEntry?: boolean;
  isOperationsRoot?: boolean;
  isUsersAccessRoot?: boolean;
  isInventoryRoot?: boolean;
  isMarketplaceOrdersRoot?: boolean;
  isMoreRoot?: boolean;
};

function isOperationsChildPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/warehouse-ops")) return true;
  return OPERATION_CHILD_PATHS.some(
    (path) => path !== "/warehouse-ops" && (pathname === path || pathname.startsWith(`${path}/`))
  );
}

function isUsersAccessChildPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return USERS_ACCESS_CHILD_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

function isInventoryChildPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return INVENTORY_CHILD_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

function isMarketplaceOrdersChildPath(pathname: string | null): boolean {
  if (!pathname) return false;
  return MARKETPLACE_ORDER_CHILD_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

function isMoreChildPath(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname.startsWith("/admin/dashboard/integrations")) return true;
  return MORE_CHILD_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`)
  );
}

export function AdminSidebar() {
  const pathname = usePathname();
  const { userProfile } = useAuth();
  const { setOpenMobile, isMobile } = useSidebar();
  const [navSearch, setNavSearch] = useState("");
  const [operationsMenuOpen, setOperationsMenuOpen] = useState(() => isOperationsChildPath(pathname));
  const [usersAccessMenuOpen, setUsersAccessMenuOpen] = useState(() => isUsersAccessChildPath(pathname));
  const [inventoryMenuOpen, setInventoryMenuOpen] = useState(() => isInventoryChildPath(pathname));
  const [marketplaceOrdersMenuOpen, setMarketplaceOrdersMenuOpen] = useState(() =>
    isMarketplaceOrdersChildPath(pathname)
  );
  const [moreMenuOpen, setMoreMenuOpen] = useState(() => isMoreChildPath(pathname));
  const navQuery = navSearch.trim().toLowerCase();
  const matchesNavQuery = (label: string) =>
    !navQuery || label.toLowerCase().includes(navQuery);

  useEffect(() => {
    if (isOperationsChildPath(pathname)) {
      setOperationsMenuOpen(true);
    }
    if (isUsersAccessChildPath(pathname)) {
      setUsersAccessMenuOpen(true);
    }
    if (isInventoryChildPath(pathname)) {
      setInventoryMenuOpen(true);
    }
    if (isMarketplaceOrdersChildPath(pathname)) {
      setMarketplaceOrdersMenuOpen(true);
    }
    if (isMoreChildPath(pathname)) {
      setMoreMenuOpen(true);
    }
  }, [pathname]);

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
      title: "Internal Move",
      url: "/admin/dashboard/internal-move",
      icon: ArrowRightLeft,
      color: "text-pink-600",
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
      title: "Outbound Tracker",
      url: "/admin/dashboard/outbound-tracker",
      icon: PackageSearch,
      color: "text-orange-600",
      requiredFeature: "admin_dashboard" as const,
      adminOnly: true,
    },
    {
      title: "Warehouse Ops",
      url: "/warehouse-ops",
      icon: Package,
      color: "text-orange-600",
      warehouseOpsEntry: true as const,
    },
    {
      title: "Notifications",
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
      requiredFeaturesAnyOf: ["manage_shopify_orders", "manage_ebay_orders", "manage_shipstation_orders", "manage_woocommerce_orders", "manage_tiktok_orders", "manage_amazon_orders"] as const satisfies readonly UserFeature[],
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
      title: "TikTok Shop Orders",
      url: "/admin/dashboard/tiktok-orders",
      icon: ShoppingBag,
      color: "text-fuchsia-600",
      badge: null,
      requiredFeature: "manage_tiktok_orders" as const,
    },
    {
      title: "Amazon Orders",
      url: "/admin/dashboard/amazon-orders",
      icon: ShoppingBag,
      color: "text-orange-600",
      badge: null,
      requiredFeature: "manage_amazon_orders" as const,
    },
    {
      title: "eBay Orders",
      url: "/admin/dashboard/ebay-orders",
      icon: ShoppingCart,
      color: "text-blue-600",
      badge: unfulfilledEbayOrdersCount > 0 ? unfulfilledEbayOrdersCount : null,
      requiredFeature: "manage_ebay_orders" as const,
    },
    {
      title: "ShipStation Orders",
      url: "/admin/dashboard/shipstation-orders",
      icon: Ship,
      color: "text-indigo-600",
      badge: null,
      requiredFeature: "manage_shipstation_orders" as const,
    },
    {
      title: "WooCommerce Orders",
      url: "/admin/dashboard/woocommerce-orders",
      icon: Store,
      color: "text-violet-600",
      badge: null,
      requiredFeature: "manage_woocommerce_orders" as const,
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

  const operationsNestedItems = useMemo(
    () =>
      OPERATION_CHILD_PATHS.map((url) => menuItems.find((item) => item.url === url)).filter(
        (item): item is (typeof menuItems)[number] => Boolean(item)
      ),
    [menuItems]
  );
  const operationsNestedUrls = useMemo(
    () => new Set(operationsNestedItems.map((item) => item.url)),
    [operationsNestedItems]
  );
  const operationsMenuHref =
    operationsNestedItems.find((item) => item.url === "/warehouse-ops")?.url ??
    operationsNestedItems[0]?.url ??
    "/warehouse-ops";

  const usersAccessNestedItems = useMemo(
    () =>
      USERS_ACCESS_CHILD_PATHS.map((url) => menuItems.find((item) => item.url === url)).filter(
        (item): item is (typeof menuItems)[number] => Boolean(item)
      ),
    [menuItems]
  );
  const usersAccessNestedUrls = useMemo(
    () => new Set(usersAccessNestedItems.map((item) => item.url)),
    [usersAccessNestedItems]
  );
  const usersAccessMenuHref =
    usersAccessNestedItems.find((item) => item.url === "/admin/dashboard/users")?.url ??
    usersAccessNestedItems[0]?.url ??
    "/admin/dashboard/users";
  const usersAccessCombinedBadge = useMemo(() => {
    const total = usersAccessNestedItems.reduce(
      (sum, item) => sum + (item.badge ?? 0),
      0
    );
    return total > 0 ? total : null;
  }, [usersAccessNestedItems]);

  const inventoryNestedItems = useMemo(
    () =>
      INVENTORY_CHILD_PATHS.map((url) => menuItems.find((item) => item.url === url)).filter(
        (item): item is (typeof menuItems)[number] => Boolean(item)
      ),
    [menuItems]
  );
  const inventoryNestedUrls = useMemo(
    () => new Set(inventoryNestedItems.map((item) => item.url)),
    [inventoryNestedItems]
  );
  const inventoryMenuHref =
    inventoryNestedItems.find((item) => item.url === "/admin/dashboard/inventory-management")?.url ??
    inventoryNestedItems[0]?.url ??
    "/admin/dashboard/inventory-management";
  const inventoryCombinedBadge = useMemo(() => {
    const total = inventoryNestedItems.reduce(
      (sum, item) => sum + (item.badge ?? 0),
      0
    );
    return total > 0 ? total : null;
  }, [inventoryNestedItems]);

  const marketplaceOrdersNestedItems = useMemo(
    () =>
      MARKETPLACE_ORDER_CHILD_PATHS.map((url) => menuItems.find((item) => item.url === url)).filter(
        (item): item is (typeof menuItems)[number] => Boolean(item)
      ),
    [menuItems]
  );
  const marketplaceOrdersNestedUrls = useMemo(
    () => new Set(marketplaceOrdersNestedItems.map((item) => item.url)),
    [marketplaceOrdersNestedItems]
  );
  const marketplaceOrdersMenuHref =
    marketplaceOrdersNestedItems.find((item) => item.url === "/admin/dashboard/shopify-orders")?.url ??
    marketplaceOrdersNestedItems[0]?.url ??
    "/admin/dashboard/shopify-orders";
  const marketplaceOrdersCombinedBadge = useMemo(() => {
    const total = marketplaceOrdersNestedItems.reduce(
      (sum, item) => sum + (item.badge ?? 0),
      0
    );
    return total > 0 ? total : null;
  }, [marketplaceOrdersNestedItems]);

  const moreNestedItems = useMemo(
    () =>
      MORE_CHILD_PATHS.map((url) => menuItems.find((item) => item.url === url)).filter(
        (item): item is (typeof menuItems)[number] => Boolean(item)
      ),
    [menuItems]
  );
  const moreNestedUrls = useMemo(
    () => new Set(moreNestedItems.map((item) => item.url)),
    [moreNestedItems]
  );
  const moreMenuHref =
    moreNestedItems.find((item) => item.url === "/admin/dashboard/buy-labels")?.url ??
    moreNestedItems[0]?.url ??
    "/admin/dashboard/buy-labels";
  const moreCombinedBadge = useMemo(() => {
    const total = moreNestedItems.reduce((sum, item) => sum + (item.badge ?? 0), 0);
    return total > 0 ? total : null;
  }, [moreNestedItems]);

  const navMenuItems = useMemo(() => {
    const flatItems = menuItems.filter(
      (item) =>
        !operationsNestedUrls.has(item.url) &&
        !usersAccessNestedUrls.has(item.url) &&
        !inventoryNestedUrls.has(item.url) &&
        !marketplaceOrdersNestedUrls.has(item.url) &&
        !moreNestedUrls.has(item.url)
    );
    const byUrl = new Map(flatItems.map((item) => [item.url, item]));

    const inventoryRootItem: AdminMenuItem | null =
      inventoryNestedItems.length > 0
        ? {
            title: "Inventory",
            url: INVENTORY_MENU_ROOT,
            icon: Boxes,
            color: "text-violet-600",
            badge: inventoryCombinedBadge,
            isInventoryRoot: true,
          }
        : null;

    const marketplaceOrdersRootItem: AdminMenuItem | null =
      marketplaceOrdersNestedItems.length > 0
        ? {
            title: "Marketplace Orders",
            url: MARKETPLACE_ORDERS_MENU_ROOT,
            icon: ShoppingBag,
            color: "text-emerald-600",
            badge: marketplaceOrdersCombinedBadge,
            isMarketplaceOrdersRoot: true,
          }
        : null;

    const operationsRootItem: AdminMenuItem | null =
      operationsNestedItems.length > 0
        ? {
            title: "Operations",
            url: OPERATIONS_MENU_ROOT,
            icon: Warehouse,
            color: "text-orange-600",
            isOperationsRoot: true,
          }
        : null;

    const usersAccessRootItem: AdminMenuItem | null =
      usersAccessNestedItems.length > 0
        ? {
            title: "Users and Access Control",
            url: USERS_ACCESS_MENU_ROOT,
            icon: ShieldCheck,
            color: "text-green-600",
            badge: usersAccessCombinedBadge,
            isUsersAccessRoot: true,
          }
        : null;

    const moreRootItem: AdminMenuItem | null =
      moreNestedItems.length > 0
        ? {
            title: "More",
            url: MORE_MENU_ROOT,
            icon: MoreHorizontal,
            color: "text-slate-700",
            badge: moreCombinedBadge,
            isMoreRoot: true,
          }
        : null;

    const ordered: AdminMenuItem[] = [];
    const pushFlat = (url: string) => {
      const item = byUrl.get(url);
      if (item) ordered.push(item);
    };
    const pushRoot = (item: AdminMenuItem | null) => {
      if (item) ordered.push(item);
    };

    pushFlat("/admin/dashboard");
    pushFlat("/admin/dashboard/notifications");
    pushRoot(inventoryRootItem);
    pushRoot(marketplaceOrdersRootItem);
    pushRoot(operationsRootItem);
    pushFlat("/admin/dashboard/invoices");
    pushFlat("/admin/dashboard/pricing");
    pushRoot(usersAccessRootItem);
    pushRoot(moreRootItem);

    return ordered;
  }, [
    menuItems,
    operationsNestedItems,
    operationsNestedUrls,
    usersAccessNestedItems,
    usersAccessNestedUrls,
    usersAccessCombinedBadge,
    inventoryNestedItems,
    inventoryNestedUrls,
    inventoryCombinedBadge,
    marketplaceOrdersNestedItems,
    marketplaceOrdersNestedUrls,
    marketplaceOrdersCombinedBadge,
    moreNestedItems,
    moreNestedUrls,
    moreCombinedBadge,
  ]);

  const visibleNavMenuItems = useMemo(() => {
    if (!navQuery) return navMenuItems;

    return navMenuItems.filter((item) => {
      if (item.isInventoryRoot) {
        return (
          matchesNavQuery("Inventory") ||
          inventoryNestedItems.some((child) => matchesNavQuery(child.title))
        );
      }
      if (item.isMarketplaceOrdersRoot) {
        return (
          matchesNavQuery("Marketplace Orders") ||
          marketplaceOrdersNestedItems.some((child) => matchesNavQuery(child.title))
        );
      }
      if (item.isMoreRoot) {
        return (
          matchesNavQuery("More") ||
          moreNestedItems.some((child) => matchesNavQuery(child.title))
        );
      }
      if (item.isOperationsRoot) {
        return (
          matchesNavQuery("Operations") ||
          operationsNestedItems.some((child) => matchesNavQuery(child.title))
        );
      }
      if (item.isUsersAccessRoot) {
        return (
          matchesNavQuery("Users and Access Control") ||
          matchesNavQuery("Users & Access") ||
          matchesNavQuery("Users and Access") ||
          usersAccessNestedItems.some((child) => matchesNavQuery(child.title))
        );
      }
      return matchesNavQuery(item.title);
    });
  }, [
    navMenuItems,
    navQuery,
    inventoryNestedItems,
    marketplaceOrdersNestedItems,
    moreNestedItems,
    operationsNestedItems,
    usersAccessNestedItems,
  ]);

  const showClientDashboard = hasUserRole && matchesNavQuery("Client Dashboard");
  const showAffiliateDashboard = hasAgentRole && matchesNavQuery("Affiliate Dashboard");
  const showOtherDashboards =
    hasOtherRoles && (showClientDashboard || showAffiliateDashboard);

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
          <div className="relative mb-3 px-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={navSearch}
              onChange={(e) => setNavSearch(e.target.value)}
              placeholder="Search menu…"
              className="h-9 pl-8 pr-8 text-sm"
              aria-label="Search navigation"
            />
            {navSearch ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-1.5 top-1/2 h-7 w-7 -translate-y-1/2"
                onClick={() => setNavSearch("")}
                aria-label="Clear navigation search"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            ) : null}
          </div>
          <SidebarGroupContent>
            {menuItems.length > 0 ? (
              visibleNavMenuItems.length > 0 ? (
              <SidebarMenu className="space-y-1">
                {visibleNavMenuItems.map((item) => {
                  const Icon = item.icon;
                  const isOperationsRoot = item.url === OPERATIONS_MENU_ROOT;
                  const isUsersAccessRoot = item.url === USERS_ACCESS_MENU_ROOT;
                  const isInventoryRoot = item.url === INVENTORY_MENU_ROOT;
                  const isMarketplaceOrdersRoot = item.url === MARKETPLACE_ORDERS_MENU_ROOT;
                  const isMoreRoot = item.url === MORE_MENU_ROOT;
                  const isWarehouseOps = Boolean(item.warehouseOpsEntry);
                  const operationsActive = isOperationsChildPath(pathname);
                  const usersAccessActive = isUsersAccessChildPath(pathname);
                  const inventoryActive = isInventoryChildPath(pathname);
                  const marketplaceOrdersActive = isMarketplaceOrdersChildPath(pathname);
                  const moreActive = isMoreChildPath(pathname);
                  const isActive = isOperationsRoot
                    ? operationsActive
                    : isUsersAccessRoot
                      ? usersAccessActive
                      : isInventoryRoot
                        ? inventoryActive
                        : isMarketplaceOrdersRoot
                          ? marketplaceOrdersActive
                          : isMoreRoot
                            ? moreActive
                            : pathname === item.url ||
                          (isWarehouseOps && pathname?.startsWith("/warehouse-ops"));

                  if (isInventoryRoot) {
                    const nestedVisible = navQuery
                      ? inventoryNestedItems.filter((child) => matchesNavQuery(child.title))
                      : inventoryNestedItems;
                    const showNested = inventoryMenuOpen || Boolean(navQuery);

                    return (
                      <SidebarMenuItem key={item.url}>
                        <div className="space-y-1">
                          <SidebarMenuButton
                            isActive={inventoryActive}
                            tooltip={item.title}
                            onClick={() => {
                              if (inventoryActive) {
                                setInventoryMenuOpen((prev) => !prev);
                              }
                            }}
                            className={cn(
                              "group relative h-11 overflow-visible rounded-lg transition-all duration-200",
                              inventoryActive
                                ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Link
                              href={inventoryMenuHref}
                              className="flex w-full min-w-0 items-center gap-3 pr-1"
                            >
                              <Icon
                                className={cn(
                                  "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                  inventoryActive ? item.color : "text-muted-foreground"
                                )}
                              />
                              <NavMenuTruncatedLabel
                                label={item.title}
                                className={cn(
                                  "font-medium transition-colors",
                                  inventoryActive && "font-semibold"
                                )}
                              />
                              {item.badge !== null && item.badge !== undefined && (
                                <NavMenuCountBadge
                                  count={item.badge}
                                  className="bg-primary text-primary-foreground shadow-sm"
                                />
                              )}
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 transition-transform text-muted-foreground",
                                  showNested && "rotate-180"
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setInventoryMenuOpen((prev) => !prev);
                                }}
                              />
                            </Link>
                          </SidebarMenuButton>
                          {showNested && nestedVisible.length > 0 ? (
                            <div className="ml-6 space-y-1 border-l border-border/60 pl-3">
                              {nestedVisible.map((nestedItem) => {
                                const NestedIcon = nestedItem.icon;
                                const isNestedActive =
                                  pathname === nestedItem.url ||
                                  pathname?.startsWith(`${nestedItem.url}/`);
                                return (
                                  <SidebarMenuButton
                                    key={nestedItem.url}
                                    asChild
                                    isActive={isNestedActive}
                                    className={cn(
                                      "h-9 rounded-md text-sm",
                                      isNestedActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                    )}
                                  >
                                    <Link
                                      href={nestedItem.url}
                                      className="flex w-full min-w-0 items-center gap-2 pr-1"
                                    >
                                      <NestedIcon
                                        className={cn(
                                          "h-4 w-4 shrink-0",
                                          isNestedActive ? nestedItem.color : "text-muted-foreground"
                                        )}
                                      />
                                      <NavMenuTruncatedLabel label={nestedItem.title} />
                                      {nestedItem.badge !== null &&
                                        nestedItem.badge !== undefined && (
                                          <NavMenuCountBadge
                                            count={nestedItem.badge}
                                            className="bg-primary text-primary-foreground shadow-sm"
                                          />
                                        )}
                                    </Link>
                                  </SidebarMenuButton>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </SidebarMenuItem>
                    );
                  }

                  if (isMarketplaceOrdersRoot) {
                    const nestedVisible = navQuery
                      ? marketplaceOrdersNestedItems.filter((child) => matchesNavQuery(child.title))
                      : marketplaceOrdersNestedItems;
                    const showNested = marketplaceOrdersMenuOpen || Boolean(navQuery);

                    return (
                      <SidebarMenuItem key={item.url}>
                        <div className="space-y-1">
                          <SidebarMenuButton
                            isActive={marketplaceOrdersActive}
                            tooltip={item.title}
                            onClick={() => {
                              if (marketplaceOrdersActive) {
                                setMarketplaceOrdersMenuOpen((prev) => !prev);
                              }
                            }}
                            className={cn(
                              "group relative h-11 overflow-visible rounded-lg transition-all duration-200",
                              marketplaceOrdersActive
                                ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Link
                              href={marketplaceOrdersMenuHref}
                              className="flex w-full min-w-0 items-center gap-3 pr-1"
                            >
                              <Icon
                                className={cn(
                                  "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                  marketplaceOrdersActive ? item.color : "text-muted-foreground"
                                )}
                              />
                              <NavMenuTruncatedLabel
                                label={item.title}
                                className={cn(
                                  "font-medium transition-colors",
                                  marketplaceOrdersActive && "font-semibold"
                                )}
                              />
                              {item.badge !== null && item.badge !== undefined && (
                                <NavMenuCountBadge
                                  count={item.badge}
                                  className="bg-primary text-primary-foreground shadow-sm"
                                />
                              )}
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 transition-transform text-muted-foreground",
                                  showNested && "rotate-180"
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setMarketplaceOrdersMenuOpen((prev) => !prev);
                                }}
                              />
                            </Link>
                          </SidebarMenuButton>
                          {showNested && nestedVisible.length > 0 ? (
                            <div className="ml-6 space-y-1 border-l border-border/60 pl-3">
                              {nestedVisible.map((nestedItem) => {
                                const NestedIcon = nestedItem.icon;
                                const isNestedActive =
                                  pathname === nestedItem.url ||
                                  pathname?.startsWith(`${nestedItem.url}/`);
                                return (
                                  <SidebarMenuButton
                                    key={nestedItem.url}
                                    asChild
                                    isActive={isNestedActive}
                                    className={cn(
                                      "h-9 rounded-md text-sm",
                                      isNestedActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                    )}
                                  >
                                    <Link
                                      href={nestedItem.url}
                                      className="flex w-full min-w-0 items-center gap-2 pr-1"
                                    >
                                      <NestedIcon
                                        className={cn(
                                          "h-4 w-4 shrink-0",
                                          isNestedActive ? nestedItem.color : "text-muted-foreground"
                                        )}
                                      />
                                      <NavMenuTruncatedLabel label={nestedItem.title} />
                                      {nestedItem.badge !== null &&
                                        nestedItem.badge !== undefined && (
                                          <NavMenuCountBadge
                                            count={nestedItem.badge}
                                            className="bg-primary text-primary-foreground shadow-sm"
                                          />
                                        )}
                                    </Link>
                                  </SidebarMenuButton>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </SidebarMenuItem>
                    );
                  }

                  if (isMoreRoot) {
                    const nestedVisible = navQuery
                      ? moreNestedItems.filter((child) => matchesNavQuery(child.title))
                      : moreNestedItems;
                    const showNested = moreMenuOpen || Boolean(navQuery);

                    return (
                      <SidebarMenuItem key={item.url}>
                        <div className="space-y-1">
                          <SidebarMenuButton
                            isActive={moreActive}
                            tooltip={item.title}
                            onClick={() => {
                              if (moreActive) {
                                setMoreMenuOpen((prev) => !prev);
                              }
                            }}
                            className={cn(
                              "group relative h-11 overflow-visible rounded-lg transition-all duration-200",
                              moreActive
                                ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Link
                              href={moreMenuHref}
                              className="flex w-full min-w-0 items-center gap-3 pr-1"
                            >
                              <Icon
                                className={cn(
                                  "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                  moreActive ? item.color : "text-muted-foreground"
                                )}
                              />
                              <NavMenuTruncatedLabel
                                label={item.title}
                                className={cn(
                                  "font-medium transition-colors",
                                  moreActive && "font-semibold"
                                )}
                              />
                              {item.badge !== null && item.badge !== undefined && (
                                <NavMenuCountBadge
                                  count={item.badge}
                                  className="bg-primary text-primary-foreground shadow-sm"
                                />
                              )}
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 transition-transform text-muted-foreground",
                                  showNested && "rotate-180"
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setMoreMenuOpen((prev) => !prev);
                                }}
                              />
                            </Link>
                          </SidebarMenuButton>
                          {showNested && nestedVisible.length > 0 ? (
                            <div className="ml-6 space-y-1 border-l border-border/60 pl-3">
                              {nestedVisible.map((nestedItem) => {
                                const NestedIcon = nestedItem.icon;
                                const isNestedActive =
                                  pathname === nestedItem.url ||
                                  (nestedItem.url === "/admin/dashboard/integrations" &&
                                    pathname?.startsWith("/admin/dashboard/integrations")) ||
                                  pathname?.startsWith(`${nestedItem.url}/`);
                                return (
                                  <SidebarMenuButton
                                    key={nestedItem.url}
                                    asChild
                                    isActive={isNestedActive}
                                    className={cn(
                                      "h-9 rounded-md text-sm",
                                      isNestedActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                    )}
                                  >
                                    <Link
                                      href={nestedItem.url}
                                      className="flex w-full min-w-0 items-center gap-2 pr-1"
                                    >
                                      <NestedIcon
                                        className={cn(
                                          "h-4 w-4 shrink-0",
                                          isNestedActive ? nestedItem.color : "text-muted-foreground"
                                        )}
                                      />
                                      <NavMenuTruncatedLabel label={nestedItem.title} />
                                      {nestedItem.badge !== null &&
                                        nestedItem.badge !== undefined && (
                                          <NavMenuCountBadge
                                            count={nestedItem.badge}
                                            className="bg-primary text-primary-foreground shadow-sm"
                                          />
                                        )}
                                    </Link>
                                  </SidebarMenuButton>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </SidebarMenuItem>
                    );
                  }

                  if (isUsersAccessRoot) {
                    const nestedVisible = navQuery
                      ? usersAccessNestedItems.filter((child) => matchesNavQuery(child.title))
                      : usersAccessNestedItems;
                    const showNested = usersAccessMenuOpen || Boolean(navQuery);

                    return (
                      <SidebarMenuItem key={item.url}>
                        <div className="space-y-1">
                          <SidebarMenuButton
                            isActive={usersAccessActive}
                            tooltip={item.title}
                            onClick={() => {
                              if (usersAccessActive) {
                                setUsersAccessMenuOpen((prev) => !prev);
                              }
                            }}
                            className={cn(
                              "group relative h-11 overflow-visible rounded-lg transition-all duration-200",
                              usersAccessActive
                                ? "bg-gradient-to-r from-primary/10 to-primary/5 text-primary shadow-sm border border-primary/20"
                                : "hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                            )}
                          >
                            <Link
                              href={usersAccessMenuHref}
                              className="flex w-full min-w-0 items-center gap-3 pr-1"
                            >
                              <Icon
                                className={cn(
                                  "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                  usersAccessActive ? item.color : "text-muted-foreground"
                                )}
                              />
                              <NavMenuTruncatedLabel
                                label={item.title}
                                className={cn(
                                  "font-medium transition-colors",
                                  usersAccessActive && "font-semibold"
                                )}
                              />
                              {item.badge !== null && item.badge !== undefined && (
                                <NavMenuCountBadge
                                  count={item.badge}
                                  className="bg-primary text-primary-foreground shadow-sm"
                                />
                              )}
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 transition-transform text-muted-foreground",
                                  showNested && "rotate-180"
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setUsersAccessMenuOpen((prev) => !prev);
                                }}
                              />
                            </Link>
                          </SidebarMenuButton>
                          {showNested && nestedVisible.length > 0 ? (
                            <div className="ml-6 space-y-1 border-l border-border/60 pl-3">
                              {nestedVisible.map((nestedItem) => {
                                const NestedIcon = nestedItem.icon;
                                const isNestedActive =
                                  pathname === nestedItem.url ||
                                  pathname?.startsWith(`${nestedItem.url}/`);
                                return (
                                  <SidebarMenuButton
                                    key={nestedItem.url}
                                    asChild
                                    isActive={isNestedActive}
                                    className={cn(
                                      "h-9 rounded-md text-sm",
                                      isNestedActive
                                        ? "bg-primary/10 text-primary"
                                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                    )}
                                  >
                                    <Link
                                      href={nestedItem.url}
                                      className="flex w-full min-w-0 items-center gap-2 pr-1"
                                    >
                                      <NestedIcon
                                        className={cn(
                                          "h-4 w-4 shrink-0",
                                          isNestedActive ? nestedItem.color : "text-muted-foreground"
                                        )}
                                      />
                                      <NavMenuTruncatedLabel label={nestedItem.title} />
                                      {nestedItem.badge !== null &&
                                        nestedItem.badge !== undefined && (
                                          <NavMenuCountBadge
                                            count={nestedItem.badge}
                                            className="bg-primary text-primary-foreground shadow-sm"
                                          />
                                        )}
                                    </Link>
                                  </SidebarMenuButton>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </SidebarMenuItem>
                    );
                  }

                  if (isOperationsRoot) {
                    const nestedVisible = navQuery
                      ? operationsNestedItems.filter((child) => matchesNavQuery(child.title))
                      : operationsNestedItems;
                    const showNested = operationsMenuOpen || Boolean(navQuery);

                    return (
                      <SidebarMenuItem key={item.url}>
                        <div className="space-y-1">
                          <SidebarMenuButton
                            isActive={operationsActive}
                            tooltip={item.title}
                            onClick={() => {
                              if (operationsActive) {
                                setOperationsMenuOpen((prev) => !prev);
                              }
                            }}
                            className={cn(
                              "group relative h-11 overflow-visible rounded-lg border transition-all duration-200",
                              operationsActive
                                ? "border-orange-400/50 bg-gradient-to-r from-orange-600 to-amber-600 text-white shadow-sm hover:from-orange-600 hover:to-amber-600 hover:text-white"
                                : "border-orange-300/70 bg-gradient-to-r from-orange-500/15 to-amber-500/10 text-orange-800 shadow-sm hover:from-orange-500/25 hover:to-amber-500/15 dark:border-orange-700/50 dark:text-orange-200"
                            )}
                          >
                            <Link
                              href={operationsMenuHref}
                              className="flex w-full min-w-0 items-center gap-3 pr-1"
                            >
                              <Icon
                                className={cn(
                                  "h-5 w-5 shrink-0 transition-transform group-hover:scale-110",
                                  operationsActive
                                    ? "text-white"
                                    : "text-orange-600 dark:text-orange-400"
                                )}
                              />
                              <NavMenuTruncatedLabel
                                label={item.title}
                                className={cn(
                                  "font-semibold transition-colors",
                                  operationsActive ? "text-white" : "text-orange-900 dark:text-orange-100"
                                )}
                              />
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 shrink-0 transition-transform",
                                  operationsActive ? "text-white" : "text-orange-600",
                                  showNested && "rotate-180"
                                )}
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  setOperationsMenuOpen((prev) => !prev);
                                }}
                              />
                            </Link>
                          </SidebarMenuButton>
                          {showNested && nestedVisible.length > 0 ? (
                            <div className="ml-6 space-y-1 border-l border-orange-200/80 pl-3 dark:border-orange-800/50">
                              {nestedVisible.map((nestedItem) => {
                                const NestedIcon = nestedItem.icon;
                                const nestedWarehouseOps = Boolean(
                                  (nestedItem as { warehouseOpsEntry?: boolean }).warehouseOpsEntry
                                );
                                const isNestedActive =
                                  pathname === nestedItem.url ||
                                  (nestedItem.url === "/warehouse-ops" &&
                                    pathname?.startsWith("/warehouse-ops")) ||
                                  pathname?.startsWith(`${nestedItem.url}/`);
                                return (
                                  <SidebarMenuButton
                                    key={nestedItem.url}
                                    asChild
                                    isActive={isNestedActive}
                                    className={cn(
                                      "h-9 rounded-md text-sm",
                                      isNestedActive
                                        ? nestedWarehouseOps
                                          ? "border border-orange-400/50 bg-gradient-to-r from-orange-600 to-amber-600 text-white"
                                          : "bg-primary/10 text-primary"
                                        : nestedWarehouseOps
                                          ? "border border-orange-200/70 bg-orange-50/80 text-orange-900 hover:bg-orange-100/80 dark:border-orange-800/50 dark:bg-orange-950/30 dark:text-orange-100"
                                          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                                    )}
                                  >
                                    <Link
                                      href={nestedItem.url}
                                      className="flex w-full min-w-0 items-center gap-2 pr-1"
                                    >
                                      <NestedIcon
                                        className={cn(
                                          "h-4 w-4 shrink-0",
                                          isNestedActive
                                            ? nestedWarehouseOps
                                              ? "text-white"
                                              : nestedItem.color
                                            : nestedWarehouseOps
                                              ? "text-orange-600"
                                              : "text-muted-foreground"
                                        )}
                                      />
                                      <NavMenuTruncatedLabel label={nestedItem.title} />
                                      {nestedWarehouseOps ? (
                                        <span
                                          className={cn(
                                            "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide",
                                            isNestedActive
                                              ? "bg-white/20 text-white"
                                              : "bg-orange-600 text-white"
                                          )}
                                        >
                                          Floor
                                        </span>
                                      ) : null}
                                      {nestedItem.badge !== null &&
                                        nestedItem.badge !== undefined && (
                                          <NavMenuCountBadge
                                            count={nestedItem.badge}
                                            className="bg-primary text-primary-foreground shadow-sm"
                                          />
                                        )}
                                    </Link>
                                  </SidebarMenuButton>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      </SidebarMenuItem>
                    );
                  }

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
                          <NavMenuTruncatedLabel
                            label={item.title}
                            className={cn(
                              "font-medium transition-colors",
                              isActive && "font-semibold"
                            )}
                          />
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
              ) : (
                <p className="px-3 py-3 text-xs text-muted-foreground">
                  No menu items match &quot;{navSearch.trim()}&quot;.
                </p>
              )
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
        {showOtherDashboards && (
          <SidebarGroup>
            <SidebarGroupLabel className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">
              Other Dashboards
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="space-y-1">
                {showClientDashboard && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip="Client Dashboard"
                      className="group relative h-11 rounded-lg transition-all duration-200 hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                    >
                      <Link href="/dashboard" className="flex w-full min-w-0 items-center gap-3 pr-1">
                        <Briefcase className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110 text-muted-foreground" />
                        <NavMenuTruncatedLabel
                          label="Client Dashboard"
                          className="font-medium transition-colors"
                        />
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
                {showAffiliateDashboard && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      tooltip="Affiliate Dashboard"
                      className="group relative h-11 rounded-lg transition-all duration-200 hover:bg-accent/50 text-muted-foreground hover:text-foreground"
                    >
                      <Link href="/dashboard/agent" className="flex w-full min-w-0 items-center gap-3 pr-1">
                        <UserCheck className="h-5 w-5 shrink-0 transition-transform group-hover:scale-110 text-muted-foreground" />
                        <NavMenuTruncatedLabel
                          label="Affiliate Dashboard"
                          className="font-medium transition-colors"
                        />
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
