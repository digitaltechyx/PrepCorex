"use client";

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
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { Invoice, UploadedPDF } from "@/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { hasRole, hasFeature } from "@/lib/permissions";
import { brandLogoSrc } from "@/components/logo";

export function DashboardSidebar() {
  const pathname = usePathname();
  const { userProfile, user } = useAuth();
  const { setOpenMobile, isMobile } = useSidebar();

  // Get counts for badges
  const { data: invoices } = useCollection<Invoice>(
    userProfile ? `users/${userProfile.uid}/invoices` : ""
  );
  const { data: allUploadedPDFs } = useCollection<UploadedPDF>("uploadedPDFs");
  const uploadedPDFs = userProfile?.role === "admin" 
    ? allUploadedPDFs 
    : allUploadedPDFs.filter((pdf) => pdf.uploadedBy === user?.uid);

  const pendingInvoicesCount = invoices.filter(inv => inv.status === 'pending').length;
  const labelsCount = uploadedPDFs.length;

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
      title: "Shipped Orders",
      url: "/dashboard/shipped-orders",
      icon: Truck,
      color: "text-teal-600",
      requiredRole: "user" as const,
      requiredFeature: "shipped_orders" as const,
    },
    {
      title: "Create Shipment",
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
      title: "My Pricing",
      url: "/dashboard/pricing",
      icon: DollarSign,
      color: "text-green-600",
      badge: null,
      requiredRole: "user" as const,
      requiredFeature: "my_pricing" as const,
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
  const menuItems = allMenuItems.filter((item) => {
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

  return (
    <Sidebar className="border-r border-border/40 bg-gradient-to-b from-background to-muted/20">
      <SidebarHeader className="border-b border-border/40 pb-4">
        <div className="flex items-center justify-between gap-3 px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-2 pr-1">
            <img
              src={brandLogoSrc}
              alt="PrepCorex"
              className="h-auto w-full max-h-24 object-contain object-left sm:max-h-28"
              width={512}
              height={512}
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
                        <Icon className={cn(
                          "h-5 w-5 transition-transform group-hover:scale-110",
                          isActive ? item.color : "text-muted-foreground"
                        )} />
                        <span className={cn(
                          "font-medium transition-colors",
                          isActive && "font-semibold"
                        )}>
                          {item.title}
                        </span>
                        {item.badge !== null && item.badge !== undefined && (
                          <SidebarMenuBadge className={cn(
                            "ml-auto bg-primary text-primary-foreground shadow-sm",
                            isActive && "bg-primary/90"
                          )}>
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
      </SidebarContent>
    </Sidebar>
  );
}
