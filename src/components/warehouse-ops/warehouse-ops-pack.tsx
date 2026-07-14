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
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { resolveScan } from "@/lib/warehouse-putaway";
import {
  buildPackPlan,
  bindCourierLabelAtPack,
  completePackReadyToDispatch,
  markPackItemVerified,
  verifyPackScan,
  type OutboundPackOrder,
  type PackPlan,
  type PackPlanItem,
} from "@/lib/warehouse-pack";
import { completeReturnPack } from "@/lib/warehouse-unallocated-return";
import { completeCrossdockPack } from "@/lib/warehouse-crossdock-pack";
import {
  cancelFbaAwaitingLabelRequest,
  completeFbaPackWithMasterCases,
  formatFbaMasterCaseSummary,
  loadFbaAwaitingLabelOrders,
  markFbaWarehouseBuysLabel,
  recordFbaLabelUpload,
  type FbaAwaitingLabelOrder,
} from "@/lib/fba-shipment-workflow";
import { formatOutboundLineLabel } from "@/lib/warehouse-outbound-lines";
import { FbaMasterCaseForm } from "@/components/warehouse-ops/fba-master-case-form";
import type { FbaMasterCase } from "@/types";
import type { WarehouseDoc } from "@/types";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Download,
  ExternalLink,
  Loader2,
  Package,
  Printer,
  ScanLine,
  Search,
  Truck,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

type PackQueueFilter = "all" | "waiting_label" | "ready_to_pack";

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

