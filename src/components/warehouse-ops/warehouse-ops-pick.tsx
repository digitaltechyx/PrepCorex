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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { WarehouseMobileCameraRecorder } from "@/components/warehouse-ops/warehouse-mobile-camera-recorder";
import { linesToWarehouseCameraSummaries } from "@/lib/warehouse-camera-types";
import { useSearchParams } from "next/navigation";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsActivityLog } from "@/components/warehouse-ops/warehouse-ops-activity-log";
import { findBinByPath, resolveScan } from "@/lib/warehouse-putaway";
import {
  applyPickStep,
  buildPickPlan,
  markPickOrderStatus,
  skipPickOrder,
  type OutboundPickOrder,
  type PickBatchOption,
  type PickPlan,
  type PickTaskStep,
} from "@/lib/warehouse-pick";
import {
  cancelConfirmedOutboundAtWarehouse,
  confirmOutboundRequestAtPick,
  rejectOutboundRequestAtPick,
  type PendingOutboundRequest,
} from "@/lib/warehouse-outbound-ops";
import { formatOutboundLineLabel } from "@/lib/warehouse-outbound-lines";
import { WarehouseOutboundLineEditPanel } from "@/components/warehouse-ops/warehouse-outbound-line-edit-panel";
import { isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import type { WarehouseDoc } from "@/types";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageSquareText,
  Package,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  buildOrderLinesFromRequestData,
  loadClientProductMap,
} from "@/lib/warehouse-outbound-lines";

type Props = {
  warehouse: WarehouseDoc;
};

type QueueTab = "pending" | "ready" | "log";
type PendingFilter = "all" | "approvable";
type ReadyFilter = "all" | "ready" | "picking";

function matchesQuery(haystack: string, q: string): boolean {
  if (!q) return true;
  return haystack.toLowerCase().includes(q);
}

