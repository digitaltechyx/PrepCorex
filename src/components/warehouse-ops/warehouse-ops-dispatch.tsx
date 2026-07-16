"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsDispatchLog } from "@/components/warehouse-ops/warehouse-ops-dispatch-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  completeDispatchHandoff,
  returnToPackFromDispatchQc,
  type OutboundPackOrder,
  type WarehouseQcCondition,
  type WarehouseQcUnitType,
} from "@/lib/warehouse-pack";
import {
  completeCrossdockDispatch,
  findCrossdockUnitByScan,
  linkCrossdockHoldToShipment,
  type CrossdockDispatchUnit,
} from "@/lib/warehouse-crossdock-dispatch";
import {
  countDispatchedToday,
  loadDispatchLog,
} from "@/lib/warehouse-dispatch-log";
import { courierScansMatch } from "@/lib/warehouse-courier-label";
import type { WarehouseDoc } from "@/types";
import {
  CheckCircle2,
  ClipboardList,
  Loader2,
  Package,
  ScanLine,
  Truck,
  XCircle,
  ArrowRightLeft,
  Boxes,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

function formatWhen(date: Date | null): string {
  if (!date) return "—";
  return format(date, "MMM d, yyyy h:mm a");
}

type DispatchMode = "outbound" | "crossdock";

function StatCard({
  label,
  value,
  hint,
  icon,
  accent,
  loading,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: ReactNode;
  accent?: string;
  loading?: boolean;
}) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <span className="text-muted-foreground/70">{icon}</span>
        </div>
        <p
          className={cn(
            "mt-1 text-2xl sm:text-3xl font-bold tabular-nums",
            accent,
            loading && "animate-pulse text-muted-foreground/60"
          )}
        >
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

export function WarehouseOpsDispatch({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;
  const { clients } = useWarehouseOpsClients({ includeUnapproved: true });

  const {
    dispatchQueue: orders,
    crossdockDispatchQueue,
    crossdockHoldQueue,
    outboundLoading: queueLoading,
    liveLoading: crossdockLoading,
  } = useWarehouseOpsLive();

  const [tab, setTab] = useState<"dispatch" | "log">("dispatch");
  const [mode, setMode] = useState<DispatchMode>("outbound");
  const [dispatchedToday, setDispatchedToday] = useState(0);
  const [todayLoading, setTodayLoading] = useState(true);

  const [scanValue, setScanValue] = useState("");
  const [scanning, setScanning] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<OutboundPackOrder | null>(null);
  const [lastScanValue, setLastScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [qcUnitType, setQcUnitType] = useState<WarehouseQcUnitType>("package");
  const [qcCondition, setQcCondition] = useState<WarehouseQcCondition | null>(null);
  const [qcRemarks, setQcRemarks] = useState("");

  const [crossdockUnitScan, setCrossdockUnitScan] = useState("");
  const [crossdockCourierScan, setCrossdockCourierScan] = useState("");
  const [matchedCrossdockUnit, setMatchedCrossdockUnit] = useState<CrossdockDispatchUnit | null>(null);
  const [matchedHoldUnit, setMatchedHoldUnit] = useState<CrossdockDispatchUnit | null>(null);
  const [crossdockScanError, setCrossdockScanError] = useState<string | null>(null);
  const [crossdockConfirming, setCrossdockConfirming] = useState(false);
  const [linkShipmentId, setLinkShipmentId] = useState("");
  const [linkingHold, setLinkingHold] = useState(false);

  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const crossdockUnitScanRef = useRef<HTMLInputElement | null>(null);
  const crossdockCourierScanRef = useRef<HTMLInputElement | null>(null);

  const refreshTodayCount = useCallback(async () => {
    setTodayLoading(true);
    try {
      const rows = await loadDispatchLog({
        warehouse,
        clients,
        max: 100,
      });
      setDispatchedToday(countDispatchedToday(rows));
    } catch {
      // Stats are best-effort.
    } finally {
      setTodayLoading(false);
    }
  }, [warehouse, clients]);

  useEffect(() => {
    void refreshTodayCount();
  }, [refreshTodayCount]);

  useEffect(() => {
    if (mode === "outbound") scanInputRef.current?.focus();
    else crossdockUnitScanRef.current?.focus();
  }, [mode]);

  function clearCrossdockMatch() {
    setMatchedCrossdockUnit(null);
    setCrossdockUnitScan("");
    setCrossdockCourierScan("");
    setCrossdockScanError(null);
    setQcCondition(null);
    setQcRemarks("");
    crossdockUnitScanRef.current?.focus();
  }

  function handleCrossdockUnitScan(raw?: string) {
    const value = (raw ?? crossdockUnitScan).trim();
    if (!value) return;

    const unit = findCrossdockUnitByScan(value, crossdockDispatchQueue);
    if (!unit) {
      setCrossdockScanError("No matching cross-dock unit in the dispatch queue.");
      setMatchedCrossdockUnit(null);
      toast({
        title: "Unknown unit",
        description: "Scan a CTN/PKG/PLT that was forwarded or linked to outbound.",
        variant: "destructive",
      });
      return;
    }

    setMatchedCrossdockUnit(unit);
    setCrossdockUnitScan("");
    setCrossdockScanError(null);
    setQcUnitType(unit.defaultQcUnitType);
    setQcCondition(null);
    setQcRemarks("");
    toast({ title: "Cross-dock unit", description: unit.code });
    crossdockCourierScanRef.current?.focus();
  }

  async function handleCrossdockDispatchConfirm() {
    if (!matchedCrossdockUnit || !crossdockCourierScan.trim() || qcCondition !== "good") return;

    setCrossdockConfirming(true);
    try {
      await completeCrossdockDispatch({
        warehouseId: warehouse.id,
        unit: matchedCrossdockUnit,
        courierTracking: crossdockCourierScan.trim(),
        qcUnitType,
        operatorId,
      });
      toast({
        title: "Cross-dock dispatched",
        description: `${matchedCrossdockUnit.code} — entry added to client shipped table.`,
      });
      clearCrossdockMatch();
      void refreshTodayCount();
    } catch (e) {
      toast({
        title: "Could not dispatch cross-dock",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCrossdockConfirming(false);
    }
  }

  async function handleLinkHoldToOutbound() {
    if (!matchedHoldUnit || !linkShipmentId.trim()) return;

    setLinkingHold(true);
    try {
      await linkCrossdockHoldToShipment({
        warehouseId: warehouse.id,
        kind: matchedHoldUnit.kind,
        unitId: matchedHoldUnit.id,
        clientUserId: matchedHoldUnit.clientUserId,
        shipmentRequestId: linkShipmentId.trim(),
        operatorId,
      });
      toast({
        title: "Linked to outbound",
        description: `${matchedHoldUnit.code} moved to Pack — complete pack, then dispatch.`,
      });
      setLinkShipmentId("");
      setMatchedHoldUnit(null);
    } catch (e) {
      toast({
        title: "Could not link",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLinkingHold(false);
    }
  }

  function handleHoldUnitScan(raw?: string) {
    const value = (raw ?? crossdockUnitScan).trim();
    if (!value) return;
    const unit = findCrossdockUnitByScan(value, crossdockHoldQueue);
    if (!unit) {
      toast({
        title: "Unknown held unit",
        description: "Scan a keep-closed cross-dock CTN/PKG/PLT awaiting client outbound.",
        variant: "destructive",
      });
      return;
    }
    setMatchedHoldUnit(unit);
    setCrossdockUnitScan("");
    toast({ title: "Held cross-dock", description: unit.code });
  }

  async function handleScanSubmit(raw?: string) {
    const value = (raw ?? scanValue).trim();
    if (!value) return;

    setScanning(true);
    setScanError(null);
    setMatchedOrder(null);

    try {
      const matches = orders.filter(
        (order) => order.courierTracking && courierScansMatch(value, order.courierTracking)
      );

      if (matches.length === 0) {
        setScanError("No matching parcel in the dispatch queue — check the label or pack bench.");
        toast({
          title: "Wrong or unknown parcel",
          description: "This label is not in the ready-to-dispatch queue.",
          variant: "destructive",
        });
        return;
      }

      const order = matches[0];
      if (matches.length > 1) {
        toast({
          title: "Multiple orders on this label",
          description: `Matched ${order.clientDisplayName} — dispatch one parcel at a time if labels were reused.`,
        });
      }

      setMatchedOrder(order);
      setLastScanValue(value);
      setScanValue("");
      setQcUnitType(order.defaultQcUnitType ?? "package");
      setQcCondition(null);
      setQcRemarks("");
      toast({
        title: "Correct parcel",
        description: order.clientDisplayName,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      setScanError(msg);
      toast({ title: "Scan failed", description: msg, variant: "destructive" });
    } finally {
      setScanning(false);
      scanInputRef.current?.focus();
    }
  }

  async function handleConfirmDispatch() {
    if (!matchedOrder || !lastScanValue || qcCondition !== "good") return;

    setConfirming(true);
    try {
      const shopifyHints = await completeDispatchHandoff({
        warehouseId: warehouse.id,
        clientUserId: matchedOrder.clientUserId,
        shipmentRequestId: matchedOrder.id,
        scannedValue: lastScanValue,
        qcUnitType,
        operatorId,
      });

      if (user && shopifyHints.length > 0) {
        const token = await user.getIdToken();
        for (const hint of shopifyHints) {
          if (hint.source !== "shopify" || !hint.shop || !hint.shopifyVariantId) continue;
          try {
            const res = await fetch("/api/shopify/sync-inventory", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
              body: JSON.stringify({
                userId: matchedOrder.clientUserId,
                shop: hint.shop,
                shopifyVariantId: hint.shopifyVariantId,
                shopifyInventoryItemId: hint.shopifyInventoryItemId,
                newQuantity: hint.newQuantity,
              }),
            });
            if (!res.ok) {
              const data = await res.json().catch(() => ({}));
              toast({
                variant: "destructive",
                title: "Dispatched; Shopify inventory did not update",
                description: typeof data.error === "string" ? data.error : "Re-connect the store or use an admin account.",
              });
            }
          } catch (e) {
            toast({
              variant: "destructive",
              title: "Dispatched; Shopify inventory did not update",
              description: e instanceof Error ? e.message : "Unknown error",
            });
          }
        }
      }

      toast({
        title: "Dispatched",
        description: `${matchedOrder.clientDisplayName} handed off to carrier.`,
      });
      setMatchedOrder(null);
      setLastScanValue("");
      setScanError(null);
      setQcCondition(null);
      setQcRemarks("");
      void refreshTodayCount();
    } catch (e) {
      toast({
        title: "Could not confirm dispatch",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
      scanInputRef.current?.focus();
    }
  }

  async function handleReturnToPack() {
    if (!matchedOrder || !lastScanValue || qcCondition !== "not_good") return;

    setConfirming(true);
    try {
      await returnToPackFromDispatchQc({
        warehouseId: warehouse.id,
        clientUserId: matchedOrder.clientUserId,
        shipmentRequestId: matchedOrder.id,
        scannedValue: lastScanValue,
        qcUnitType,
        remarks: qcRemarks,
        operatorId,
      });
      toast({
        title: "Returned to pack",
        description: `${matchedOrder.clientDisplayName} — warehouse stock restored.`,
      });
      setMatchedOrder(null);
      setLastScanValue("");
      setScanError(null);
      setQcCondition(null);
      setQcRemarks("");
    } catch (e) {
      toast({
        title: "Could not return to pack",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
      scanInputRef.current?.focus();
    }
  }

  function clearMatch() {
    setMatchedOrder(null);
    setLastScanValue("");
    setScanError(null);
    setScanValue("");
    setQcCondition(null);
    setQcRemarks("");
    scanInputRef.current?.focus();
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <WarehouseOpsHeader title="Dispatch" />

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as "dispatch" | "log")}
      >
        <TabsList>
          <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>

        <TabsContent value="dispatch" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Ready outbound"
              value={orders.length}
              hint="Awaiting carrier handoff"
              icon={<Truck className="h-4 w-4" />}
              accent="text-emerald-700 dark:text-emerald-400"
              loading={queueLoading}
            />
            <StatCard
              label="Ready cross-dock"
              value={crossdockDispatchQueue.length}
              hint="Forward / return units"
              icon={<Package className="h-4 w-4" />}
              accent="text-sky-700 dark:text-sky-400"
              loading={crossdockLoading}
            />
            <StatCard
              label="Held units"
              value={crossdockHoldQueue.length}
              hint="Awaiting outbound link"
              icon={<Boxes className="h-4 w-4" />}
              accent="text-amber-700 dark:text-amber-400"
              loading={crossdockLoading}
            />
            <StatCard
              label="Dispatched today"
              value={dispatchedToday}
              hint="Outbound + cross-dock"
              icon={<ClipboardList className="h-4 w-4" />}
              accent="text-violet-700 dark:text-violet-400"
              loading={todayLoading}
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={mode === "outbound" ? "default" : "outline"}
              onClick={() => setMode("outbound")}
            >
              Outbound orders ({orders.length})
            </Button>
            <Button
              type="button"
              variant={mode === "crossdock" ? "default" : "outline"}
              onClick={() => setMode("crossdock")}
            >
              Cross-dock ({crossdockDispatchQueue.length})
            </Button>
          </div>

      {mode === "outbound" ? (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Carrier handoff
          </CardTitle>
          <CardDescription className="text-xs">
            Scan the courier label, complete quality check, then dispatch or return to pack.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-orange-300/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Scan courier label
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dispatch-scan" className="text-xs">
              Tracking barcode
            </Label>
            <div className="flex gap-2">
              <Input
                id="dispatch-scan"
                ref={scanInputRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleScanSubmit();
                }}
                placeholder="Scan label…"
                className="font-mono"
                disabled={scanning || confirming}
              />
              <ScanCameraButton
                onScan={(v) => {
                  setScanValue(v);
                  void handleScanSubmit(v);
                }}
              />
            </div>
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={!scanValue.trim() || scanning || confirming}
            onClick={() => void handleScanSubmit()}
          >
            {scanning ? "Checking…" : "Verify parcel"}
          </Button>

          {scanError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50/80 dark:bg-red-950/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{scanError}</p>
            </div>
          ) : null}

          {matchedOrder ? (
            <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-3 space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p className="font-semibold text-sm">Correct parcel</p>
              </div>
              <div className="text-sm space-y-1">
                <p className="font-medium">{matchedOrder.clientDisplayName}</p>
                {matchedOrder.courierTracking ? (
                  <p className="text-xs font-mono text-muted-foreground">
                    {matchedOrder.courierTracking}
                  </p>
                ) : null}
                {matchedOrder.shipFrom ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">From: </span>
                    {matchedOrder.shipFrom}
                  </p>
                ) : null}
                {matchedOrder.shipTo ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">To: </span>
                    {matchedOrder.shipTo}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {matchedOrder.lines.map((l) => `${l.quantityUnits}× ${l.sku}`).join(" · ")}
                </p>
              </div>

              <div className="space-y-3 border-t pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Quality check
                </p>
                <div className="space-y-1.5">
                  <Label className="text-xs">Unit type</Label>
                  <Select
                    value={qcUnitType}
                    onValueChange={(v) => setQcUnitType(v as WarehouseQcUnitType)}
                    disabled={confirming}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="package">Package</SelectItem>
                      <SelectItem value="carton">Carton</SelectItem>
                      <SelectItem value="pallet">Pallet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Condition</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant={qcCondition === "good" ? "default" : "outline"}
                      className={cn(
                        qcCondition === "good" && "bg-emerald-600 hover:bg-emerald-700"
                      )}
                      disabled={confirming}
                      onClick={() => setQcCondition("good")}
                    >
                      Good
                    </Button>
                    <Button
                      type="button"
                      variant={qcCondition === "not_good" ? "default" : "outline"}
                      className={cn(
                        qcCondition === "not_good" && "bg-red-600 hover:bg-red-700"
                      )}
                      disabled={confirming}
                      onClick={() => setQcCondition("not_good")}
                    >
                      Not good
                    </Button>
                  </div>
                </div>
                {qcCondition === "not_good" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="qc-remarks" className="text-xs">
                      Remarks (required)
                    </Label>
                    <Textarea
                      id="qc-remarks"
                      value={qcRemarks}
                      onChange={(e) => setQcRemarks(e.target.value)}
                      placeholder="Describe the issue — damaged carton, wrong label, etc."
                      rows={3}
                      disabled={confirming}
                    />
                  </div>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={confirming}
                  onClick={clearMatch}
                >
                  Scan another
                </Button>
                {qcCondition === "good" ? (
                  <Button
                    type="button"
                    className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                    disabled={confirming}
                    onClick={() => void handleConfirmDispatch()}
                  >
                    {confirming ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Confirm dispatched"
                    )}
                  </Button>
                ) : qcCondition === "not_good" ? (
                  <Button
                    type="button"
                    className="flex-1 bg-red-600 hover:bg-red-700"
                    disabled={confirming || !qcRemarks.trim()}
                    onClick={() => void handleReturnToPack()}
                  >
                    {confirming ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        Saving…
                      </>
                    ) : (
                      "Return to pack"
                    )}
                  </Button>
                ) : (
                  <Button type="button" className="flex-1" disabled>
                    Select condition
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
          </div>

      <div className="space-y-4 lg:col-span-2">
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Awaiting handoff ({orders.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {queueLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No orders ready to dispatch.
            </p>
          ) : (
            <div className="max-h-[28rem] space-y-2 overflow-y-auto">
              {orders.map((order) => {
                const isMatched =
                  matchedOrder?.id === order.id &&
                  matchedOrder.clientUserId === order.clientUserId;
                return (
                  <div
                    key={`${order.clientUserId}:${order.id}`}
                    className={cn(
                      "rounded-lg border px-3 py-3 bg-card",
                      isMatched && "border-emerald-400 ring-1 ring-emerald-300/50"
                    )}
                  >
                    <div className="flex justify-between gap-2 items-start">
                      <div>
                        <p className="font-semibold text-sm">{order.clientDisplayName}</p>
                        {order.courierTracking ? (
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">
                            {order.courierTracking}
                          </p>
                        ) : null}
                        {order.shipTo ? (
                          <p className="text-xs text-muted-foreground mt-0.5">{order.shipTo}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground mt-1">
                          {order.lines.map((l) => `${l.quantityUnits}× ${l.sku}`).join(" · ")}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Ready: {formatWhen(order.readyToDispatchAt ?? null)}
                        </p>
                      </div>
                      <Badge className="shrink-0 bg-emerald-600">Ready</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" asChild className="w-full">
        <Link href="/warehouse-ops/pack">
          <Package className="h-4 w-4 mr-2" />
          Back to pack
        </Link>
      </Button>
      </div>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="space-y-4 lg:col-span-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Truck className="h-4 w-4" />
                Cross-dock direct dispatch
              </CardTitle>
              <CardDescription className="text-xs">
                Skip pick and pack. Scan the unit, then the outbound courier label. A shipped entry is
                created for the client automatically.
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="border-orange-300/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ScanLine className="h-4 w-4" />
                1. Scan cross-dock unit
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  ref={crossdockUnitScanRef}
                  value={crossdockUnitScan}
                  onChange={(e) => setCrossdockUnitScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleCrossdockUnitScan();
                  }}
                  placeholder="CTN / PKG / PLT…"
                  className="font-mono"
                  disabled={crossdockConfirming}
                />
                <ScanCameraButton
                  onScan={(v) => {
                    setCrossdockUnitScan(v);
                    handleCrossdockUnitScan(v);
                  }}
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={!crossdockUnitScan.trim() || crossdockConfirming}
                onClick={() => handleCrossdockUnitScan()}
              >
                Verify unit
              </Button>
              {crossdockScanError ? (
                <p className="text-sm text-red-600">{crossdockScanError}</p>
              ) : null}
              {matchedCrossdockUnit ? (
                <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/50 px-3 py-3 text-sm space-y-1">
                  <p className="font-semibold">{matchedCrossdockUnit.code}</p>
                  <p>{matchedCrossdockUnit.clientDisplayName}</p>
                  <p className="text-muted-foreground">{matchedCrossdockUnit.productLabel}</p>
                  {matchedCrossdockUnit.stagingArea ? (
                    <p className="text-xs font-mono">Area {matchedCrossdockUnit.stagingArea}</p>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>

          {matchedCrossdockUnit ? (
            <Card className="border-orange-300/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">2. Scan outbound courier label</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input
                  ref={crossdockCourierScanRef}
                  value={crossdockCourierScan}
                  onChange={(e) => setCrossdockCourierScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && crossdockCourierScan.trim()) {
                      crossdockCourierScanRef.current?.blur();
                    }
                  }}
                  placeholder="Outbound tracking barcode…"
                  className="font-mono"
                  disabled={crossdockConfirming}
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">Unit type</Label>
                  <Select
                    value={qcUnitType}
                    onValueChange={(v) => setQcUnitType(v as WarehouseQcUnitType)}
                    disabled={crossdockConfirming}
                  >
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="package">Package</SelectItem>
                      <SelectItem value="carton">Carton</SelectItem>
                      <SelectItem value="pallet">Pallet</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant={qcCondition === "good" ? "default" : "outline"}
                    className={cn(qcCondition === "good" && "bg-emerald-600 hover:bg-emerald-700")}
                    onClick={() => setQcCondition("good")}
                    disabled={crossdockConfirming}
                  >
                    Good
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={crossdockConfirming}
                    onClick={clearCrossdockMatch}
                  >
                    Cancel
                  </Button>
                </div>
                <Button
                  type="button"
                  className="w-full bg-emerald-600 hover:bg-emerald-700"
                  disabled={
                    crossdockConfirming ||
                    !crossdockCourierScan.trim() ||
                    qcCondition !== "good"
                  }
                  onClick={() => void handleCrossdockDispatchConfirm()}
                >
                  {crossdockConfirming ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Dispatching…
                    </>
                  ) : (
                    "Confirm cross-dock dispatch"
                  )}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ArrowRightLeft className="h-4 w-4" />
                Link held unit to client outbound (Path B)
              </CardTitle>
              <CardDescription className="text-xs">
                After the client outbound is confirmed, scan the held unit and enter the order ID.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={crossdockUnitScan}
                  onChange={(e) => setCrossdockUnitScan(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleHoldUnitScan();
                  }}
                  placeholder="Scan held CTN/PKG/PLT…"
                  className="font-mono"
                  disabled={linkingHold}
                />
                <Button type="button" variant="outline" onClick={() => handleHoldUnitScan()} disabled={linkingHold}>
                  Select
                </Button>
              </div>
              {matchedHoldUnit ? (
                <div className="rounded-lg border px-3 py-2 text-sm">
                  <p className="font-semibold">{matchedHoldUnit.code}</p>
                  <p className="text-muted-foreground">{matchedHoldUnit.clientDisplayName}</p>
                </div>
              ) : null}
              <div className="space-y-1.5">
                <Label className="text-xs">Confirmed outbound order ID</Label>
                <Input
                  value={linkShipmentId}
                  onChange={(e) => setLinkShipmentId(e.target.value)}
                  placeholder="Shipment request document ID"
                  className="font-mono text-xs"
                  disabled={linkingHold}
                />
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={!matchedHoldUnit || !linkShipmentId.trim() || linkingHold}
                onClick={() => void handleLinkHoldToOutbound()}
              >
                {linkingHold ? "Linking…" : "Link → Pack"}
              </Button>
            </CardContent>
          </Card>
          </div>

          <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Ready for cross-dock dispatch ({crossdockDispatchQueue.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {crossdockLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : crossdockDispatchQueue.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No cross-dock units ready. Forward at putaway or link a held unit to outbound.
                </p>
              ) : (
                <div className="max-h-[28rem] space-y-2 overflow-y-auto">
                  {crossdockDispatchQueue.map((unit) => (
                    <button
                      key={`${unit.kind}:${unit.id}`}
                      type="button"
                      className={cn(
                        "w-full text-left rounded-lg border px-3 py-3 bg-card hover:bg-muted/40",
                        matchedCrossdockUnit?.id === unit.id && "border-emerald-400 ring-1 ring-emerald-300/50"
                      )}
                      onClick={() => {
                        setMatchedCrossdockUnit(unit);
                        setQcUnitType(unit.defaultQcUnitType);
                        setQcCondition(null);
                        crossdockCourierScanRef.current?.focus();
                      }}
                    >
                      <div className="flex justify-between gap-2">
                        <div>
                          <p className="font-semibold text-sm font-mono">{unit.code}</p>
                          <p className="text-xs">{unit.clientDisplayName}</p>
                          <p className="text-xs text-muted-foreground">{unit.productLabel}</p>
                        </div>
                        <Badge variant="outline">
                          {unit.disposition === "forward"
                            ? "Forward"
                            : unit.disposition === "return"
                              ? "Return"
                              : "Linked hold"}
                        </Badge>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      )}
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <WarehouseOpsDispatchLog warehouse={warehouse} clients={clients} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
