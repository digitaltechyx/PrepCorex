"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  ArrowRight,
  Bell,
  Box,
  Loader2,
  PackagePlus,
  RotateCcw,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";

import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { useAuth } from "@/hooks/use-auth";
import { useAllProductReturns } from "@/hooks/use-all-product-returns";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { hasFeature } from "@/lib/permissions";
import { formatClientOptionLabel } from "@/components/warehouse-ops/crossdock-client-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { UserFeature, WarehouseDoc } from "@/types";

type NotifKind =
  | "inbound_pending"
  | "inbound_receive"
  | "outbound_pending"
  | "outbound_pick"
  | "outbound_pack"
  | "outbound_dispatch"
  | "return_pending"
  | "return_open";

type NotifFilter = "all" | "inbound" | "outbound" | "returns";

type OpsNotificationRow = {
  id: string;
  kind: NotifKind;
  feature: UserFeature;
  title: string;
  subtitle: string;
  clientLabel: string;
  statusLabel: string;
  createdAtMs: number;
  processHref: string;
  processLabel: string;
};

function normStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isPendingInbound(status: unknown): boolean {
  const s = normStatus(status);
  return s === "pending" || s === "pending_approval";
}

function isApprovedInbound(status: unknown): boolean {
  return normStatus(status) === "approved";
}

function formatWhen(ms: number): string {
  if (!ms) return "";
  try {
    return format(new Date(ms), "MMM d, yyyy · h:mm a");
  } catch {
    return "";
  }
}