function localDateKey(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatPickExpiry(expiry: string | null | undefined): string {
  if (!expiry?.trim()) return "No expiry";
  const iso = expiry.trim().slice(0, 10);
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function batchOptionsForBin(
  step: PickTaskStep,
  binId: string | null
): PickBatchOption[] {
  if (!binId || !step.allowAnyBatch) return [];
  return (step.batchOptions ?? []).filter((option) => option.binId === binId);
}

function resolveSelectedBatch(
  step: PickTaskStep,
  binId: string | null,
  cartonId: string | null
): PickBatchOption | null {
  if (!step.allowAnyBatch) {
    if (binId !== step.binId) return null;
    if (cartonId && cartonId !== step.cartonId) return null;
    return {
      cartonId: step.cartonId,
      cartonCode: step.cartonCode,
      lineId: step.lineId,
      binId: step.binId,
      binPath: step.binPath,
      lot: step.lot,
      expiry: step.expiry,
      quantity: step.quantity,
      condition: step.condition,
      receivedAtIso: step.receivedAtIso,
    };
  }
  if (!binId) return null;
  let matched = batchOptionsForBin(step, binId);
  if (matched.length === 0) return null;
  if (cartonId) {
    matched = matched.filter((option) => option.cartonId === cartonId);
    if (matched.length === 0) return null;
  } else {
    const cartonIds = new Set(matched.map((option) => option.cartonId));
    if (cartonIds.size > 1) return null;
  }
  return matched[0] ?? null;
}

function matchesDateFilter(date: Date | null | undefined, day: string): boolean {
  if (!day) return true;
  return localDateKey(date) === day;
}

function formatQueueDate(date: Date | null | undefined): string | null {
  const key = localDateKey(date);
  if (!key) return null;
  return date!.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function WarehouseOpsPick({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;
  const canDismissFromQueue = isOpsSupervisor(userProfile);

  const {
    pickQueue: orders,
    pendingOutboundQueue,
    outboundLoading: queueLoading,
  } = useWarehouseOpsLive();

  const [queueTab, setQueueTab] = useState<QueueTab>("pending");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pendingSearch, setPendingSearch] = useState("");
  const [readySearch, setReadySearch] = useState("");
  const [pendingFilter, setPendingFilter] = useState<PendingFilter>("all");
  const [readyFilter, setReadyFilter] = useState<ReadyFilter>("all");
  const [pendingDate, setPendingDate] = useState("");
  const [readyDate, setReadyDate] = useState("");

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
  const [cancellingKey, setCancellingKey] = useState<string | null>(null);

  const binInputRef = useRef<HTMLInputElement | null>(null);
  const searchParams = useSearchParams();
  const focusAppliedRef = useRef(false);

  const currentStep: PickTaskStep | null = plan?.steps[0] ?? null;
  const selectedBatch = currentStep
    ? resolveSelectedBatch(currentStep, resolvedBinId, resolvedCartonId)
    : null;
  const maxPickQty = selectedBatch
    ? Math.min(currentStep!.quantity, selectedBatch.quantity)
    : currentStep?.quantity ?? 0;
  const binVerified = Boolean(
    currentStep &&
      resolvedBinId &&
      (currentStep.allowAnyBatch
        ? batchOptionsForBin(currentStep, resolvedBinId).length > 0
        : resolvedBinId === currentStep.binId)
  );
  const qtyNum = parseInt(pickQty, 10) || 0;
  const canConfirmPick =
    selectedOrder &&
    currentStep &&
    binVerified &&
    selectedBatch &&
    qtyNum >= 1 &&
    qtyNum <= maxPickQty;

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

  useEffect(() => {
    if (focusAppliedRef.current || queueLoading) return;
    const requestId = String(searchParams.get("requestId") || "").trim();
    const userId = String(searchParams.get("userId") || "").trim();
    const tabParam = String(searchParams.get("tab") || "").trim().toLowerCase();
    if (!requestId && !tabParam) return;

    if (tabParam === "pending" || tabParam === "ready") {
      setQueueTab(tabParam as QueueTab);
    }
    if (!requestId) {
      focusAppliedRef.current = true;
      return;
    }

    const pendingMatch = pendingOutboundQueue.find(
      (r) => r.id === requestId && (!userId || r.clientUserId === userId)
    );
    if (pendingMatch) {
      setQueueTab("pending");
      setFocusKey(`${pendingMatch.clientUserId}:${pendingMatch.id}`);
      focusAppliedRef.current = true;
      return;
    }

    const readyMatch = orders.find(
      (o) => o.id === requestId && (!userId || o.clientUserId === userId)
    );
    if (readyMatch) {
      setQueueTab("ready");
      void selectOrder(readyMatch);
      focusAppliedRef.current = true;
    }
  }, [orders, pendingOutboundQueue, queueLoading, searchParams]);

  async function approvePending(row: PendingOutboundRequest) {
    if (!operatorId) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    const key = `${row.clientUserId}:${row.id}`;
    setBusyKey(key);
    try {
      await confirmOutboundRequestAtPick({
        clientUserId: row.clientUserId,
        shipmentRequestId: row.id,
        confirmedBy: String(operatorId),
      });
      toast({
        title: "Outbound approved",
        description: `${row.clientDisplayName} — ready to pick.`,
      });
      setQueueTab("ready");
      setFocusKey(null);
    } catch (e) {
      toast({
        title: "Approve failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function rejectPending(row: PendingOutboundRequest) {
    if (!operatorId) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    const key = `${row.clientUserId}:${row.id}`;
    setBusyKey(key);
    try {
      await rejectOutboundRequestAtPick({
        clientUserId: row.clientUserId,
        shipmentRequestId: row.id,
        rejectedBy: String(operatorId),
      });
      toast({ title: "Request rejected" });
      setFocusKey(null);
    } catch (e) {
      toast({
        title: "Reject failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setBusyKey(null);
    }
  }

  const pendingCount = pendingOutboundQueue.length;
  const readyCount = orders.length;

  const filteredPending = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();
    return pendingOutboundQueue.filter((row) => {
      if (pendingFilter === "approvable" && !row.canApprove) return false;
      if (!matchesDateFilter(row.createdAt, pendingDate)) return false;
      if (!q) return true;
      const haystack = [
        row.clientDisplayName,
        row.shipTo,
        row.service,
        row.lineSummary,
        row.status,
        row.id,
        formatQueueDate(row.createdAt),
      ]
        .filter(Boolean)
        .join(" ");
      return matchesQuery(haystack, q);
    });
  }, [pendingOutboundQueue, pendingSearch, pendingFilter, pendingDate]);

  const filteredReady = useMemo(() => {
    const q = readySearch.trim().toLowerCase();
    return orders.filter((order) => {
      if (readyFilter !== "all" && order.warehousePickStatus !== readyFilter) return false;
      if (!matchesDateFilter(order.confirmedAt, readyDate)) return false;
      if (!q) return true;
      const lineText = order.lines
        .map((l) => formatOutboundLineLabel(l))
        .join(" ");
      const haystack = [
        order.clientDisplayName,
        order.shipTo,
        lineText,
        order.warehousePickStatus,
        order.id,
        formatQueueDate(order.confirmedAt),
        ...order.lines.map((l) => `${l.productName} ${l.sku} ${l.productId}`),
      ]
        .filter(Boolean)
        .join(" ");
      return matchesQuery(haystack, q);
    });
  }, [orders, readySearch, readyFilter, readyDate]);

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

  async function reloadSelectedOrderAfterLineEdit() {
    if (!selectedOrder) return;
    const snap = await getDoc(
      doc(db, `users/${selectedOrder.clientUserId}/shipmentRequests`, selectedOrder.id)
    );
    if (!snap.exists()) {
      resetToQueue();
      return;
    }
    const data = snap.data() as Record<string, unknown>;
    const products = await loadClientProductMap(selectedOrder.clientUserId);
    const lines = buildOrderLinesFromRequestData(data, products);
    const updated: OutboundPickOrder = { ...selectedOrder, lines };
    setSelectedOrder(updated);
    await loadPlanForOrder(updated);
  }

  async function handleCancelConfirmed(order: OutboundPickOrder) {
    if (!operatorId) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    const reason = window.prompt(
      "Cancel this outbound? Enter reason (required). Restores client inventory and reverses any picks.",
      ""
    );
    if (reason == null) return;
    const trimmed = reason.trim();
    if (!trimmed) {
      toast({
        title: "Reason required",
        description: "Enter a cancellation reason to continue.",
        variant: "destructive",
      });
      return;
    }

    const key = `${order.clientUserId}:${order.id}`;
    setCancellingKey(key);
    try {
      await cancelConfirmedOutboundAtWarehouse({
        clientUserId: order.clientUserId,
        shipmentRequestId: order.id,
        warehouseId: warehouse.id,
        cancelledBy: String(operatorId),
        reason: trimmed,
      });
      toast({
        title: "Outbound cancelled",
        description: `${order.clientDisplayName} — inventory restored.`,
      });
      if (selectedOrder?.id === order.id && selectedOrder.clientUserId === order.clientUserId) {
        resetToQueue();
      }
    } catch (e) {
      toast({
        title: "Cancel failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setCancellingKey(null);
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

  useEffect(() => {
    if (!currentStep || !selectedBatch) return;
    const capped = Math.min(currentStep.quantity, selectedBatch.quantity);
    setPickQty((prev) => {
      const n = parseInt(prev, 10) || 0;
      if (n < 1 || n > capped) return String(capped);
      return prev;
    });
  }, [currentStep?.stepKey, selectedBatch?.cartonId, selectedBatch?.lineId, selectedBatch?.quantity]);

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
      if (currentStep.allowAnyBatch) {
        const inBin = batchOptionsForBin(currentStep, bin.id);
        if (inBin.length === 0) {
          toast({
            title: "Wrong bin",
            description: "Scan a bin from the listed expiry batches.",
            variant: "destructive",
          });
          setResolvedBinId(null);
          return;
        }
        setResolvedBinId(bin.id);
        setResolvedCartonId(null);
        setCartonScan("");
        const cartonIds = new Set(inBin.map((option) => option.cartonId));
        if (cartonIds.size === 1) {
          setResolvedCartonId(inBin[0].cartonId);
          setCartonScan(inBin[0].cartonCode);
        }
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
    if (!currentStep || !resolvedBinId || !binVerified) {
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
      if (currentStep.allowAnyBatch) {
        const match = batchOptionsForBin(currentStep, resolvedBinId).find(
          (option) => option.cartonId === res.carton.id
        );
        if (!match) {
          toast({
            title: "Wrong carton",
            description: "That carton is not one of the listed batches in this bin.",
            variant: "destructive",
          });
          setResolvedCartonId(null);
          return;
        }
        setResolvedCartonId(res.carton.id);
        setCartonScan(res.carton.cartonCode);
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
    if (!canConfirmPick || !selectedOrder || !currentStep || !resolvedBinId) {
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
              Outbound pick
            </CardTitle>
            <CardDescription className="text-xs">
              Approve pending shipment requests (same idea as inbound dock), then select a ready
              order and start picking. Expiry products show all batches (picker chooses); undated
              stock stays FIFO by receive date.
            </CardDescription>
          </CardHeader>
        </Card>

        <Tabs value={queueTab} onValueChange={(v) => setQueueTab(v as QueueTab)}>
          <TabsList>
            <TabsTrigger value="pending">Pending ({pendingCount})</TabsTrigger>
            <TabsTrigger value="ready">Ready to pick ({readyCount})</TabsTrigger>
            <TabsTrigger value="log">Log</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-3">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Pending shipment requests</CardTitle>
                <CardDescription className="text-xs">
                  Approve to confirm for warehouse. Inventory still deducts at dispatch.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={pendingSearch}
                        onChange={(e) => setPendingSearch(e.target.value)}
                        placeholder="Search client, SKU, product, ship-to…"
                        className="pl-8 h-9 text-sm"
                      />
                    </div>
                    <Input
                      type="date"
                      value={pendingDate}
                      onChange={(e) => setPendingDate(e.target.value)}
                      className="h-9 text-sm sm:w-[11rem]"
                      title="Filter by request date"
                    />
                    <div className="flex flex-wrap gap-1">
                      {(
                        [
                          ["all", "All"],
                          ["approvable", "Ready to approve"],
                        ] as const
                      ).map(([value, label]) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          variant={pendingFilter === value ? "default" : "outline"}
                          className="h-8 text-xs"
                          onClick={() => setPendingFilter(value)}
                        >
                          {label}
                        </Button>
                      ))}
                    </div>
                  </div>
                  {pendingDate ? (
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground underline w-fit"
                      onClick={() => setPendingDate("")}
                    >
                      Clear date
                    </button>
                  ) : null}
                </div>
                {queueLoading ? (
                  <p className="text-sm text-muted-foreground flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading requests…
                  </p>
                ) : pendingOutboundQueue.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No pending outbound requests.
                  </p>
                ) : filteredPending.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No requests match that search or filter.
                  </p>
                ) : (
                  filteredPending.map((row) => {
                    const key = `${row.clientUserId}:${row.id}`;
                    const busy = busyKey === key;
                    const focused = focusKey === key;
                    return (
                      <div
                        key={key}
                        className={cn(
                          "rounded-lg border px-3 py-3 space-y-2",
                          focused && "border-primary ring-2 ring-primary/30"
                        )}
                      >
                        <div className="flex justify-between gap-2 items-start">
                          <div>
                            <p className="font-semibold text-sm">{row.clientDisplayName}</p>
                            {row.shipTo ? (
                              <p className="text-xs text-muted-foreground mt-0.5">{row.shipTo}</p>
                            ) : null}
                            <p className="text-xs text-muted-foreground mt-1">{row.lineSummary}</p>
                            {formatQueueDate(row.createdAt) ? (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                Requested {formatQueueDate(row.createdAt)}
                              </p>
                            ) : null}
                          </div>
                          <Badge
                            variant="outline"
                            className={cn(
                              "shrink-0 capitalize",
                              row.waitingOnInbound && "border-amber-300 text-amber-800",
                              row.needsClientLabel && !row.waitingOnInbound && "border-amber-300 text-amber-800"
                            )}
                          >
                            {row.waitingOnInbound
                              ? "Waiting inbound"
                              : row.isPrepOutbound
                                ? "Pre outbound"
                                : row.status.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        {row.waitingOnInbound ? (
                          <p className="text-xs text-amber-700">
                            Pre outbound — receive linked inbound first, then approve.
                          </p>
                        ) : null}
                        {row.needsClientLabel && !row.canApprove && !row.waitingOnInbound ? (
                          <p className="text-xs text-amber-700">
                            Waiting for client shipping label before approve.
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            className="bg-emerald-600 hover:bg-emerald-700"
                            disabled={!row.canApprove || busy}
                            onClick={() => void approvePending(row)}
                          >
                            {busy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Approve → pick
                              </>
                            )}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            disabled={busy}
                            onClick={() => void rejectPending(row)}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="ready" className="mt-3">
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
            <div className="flex flex-col gap-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={readySearch}
                    onChange={(e) => setReadySearch(e.target.value)}
                    placeholder="Search client, SKU, product, ship-to…"
                    className="pl-8 h-9 text-sm"
                  />
                </div>
                <Input
                  type="date"
                  value={readyDate}
                  onChange={(e) => setReadyDate(e.target.value)}
                  className="h-9 text-sm sm:w-[11rem]"
                  title="Filter by confirmed date"
                />
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ["all", "All"],
                      ["ready", "Ready"],
                      ["picking", "Picking"],
                    ] as const
                  ).map(([value, label]) => (
                    <Button
                      key={value}
                      type="button"
                      size="sm"
                      variant={readyFilter === value ? "default" : "outline"}
                      className="h-8 text-xs"
                      onClick={() => setReadyFilter(value)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>
              {readyDate ? (
                <button
                  type="button"
                  className="text-[11px] text-muted-foreground underline w-fit"
                  onClick={() => setReadyDate("")}
                >
                  Clear date
                </button>
              ) : null}
            </div>
            {queueLoading ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading orders…
              </p>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No confirmed outbound orders waiting for floor pick. Approve pending first.
              </p>
            ) : filteredReady.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No orders match that search or filter.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredReady.map((order) => {
                  const rowKey = `${order.clientUserId}:${order.id}`;
                  const cancelling = cancellingKey === rowKey;
                  return (
                  <div
                    key={rowKey}
                    className="rounded-lg border overflow-hidden"
                  >
                    <div className="flex gap-1">
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
                              {order.lines.map((l) => formatOutboundLineLabel(l)).join(" · ")}
                            </p>
                            {formatQueueDate(order.confirmedAt) ? (
                              <p className="text-[10px] text-muted-foreground mt-1">
                                Confirmed {formatQueueDate(order.confirmedAt)}
                              </p>
                            ) : null}
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
                          disabled={dismissing || cancelling}
                          title="Remove from pick queue (keep confirmed)"
                          onClick={() => void handleSkipOrder(order)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="border-t px-3 py-2 bg-muted/20">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="text-destructive h-8 text-xs"
                        disabled={cancelling || dismissing}
                        onClick={() => void handleCancelConfirmed(order)}
                      >
                        {cancelling ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          "Cancel outbound"
                        )}
                      </Button>
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="log" className="mt-3">
            <WarehouseOpsActivityLog warehouse={warehouse} module="pick" />
          </TabsContent>
        </Tabs>

        <Button variant="outline" asChild>
          <Link href="/warehouse-ops/pack">Go to pack</Link>
        </Button>
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
            {selectedOrder.lines.map((l) => formatOutboundLineLabel(l)).join(" · ")}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
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
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="text-destructive"
            disabled={
              cancellingKey === `${selectedOrder.clientUserId}:${selectedOrder.id}` || dismissing
            }
            onClick={() => void handleCancelConfirmed(selectedOrder)}
          >
            {cancellingKey === `${selectedOrder.clientUserId}:${selectedOrder.id}` ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              "Cancel outbound"
            )}
          </Button>
        </CardContent>
      </Card>

      <WarehouseOutboundLineEditPanel
        warehouseId={warehouse.id}
        clientUserId={selectedOrder.clientUserId}
        shipmentRequestId={selectedOrder.id}
        operatorId={operatorId}
        onEdited={() => void reloadSelectedOrderAfterLineEdit()}
      />

      <WarehouseMobileCameraRecorder
        jobType="pick"
        clientUserId={selectedOrder.clientUserId}
        clientDisplayName={selectedOrder.clientDisplayName}
        shipmentRequestIds={[selectedOrder.id]}
        requestSummaries={linesToWarehouseCameraSummaries(selectedOrder.lines)}
        warehouseId={warehouse.id}
        warehouseLabel={warehouse.code || warehouse.name}
      />

      {selectedOrder.remarks ? (
        <Card className="border-sky-200 bg-sky-50/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2 text-sky-900">
              <MessageSquareText className="h-4 w-4" />
              Customer remarks
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap text-sky-950">{selectedOrder.remarks}</p>
          </CardContent>
        </Card>
      ) : null}

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
                {currentStep.allowAnyBatch ? (
                  <Badge variant="outline" className="ml-1 font-normal">
                    FEFO — choose batch
                  </Badge>
                ) : (
                  <Badge variant="outline" className="ml-1 font-normal">
                    FIFO
                  </Badge>
                )}
              </CardTitle>
              <CardDescription className="text-xs font-mono">
                {currentStep.productName} · {currentStep.sku} · need {currentStep.quantity} units
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {currentStep.allowAnyBatch ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    All putaway batches for this product (earliest expiry listed first). Scan any
                    listed bin — system does not lock you to one batch.
                  </p>
                  <div className="space-y-2">
                    {(currentStep.batchOptions ?? []).map((option, index) => {
                      const isActive =
                        selectedBatch?.cartonId === option.cartonId &&
                        selectedBatch?.lineId === option.lineId;
                      return (
                        <div
                          key={`${option.cartonId}:${option.lineId}`}
                          className={cn(
                            "rounded-md border p-2.5",
                            isActive
                              ? "border-emerald-400 bg-emerald-50/70"
                              : "bg-white"
                          )}
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            {index === 0 ? (
                              <Badge className="bg-amber-500 text-white">Earliest expiry</Badge>
                            ) : (
                              <Badge variant="outline">Batch {index + 1}</Badge>
                            )}
                            <span className="font-semibold">{formatPickExpiry(option.expiry)}</span>
                            <span className="text-muted-foreground">· qty {option.quantity}</span>
                          </div>
                          <p className="mt-1 font-mono text-xs">
                            Bin {option.binPath}
                            <span className="text-muted-foreground"> · {option.cartonCode}</span>
                            {option.lot ? (
                              <span className="text-muted-foreground"> · Lot {option.lot}</span>
                            ) : null}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <>
                  <p>
                    <span className="text-muted-foreground">Bin </span>
                    <span className="font-mono font-semibold">{currentStep.binPath}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">Carton </span>
                    <span className="font-mono font-semibold">{currentStep.cartonCode}</span>
                    {currentStep.receivedAtIso ? (
                      <span className="text-muted-foreground">
                        {" "}
                        · Rcv {currentStep.receivedAtIso.slice(0, 10)} (FIFO)
                      </span>
                    ) : null}
                  </p>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Scan bin</CardTitle>
              {currentStep.allowAnyBatch ? (
                <CardDescription className="text-xs">
                  Scan any bin from the batch list above.
                </CardDescription>
              ) : null}
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
                  scannerDescription={
                    currentStep.allowAnyBatch
                      ? "Scan any listed batch bin"
                      : `Expected: ${currentStep.binPath}`
                  }
                />
                <Button onClick={() => void handleResolveBin()} disabled={resolvingBin}>
                  {resolvingBin ? <Loader2 className="h-4 w-4 animate-spin" /> : "OK"}
                </Button>
              </div>
              {binVerified ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                  Bin verified
                  {selectedBatch ? ` · ${selectedBatch.binPath}` : ""}
                </Badge>
              ) : null}
            </CardContent>
          </Card>

          <Card className={cn(!binVerified && "opacity-60 pointer-events-none")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                Scan carton
                {currentStep.allowAnyBatch &&
                resolvedBinId &&
                new Set(batchOptionsForBin(currentStep, resolvedBinId).map((o) => o.cartonId)).size >
                  1
                  ? " (required)"
                  : " (optional)"}
              </CardTitle>
              <CardDescription className="text-xs">
                {currentStep.allowAnyBatch
                  ? "Required only when more than one carton is in the scanned bin."
                  : "Skip if you already have the right carton from the pick step — scan only to double-check."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input
                  value={cartonScan}
                  onChange={(e) => setCartonScan(e.target.value)}
                  placeholder="Scan carton (optional)"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleResolveCarton();
                  }}
                />
                <ScanCameraButton
                  onScan={(text) => void handleResolveCarton(text)}
                  scannerTitle="Scan carton"
                  scannerDescription={
                    currentStep.allowAnyBatch
                      ? "Scan carton for the chosen batch"
                      : `Expected: ${currentStep.cartonCode}`
                  }
                />
                <Button onClick={() => void handleResolveCarton()} disabled={resolvingCarton}>
                  {resolvingCarton ? <Loader2 className="h-4 w-4 animate-spin" /> : "OK"}
                </Button>
              </div>
              {selectedBatch ? (
                <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300">
                  Batch ready · {selectedBatch.cartonCode} · Exp{" "}
                  {formatPickExpiry(selectedBatch.expiry)}
                </Badge>
              ) : binVerified && currentStep.allowAnyBatch ? (
                <p className="text-[11px] text-amber-800">
                  Scan the carton for the batch you are picking from this bin.
                </p>
              ) : !currentStep.allowAnyBatch ? (
                <p className="text-[11px] text-muted-foreground">
                  Using planned carton <span className="font-mono">{currentStep.cartonCode}</span>{" "}
                  unless you scan a different one.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card className={cn(!selectedBatch && "opacity-60 pointer-events-none")}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Confirm quantity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label className="text-xs">Pick qty (max {maxPickQty})</Label>
              <Input
                type="number"
                min={1}
                max={maxPickQty}
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
                `Confirm pick · ${qtyNum || maxPickQty} × ${currentStep.sku}`
              )}
            </Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
