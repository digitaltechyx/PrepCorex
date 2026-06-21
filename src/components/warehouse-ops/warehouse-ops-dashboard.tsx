"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Box,
  ClipboardList,
  Loader2,
  Package,
  PackagePlus,
  Search,
  Shield,
  Truck,
  Archive,
  Move,
  ShoppingCart,
  RotateCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { getOpsNavItems, isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import { hasFeature } from "@/lib/permissions";
import {
  buildWarehouseOpsFlowMetrics,
  type WarehouseOpsFlowMetric,
} from "@/lib/warehouse-ops-dashboard-stats";
import type { UserFeature } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const NAV_ICONS: Record<string, LucideIcon> = {
  "/warehouse-ops/locate": Search,
  "/warehouse-ops/receiving": PackagePlus,
  "/warehouse-ops/putaway": Archive,
  "/warehouse-ops/move": Move,
  "/warehouse-ops/pick": ShoppingCart,
  "/warehouse-ops/pack": Box,
  "/warehouse-ops/dispatch": Truck,
  "/warehouse-ops/cycle-count": ClipboardList,
  "/warehouse-ops/return-qc": RotateCcw,
};

const TONE_STYLES: Record<
  WarehouseOpsFlowMetric["tone"],
  { ring: string; badge: string; dot: string }
> = {
  neutral: {
    ring: "border-border/60",
    badge: "bg-muted text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
  info: {
    ring: "border-sky-200 dark:border-sky-900/50",
    badge: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200",
    dot: "bg-sky-500",
  },
  warning: {
    ring: "border-amber-200 dark:border-amber-900/50",
    badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
    dot: "bg-amber-500",
  },
  success: {
    ring: "border-emerald-200 dark:border-emerald-900/50",
    badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
    dot: "bg-emerald-500",
  },
  danger: {
    ring: "border-red-200 dark:border-red-900/50",
    badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
    dot: "bg-red-500",
  },
};

function StatCard({
  label,
  value,
  hint,
  accent,
  loading,
}: {
  label: string;
  value: number | string;
  hint?: string;
  accent?: string;
  loading?: boolean;
}) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <p
          className={cn(
            "mt-1 text-2xl sm:text-3xl font-bold tabular-nums",
            accent,
            loading && "text-muted-foreground/60 animate-pulse"
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

function FlowStateCard({
  metric,
  enabled,
  countLoading,
}: {
  metric: WarehouseOpsFlowMetric;
  enabled: boolean;
  countLoading?: boolean;
}) {
  const tone = TONE_STYLES[metric.tone];
  const inner = (
    <Card
      className={cn(
        "h-full border shadow-sm transition-all",
        tone.ring,
        enabled && metric.count > 0 && "hover:shadow-md hover:border-orange-300/60",
        !enabled && "opacity-50"
      )}
    >
      <CardContent className="flex h-full flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold text-sm">{metric.label}</p>
            <p className="text-xs text-muted-foreground line-clamp-2">{metric.description}</p>
          </div>
          <Badge
            className={cn(
              "shrink-0 tabular-nums min-w-[2rem] justify-center",
              tone.badge,
              countLoading && "animate-pulse opacity-70"
            )}
          >
            {countLoading ? "…" : metric.count}
          </Badge>
        </div>
        {enabled && metric.count > 0 ? (
          <span className="mt-auto inline-flex items-center gap-1 text-xs font-medium text-orange-600">
            Open workflow
            <ArrowRight className="h-3 w-3" />
          </span>
        ) : (
          <span className="mt-auto text-xs text-muted-foreground">No pending work</span>
        )}
      </CardContent>
    </Card>
  );

  if (!enabled) return inner;
  return (
    <Link href={metric.href} className="block h-full">
      {inner}
    </Link>
  );
}

export function WarehouseOpsDashboard() {
  const { userProfile } = useAuth();
  const { selectedWarehouse, loading: warehousesLoading } = useWarehouseOps();
  const { stats, liveLoading, syncError } = useWarehouseOpsLive();

  const navItems = useMemo(
    () => getOpsNavItems(userProfile).filter((n) => n.href !== "/warehouse-ops"),
    [userProfile]
  );

  const flowMetrics = useMemo(() => buildWarehouseOpsFlowMetrics(stats), [stats]);

  const totalPending = useMemo(
    () =>
      stats.inboundDock +
      stats.awaitingPutaway +
      stats.pickQueue +
      stats.packQueue +
      stats.dispatchReady +
      stats.returnQc +
      stats.cycleCountOpen,
    [stats]
  );

  const supervisor = isOpsSupervisor(userProfile);
  const canReceive = hasFeature(userProfile, "ops_receive");

  if (warehousesLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-orange-600" />
        Loading warehouse…
      </div>
    );
  }

  if (!selectedWarehouse) {
    return (
      <Card className="max-w-lg border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20">
        <CardHeader>
          <CardTitle>No warehouse selected</CardTitle>
          <CardDescription>
            Ask an admin to assign you to a warehouse in Roles &amp; Permissions, then pick it in
            the header.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 sm:space-y-8">
      {/* Hero */}
      <div className="relative overflow-hidden rounded-2xl border border-orange-200/50 bg-gradient-to-br from-orange-50 via-background to-amber-50/30 p-5 sm:p-8 dark:border-orange-900/30 dark:from-orange-950/30 dark:via-background dark:to-amber-950/10">
        <div className="relative z-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-orange-300/60 bg-background/80">
                <Package className="mr-1 h-3 w-3 text-orange-600" />
                Floor dashboard
              </Badge>
              {supervisor ? (
                <Badge className="gap-1 bg-orange-600 hover:bg-orange-600">
                  <Shield className="h-3 w-3" />
                  Supervisor
                </Badge>
              ) : null}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">
              {selectedWarehouse.code}
              <span className="font-normal text-muted-foreground"> · {selectedWarehouse.name}</span>
            </h1>
            <p className="max-w-xl text-sm text-muted-foreground">
              Live queue counts for inbound, storage, outbound, and quality workflows. Scan-first
              operations — receive at the dock, putaway to bins, then pick and dispatch.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {liveLoading ? (
              <Badge variant="outline" className="gap-1 text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                Syncing…
              </Badge>
            ) : syncError ? (
              <Badge variant="outline" className="gap-1 border-amber-300/60 text-xs text-amber-700">
                Partial sync
              </Badge>
            ) : (
              <Badge variant="outline" className="gap-1 border-emerald-300/60 text-xs text-emerald-700">
                Live
              </Badge>
            )}
            {canReceive ? (
              <Button size="sm" className="bg-orange-600 hover:bg-orange-700" asChild>
                <Link href="/warehouse-ops/receiving">Start receiving</Link>
              </Button>
            ) : null}
          </div>
        </div>
        <div
          className="pointer-events-none absolute -right-8 -top-8 h-40 w-40 rounded-full bg-orange-400/10 blur-2xl"
          aria-hidden
        />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Pending tasks"
          value={totalPending}
          hint="Across all floor queues"
          accent="text-orange-600"
          loading={liveLoading}
        />
        <StatCard
          label="Active cartons"
          value={stats.activeCartons}
          hint="On hand in this warehouse"
          loading={liveLoading}
        />
        <StatCard
          label="In staging"
          value={stats.inStaging}
          hint="Awaiting putaway"
          loading={liveLoading}
        />
        <StatCard
          label="Quarantine / DMG"
          value={stats.quarantineUnits}
          hint="Units flagged damaged"
          accent={stats.quarantineUnits > 0 ? "text-red-600" : undefined}
          loading={liveLoading}
        />
      </div>

      {/* Pipeline health */}
      <Card className="border-border/60 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base sm:text-lg">Workflow pipeline</CardTitle>
          <CardDescription>
            Queue depth by stage — tap a card with pending work to jump in.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <>
            <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground overflow-x-auto pb-1">
              {["Inbound", "Staging", "Putaway", "Outbound", "Dispatch", "Quality"].map(
                (step, i, arr) => (
                  <div key={step} className="flex items-center gap-1 shrink-0">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5",
                        i === 0 && "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-200"
                      )}
                    >
                      {step}
                    </span>
                    {i < arr.length - 1 ? (
                      <ArrowRight className="h-3 w-3 opacity-40" />
                    ) : null}
                  </div>
                )
              )}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {flowMetrics.map((metric) => (
                <FlowStateCard
                  key={metric.key}
                  metric={metric}
                  enabled={hasFeature(userProfile, metric.feature as UserFeature)}
                  countLoading={liveLoading}
                />
              ))}
            </div>
          </>
        </CardContent>
      </Card>

      {/* Outbound mini bar */}
      <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Outbound progress</CardTitle>
            <CardDescription>Pick → pack → dispatch funnel for this warehouse</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {[
              { label: "Pick queue", value: stats.pickQueue, max: Math.max(stats.pickQueue, stats.packQueue, stats.dispatchReady, 1) },
              { label: "Pack queue", value: stats.packQueue, max: Math.max(stats.pickQueue, stats.packQueue, stats.dispatchReady, 1) },
              { label: "Ready to dispatch", value: stats.dispatchReady, max: Math.max(stats.pickQueue, stats.packQueue, stats.dispatchReady, 1) },
            ].map((row) => (
              <div key={row.label} className="space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span>{row.label}</span>
                  <span className="font-medium tabular-nums">{row.value}</span>
                </div>
                <Progress value={row.max > 0 ? (row.value / row.max) * 100 : 0} className="h-2" />
              </div>
            ))}
          </CardContent>
      </Card>

      {/* Quick actions */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Quick actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {navItems.map((item) => {
            const Icon = NAV_ICONS[item.href] ?? Package;
            const disabled = item.disabled || !selectedWarehouse;
            return (
              <Card
                key={item.href}
                className={cn(
                  "group border-border/60 shadow-sm transition-all",
                  !disabled && "hover:border-orange-300/60 hover:shadow-md"
                )}
              >
                <CardContent className="p-0">
                  {disabled ? (
                    <div className="flex items-start gap-3 p-4 opacity-50">
                      <div className="rounded-lg bg-muted p-2">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">{item.title}</p>
                        {item.description ? (
                          <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>
                        ) : null}
                      </div>
                    </div>
                  ) : (
                    <Link
                      href={item.href}
                      className="flex items-start gap-3 p-4"
                    >
                      <div className="rounded-lg bg-orange-100 p-2 text-orange-700 dark:bg-orange-950 dark:text-orange-300 group-hover:bg-orange-600 group-hover:text-white transition-colors">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm flex items-center gap-1">
                          {item.title}
                          <ArrowRight className="h-3.5 w-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                        </p>
                        {item.description ? (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {item.description}
                          </p>
                        ) : null}
                      </div>
                    </Link>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
