"use client";

import Link from "next/link";
import {
  Archive,
  ArrowRight,
  Box,
  ClipboardList,
  Loader2,
  PackagePlus,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { hasFeature } from "@/lib/permissions";
import type { UserFeature } from "@/types";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type MobileOperation = {
  label: string;
  href: string;
  feature: UserFeature;
  icon: LucideIcon;
  count: number;
  countLabel: string;
  accent: "orange" | "navy";
};

const ACCENTS = {
  orange: {
    border: "border-l-orange-500",
    icon: "bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300",
    count: "text-orange-600 dark:text-orange-300",
  },
  navy: {
    border: "border-l-[#092a5e]",
    icon: "bg-blue-50 text-[#092a5e] dark:bg-blue-950/50 dark:text-blue-200",
    count: "text-[#092a5e] dark:text-blue-200",
  },
} as const;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export function WarehouseOpsMobileHome() {
  const { userProfile } = useAuth();
  const { selectedWarehouse } = useWarehouseOps();
  const { stats, liveLoading, syncError } = useWarehouseOpsLive();

  const operations: MobileOperation[] = [
    {
      label: "Receiving",
      href: "/warehouse-ops/receiving",
      feature: "ops_receive",
      icon: PackagePlus,
      count: stats.inboundDock,
      countLabel: "waiting",
      accent: "orange",
    },
    {
      label: "Putaway",
      href: "/warehouse-ops/putaway",
      feature: "ops_putaway",
      icon: Archive,
      count: stats.awaitingPutaway,
      countLabel: "tasks",
      accent: "navy",
    },
    {
      label: "Picking",
      href: "/warehouse-ops/pick",
      feature: "ops_pick",
      icon: ShoppingCart,
      count: stats.pickQueue,
      countLabel: "orders",
      accent: "navy",
    },
    {
      label: "Packing",
      href: "/warehouse-ops/pack",
      feature: "ops_pack",
      icon: Box,
      count: stats.packQueue,
      countLabel: "ready",
      accent: "orange",
    },
    {
      label: "Dispatch",
      href: "/warehouse-ops/dispatch",
      feature: "ops_pack",
      icon: Truck,
      count: stats.dispatchReady,
      countLabel: "ready",
      accent: "navy",
    },
    {
      label: "Inventory",
      href: "/warehouse-ops/locate",
      feature: "ops_dashboard",
      icon: ClipboardList,
      count: stats.activeCartons,
      countLabel: "cartons",
      accent: "navy",
    },
  ];

  const enabledOperations = operations.filter((operation) =>
    hasFeature(userProfile, operation.feature)
  );
  const priorityTasks = enabledOperations
    .filter((operation) => operation.label !== "Inventory" && operation.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const firstName = String(userProfile?.name || "Operator").trim().split(/\s+/)[0];

  return (
    <div className="space-y-5 pb-2">
      <section className="rounded-2xl border border-orange-100 bg-gradient-to-br from-orange-50 via-white to-blue-50/50 p-4 shadow-sm dark:border-orange-900/30 dark:from-orange-950/30 dark:via-background dark:to-blue-950/20">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">
              {greeting()}, {firstName}
            </h1>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {selectedWarehouse?.name || "Warehouse floor"}
            </p>
          </div>
          <Badge
            variant="outline"
            className={cn(
              "shrink-0 gap-1.5 rounded-full bg-background/80 px-2.5 py-1 text-[11px]",
              syncError
                ? "border-amber-300 text-amber-700"
                : "border-emerald-300 text-emerald-700"
            )}
          >
            {liveLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  syncError ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
            )}
            {liveLoading ? "Syncing" : syncError ? "Partial sync" : "On shift"}
          </Badge>
        </div>
      </section>

      <section aria-label="Warehouse operations">
        <div className="grid grid-cols-2 gap-3">
          {enabledOperations.map((operation) => {
            const Icon = operation.icon;
            const accent = ACCENTS[operation.accent];
            return (
              <Link
                key={operation.href}
                href={operation.href}
                className={cn(
                  "relative min-h-[142px] overflow-hidden rounded-2xl border border-border/70 border-l-4 bg-card p-4 shadow-sm transition active:scale-[0.98]",
                  accent.border
                )}
              >
                <div className="flex h-full flex-col justify-between gap-3">
                  <div className="flex items-start justify-between gap-2">
                    <span className={cn("rounded-xl p-2.5", accent.icon)}>
                      <Icon className="h-7 w-7" strokeWidth={2.1} />
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      Live
                    </span>
                  </div>
                  <div>
                    <p className="text-base font-bold tracking-tight">{operation.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      <span className={cn("mr-1 text-lg font-bold tabular-nums", accent.count)}>
                        {liveLoading ? "…" : operation.count}
                      </span>
                      {operation.countLabel}
                    </p>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section id="priority-tasks" className="scroll-mt-20 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">Priority tasks</h2>
          <Link
            href="/warehouse-ops/notifications"
            className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600"
          >
            View all
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
          {priorityTasks.length > 0 ? (
            priorityTasks.map((task, index) => {
              const Icon = task.icon;
              return (
                <Link
                  key={task.href}
                  href={task.href}
                  className={cn(
                    "flex min-h-[72px] items-center gap-3 px-4 py-3 active:bg-muted/60",
                    index > 0 && "border-t"
                  )}
                >
                  <span className="rounded-full bg-orange-50 p-2 text-orange-600 dark:bg-orange-950/50">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{task.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {task.count} {task.countLabel} need processing
                    </span>
                  </span>
                  <span className="text-right">
                    <span className="block text-xs font-semibold text-orange-600">Open queue</span>
                    <span className="text-[10px] text-muted-foreground">High priority</span>
                  </span>
                  <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              );
            })
          ) : (
            <div className="flex min-h-[96px] flex-col items-center justify-center px-4 text-center">
              <Search className="mb-2 h-5 w-5 text-emerald-600" />
              <p className="text-sm font-semibold">All caught up</p>
              <p className="text-xs text-muted-foreground">No priority warehouse tasks right now.</p>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
