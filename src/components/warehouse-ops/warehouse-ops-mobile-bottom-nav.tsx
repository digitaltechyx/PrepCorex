"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Archive,
  Bell,
  Box,
  ClipboardList,
  Ellipsis,
  Home,
  Move,
  Package,
  PackagePlus,
  PauseCircle,
  RotateCcw,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { getOpsNavItems } from "@/lib/warehouse-ops-permissions";
import { hasFeature } from "@/lib/permissions";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

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
};

const PRIMARY_ROUTES = new Set([
  "/warehouse-ops",
  "/warehouse-ops/notifications",
  "/warehouse-ops/locate",
  "/warehouse-ops/receiving",
  "/warehouse-ops/putaway",
  "/warehouse-ops/pick",
  "/warehouse-ops/pack",
  "/warehouse-ops/dispatch",
]);

function BottomItem({
  href,
  label,
  icon: Icon,
  active,
  badge,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  active: boolean;
  badge?: number;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium",
        active ? "text-orange-600" : "text-slate-600 dark:text-slate-300"
      )}
    >
      <span className="relative">
        <Icon className="h-5 w-5" strokeWidth={active ? 2.5 : 2} />
        {badge && badge > 0 ? (
          <span className="absolute -right-2.5 -top-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
            {badge > 99 ? "99+" : badge}
          </span>
        ) : null}
      </span>
      <span>{label}</span>
      {active ? <span className="absolute top-0 h-0.5 w-8 rounded-full bg-orange-500" /> : null}
    </Link>
  );
}

export function WarehouseOpsMobileBottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { userProfile } = useAuth();
  const { stats } = useWarehouseOpsLive();

  const canPutaway = hasFeature(userProfile, "ops_putaway");
  const onHoldCount = stats.awaitingPutaway;
  const alertCount = stats.quarantineUnits > 0 ? 1 : 0;
  const moreItems = getOpsNavItems(userProfile).filter((item) => !PRIMARY_ROUTES.has(item.href));

  return (
    <nav
      aria-label="Warehouse mobile navigation"
      className="fixed inset-x-0 bottom-0 z-50 flex h-[72px] items-stretch border-t bg-background/95 px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_30px_rgba(15,23,42,0.08)] backdrop-blur md:hidden"
    >
      <BottomItem
        href="/warehouse-ops"
        label="Home"
        icon={Home}
        active={pathname === "/warehouse-ops"}
      />
      {canPutaway ? (
        <BottomItem
          href="/warehouse-ops/on-hold"
          label="On hold"
          icon={PauseCircle}
          active={pathname?.startsWith("/warehouse-ops/on-hold") ?? false}
          badge={onHoldCount}
        />
      ) : null}

      <div className="relative flex min-w-0 flex-1 items-center justify-center">
        <ScanCameraButton
          onScan={(value) =>
            router.push(`/warehouse-ops/locate?query=${encodeURIComponent(value.trim())}`)
          }
          label="Scan"
          className="absolute -top-5 h-14 w-14 rounded-full border-4 border-background bg-orange-600 text-white shadow-lg hover:bg-orange-700"
          scannerTitle="Scan warehouse barcode"
          scannerDescription="Scan a SKU, carton, pallet, package, or bin label."
        />
        <span className="mt-8 text-[10px] font-semibold text-orange-600">Scan</span>
      </div>

      <BottomItem
        href="/warehouse-ops/notifications"
        label="Alerts"
        icon={Bell}
        active={pathname?.startsWith("/warehouse-ops/notifications") ?? false}
        badge={alertCount}
      />

      <Sheet>
        <SheetTrigger asChild>
          <button
            type="button"
            className="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium text-slate-600 dark:text-slate-300"
          >
            <Ellipsis className="h-5 w-5" />
            <span>More</span>
          </button>
        </SheetTrigger>
        <SheetContent side="bottom" className="max-h-[82svh] overflow-y-auto rounded-t-3xl px-4 pb-8 pt-5">
          <SheetHeader className="text-left">
            <SheetTitle>More warehouse tools</SheetTitle>
            <SheetDescription>Open secondary floor and quality workflows.</SheetDescription>
          </SheetHeader>

          <div className="mt-5 grid grid-cols-2 gap-3">
            {moreItems.map((item) => {
              const Icon = NAV_ICONS[item.href] ?? Package;
              return (
                <SheetClose asChild key={item.href}>
                  <Link
                    href={item.href}
                    className="flex min-h-[88px] flex-col justify-between rounded-2xl border bg-card p-3.5 shadow-sm active:scale-[0.98]"
                  >
                    <Icon className="h-5 w-5 text-orange-600" />
                    <span>
                      <span className="block text-sm font-semibold">{item.title}</span>
                      {item.description ? (
                        <span className="mt-0.5 block line-clamp-1 text-[10px] text-muted-foreground">
                          {item.description}
                        </span>
                      ) : null}
                    </span>
                  </Link>
                </SheetClose>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