function kindTone(kind: NotifKind): string {
  switch (kind) {
    case "inbound_pending":
    case "outbound_pending":
    case "return_pending":
      return "bg-amber-100 text-amber-900 border-amber-200 dark:bg-amber-950 dark:text-amber-200 dark:border-amber-800";
    case "inbound_receive":
    case "return_open":
      return "bg-sky-100 text-sky-900 border-sky-200 dark:bg-sky-950 dark:text-sky-200 dark:border-sky-800";
    case "outbound_pick":
      return "bg-violet-100 text-violet-900 border-violet-200 dark:bg-violet-950 dark:text-violet-200 dark:border-violet-800";
    case "outbound_pack":
      return "bg-indigo-100 text-indigo-900 border-indigo-200 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-800";
    case "outbound_dispatch":
      return "bg-emerald-100 text-emerald-900 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-800";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function kindIcon(kind: NotifKind) {
  switch (kind) {
    case "inbound_pending":
    case "inbound_receive":
      return PackagePlus;
    case "outbound_pending":
    case "outbound_pick":
      return ShoppingCart;
    case "outbound_pack":
      return Box;
    case "outbound_dispatch":
      return Truck;
    case "return_pending":
    case "return_open":
      return RotateCcw;
    default:
      return Bell;
  }
}

function matchesFilter(kind: NotifKind, filter: NotifFilter): boolean {
  if (filter === "all") return true;
  if (filter === "inbound") return kind.startsWith("inbound_");
  if (filter === "outbound") return kind.startsWith("outbound_");
  if (filter === "returns") return kind.startsWith("return_");
  return true;
}

export function WarehouseOpsNotifications({ warehouse }: { warehouse: WarehouseDoc }) {
  const { userProfile } = useAuth();
  const {
    inboundDockQueue,
    pendingOutboundQueue,
    pickQueue,
    packQueue,
    dispatchQueue,
    returnDockQueue,
    liveLoading,
    outboundLoading,
  } = useWarehouseOpsLive();
  const { data: allReturns, loading: returnsLoading } = useAllProductReturns();
  const { clients } = useWarehouseOpsClients({ includeUnapproved: true });
  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) {
      map.set(c.uid, formatClientOptionLabel(c));
    }
    return map;
  }, [clients]);

  const [filter, setFilter] = useState<NotifFilter>("all");
  const [search, setSearch] = useState("");

  const canReceive = hasFeature(userProfile, "ops_receive");
  const canPick = hasFeature(userProfile, "ops_pick");
  const canPack = hasFeature(userProfile, "ops_pack");
  const canReturns = hasFeature(userProfile, "ops_returns");

  const rows = useMemo(() => {
    const out: OpsNotificationRow[] = [];

    if (canReceive) {
      for (const r of inboundDockQueue) {
        const createdAtMs =
          (r.requestedAt && typeof (r.requestedAt as { seconds?: number }).seconds === "number"
            ? (r.requestedAt as { seconds: number }).seconds * 1000
            : 0) ||
          (r.addDate && typeof (r.addDate as { seconds?: number }).seconds === "number"
            ? (r.addDate as { seconds: number }).seconds * 1000
            : 0);
        if (isPendingInbound(r.status)) {
          out.push({
            id: `inbound-pending:${r.clientUserId}:${r.id}`,
            kind: "inbound_pending",
            feature: "ops_receive",
            title: r.productName || "Inbound request",
            subtitle: `Qty ${r.expectedQty || r.quantity || 0}${r.sku ? ` · SKU ${r.sku}` : ""}`,
            clientLabel: r.clientDisplayName,
            statusLabel: "Pending approval",
            createdAtMs,
            processHref: `/warehouse-ops/receiving?tab=pending&userId=${encodeURIComponent(r.clientUserId)}&requestId=${encodeURIComponent(r.id)}`,
            processLabel: "Approve at dock",
          });
        } else if (isApprovedInbound(r.status) && r.remainingQty > 0) {
          out.push({
            id: `inbound-receive:${r.clientUserId}:${r.id}`,
            kind: "inbound_receive",
            feature: "ops_receive",
            title: r.productName || "Inbound request",
            subtitle: `Remaining ${r.remainingQty}${r.sku ? ` · SKU ${r.sku}` : ""}`,
            clientLabel: r.clientDisplayName,
            statusLabel: "Awaiting receive",
            createdAtMs,
            processHref: `/warehouse-ops/receiving?tab=approved&userId=${encodeURIComponent(r.clientUserId)}&requestId=${encodeURIComponent(r.id)}`,
            processLabel: "Receive",
          });
        }
      }
    }

    if (canPick) {
      for (const r of pendingOutboundQueue) {
        out.push({
          id: `outbound-pending:${r.clientUserId}:${r.id}`,
          kind: "outbound_pending",
          feature: "ops_pick",
          title: r.shipTo?.trim() || "Outbound shipment",
          subtitle: r.lineSummary || `${r.status}${r.needsClientLabel ? " · waiting label" : ""}`,
          clientLabel: r.clientDisplayName,
          statusLabel: "Pending approval",
          createdAtMs: r.createdAt?.getTime() ?? 0,
          processHref: `/warehouse-ops/pick?tab=pending&userId=${encodeURIComponent(r.clientUserId)}&requestId=${encodeURIComponent(r.id)}`,
          processLabel: "Approve for pick",
        });
      }
      for (const o of pickQueue) {
        const lineSummary =
          o.lines?.length > 0
            ? `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}`
            : "Pick queue";
        out.push({
          id: `outbound-pick:${o.clientUserId}:${o.id}`,
          kind: "outbound_pick",
          feature: "ops_pick",
          title: o.shipTo?.trim() || "Ready to pick",
          subtitle: lineSummary,
          clientLabel: o.clientDisplayName,
          statusLabel: "Ready to pick",
          createdAtMs: o.confirmedAt?.getTime() ?? 0,
          processHref: `/warehouse-ops/pick?tab=ready&userId=${encodeURIComponent(o.clientUserId)}&requestId=${encodeURIComponent(o.id)}`,
          processLabel: "Open pick",
        });
      }
    }

    if (canPack) {
      for (const o of packQueue) {
        const lineSummary =
          o.lines?.length > 0
            ? `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}`
            : "Pack queue";
        out.push({
          id: `outbound-pack:${o.clientUserId}:${o.id}`,
          kind: "outbound_pack",
          feature: "ops_pack",
          title: o.shipTo?.trim() || "Ready to pack",
          subtitle: lineSummary,
          clientLabel: o.clientDisplayName,
          statusLabel: "Ready to pack",
          createdAtMs: o.confirmedAt?.getTime() ?? 0,
          processHref: `/warehouse-ops/pack?userId=${encodeURIComponent(o.clientUserId)}&requestId=${encodeURIComponent(o.id)}`,
          processLabel: "Open pack",
        });
      }
      for (const o of dispatchQueue) {
        const lineSummary =
          o.lines?.length > 0
            ? `${o.lines.length} line${o.lines.length === 1 ? "" : "s"}`
            : "Dispatch queue";
        out.push({
          id: `outbound-dispatch:${o.clientUserId}:${o.id}`,
          kind: "outbound_dispatch",
          feature: "ops_pack",
          title: o.shipTo?.trim() || "Ready to dispatch",
          subtitle: o.courierTracking ? `Tracking ${o.courierTracking}` : lineSummary,
          clientLabel: o.clientDisplayName,
          statusLabel: "Ready to dispatch",
          createdAtMs: o.readyToDispatchAt?.getTime() ?? o.confirmedAt?.getTime() ?? 0,
          processHref: `/warehouse-ops/dispatch?userId=${encodeURIComponent(o.clientUserId)}&requestId=${encodeURIComponent(o.id)}`,
          processLabel: "Open dispatch",
        });
      }
    }

    if (canReturns) {
      const pendingReturns = allReturns.filter((r) => normStatus(r.status) === "pending");
      for (const r of pendingReturns) {
        const ownerId = String(r.ownerUserId || "").trim();
        const createdAtMs =
          r.createdAt && typeof (r.createdAt as { seconds?: number }).seconds === "number"
            ? (r.createdAt as { seconds: number }).seconds * 1000
            : 0;
        out.push({
          id: `return-pending:${ownerId}:${r.id}`,
          kind: "return_pending",
          feature: "ops_returns",
          title: r.productName || r.newProductName || "Product return",
          subtitle: `Req qty ${r.requestedQuantity ?? 0}${
            r.sku || r.newProductSku ? ` · SKU ${r.sku || r.newProductSku}` : ""
          }`,
          clientLabel: clientNameById.get(ownerId) || (ownerId ? `Client ${ownerId.slice(0, 8)}` : "Client"),
          statusLabel: "Pending approval",
          createdAtMs,
          processHref: `/warehouse-ops/returns?tab=pending&userId=${encodeURIComponent(ownerId || "")}&returnId=${encodeURIComponent(String(r.id || ""))}`,
          processLabel: "Review return",
        });
      }
      for (const r of returnDockQueue) {
        out.push({
          id: `return-open:${r.clientUserId}:${r.id}`,
          kind: "return_open",
          feature: "ops_returns",
          title: r.productLabel || "Open return",
          subtitle: `Remaining ${r.remainingQty} · ${r.skuLabel || "No SKU"}`,
          clientLabel: r.clientDisplayName,
          statusLabel: normStatus(r.status) === "in_progress" ? "In progress" : "Approved",
          createdAtMs:
            r.createdAt && typeof (r.createdAt as { seconds?: number }).seconds === "number"
              ? (r.createdAt as { seconds: number }).seconds * 1000
              : 0,
          processHref: `/warehouse-ops/returns?tab=${
            normStatus(r.status) === "in_progress" ? "in_progress" : "open"
          }&userId=${encodeURIComponent(r.clientUserId)}&returnId=${encodeURIComponent(r.id)}`,
          processLabel: "Process return",
        });
      }
    }

    out.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return out;
  }, [
    allReturns,
    canPack,
    canPick,
    canReceive,
    canReturns,
    clientNameById,
    dispatchQueue,
    inboundDockQueue,
    packQueue,
    pendingOutboundQueue,
    pickQueue,
    returnDockQueue,
  ]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (!matchesFilter(row.kind, filter)) return false;
      if (!q) return true;
      const hay = `${row.title} ${row.subtitle} ${row.clientLabel} ${row.statusLabel}`.toLowerCase();
      return hay.includes(q);
    });
  }, [filter, rows, search]);

  const counts = useMemo(() => {
    return {
      all: rows.length,
      inbound: rows.filter((r) => r.kind.startsWith("inbound_")).length,
      outbound: rows.filter((r) => r.kind.startsWith("outbound_")).length,
      returns: rows.filter((r) => r.kind.startsWith("return_")).length,
    };
  }, [rows]);

  const loading = liveLoading || outboundLoading || returnsLoading;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <WarehouseOpsHeader title="Notifications" />
      <p className="text-sm text-muted-foreground">
        Live floor queue for {warehouse.name || warehouse.code || "this warehouse"}. Process opens the
        matching Warehouse Ops screen.
      </p>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search client, product, SKU…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as NotifFilter)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="inbound" disabled={!canReceive}>
            Inbound ({counts.inbound})
          </TabsTrigger>
          <TabsTrigger value="outbound" disabled={!canPick && !canPack}>
            Outbound ({counts.outbound})
          </TabsTrigger>
          <TabsTrigger value="returns" disabled={!canReturns}>
            Returns ({counts.returns})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading notifications…
        </div>
      ) : filtered.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Bell className="h-8 w-8 opacity-50" />
            <p className="font-medium text-foreground">No items to process</p>
            <p className="text-sm">When new inbound, outbound, or returns arrive, they show up here.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((row) => {
            const Icon = kindIcon(row.kind);
            return (
              <Card key={row.id} className="border-border/70 shadow-sm">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-orange-50 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate font-semibold leading-tight">{row.title}</p>
                        <Badge variant="outline" className={cn("text-[10px]", kindTone(row.kind))}>
                          {row.statusLabel}
                        </Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">{row.clientLabel}</p>
                      <p className="text-xs text-muted-foreground">{row.subtitle}</p>
                      {row.createdAtMs ? (
                        <p className="text-[11px] text-muted-foreground/80">{formatWhen(row.createdAtMs)}</p>
                      ) : null}
                    </div>
                  </div>
                  <Button asChild className="w-full shrink-0 sm:w-auto">
                    <Link href={row.processHref}>
                      {row.processLabel}
                      <ArrowRight className="ml-1.5 h-4 w-4" />
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