export function WarehouseOpsPack({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;

  const { packQueue: orders, returnPackQueue, crossdockPackQueue, outboundLoading: queueLoading } =
    useWarehouseOpsLive();
  const { clients } = useWarehouseOpsClients();

  const [fbaAwaitingLabel, setFbaAwaitingLabel] = useState<FbaAwaitingLabelOrder[]>([]);
  const [fbaAwaitingLoading, setFbaAwaitingLoading] = useState(false);
  const [warehouseLabelFiles, setWarehouseLabelFiles] = useState<Record<string, File[]>>({});
  const [warehouseCancelReason, setWarehouseCancelReason] = useState<Record<string, string>>({});
  const [returnPackSavingId, setReturnPackSavingId] = useState<string | null>(null);
  const [crossdockPackSavingId, setCrossdockPackSavingId] = useState<string | null>(null);
  const [fbaBuysLabelSavingId, setFbaBuysLabelSavingId] = useState<string | null>(null);
  const [packSearch, setPackSearch] = useState("");
  const [packDate, setPackDate] = useState("");
  const [packFilter, setPackFilter] = useState<PackQueueFilter>("all");

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

  const filteredFbaAwaiting = useMemo(() => {
    const q = packSearch.trim().toLowerCase();
    return fbaAwaitingLabel.filter((order) => {
      if (!matchesDateFilter(order.masterCaseCompletedAt, packDate)) return false;
      if (!q) return true;
      const clientName =
        clients.find((c) => c.uid === order.clientUserId)?.name ||
        order.clientUserId;
      const haystack = [
        clientName,
        order.service,
        order.id,
        formatQueueDate(order.masterCaseCompletedAt),
        ...(order.fbaMasterCases ?? []).map((mc) => formatFbaMasterCaseSummary(mc)),
      ]
        .filter(Boolean)
        .join(" ");
      return matchesQuery(haystack, q);
    });
  }, [fbaAwaitingLabel, packSearch, packDate, clients]);

  const filteredPackOrders = useMemo(() => {
    const q = packSearch.trim().toLowerCase();
    return orders.filter((order) => {
      if (!matchesDateFilter(order.confirmedAt, packDate)) return false;
      if (!q) return true;
      const lineText = order.lines.map((l) => formatOutboundLineLabel(l)).join(" ");
      const haystack = [
        order.clientDisplayName,
        order.shipTo,
        lineText,
        order.id,
        formatQueueDate(order.confirmedAt),
        ...order.lines.map((l) => `${l.productName} ${l.sku}`),
      ]
        .filter(Boolean)
        .join(" ");
      return matchesQuery(haystack, q);
    });
  }, [orders, packSearch, packDate]);

  const showWaitingLabelSection =
    packFilter === "all" || packFilter === "waiting_label";
  const showReadyPackSection =
    packFilter === "all" || packFilter === "ready_to_pack";

  const nextItem: PackPlanItem | null =
    selectedOrder?.fbaPackPhase === "awaiting_courier"
      ? null
      : plan?.items.find((i) => !verifiedSet.has(i.itemKey)) ?? null;

  const isFbaLabelFlow =
    Boolean(selectedOrder?.fbaLabelWorkflow) && selectedOrder?.fbaPackPhase !== "awaiting_courier";
  const isFbaAwaitingCourier = selectedOrder?.fbaPackPhase === "awaiting_courier";

  const refreshFbaAwaitingLabel = useCallback(async () => {
    const eligible = new Set(clients.map((c) => c.uid));
    setFbaAwaitingLoading(true);
    try {
      const rows = await loadFbaAwaitingLabelOrders(eligible);
      setFbaAwaitingLabel(rows);
    } finally {
      setFbaAwaitingLoading(false);
    }
  }, [clients]);

  useEffect(() => {
    void refreshFbaAwaitingLabel();
  }, [refreshFbaAwaitingLabel, orders.length]);

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
      void refreshFbaAwaitingLabel();
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
              Picked orders, cross-dock carton/pallet forwarding, and returns. After pack, units
              move to dispatch.
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardContent className="pt-4 space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={packSearch}
                  onChange={(e) => setPackSearch(e.target.value)}
                  placeholder="Search client, SKU, product, ship-to…"
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Input
                type="date"
                value={packDate}
                onChange={(e) => setPackDate(e.target.value)}
                className="h-9 text-sm sm:w-[11rem]"
                title="Filter by date"
              />
              <div className="flex flex-wrap gap-1">
                {(
                  [
                    ["all", "All"],
                    ["waiting_label", "Waiting label"],
                    ["ready_to_pack", "Ready to pack"],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={packFilter === value ? "default" : "outline"}
                    className="h-8 text-xs"
                    onClick={() => setPackFilter(value)}
                  >
                    {label}
                    {value === "waiting_label" ? ` (${fbaAwaitingLabel.length})` : ""}
                    {value === "ready_to_pack" ? ` (${orders.length})` : ""}
                  </Button>
                ))}
              </div>
            </div>
            {packDate ? (
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline w-fit"
                onClick={() => setPackDate("")}
              >
                Clear date
              </button>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Cross-dock carton / pallet ({crossdockPackQueue.length})
            </CardTitle>
            <CardDescription className="text-xs">
              Forward after receive, or after linking a held unit. Download labels if attached,
              then pack complete → dispatch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {crossdockPackQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No cross-dock units awaiting pack.
              </p>
            ) : (
              <div className="space-y-2">
                {crossdockPackQueue.map((unit) => {
                  const saveKey = `${unit.kind}:${unit.id}`;
                  return (
                    <div
                      key={saveKey}
                      className="rounded-lg border px-3 py-2 space-y-2"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-semibold">{unit.code}</p>
                          <p className="text-xs text-muted-foreground">
                            {unit.clientDisplayName}
                            {unit.stagingArea ? ` · ${unit.stagingArea}` : ""}
                            {` · ${unit.kind}`}
                            {unit.disposition === "keep_closed" ? " · held link" : " · forward"}
                          </p>
                          <p className="text-xs text-muted-foreground">{unit.productLabel}</p>
                          {(unit.labelUrls?.length ?? 0) > 0 ? (
                            <p className="text-[10px] text-emerald-700 mt-1">
                              {unit.labelUrls.length} client label
                              {unit.labelUrls.length === 1 ? "" : "s"} attached
                            </p>
                          ) : (
                            <p className="text-[10px] text-muted-foreground mt-1">
                              No client label on linked request — pack and dispatch with courier
                              label when ready.
                            </p>
                          )}
                        </div>
                        <Button
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={crossdockPackSavingId === saveKey}
                          onClick={() => {
                            void (async () => {
                              setCrossdockPackSavingId(saveKey);
                              try {
                                await completeCrossdockPack({
                                  warehouseId: warehouse.id,
                                  kind: unit.kind,
                                  unitId: unit.id,
                                  operatorId,
                                });
                                toast({
                                  title: "Packed — ready to dispatch",
                                  description: `${unit.code} moved to cross-dock dispatch.`,
                                });
                              } catch (e) {
                                toast({
                                  title: "Pack failed",
                                  description: e instanceof Error ? e.message : "Unknown error",
                                  variant: "destructive",
                                });
                              } finally {
                                setCrossdockPackSavingId(null);
                              }
                            })();
                          }}
                        >
                          {crossdockPackSavingId === saveKey ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                              Pack complete → dispatch
                            </>
                          )}
                        </Button>
                      </div>
                      {unit.labelUrls.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {unit.labelUrls.map((url, i) => (
                            <div key={`${url}-${i}`} className="flex gap-1">
                              <Button size="sm" variant="outline" asChild>
                                <a href={url} target="_blank" rel="noopener noreferrer">
                                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                                  Open {unit.labelUrls.length > 1 ? i + 1 : "label"}
                                </a>
                              </Button>
                              <Button size="sm" variant="secondary" asChild>
                                <a href={url} download target="_blank" rel="noopener noreferrer">
                                  <Download className="h-3.5 w-3.5 mr-1" />
                                  Download
                                </a>
                              </Button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Unallocated returns ({returnPackQueue.length})</CardTitle>
            <CardDescription className="text-xs">
              Stock returned from Allocate → packing area. Confirm pack to send to dispatch.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {returnPackQueue.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No returns awaiting pack.
              </p>
            ) : (
              <div className="space-y-2">
                {returnPackQueue.map((unit) => (
                  <div
                    key={unit.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-mono text-sm font-semibold">{unit.cartonCode}</p>
                      <p className="text-xs text-muted-foreground">
                        {unit.clientDisplayName}
                        {unit.stagingArea ? ` · ${unit.stagingArea}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{unit.skuSummary}</p>
                    </div>
                    <Button
                      size="sm"
                      className="bg-orange-600 hover:bg-orange-700"
                      disabled={returnPackSavingId === unit.id}
                      onClick={() => {
                        void (async () => {
                          setReturnPackSavingId(unit.id);
                          try {
                            await completeReturnPack({
                              warehouseId: warehouse.id,
                              cartonId: unit.id,
                              operatorId,
                            });
                            toast({
                              title: "Packed — ready to dispatch",
                              description: `${unit.cartonCode} moved to dispatch queue.`,
                            });
                          } catch (e) {
                            toast({
                              title: "Pack failed",
                              description: e instanceof Error ? e.message : "Unknown error",
                              variant: "destructive",
                            });
                          } finally {
                            setReturnPackSavingId(null);
                          }
                        })();
                      }}
                    >
                      {returnPackSavingId === unit.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                          Pack complete → dispatch
                        </>
                      )}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {showWaitingLabelSection &&
          (packFilter === "waiting_label" ||
            fbaAwaitingLoading ||
            fbaAwaitingLabel.length > 0) && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                FBA — Waiting label ({filteredFbaAwaiting.length}
                {packSearch || packDate ? ` of ${fbaAwaitingLabel.length}` : ""})
              </CardTitle>
              <CardDescription className="text-xs">
                Master case details sent. Upload a label, or complete without upload if the
                warehouse will buy the courier label.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {fbaAwaitingLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading…
                </div>
              ) : filteredFbaAwaiting.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No waiting-label requests match that search or date.
                </p>
              ) : (
                filteredFbaAwaiting.map((order) => {
                  const clientName =
                    clients.find((c) => c.uid === order.clientUserId)?.name ||
                    order.clientUserId.slice(0, 8);
                  return (
                    <div key={`${order.clientUserId}:${order.id}`} className="rounded-lg border p-3 space-y-3">
                      <div>
                        <p className="font-medium text-sm">{clientName}</p>
                        <p className="text-xs text-muted-foreground">{order.service}</p>
                        {formatQueueDate(order.masterCaseCompletedAt) ? (
                          <p className="text-[10px] text-muted-foreground mt-0.5">
                            Dims submitted {formatQueueDate(order.masterCaseCompletedAt)}
                          </p>
                        ) : null}
                        {order.fbaMasterCases?.map((mc) => (
                          <p key={mc.id} className="text-xs mt-1">
                            {formatFbaMasterCaseSummary(mc)}
                          </p>
                        ))}
                      </div>
                      <Input
                        type="file"
                        accept="image/*,application/pdf"
                        multiple
                        onChange={(e) =>
                          setWarehouseLabelFiles((prev) => ({
                            ...prev,
                            [order.id]: Array.from(e.target.files || []),
                          }))
                        }
                      />
                      <Input
                        placeholder="Cancel reason (optional)"
                        value={warehouseCancelReason[order.id] || ""}
                        onChange={(e) =>
                          setWarehouseCancelReason((prev) => ({
                            ...prev,
                            [order.id]: e.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={!(warehouseLabelFiles[order.id]?.length)}
                          onClick={() => {
                            void (async () => {
                              try {
                                const files = warehouseLabelFiles[order.id] || [];
                                const urls: string[] = [];
                                for (const file of files) {
                                  const formData = new FormData();
                                  formData.append("file", file);
                                  formData.append("clientName", clientName);
                                  const response = await fetch("/api/onedrive/upload", {
                                    method: "POST",
                                    body: formData,
                                  });
                                  if (!response.ok) throw new Error("Label upload failed.");
                                  const result = await response.json();
                                  const url = result.webUrl || result.downloadURL;
                                  if (url) urls.push(url);
                                }
                                await recordFbaLabelUpload({
                                  clientUserId: order.clientUserId,
                                  shipmentRequestId: order.id,
                                  labelUrls: urls,
                                  uploadedBy: "warehouse",
                                  operatorId,
                                  warehouseId: warehouse.id,
                                });
                                toast({ title: "Label uploaded for client" });
                                void refreshFbaAwaitingLabel();
                              } catch (e) {
                                toast({
                                  title: "Upload failed",
                                  description: e instanceof Error ? e.message : "Unknown error",
                                  variant: "destructive",
                                });
                              }
                            })();
                          }}
                        >
                          Upload label
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={fbaBuysLabelSavingId === order.id}
                          onClick={() => {
                            void (async () => {
                              setFbaBuysLabelSavingId(order.id);
                              try {
                                await markFbaWarehouseBuysLabel({
                                  clientUserId: order.clientUserId,
                                  shipmentRequestId: order.id,
                                  operatorId,
                                });
                                toast({
                                  title: "Warehouse will buy label",
                                  description:
                                    "Open the order in Pack queue, then scan the courier label to finish.",
                                });
                                void refreshFbaAwaitingLabel();
                              } catch (e) {
                                toast({
                                  title: "Could not continue",
                                  description: e instanceof Error ? e.message : "Unknown error",
                                  variant: "destructive",
                                });
                              } finally {
                                setFbaBuysLabelSavingId(null);
                              }
                            })();
                          }}
                        >
                          {fbaBuysLabelSavingId === order.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            "Complete without client label"
                          )}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-destructive"
                          onClick={() => {
                            void (async () => {
                              try {
                                await cancelFbaAwaitingLabelRequest({
                                  clientUserId: order.clientUserId,
                                  shipmentRequestId: order.id,
                                  reason:
                                    warehouseCancelReason[order.id]?.trim() ||
                                    "Cancelled by warehouse — label not provided.",
                                  operatorId,
                                });
                                toast({ title: "FBA request cancelled" });
                                void refreshFbaAwaitingLabel();
                              } catch (e) {
                                toast({
                                  title: "Cancel failed",
                                  description: e instanceof Error ? e.message : "Unknown error",
                                  variant: "destructive",
                                });
                              }
                            })();
                          }}
                        >
                          Cancel request
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        )}

        {showReadyPackSection ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Orders to pack ({filteredPackOrders.length}
              {packSearch || packDate ? ` of ${orders.length}` : ""})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {queueLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : orders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No picked orders waiting for pack.
              </p>
            ) : filteredPackOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No orders match that search or date.
              </p>
            ) : (
              <div className="space-y-2">
                {filteredPackOrders.map((order) => (
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
                          {order.lines.map((l) => formatOutboundLineLabel(l)).join(" · ")}
                        </p>
                        {formatQueueDate(order.confirmedAt) ? (
                          <p className="text-[10px] text-muted-foreground mt-1">
                            Confirmed {formatQueueDate(order.confirmedAt)}
                          </p>
                        ) : null}
                        {(order.labelUrls?.length ?? 0) > 0 ? (
                          <p className="text-[10px] text-emerald-700 mt-1">
                            {order.labelUrls!.length} client label
                            {order.labelUrls!.length === 1 ? "" : "s"} attached
                          </p>
                        ) : null}
                      </div>
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {order.fbaPackPhase === "awaiting_courier"
                          ? "label ready"
                          : order.qcFailedAt
                          ? "QC failed"
                          : order.warehousePackStatus === "packing"
                            ? "packing"
                            : order.fbaLabelWorkflow
                              ? "FBA"
                              : "picked"}
                      </Badge>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        ) : null}

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
            {selectedOrder.lines.map((l) => formatOutboundLineLabel(l)).join(" · ")}
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
        {(selectedOrder.labelUrls?.length ?? 0) > 0 ? (
          <CardContent className="pt-0 space-y-2">
            <p className="text-xs font-medium flex items-center gap-1">
              <Printer className="h-3.5 w-3.5" />
              Client shipping labels
            </p>
            <div className="flex flex-wrap gap-2">
              {selectedOrder.labelUrls!.map((url, i) => (
                <div key={`${url}-${i}`} className="flex gap-1">
                  <Button size="sm" variant="outline" asChild>
                    <a href={url} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-3.5 w-3.5 mr-1" />
                      Open label {selectedOrder.labelUrls!.length > 1 ? i + 1 : ""}
                    </a>
                  </Button>
                  <Button size="sm" variant="secondary" asChild>
                    <a href={url} download target="_blank" rel="noopener noreferrer">
                      <Download className="h-3.5 w-3.5 mr-1" />
                      Download
                    </a>
                  </Button>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Print or open the label, pack the order, then scan the courier barcode to finish.
            </p>
          </CardContent>
        ) : (
          <CardContent className="pt-0">
            <p className="text-xs text-amber-700">
              No client label on this request yet — attach/scan courier label at pack if provided
              separately.
            </p>
          </CardContent>
        )}
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

          {plan.readyToComplete && isFbaLabelFlow ? (
            <Card className="border-violet-300/60">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">FBA master case details</CardTitle>
                <CardDescription className="text-xs">
                  Enter weight and dimensions for each master case. The client will upload the
                  shipping label after reviewing these details.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FbaMasterCaseForm
                  disabled={saving}
                  onSubmit={async (masterCases: FbaMasterCase[]) => {
                    if (!selectedOrder || !plan) return;
                    await completeFbaPackWithMasterCases({
                      clientUserId: selectedOrder.clientUserId,
                      shipmentRequestId: selectedOrder.id,
                      warehouseId: warehouse.id,
                      operatorId,
                      verifiedKeys: plan.verifiedKeys,
                      masterCases,
                    });
                    toast({
                      title: "Master case details sent",
                      description: "Client can now upload the FBA shipping label.",
                    });
                    resetToQueue();
                    void refreshFbaAwaitingLabel();
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          {plan.readyToComplete && (isFbaAwaitingCourier || !selectedOrder?.fbaLabelWorkflow) ? (
            <>
              {isFbaAwaitingCourier ? (
                <Card className="border-violet-200/60">
                  <CardContent className="py-3 text-xs text-muted-foreground">
                    FBA label uploaded — scan the courier barcode to finish pack.
                  </CardContent>
                </Card>
              ) : null}
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
