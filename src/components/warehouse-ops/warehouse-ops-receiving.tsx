"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { hasFeature } from "@/lib/permissions";
import type { UserProfile, WarehouseDoc, WarehouseCartonDoc } from "@/types";
import {
  loadInboundRequestQueue,
  formatExpiryForInput,
  type InboundRequestRow,
  type ReceivingScenario,
} from "@/lib/warehouse-inbound-requests";
import {
  createWarehouseCarton,
  createWarehousePallet,
  listWarehouseCartons,
  listWarehousePallets,
} from "@/lib/warehouse-carton-firestore";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { buildWarehousePalletLabelsPdf } from "@/lib/warehouse-pallet-label-pdf";
import { Loader2, ArrowLeft, Package, Printer, Truck, AlertTriangle, Layers } from "lucide-react";
import { cn } from "@/lib/utils";

const SCENARIOS: { id: ReceivingScenario; label: string; description: string; icon: typeof Truck }[] = [
  {
    id: "client_request",
    label: "Client request",
    description: "Expected inbound from client inventory request",
    icon: Truck,
  },
  {
    id: "walk_in",
    label: "Walk-in",
    description: "No request — enter SKU and qty manually",
    icon: Package,
  },
  {
    id: "mixed_pallet",
    label: "Mixed pallet",
    description: "One pallet, many SKUs — create pallet then receive cartons",
    icon: Layers,
  },
  {
    id: "damaged",
    label: "Damaged",
    description: "Receive and mark cartons as damaged",
    icon: AlertTriangle,
  },
];

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseOpsReceiving({ warehouse }: Props) {
  const { toast } = useToast();
  const { userProfile } = useAuth();
  const canSeeExpected = hasFeature(userProfile, "ops_view_expected_inbound");

  const { data: allUsers, loading: usersLoading } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () => allUsers.filter((u) => u.role === "user" || (u.roles ?? []).includes("user")),
    [allUsers]
  );

  const [scenario, setScenario] = useState<ReceivingScenario | null>(null);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queue, setQueue] = useState<InboundRequestRow[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<InboundRequestRow | null>(null);

  const [sku, setSku] = useState("");
  const [productTitle, setProductTitle] = useState("");
  const [qty, setQty] = useState("1");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [sessionCartons, setSessionCartons] = useState<WarehouseCartonDoc[]>([]);
  const [activePalletId, setActivePalletId] = useState<string | null>(null);
  const [activePalletCode, setActivePalletCode] = useState<string | null>(null);

  const refreshQueue = useCallback(async () => {
    if (!canSeeExpected) return;
    setQueueLoading(true);
    try {
      const rows = await loadInboundRequestQueue({ warehouse, clients });
      setQueue(rows);
    } catch (e) {
      toast({
        title: "Could not load requests",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setQueueLoading(false);
    }
  }, [warehouse, clients, canSeeExpected, toast]);

  useEffect(() => {
    if (scenario === "client_request" && canSeeExpected) {
      void refreshQueue();
    }
  }, [scenario, canSeeExpected, refreshQueue]);

  const resetCartonForm = () => {
    setQty("1");
    setLot("");
    if (!selectedRequest) setExpiry("");
  };

  const prefillFromRequest = (row: InboundRequestRow) => {
    setSelectedRequest(row);
    setSku(row.sku?.trim() || "");
    setProductTitle(row.productName || "");
    setExpiry(formatExpiryForInput(row.expiryDate));
    setQty(row.remainingQty > 0 ? String(Math.min(row.remainingQty, 24)) : "1");
  };

  const handleSelectRequest = (row: InboundRequestRow) => {
    prefillFromRequest(row);
    setSessionCartons([]);
  };

  const handleStartWalkIn = () => {
    setSelectedRequest(null);
    setSku("");
    setProductTitle("");
    setLot("");
    setExpiry("");
    setQty("1");
    setSessionCartons([]);
  };

  const handleStartMixedPallet = async () => {
    setSaving(true);
    try {
      const palletId = await createWarehousePallet({ warehouseId: warehouse.id });
      const pallets = await listWarehousePallets(warehouse.id);
      const p = pallets.find((x) => x.id === palletId);
      setActivePalletId(palletId);
      setActivePalletCode(p?.palletCode ?? palletId);
      setSelectedRequest(null);
      setSessionCartons([]);
      toast({
        title: "Pallet created",
        description: `Scan and receive cartons onto ${p?.palletCode ?? "pallet"}.`,
      });
    } catch (e) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleReceiveCarton = async () => {
    const skuTrim = sku.trim();
    if (!skuTrim) {
      toast({ title: "SKU required", variant: "destructive" });
      return;
    }
    const quantity = parseInt(qty, 10);
    if (!Number.isFinite(quantity) || quantity < 1) {
      toast({ title: "Invalid quantity", variant: "destructive" });
      return;
    }

    if (selectedRequest && selectedRequest.remainingQty > 0 && quantity > selectedRequest.remainingQty) {
      toast({
        title: "Over expected qty",
        description: `Only ${selectedRequest.remainingQty} unit(s) remaining on this request.`,
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const isDamaged = scenario === "damaged";
      const cartonId = await createWarehouseCarton({
        warehouseId: warehouse.id,
        sku: skuTrim,
        quantity,
        lot: lot.trim() || null,
        expiry: expiry.trim() || null,
        status: isDamaged ? "damaged" : "receiving",
        clientId: selectedRequest?.clientUserId ?? null,
        productTitle: productTitle.trim() || selectedRequest?.productName || null,
        inventoryRequestId: selectedRequest?.id ?? null,
        palletId: activePalletId,
      });

      const cartons = await listWarehouseCartons(warehouse.id);
      const created = cartons.find((c) => c.id === cartonId);
      if (created) {
        setSessionCartons((prev) => [created, ...prev]);
        const bytes = await buildWarehouseCartonLabelsPdf({
          title: `${warehouse.code} — Carton ${created.cartonCode}`,
          cartons: [created],
        });
        downloadUint8ArrayAsFile(bytes, `${created.cartonCode}.pdf`);
      }

      toast({
        title: "Carton received",
        description: "Label PDF downloaded — stick on the carton before putaway.",
      });

      resetCartonForm();
      if (selectedRequest) {
        const updated = await loadInboundRequestQueue({ warehouse, clients });
        setQueue(updated);
        const again = updated.find((r) => r.id === selectedRequest.id);
        if (again) prefillFromRequest(again);
        else setSelectedRequest(null);
      }
    } catch (e) {
      toast({
        title: "Receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePrintPalletLabel = async () => {
    if (!activePalletId || !activePalletCode) return;
    setPrinting(true);
    try {
      const pallets = await listWarehousePallets(warehouse.id);
      const p = pallets.find((x) => x.id === activePalletId);
      if (!p) throw new Error("Pallet not found");
      const bytes = await buildWarehousePalletLabelsPdf({
        title: `${warehouse.code} — ${p.palletCode}`,
        pallets: [p],
      });
      downloadUint8ArrayAsFile(bytes, `${p.palletCode}.pdf`);
    } catch (e) {
      toast({
        title: "Print failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  if (!scenario) {
    return (
      <div className="max-w-3xl">
        <WarehouseOpsHeader title="Receiving" />
        <p className="text-sm text-muted-foreground mb-6">
          Choose how this truck or delivery is being received. Each carton gets an internal label before putaway.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {SCENARIOS.map((s) => {
            const Icon = s.icon;
            const disabled = s.id === "client_request" && !canSeeExpected;
            return (
              <button
                key={s.id}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (s.id === "mixed_pallet") {
                    setScenario(s.id);
                    void handleStartMixedPallet();
                    return;
                  }
                  if (s.id === "walk_in" || s.id === "damaged") {
                    setScenario(s.id);
                    handleStartWalkIn();
                    return;
                  }
                  setScenario(s.id);
                }}
                className={cn(
                  "text-left rounded-xl border p-4 transition-colors hover:border-orange-400 hover:bg-orange-50/50 dark:hover:bg-orange-950/20",
                  disabled && "opacity-50 pointer-events-none"
                )}
              >
                <Icon className="h-6 w-6 text-orange-600 mb-2" />
                <p className="font-semibold">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-1">{s.description}</p>
              </button>
            );
          })}
        </div>
        {!canSeeExpected ? (
          <p className="text-xs text-amber-700 mt-4">
            Client request queue requires the &quot;Expected inbound&quot; ops feature.
          </p>
        ) : null}
      </div>
    );
  }

  const showReceiveForm =
    scenario === "walk_in" ||
    scenario === "damaged" ||
    (scenario === "client_request" && selectedRequest) ||
    (scenario === "mixed_pallet" && activePalletId);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setScenario(null);
            setSelectedRequest(null);
            setActivePalletId(null);
            setSessionCartons([]);
          }}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Scenarios
        </Button>
        <Badge variant="outline" className="capitalize">
          {SCENARIOS.find((s) => s.id === scenario)?.label}
        </Badge>
        {activePalletCode ? (
          <Badge className="bg-indigo-600">{activePalletCode}</Badge>
        ) : null}
      </div>

      <WarehouseOpsHeader title="Receive cartons" />

      {scenario === "client_request" && canSeeExpected ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Expected inbound</CardTitle>
            <CardDescription>Client inventory requests for this warehouse location</CardDescription>
          </CardHeader>
          <CardContent>
            {queueLoading || usersLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading queue…
              </div>
            ) : queue.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No pending or open approved requests.</p>
            ) : (
              <ul className="divide-y max-h-[280px] overflow-y-auto">
                {queue.map((row) => {
                  const pct =
                    row.expectedQty > 0
                      ? Math.min(100, Math.round((row.cartonReceivedQty / row.expectedQty) * 100))
                      : 0;
                  const active = selectedRequest?.id === row.id;
                  return (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() => handleSelectRequest(row)}
                        className={cn(
                          "w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors",
                          active && "bg-orange-50 dark:bg-orange-950/30"
                        )}
                      >
                        <div className="flex justify-between gap-2">
                          <div>
                            <p className="font-medium text-sm">{row.productName}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.clientDisplayName}
                              {row.sku ? ` · ${row.sku}` : ""}
                            </p>
                          </div>
                          <Badge variant={row.status === "pending" ? "secondary" : "outline"}>
                            {row.status}
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Progress value={pct} className="h-1.5 flex-1" />
                          <span className="text-xs tabular-nums shrink-0">
                            {row.cartonReceivedQty}/{row.expectedQty}
                          </span>
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      ) : null}

      {scenario === "mixed_pallet" && activePalletId ? (
        <Button type="button" variant="outline" size="sm" onClick={() => void handlePrintPalletLabel()} disabled={printing}>
          {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
          Print pallet label
        </Button>
      ) : null}

      {showReceiveForm ? (
        <Card className="border-orange-200/60">
          <CardHeader>
            <CardTitle className="text-base">Receive one carton</CardTitle>
            <CardDescription>
              Golden rule: print and stick the label before the carton leaves the dock.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label>SKU</Label>
                <Input
                  value={sku}
                  onChange={(e) => setSku(e.target.value)}
                  placeholder="Required"
                  disabled={!!selectedRequest?.sku}
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Product name (optional)</Label>
                <Input
                  value={productTitle}
                  onChange={(e) => setProductTitle(e.target.value)}
                  placeholder={selectedRequest?.productName || "Display name"}
                />
              </div>
              <div className="space-y-1">
                <Label>Qty in this carton</Label>
                <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Lot (optional)</Label>
                <Input value={lot} onChange={(e) => setLot(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Expiry (optional)</Label>
                <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
              </div>
            </div>
            <Button
              className="w-full sm:w-auto bg-orange-600 hover:bg-orange-700"
              onClick={() => void handleReceiveCarton()}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Printer className="h-4 w-4 mr-2" />
                  Receive &amp; print label
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      ) : scenario === "client_request" ? (
        <p className="text-sm text-muted-foreground">Select a client request above to start receiving.</p>
      ) : null}

      {sessionCartons.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">This session ({sessionCartons.length})</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {sessionCartons.map((c) => (
              <div key={c.id} className="flex justify-between text-sm font-mono border rounded px-3 py-2">
                <span>{c.cartonCode}</span>
                <span>
                  {c.sku} × {c.quantity}
                </span>
              </div>
            ))}
            <Button variant="outline" size="sm" asChild>
              <Link href="/warehouse-ops/putaway">Continue to putaway (Phase 4)</Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
