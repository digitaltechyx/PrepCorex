"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Archive,
  AlertTriangle,
  Bell,
  Box,
  ClipboardList,
  Home,
  Move,
  Package,
  PackagePlus,
  RotateCcw,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { getOpsNavItems, isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import { Badge } from "@/components/ui/badge";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Shield } from "lucide-react";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/warehouse-ops": Home,
  "/warehouse-ops/notifications": Bell,
  "/warehouse-ops/locate": Search,
  "/warehouse-ops/receiving": PackagePlus,
  "/warehouse-ops/putaway": Archive,
  "/warehouse-ops/quarantine": AlertTriangle,
  "/warehouse-ops/storage": Package,
  "/warehouse-ops/move": Move,
  "/warehouse-ops/pick": ShoppingCart,
  "/warehouse-ops/pack": Box,
  "/warehouse-ops/dispatch": Truck,
  "/warehouse-ops/cycle-count": ClipboardList,
  "/warehouse-ops/returns": RotateCcw,
  "/warehouse-ops/return-qc": RotateCcw,
};

type NavGroup = "overview" | "inbound" | "floor" | "outbound" | "quality";

const NAV_GROUP: Record<string, NavGroup> = {
  "/warehouse-ops": "overview",
  "/warehouse-ops/notifications": "overview",
  "/warehouse-ops/locate": "overview",
  "/warehouse-ops/receiving": "inbound",
  "/warehouse-ops/putaway": "inbound",
  "/warehouse-ops/quarantine": "quality",
  "/warehouse-ops/storage": "inbound",
  "/warehouse-ops/move": "floor",
  "/warehouse-ops/pick": "outbound",
  "/warehouse-ops/pack": "outbound",
  "/warehouse-ops/dispatch": "outbound",
  "/warehouse-ops/cycle-count": "quality",
  "/warehouse-ops/returns": "quality",
  "/warehouse-ops/return-qc": "quality",
};

const GROUP_ORDER: NavGroup[] = ["overview", "inbound", "floor", "outbound", "quality"];

const GROUP_LABELS: Record<NavGroup, string> = {
  overview: "Overview",
  inbound: "Inbound",
  floor: "Floor",
  outbound: "Outbound",
  quality: "Quality",
};

export function WarehouseOpsSidebar() {
  const pathname = usePathname();
  const { userProfile } = useAuth();
  const { setOpenMobile, isMobile } = useSidebar();
  const navItems = getOpsNavItems(userProfile);
  const supervisor = isOpsSupervisor(userProfile);

  const grouped = GROUP_ORDER.map((group) => ({
    group,
    label: GROUP_LABELS[group],
    items: navItems.filter((item) => NAV_GROUP[item.href] === group),
  })).filter((g) => g.items.length > 0);

  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-orange-200/40 dark:border-orange-900/30"
    >
      <SidebarHeader className="border-b border-orange-200/30 dark:border-orange-900/20 p-3">
        <Link
          href="/warehouse-ops"
          className="flex items-center gap-2 rounded-lg px-1 py-0.5"
          onClick={() => isMobile && setOpenMobile(false)}
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 text-white shadow-sm">
            <Package className="h-5 w-5" />
          </div>
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="truncate text-sm font-bold leading-tight">Warehouse Ops</p>
            <p className="truncate text-[11px] text-muted-foreground">PrepCorex floor</p>
          </div>
        </Link>
        {supervisor ? (
          <Badge
            variant="secondary"
            className="mt-2 w-fit gap-1 text-[10px] group-data-[collapsible=icon]:hidden"
          >
            <Shield className="h-3 w-3" />
            Supervisor
          </Badge>
        ) : null}
      </SidebarHeader>

      <SidebarContent className="gap-0 py-2">
        {grouped.map(({ group, label, items }) => (
          <SidebarGroup key={group}>
            <SidebarGroupLabel className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
              {label}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => {
                  const Icon = NAV_ICONS[item.href] ?? Package;
                  const active =
                    item.href === "/warehouse-ops"
                      ? pathname === "/warehouse-ops"
                      : pathname?.startsWith(item.href);
                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        asChild={!item.disabled}
                        isActive={active}
                        disabled={item.disabled}
                        tooltip={item.title}
                        className={cn(
                          active &&
                            "bg-orange-600 text-white hover:bg-orange-600 hover:text-white data-[active=true]:bg-orange-600"
                        )}
                      >
                        {item.disabled ? (
                          <span className="flex items-center gap-2 opacity-50">
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.title}</span>
                          </span>
                        ) : (
                          <Link
                            href={item.href}
                            onClick={() => isMobile && setOpenMobile(false)}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="truncate">{item.title}</span>
                          </Link>
                        )}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-orange-200/30 p-2 text-[10px] text-muted-foreground group-data-[collapsible=icon]:hidden">
        Scan-first · Mobile ready
      </SidebarFooter>
    </Sidebar>
  );
}
