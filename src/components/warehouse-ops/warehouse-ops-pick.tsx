"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { findBinByPath, resolveScan } from "@/lib/warehouse-putaway";
import {
  applyPickStep,
  buildPickPlan,
  markPickOrderStatus,
  skipPickOrder,
  type OutboundPickOrder,
  type PickPlan,
  type PickTaskStep,
} from "@/lib/warehouse-pick";
import { isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import type { WarehouseDoc } from "@/types";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  Package,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseOpsPick({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;
  const canDismissFromQueue = isOpsSupervisor(userProfile);

  const { pickQueue: orders, outboundLoading: queueLoading } = useWarehouseOpsLive();

  const [selectedOrder, setSelectedOrder] = useState<OutboundPickOrder | null>(null);
  const [plan, setPlan] = useState<PickPlan | null>(null);
  const [loadingPlan, setLoadingPlan] = useState(false);

  const [binScan, setBinScan] = useState("");
  const [cartonScan, setCartonScan] = useState("");
  const [resolvedBinId, setResolvedBinId] = useState<string | null>(null);
  const [resolvedCartonId, setResolvedCartonId] = useState<string | null>(null);
  const [pickQty, setPickQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [resolvingBin, setResolvingBin] = useState(false);
  const [resolvingCarton, setResolvingCarton] = useState(false);
  const [dismissing, setDismissing] = useState(false);

  const binInputRef = useRef<HTMLInputElement | null>(null);

  const currentStep: PickTaskStep | null = plan?.steps[0] ?? null;
  const qtyNum = parseInt(pickQty, 10) || 0;
  const canConfirmPick =
    selectedOrder &&
    currentStep &&
    resolvedBinId === currentStep.binId &&
    resolvedCartonId === currentStep.cartonId &&
    qtyNum >= 1 &&
    qtyNum <= currentStep.quantity;

  async function loadPlanForOrder(order: OutboundPickOrder) {
    setLoadingPlan(true);
    try {
      const next = await buildPickPlan(warehouse, order);
      setPlan(next);
      if (next.steps.length === 0 && next.shortfalls.length === 0) {
        toast({
          title: "Already picked",
          description: "This order is fully picked.",
        });
      }
    } catch (e) {
      toast({
        title: "Plan failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setPlan(null);
    } finally {
      setLoadingPlan(false);
    }
  }

  async function selectOrder(order: OutboundPickOrder) {
    setSelectedOrder(order);
    setBinScan("");
    setCartonScan("");
    setResolvedBinId(null);
    setResolvedCartonId(null);
    setPickQty("");
    await markPickOrderStatus({
      clientUserId: order.clientUserId,
      shipmentRequestId: order.id,
      warehouseId: warehouse.id,
      status: "picking",
      operatorId,
    }).catch(() => undefined);
    await loadPlanForOrder(order);
    setTimeout(() => binInputRef.current?.focus(), 50);
  }

  function resetToQueue() {
    setSelectedOrder(null);
    setPlan(null);
    setBinScan("");
    setCartonScan("");
    setResolvedBinId(null);
    setResolvedCartonId(null);
    setPickQty("");
  }

  async function handleSkipOrder(
    order: OutboundPickOrder,
    reason = "Legacy test data — no barcode warehouse stock"
  ) {
    if (!canDismissFromQueue) return;
    setDismissing(true);
    try {
      await skipPickOrder({
        clientUserId: order.clientUserId,
        shipmentRequestId: order.id,
        warehouseId: warehouse.id,
        reason,
        operatorId,
      });
      toast({
        title: "Removed from pick queue",
        description: `${order.clientDisplayName} — order will not appear on Pick.`,
      });
      if (selectedOrder?.id === order.id) {
        resetToQueue();
      } else {
      }
    } catch (e) {
      toast({
        title: "Could not remove",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDismissing(false);
    }
  }

  async function handleSkipAllInQueue() {
    if (!canDismissFromQueue || orders.length === 0) return;
    setDismissing(true);
    try {
      for (const order of orders) {
        await skipPickOrder({
          clientUserId: order.clientUserId,
          shipmentRequestId: order.id,
          warehouseId: warehouse.id,
          reason: "Legacy test data — bulk cleared from pick queue",
          operatorId,
        });
      }
      toast({
        title: "Queue cleared",
        description: `${orders.length} order(s) removed from pick.`,
      });
      resetToQueue();
    } catch (e) {
      toast({
        title: "Clear failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setDismissing(false);
    }
  }

  useEffect(() => {
    if (currentStep) {
      setPickQty(String(currentStep.quantity));
      setResolvedBinId(null);
      setResolvedCartonId(null);
      setBinScan("");
      setCartonScan("");
    }
  }, [currentStep?.stepKey]);

  async function handleResolveBin(pathOverride?: string) {
    if (!currentStep) return;
    const v = (pathOverride ?? binScan).trim();
    if (!v) return;
    if (pathOverride != null) setBinScan(pathOverride);
    setResolvingBin(true);
    try {
      const bin = await findBinByPath(warehouse.id, v);
      if (!bin) {
        toast({ title: "Bin not found", variant: "destructive" });
        setResolvedBinId(null);
        return;
      }
      if (bin.id !== currentStep.binId) {
        toast({
          title: "Wrong bin",
          description: `Expected ${currentStep.binPath}`,
          variant: "destructive",
        });
        setResolvedBinId(null);
        return;
      }
      setResolvedBinId(bin.id);
    } finally {
      setResolvingBin(false);
    }
  }

  async function handleResolveCarton(pathOverride?: string) {
    if (!currentStep || resolvedBinId !== currentStep.binId) {
      toast({ title: "Scan bin first", variant: "destructive" });
      return;
    }
    const v = (pathOverride ?? cartonScan).trim();
    if (!v) return;
    if (pathOverride != null) setCartonScan(pathOverride);
    setResolvingCarton(true);
    try {
      const res = await resolveScan(warehouse.id, v);
      if (res.kind !== "carton") {
        toast({
          title: "Carton not found",
          description: "Scan the CTN / PKG label for this step.",
          variant: "destructive",
        });
        setResolvedCartonId(null);
        return;
      }
      if (res.carton.id !== currentStep.cartonId) {
        toast({
          title: "Wrong carton",
          description: `Expected ${currentStep.cartonCode}`,
          variant: "destructive",
        });
        setResolvedCartonId(null);
        return;
      }
      setResolvedCartonId(res.carton.id);
      setCartonScan(res.carton.cartonCode);
    } finally {
      setResolvingCarton(false);
    }
  }

  async function handleConfirmPick() {
    if (!canConfirmPick || !selectedOrder || !currentStep || !resolvedBinId || !resolvedCartonId) {
      return;
    }
    setSaving(true);
    try {
      const result = await applyPickStep({
        warehouseId: warehouse.id,
        clientUserId: selectedOrder.clientUserId,
        shipmentRequestId: selectedOrder.id,
        step: currentStep,
        scannedBinId: resolvedBinId,
        scannedCartonId: resolvedCartonId,
        pickQty: qtyNum,
        operatorId,
      });
      toast({
        title: result.orderComplete ? "Order picked" : "Pick recorded",
        description: result.orderComplete
          ? `${selectedOrder.clientDisplayName} — ready to pack`
          : `${result.pickedQty} × ${currentStep.sku} picked`,
      });
      if (result.orderComplete) {
        resetToQueue();
        return;
      }
      await loadPlanForOrder(selectedOrder);
    } catch (e) {
      toast({
        title: "Pick failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (!selectedOrder) {
    return (
      <div className="max-w-4xl space-y-6">
        <WarehouseOpsHeader title="Pick" />
        <Card className="border-emerald-200/60 bg-emerald-50/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-emerald-600" />
              Outbound pick queue
            </CardTitle>
            <CardDescription className="text-xs">
              Confirmed client shipment requests. Select an order, then scan bin → carton for each
              step (FEFO if expiry on line, else FIFO by receive date; walk order by bin).
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-sm">Orders to pick</CardTitle>
              {canDismissFromQueue && orders.length > 0 ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="text-xs"
                      disabled={dismissing}
                    >
                      Clear all ({orders.length})
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Clear entire pick queue?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Removes {orders.length} confirmed order(s) from the pick screen without
                        floor picking. Use for legacy test data that was fulfilled before barcode
                        scanning. Shipment requests stay confirmed in admin.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleSkipAllInQueue()}>
                        Clear queue
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
            </div>
            {canDismissFromQueue ? (
              <CardDescription className="text-xs">
                Supervisor: use ✕ on a row or Clear all to remove legacy orders with no bin stock.
              </CardDescription>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-3">
            {queueLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading orders…
              </p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No confirmed outbound orders waiting for floor pick.
              </p>
            ) : (
              <div className="space-y-2">
                {orders.map((order) => (
                  <div
                    key={`${order.clientUserId}:${order.id}`}
                    className="flex gap-1 rounded-lg border overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => void selectOrder(order)}
                      className="flex-1 text-left px-3 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex justify-between gap-2 items-start">
                        <div>
                          <p className="font-semibold text-sm">{order.clientDisplayName}</p>
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
                          {order.warehousePickStatus}
                        </Badge>
                      </div>
                    </button>
                    {canDismissFromQueue ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0 rounded-none border-l h-auto"
                        disabled={dismissing}
                        title="Remove from pick queue"
                        onClick={() => void handleSkipOrder(order)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between gap-2">
        <WarehouseOpsHeader title="Pick order" />
        <Button type="button" variant="ghost" size="sm" onClick={resetToQueue}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Queue
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{selectedOrder.clientDisplayName}</CardTitle>
          <CardDescription className="text-xs">
            {selectedOrder.lines.map((l) => `${l.quantityUnits}× ${l.sku}`).join(" · ")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loadingPlan ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : plan ? (
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">
                {plan.steps.length} step{plan.steps.length === 1 ? "" : "s"} left
              </Badge>
              {plan.shortfalls.length > 0 ? (
                <Badge variant="destructive">
                  {plan.shortfalls.length} shortfall
                </Badge>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {plan?.shortfalls.length ? (
        <Card className="border-amber-300 bg-amber-50/40">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-900">Stock shortfall</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1 text-amber-900">
            {plan.shortfalls.map((s) => (
              <p key={s.sku}>
                {s.productName} ({s.sku}): need {s.needed}, only {s.planned} in bins
              </p>
            ))}
            <p className="pt-1 text-muted-foreground">
              Put away stock to pick this order, or remove it from the queue if it is legacy test
              data.
            </p>
            {canDismissFromQueue && selectedOrder ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2"
                disabled={dismissing}
                onClick={() => void handleSkipOrder(selectedOrder)}
              >
                Remove from pick queue
              </Button>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {!loadingPlan && plan && plan.steps.length === 0 && plan.shortfalls.length > 0 ? (
        <Card>
          <CardContent className="py-6 text-center space-y-3">
            <AlertCircle className="h-10 w-10 text-amber-600 mx-auto" />
            <p className="font-semibold">Cannot pick — no stock in bins</p>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto">
              Nothing was marked as picked. This order stays on the queue until you put away stock
              or remove it (supervisor).
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Button type="button" variant="outline" onClick={resetToQueue}>
                Back to queue
              </Button>
              {canDismissFromQueue && selectedOrder ? (
                <Button
                  type="button"
                  variant="destructive"
                  disabled={dismissing}
                  onClick={() => void handleSkipOrder(selectedOrder)}
                >
                  Remove from queue
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {!loadingPlan && plan && plan.steps.length === 0 && plan.shortfalls.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center space-y-3">
            <CheckCircle2 className="h-10 w-10 text-emerald-600 mx-auto" />
            <p className="font-semibold">Order fully picked</p>
            <Button asChild>
              <Link href="/warehouse-ops">Back to ops home</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {currentStep ? (
        <>
          <Card className="border-emerald-300/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Package className="h-4 w-4" />
                Step {currentStep.sequence}
                {plan ? ` of ${plan.steps.length}` : ""}
              </CardTitle>
              <CardDescription className="text-xs font-mono">
                {currentStep.sku} · {currentStep.quantity} units
                {currentStep.lot ? ` · Lot ${currentStep.lot}` : ""}
                {currentStep.expiry
                  ? ` · Exp ${currentStep.expiry.slice(0, 10)}`
                  : currentStep.receivedAtIso
                    ? ` · Rcv ${currentStep.receivedAtIso.slice(0, 10)} (FIFO)`
                    : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>
                <span className="text-muted-foreground">Bin </span>
                <span className="font-mono font-semibold">{currentStep.binPath}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Carton </span>
                <span className="font-mono font-semibold">{currentStep.cartonCode}</span>
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Scan bin</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  ref={binInputRef}
                  value={binScan}
                  onChange={(e) => setBinScan(e.target.value)}
                  placeholder="Scan bin"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleResolveBin();
                  }}
                />
                <ScanCameraButton
                  onScan={(text) => void handleResolveBin(text)}
                  scannerTitle="Scan bin"
                  scannerDescription={`Expected: ${currentStep.binPath}`}
                />
                <Button onClick={() => void handleResolveBin()} disabled={resolvingBin}>
                  {resolvingBin ? <Loader2 className="h-4 w-4 animate-spin" /> : "OK"}
                </Button>
              </div>
              {resolvedBinId === currentStep.binId ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                  Bin verified
                </Badge>
              ) : null}
            </CardContent>
          </Card>

          <Card className={cn(resolvedBinId !== currentStep.binId && "opacity-60 pointer-events-none")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Scan carton</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={cartonScan}
                  onChange={(e) => setCartonScan(e.target.value)}
                  placeholder="Scan carton"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleResolveCarton();
                  }}
                />
                <ScanCameraButton
                  onScan={(text) => void handleResolveCarton(text)}
                  scannerTitle="Scan carton"
                  scannerDescription={`Expected: ${currentStep.cartonCode}`}
                />
                <Button onClick={() => void handleResolveCarton()} disabled={resolvingCarton}>
                  {resolvingCarton ? <Loader2 className="h-4 w-4 animate-spin" /> : "OK"}
                </Button>
              </div>
              {resolvedCartonId === currentStep.cartonId ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                  Carton verified
                </Badge>
              ) : null}
            </CardContent>
          </Card>

          <Card
            className={cn(
              resolvedCartonId !== currentStep.cartonId && "opacity-60 pointer-events-none"
            )}
          >
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Confirm quantity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label className="text-xs">Pick qty (max {currentStep.quantity})</Label>
              <Input
                type="number"
                min={1}
                max={currentStep.quantity}
                value={pickQty}
                onChange={(e) => setPickQty(e.target.value)}
              />
            </CardContent>
          </Card>

          <div className="sticky bottom-4 bg-background/95 py-2 border-t">
            <Button
              size="lg"
              className="w-full bg-emerald-600 hover:bg-emerald-700"
              disabled={!canConfirmPick || saving}
              onClick={() => void handleConfirmPick()}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                `Confirm pick · ${qtyNum || currentStep.quantity} × ${currentStep.sku}`
              )}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
