"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { resolveScan } from "@/lib/warehouse-putaway";
import {
  buildPackPlan,
  bindCourierLabelAtPack,
  completePackReadyToDispatch,
  loadOutboundPackQueue,
  markPackItemVerified,
  verifyPackScan,
  type OutboundPackOrder,
  type PackPlan,
  type PackPlanItem,
} from "@/lib/warehouse-pack";
import type { UserProfile, WarehouseDoc } from "@/types";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Loader2,
  Package,
  ScanLine,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseOpsPack({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;

  const { data: allUsers } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () => allUsers.filter((u) => u.role === "user" && u.status === "approved"),
    [allUsers]
  );

  const [orders, setOrders] = useState<OutboundPackOrder[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [selectedOrder, setSelectedOrder] = useState<OutboundPackOrder | null>(null);
  const [plan, setPlan] = useState<PackPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

  const [labelScan, setLabelScan] = useState("");
  const [courierScan, setCourierScan] = useState("");
  const [courierPreview, setCourierPreview] = useState<{
    tracking: string;
    shipFrom: string;
    shipTo: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [courierResolving, setCourierResolving] = useState(false);

  const scanInputRef = useRef<HTMLInputElement | null>(null);
  const courierScanInputRef = useRef<HTMLInputElement | null>(null);

  const verifiedSet = useMemo(
    () => new Set(plan?.verifiedKeys ?? []),
    [plan?.verifiedKeys]
  );

  const nextItem: PackPlanItem | null =
    plan?.items.find((i) => !verifiedSet.has(i.itemKey)) ?? null;

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const list = await loadOutboundPackQueue({ warehouse, clients });
      setOrders(list);
    } catch (e) {
      toast({
        title: "Could not load pack queue",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setOrders([]);
    } finally {
      setLoadingQueue(false);
    }
  }, [warehouse, clients, toast]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  async function refreshPlan(order: OutboundPackOrder) {
    setLoadingPlan(true);
    try {
      const p = await buildPackPlan(warehouse, order);
      setPlan(p);
    } catch (e) {
      toast({
        title: "Could not load pack plan",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setPlan(null);
    } finally {
      setLoadingPlan(false);
    }
  }

  async function selectOrder(order: OutboundPackOrder) {
    setSelectedOrder(order);
    setLabelScan("");
    setCourierScan("");
    setCourierPreview(null);
    await refreshPlan(order);
  }

  function resetToQueue() {
    setSelectedOrder(null);
    setPlan(null);
    setLabelScan("");
    setCourierScan("");
    setCourierPreview(null);
    void loadQueue();
  }

  async function handleConfirmLoose(item: PackPlanItem) {
    if (!selectedOrder) return;
    setSaving(true);
    try {
      const keys = await markPackItemVerified({
        clientUserId: selectedOrder.clientUserId,
        shipmentRequestId: selectedOrder.id,
        itemKey: item.itemKey,
        warehouseId: warehouse.id,
        operatorId,
      });
      setPlan((prev) =>
        prev ? { ...prev, verifiedKeys: keys, readyToComplete: prev.items.every((i) => keys.includes(i.itemKey)) } : prev
      );
      toast({ title: "Confirmed", description: `${item.quantity}× ${item.sku}` });
    } catch (e) {
      toast({
        title: "Could not confirm",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleLabelScanSubmit(raw?: string) {
    const value = (raw ?? labelScan).trim();
    if (!value || !selectedOrder || !nextItem || nextItem.verifyMode === "confirm") return;

    setResolving(true);
    try {
      const resolved = await resolveScan(warehouse.id, value);
      if (resolved.kind !== "carton") {
        throw new Error("Scan a PKG or CTN label.");
      }
      const keys = await verifyPackScan({
        warehouseId: warehouse.id,
        clientUserId: selectedOrder.clientUserId,
        shipmentRequestId: selectedOrder.id,
        item: nextItem,
        scannedCartonId: resolved.carton.id,
        operatorId,
      });
      setLabelScan("");
      setPlan((prev) =>
        prev
          ? {
              ...prev,
              verifiedKeys: keys,
              readyToComplete: prev.items.every((i) => keys.includes(i.itemKey)),
            }
          : prev
      );
      toast({
        title: "Verified",
        description: resolved.carton.cartonCode,
      });
    } catch (e) {
      toast({
        title: "Scan failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
      scanInputRef.current?.focus();
    }
  }

  async function handleCourierScanSubmit(raw?: string) {
    const value = (raw ?? courierScan).trim();
    if (!value || !selectedOrder || !plan?.readyToComplete) return;

    setCourierResolving(true);
    try {
      const result = await bindCourierLabelAtPack({
        warehouse,
        clientUserId: selectedOrder.clientUserId,
        shipmentRequestId: selectedOrder.id,
        scannedValue: value,
        operatorId,
      });
      setCourierScan("");
      setCourierPreview({
        tracking: result.normalizedTracking,
        shipFrom: result.shipFrom,
        shipTo: result.shipTo,
      });
      setPlan((prev) =>
        prev
          ? { ...prev, courierTracking: result.normalizedTracking, courierVerified: true }
          : prev
      );
      setSelectedOrder((prev) =>
        prev ? { ...prev, courierTracking: result.normalizedTracking } : prev
      );
      toast({
        title: "Courier label verified",
        description: result.normalizedTracking,
      });
    } catch (e) {
      toast({
        title: "Courier scan failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCourierResolving(false);
      courierScanInputRef.current?.focus();
    }
  }

  async function handleReadyToDispatch() {
    if (!selectedOrder || !plan?.readyToComplete || !plan.courierVerified) return;
    setSaving(true);
    try {
      await completePackReadyToDispatch({
        warehouseId: warehouse.id,
        clientUserId: selectedOrder.clientUserId,
        shipmentRequestId: selectedOrder.id,
        operatorId,
      });
      toast({
        title: "Ready to dispatch",
        description: "Warehouse stock updated. Order appears on Dispatch.",
      });
      resetToQueue();
    } catch (e) {
      toast({
        title: "Could not complete pack",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (plan?.readyToComplete && !plan.courierVerified) {
      courierScanInputRef.current?.focus();
      return;
    }
    if (nextItem && nextItem.verifyMode !== "confirm") {
      scanInputRef.current?.focus();
    }
  }, [nextItem, plan?.readyToComplete, plan?.courierVerified]);

  function verifyModeLabel(mode: PackPlanItem["verifyMode"]): string {
    if (mode === "scan_pkg") return "Scan PKG";
    if (mode === "scan_ctn") return "Scan CTN";
    return "Confirm on screen";
  }

  if (!selectedOrder) {
    return (
      <div className="space-y-4">
        <WarehouseOpsHeader title="Pack" />
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4" />
              Pack bench
            </CardTitle>
            <CardDescription className="text-xs">
              Picked orders only. Scan PKG/CTN or confirm loose units, attach courier label,
              scan courier barcode, then mark ready to dispatch.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Orders to pack</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loadingQueue ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No picked orders waiting for pack.
              </p>
            ) : (
              <div className="space-y-2">
                {orders.map((order) => (
                  <button
                    key={`${order.clientUserId}:${order.id}`}
                    type="button"
                    onClick={() => void selectOrder(order)}
                    className="w-full text-left rounded-lg border px-3 py-3 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex justify-between gap-2 items-start">
                      <div>
                        <p className="font-semibold text-sm">{order.clientDisplayName}</p>
                        {order.qcRemarks ? (
                          <p className="text-xs text-red-600 dark:text-red-400 mt-0.5 line-clamp-2">
                            QC: {order.qcRemarks}
                          </p>
                        ) : null}
                        {order.shipTo ? (
                          <p className="text-xs text-muted-foreground mt-0.5">{order.shipTo}</p>
                        ) : null}
                        <p className="text-xs text-muted-foreground mt-1">
                          {order.lines
                            .map((l) => `${l.quantityUnits}× ${l.sku}`)
                            .join(" · ")}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {order.qcFailedAt
                          ? "QC failed"
                          : order.warehousePackStatus === "packing"
                            ? "packing"
                            : "picked"}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Button variant="outline" asChild>
          <Link href="/warehouse-ops/dispatch">View dispatch queue</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <WarehouseOpsHeader title="Pack" />
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={resetToQueue}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to pack queue
      </Button>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{selectedOrder.clientDisplayName}</CardTitle>
          <CardDescription className="text-xs">
            {selectedOrder.lines.map((l) => `${l.quantityUnits}× ${l.sku}`).join(" · ")}
          </CardDescription>
        </CardHeader>
        {selectedOrder.qcRemarks ? (
          <CardContent className="pt-0">
            <div className="flex gap-2 rounded-lg border border-red-300/60 bg-red-50/80 dark:bg-red-950/20 px-3 py-2 text-sm text-red-800 dark:text-red-300">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-xs">Returned from dispatch QC</p>
                <p className="text-xs mt-0.5 whitespace-pre-wrap">{selectedOrder.qcRemarks}</p>
              </div>
            </div>
          </CardContent>
        ) : null}
      </Card>

      {loadingPlan ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building pack plan…
        </div>
      ) : plan && plan.items.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-sm text-muted-foreground">
            No pick records found for this order. Complete picking first.
          </CardContent>
        </Card>
      ) : plan ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <ClipboardCheck className="h-4 w-4" />
                Verify picked stock
              </CardTitle>
              <CardDescription className="text-xs">
                {plan.verifiedKeys.length} of {plan.items.length} verified
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {plan.items.map((item) => {
                const done = verifiedSet.has(item.itemKey);
                const isNext = nextItem?.itemKey === item.itemKey;
                return (
                  <div
                    key={item.itemKey}
                    className={cn(
                      "rounded-lg border px-3 py-2 text-sm",
                      done && "border-emerald-300/60 bg-emerald-50/50 dark:bg-emerald-950/20",
                      isNext && !done && "border-orange-400 ring-1 ring-orange-300/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">
                          {item.quantity}× {item.sku}
                        </p>
                        <p className="text-xs text-muted-foreground">{item.productName}</p>
                        {item.cartonCode ? (
                          <p className="text-xs font-mono mt-0.5">{item.cartonCode}</p>
                        ) : null}
                      </div>
                      <Badge variant={done ? "secondary" : "outline"} className="text-[10px] shrink-0">
                        {done ? "Done" : verifyModeLabel(item.verifyMode)}
                      </Badge>
                    </div>
                    {!done && item.verifyMode === "confirm" && isNext ? (
                      <Button
                        type="button"
                        size="sm"
                        className="mt-2 w-full"
                        disabled={saving}
                        onClick={() => void handleConfirmLoose(item)}
                      >
                        Confirm {item.quantity} units
                      </Button>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {nextItem && nextItem.verifyMode !== "confirm" ? (
            <Card className="border-orange-300/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <ScanLine className="h-4 w-4" />
                  {nextItem.verifyMode === "scan_pkg" ? "Scan PKG label" : "Scan CTN label"}
                </CardTitle>
                <CardDescription className="text-xs font-mono">
                  {nextItem.cartonCode} · {nextItem.quantity}× {nextItem.sku}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pack-label-scan" className="text-xs">
                    Label scan
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="pack-label-scan"
                      ref={scanInputRef}
                      value={labelScan}
                      onChange={(e) => setLabelScan(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleLabelScanSubmit();
                      }}
                      placeholder="Scan PKG or CTN…"
                      className="font-mono"
                      disabled={resolving || saving}
                    />
                    <ScanCameraButton
                      onScan={(v) => {
                        setLabelScan(v);
                        void handleLabelScanSubmit(v);
                      }}
                    />
                  </div>
                </div>
                <Button
                  type="button"
                  className="w-full"
                  disabled={!labelScan.trim() || resolving || saving}
                  onClick={() => void handleLabelScanSubmit()}
                >
                  {resolving ? "Checking…" : "Verify scan"}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {plan.readyToComplete ? (
            <>
              <Card className="border-blue-300/60">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <ScanLine className="h-4 w-4" />
                    Scan courier label
                  </CardTitle>
                  <CardDescription className="text-xs">
                    Attach the carrier label, then scan its tracking barcode.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {!plan.courierVerified ? (
                    <>
                      <div className="space-y-1.5">
                        <Label htmlFor="courier-label-scan" className="text-xs">
                          Courier label scan
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="courier-label-scan"
                            ref={courierScanInputRef}
                            value={courierScan}
                            onChange={(e) => setCourierScan(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void handleCourierScanSubmit();
                            }}
                            placeholder="Scan tracking barcode…"
                            className="font-mono"
                            disabled={courierResolving || saving}
                          />
                          <ScanCameraButton
                            onScan={(v) => {
                              setCourierScan(v);
                              void handleCourierScanSubmit(v);
                            }}
                          />
                        </div>
                      </div>
                      <Button
                        type="button"
                        className="w-full"
                        disabled={!courierScan.trim() || courierResolving || saving}
                        onClick={() => void handleCourierScanSubmit()}
                      >
                        {courierResolving ? "Checking…" : "Verify courier label"}
                      </Button>
                    </>
                  ) : (
                    <div className="rounded-lg border bg-muted/30 px-3 py-3 space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                        <CheckCircle2 className="h-4 w-4 shrink-0" />
                        <span className="font-medium font-mono">
                          {plan.courierTracking ?? courierPreview?.tracking}
                        </span>
                      </div>
                      {courierPreview?.shipFrom || selectedOrder.shipFrom ? (
                        <p className="text-xs">
                          <span className="text-muted-foreground">From: </span>
                          {courierPreview?.shipFrom ?? selectedOrder.shipFrom}
                        </p>
                      ) : null}
                      {courierPreview?.shipTo || selectedOrder.shipTo ? (
                        <p className="text-xs">
                          <span className="text-muted-foreground">To: </span>
                          {courierPreview?.shipTo ?? selectedOrder.shipTo}
                        </p>
                      ) : null}
                    </div>
                  )}
                </CardContent>
              </Card>

              {plan.courierVerified ? (
                <Card className="border-emerald-300/60">
                  <CardContent className="py-4 space-y-3">
                    <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                      <p className="font-semibold text-sm">Ready to stage for dispatch</p>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Confirm to decrement warehouse stock and send this order to the dispatch
                      queue.
                    </p>
                    <Button
                      type="button"
                      className="w-full bg-emerald-600 hover:bg-emerald-700"
                      disabled={saving}
                      onClick={() => void handleReadyToDispatch()}
                    >
                      {saving ? (
                        <>
                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        <>
                          <Truck className="h-4 w-4 mr-2" />
                          Ready to dispatch
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
