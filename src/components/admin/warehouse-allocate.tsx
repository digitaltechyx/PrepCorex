"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { CrossdockClientCombobox } from "@/components/warehouse-ops/crossdock-client-combobox";
import { ScanLookupPopover } from "@/components/warehouse-ops/scan-lookup-popover";
import {
  describeReceiveLotHint,
  describeReceiveLotPattern,
} from "@/lib/warehouse-receive-lot";
import type { UserProfile, WarehouseAreaDoc, WarehouseDoc } from "@/types";
import {
  agingBucket,
  allocateLine,
  assignClientAndOpenClosedCarton,
  loadAllocateData,
  loadOpenRequests,
  unallocateLine,
  type AgingBucket,
  type OpenInventoryRequest,
  type UnallocatedLine,
} from "@/lib/warehouse-allocate";
import { isCrossdockClosedSku } from "@/lib/warehouse-crossdock";
import {
  areasForPacking,
  listWarehouseAreas,
} from "@/lib/warehouse-putaway-disposition";
import { returnUnallocatedLineToPack } from "@/lib/warehouse-unallocated-return";
import {
  Loader2,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  Search,
  Package,
  Boxes,
  Sparkles,
  PackageOpen,
  Plus,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type OpenReceiveLineDraft = {
  id: string;
  sku: string;
  productTitle: string;
  goodQty: string;
  damagedQty: string;
  lot: string;
  expiry: string;
};

function newOpenReceiveLine(lot = ""): OpenReceiveLineDraft {
  return {
    id: `ln${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    sku: "",
    productTitle: "",
    goodQty: "1",
    damagedQty: "0",
    lot,
    expiry: "",
  };
}

type Props = {
  warehouse: WarehouseDoc;
};

const BUCKET_CLASS: Record<AgingBucket, string> = {
  fresh: "bg-green-100 border-green-300 text-green-800",
  aging: "bg-yellow-100 border-yellow-300 text-yellow-800",
  stale: "bg-red-100 border-red-300 text-red-800",
};

/** Exact age label like inventory search / locate (`7d`). */
function formatAgeDaysLabel(days: number | null): string {
  if (days == null) return "—";
  if (days <= 0) return "0d";
  return `${days}d`;
}

export function WarehouseAllocate({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.email ?? null;

  const { data: allUsers, loading: usersLoading } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () => allUsers.filter((u) => u.role === "user" || (u.roles ?? []).includes("user")),
    [allUsers]
  );
  const clientById = useMemo(() => new Map(clients.map((c) => [c.uid, c])), [clients]);

  const [loading, setLoading] = useState(false);
  const [requests, setRequests] = useState<OpenInventoryRequest[]>([]);
  const [unallocated, setUnallocated] = useState<UnallocatedLine[]>([]);
  const [selectedRequest, setSelectedRequest] = useState<OpenInventoryRequest | null>(null);

  const [skuFilter, setSkuFilter] = useState("");
  const [clientFilter, setClientFilter] = useState<string>("");

  const [restockTarget, setRestockTarget] = useState<UnallocatedLine | null>(null);
  const [restockClient, setRestockClient] = useState<string>("");
  const [restockSaving, setRestockSaving] = useState(false);

  const [returnTarget, setReturnTarget] = useState<UnallocatedLine | null>(null);
  const [returnClient, setReturnClient] = useState<string>("");
  const [returnPackAreaId, setReturnPackAreaId] = useState<string>("");
  const [packingAreas, setPackingAreas] = useState<WarehouseAreaDoc[]>([]);
  const [returnSaving, setReturnSaving] = useState(false);

  const [openReceiveTarget, setOpenReceiveTarget] = useState<UnallocatedLine | null>(null);
  const [openReceiveClient, setOpenReceiveClient] = useState<string>("");
  const [openReceiveClientLabel, setOpenReceiveClientLabel] = useState("");
  const [openReceiveLines, setOpenReceiveLines] = useState<OpenReceiveLineDraft[]>([
    newOpenReceiveLine(),
  ]);
  const [openReceiveSaving, setOpenReceiveSaving] = useState(false);

  const [overrideTarget, setOverrideTarget] = useState<{
    request: OpenInventoryRequest;
    line: UnallocatedLine;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadAllocateData(warehouse);
      const reqs = await loadOpenRequests({
        warehouse,
        clients,
        unallocatedLines: data.unallocatedLines,
      });
      setUnallocated(data.unallocatedLines);
      setRequests(reqs);
      setSelectedRequest((prev) =>
        prev ? reqs.find((r) => r.id === prev.id) ?? null : null
      );
    } catch (e) {
      toast({
        title: "Could not load",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [warehouse, clients, toast]);

  useEffect(() => {
    if (usersLoading) return;
    void refresh();
  }, [refresh, usersLoading]);

  const filteredUnallocated = useMemo(() => {
    const q = skuFilter.trim().toUpperCase();
    return unallocated.filter((u) => {
      if (clientFilter) {
        const matchesClient =
          u.cartonClientId === clientFilter || u.line.clientId === clientFilter;
        if (!matchesClient) return false;
      }
      if (!q) return true;
      const clientName = (
        clientById.get(u.cartonClientId ?? "")?.name ||
        clientById.get(u.line.clientId ?? "")?.name ||
        u.cartonClientLabel ||
        ""
      ).toUpperCase();
      const hay = [
        u.line.sku,
        u.cartonCode,
        u.receiveLot ?? "",
        u.line.lot ?? "",
        u.line.productTitle ?? "",
        clientName,
      ]
        .join(" ")
        .toUpperCase();
      if (isCrossdockClosedSku(u.line.sku) && (q === "CLOSED" || hay.includes(q))) {
        return true;
      }
      return hay.includes(q);
    });
  }, [unallocated, skuFilter, clientFilter, clientById]);

  const filteredRequests = useMemo(() => {
    return requests.filter((r) => {
      if (clientFilter && r.clientUserId !== clientFilter) return false;
      if (skuFilter.trim() && !(r.sku ?? "").toUpperCase().includes(skuFilter.trim().toUpperCase())) {
        return false;
      }
      return true;
    });
  }, [requests, clientFilter, skuFilter]);

  const skuSuggestionsForSelectedRequest = useMemo(() => {
    if (!selectedRequest) return new Set<string>();
    const set = new Set<string>();
    const target = (selectedRequest.sku ?? "").toUpperCase();
    if (!target) return set;
    for (const u of unallocated) {
      if (isCrossdockClosedSku(u.line.sku)) continue;
      if (u.line.sku.toUpperCase() === target) set.add(u.cartonId + ":" + u.line.lineId);
    }
    return set;
  }, [selectedRequest, unallocated]);

  async function handleAllocate(line: UnallocatedLine, request: OpenInventoryRequest, overrideReason?: string) {
    try {
      await allocateLine({
        warehouseId: warehouse.id,
        cartonId: line.cartonId,
        lineId: line.line.lineId,
        clientId: request.clientUserId,
        inventoryRequestId: request.id,
        operatorId,
        overrideReason: overrideReason ?? null,
      });
      toast({
        title: "Allocated",
        description: `${line.line.sku} × ${line.line.quantity} → ${request.clientDisplayName}`,
      });
      await refresh();
    } catch (e) {
      toast({
        title: "Allocate failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  function handleAllocateClick(line: UnallocatedLine, request: OpenInventoryRequest) {
    const requestSku = (request.sku ?? "").toUpperCase();
    const lineSku = line.line.sku.toUpperCase();
    if (requestSku && requestSku !== lineSku) {
      setOverrideTarget({ request, line });
      setOverrideReason("");
      return;
    }
    void handleAllocate(line, request);
  }

  async function confirmOverride() {
    if (!overrideTarget) return;
    if (!overrideReason.trim()) {
      toast({
        title: "Reason required",
        description: "Add a short note explaining the SKU mismatch.",
        variant: "destructive",
      });
      return;
    }
    setOverrideSaving(true);
    try {
      await handleAllocate(overrideTarget.line, overrideTarget.request, overrideReason.trim());
      setOverrideTarget(null);
    } finally {
      setOverrideSaving(false);
    }
  }

  async function handleRestock() {
    if (!restockTarget) return;
    if (!restockClient) {
      toast({ title: "Pick a client", variant: "destructive" });
      return;
    }
    setRestockSaving(true);
    try {
      await allocateLine({
        warehouseId: warehouse.id,
        cartonId: restockTarget.cartonId,
        lineId: restockTarget.line.lineId,
        clientId: restockClient,
        inventoryRequestId: null,
        operatorId,
      });
      toast({
        title: "Restocked",
        description: `${restockTarget.line.sku} × ${restockTarget.line.quantity} reserved to ${clientById.get(restockClient)?.name ?? restockClient}.`,
      });
      setRestockTarget(null);
      setRestockClient("");
      await refresh();
    } catch (e) {
      toast({
        title: "Restock failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setRestockSaving(false);
    }
  }

  async function openReturnDialog(u: UnallocatedLine) {
    setReturnTarget(u);
    setReturnClient(u.line.clientId?.trim() || u.cartonClientId?.trim() || "");
    setReturnPackAreaId("");
    try {
      const areas = await listWarehouseAreas(warehouse.id);
      const packing = areasForPacking(areas);
      setPackingAreas(packing);
      if (packing.length === 1) setReturnPackAreaId(packing[0].id);
    } catch {
      setPackingAreas([]);
    }
  }

  async function handleReturnToPack() {
    if (!returnTarget) return;
    if (!returnClient) {
      toast({ title: "Pick a client", variant: "destructive" });
      return;
    }
    if (!returnPackAreaId) {
      toast({ title: "Pick a packing area", variant: "destructive" });
      return;
    }
    setReturnSaving(true);
    try {
      const result = await returnUnallocatedLineToPack({
        warehouseId: warehouse.id,
        cartonId: returnTarget.cartonId,
        lineId: returnTarget.line.lineId,
        packAreaId: returnPackAreaId,
        clientUserId: returnClient,
        operatorId,
      });
      toast({
        title: "Sent to pack",
        description: `${result.cartonCode} → ${result.packAreaCode}. After pack it goes to dispatch.`,
      });
      setReturnTarget(null);
      setReturnClient("");
      setReturnPackAreaId("");
      await refresh();
    } catch (e) {
      toast({
        title: "Return failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setReturnSaving(false);
    }
  }

  function openClosedReceiveDialog(u: UnallocatedLine) {
    const prefillClient =
      u.line.clientId?.trim() || u.cartonClientId?.trim() || "";
    const client = prefillClient ? clientById.get(prefillClient) : undefined;
    setOpenReceiveTarget(u);
    setOpenReceiveClient(prefillClient);
    setOpenReceiveClientLabel(
      client
        ? client.name || client.email || client.clientId || ""
        : u.cartonClientLabel ?? ""
    );
    setOpenReceiveLines([newOpenReceiveLine(u.receiveLot ?? u.line.lot ?? "")]);
  }

  function updateOpenReceiveLine(id: string, patch: Partial<OpenReceiveLineDraft>) {
    setOpenReceiveLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l))
    );
  }

  async function handleOpenReceiveConfirm() {
    if (!openReceiveTarget) return;
    if (!openReceiveClient) {
      toast({
        title: "Pick a registered client",
        description: "Select a client from the list so inventory updates on their account.",
        variant: "destructive",
      });
      return;
    }

    const payload: Array<{
      sku: string;
      quantity: number;
      lot: string | null;
      expiry: string | null;
      productTitle: string | null;
      damaged: boolean;
    }> = [];

    for (const l of openReceiveLines) {
      const sku = l.sku.trim();
      if (!sku) continue;
      const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
      const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
      if (good + dmg < 1) {
        toast({
          title: "Quantity required",
          description: `SKU ${sku} needs at least 1 good or damaged unit.`,
          variant: "destructive",
        });
        return;
      }
      if (good > 0) {
        payload.push({
          sku,
          quantity: good,
          lot: l.lot.trim() || null,
          expiry: l.expiry.trim() || null,
          productTitle: l.productTitle.trim() || null,
          damaged: false,
        });
      }
      if (dmg > 0) {
        payload.push({
          sku,
          quantity: dmg,
          lot: l.lot.trim() || null,
          expiry: l.expiry.trim() || null,
          productTitle: l.productTitle.trim() || null,
          damaged: true,
        });
      }
    }

    if (payload.length === 0) {
      toast({
        title: "Add SKUs",
        description: "Enter at least one SKU with good or damaged quantity ≥ 1.",
        variant: "destructive",
      });
      return;
    }

    setOpenReceiveSaving(true);
    try {
      const client = clientById.get(openReceiveClient);
      const result = await assignClientAndOpenClosedCarton({
        warehouseId: warehouse.id,
        cartonId: openReceiveTarget.cartonId,
        clientId: openReceiveClient,
        clientDisplayName: client?.name || client?.email || openReceiveClientLabel || null,
        lines: payload,
        operatorId,
      });
      toast({
        title: "Open receive complete",
        description: result.synced
          ? `${result.cartonCode}: ${result.lineCount} SKU line(s) added to ${client?.name ?? "client"} inventory.`
          : `${result.cartonCode}: ${result.lineCount} SKU line(s) assigned. Putaway next so inventory updates.`,
      });
      setOpenReceiveTarget(null);
      setOpenReceiveClient("");
      setOpenReceiveClientLabel("");
      await refresh();
    } catch (e) {
      toast({
        title: "Open receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setOpenReceiveSaving(false);
    }
  }

  async function handleUnallocate(cartonId: string, lineId: string) {
    try {
      await unallocateLine({ warehouseId: warehouse.id, cartonId, lineId, operatorId });
      toast({ title: "Un-allocated" });
      await refresh();
    } catch (e) {
      toast({
        title: "Failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Allocate inventory</h1>
          <p className="text-sm text-muted-foreground">
            Match stock to requests, or find closed walk-in lots by name/lot and open-receive
            into a registered client&apos;s inventory.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="py-3 flex flex-wrap gap-3 items-end">
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label className="text-xs">Search lot, carton, SKU, or name</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={skuFilter}
                onChange={(e) => setSkuFilter(e.target.value)}
                placeholder="Lot, carton code, SKU, or client name"
                className="pl-7"
              />
            </div>
          </div>
          <div className="space-y-1 flex-1 min-w-[200px]">
            <Label className="text-xs">Client</Label>
            <Select value={clientFilter || "__all__"} onValueChange={(v) => setClientFilter(v === "__all__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.uid} value={c.uid}>
                    {c.name || c.email || c.uid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="text-xs text-muted-foreground pb-2">
            {filteredRequests.length} open request{filteredRequests.length === 1 ? "" : "s"} ·{" "}
            {filteredUnallocated.length} unallocated line{filteredUnallocated.length === 1 ? "" : "s"}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-blue-200/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Boxes className="h-4 w-4 text-blue-600" />
              Open client requests
            </CardTitle>
            <CardDescription className="text-xs">
              Click a request to highlight matching SKUs on the right. One carton with many SKUs:
              allocate each line separately to that client&apos;s requests.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredRequests.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No open requests.</p>
            ) : (
              filteredRequests.map((r) => {
                const active = selectedRequest?.id === r.id;
                const pct =
                  r.expectedQty > 0
                    ? Math.min(100, Math.round((r.allocatedQty / r.expectedQty) * 100))
                    : 0;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setSelectedRequest((s) => (s?.id === r.id ? null : r))}
                    className={cn(
                      "w-full text-left rounded-md border px-3 py-2 transition-colors",
                      active
                        ? "border-blue-500 bg-blue-50/60 dark:bg-blue-950/30"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">{r.productName}</p>
                        <p className="text-xs text-muted-foreground">
                          {r.clientDisplayName}
                          {r.sku ? ` · ${r.sku}` : ""}
                        </p>
                      </div>
                      <Badge variant={r.status === "pending" ? "secondary" : "outline"}>
                        {r.status}
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] tabular-nums shrink-0">
                        {r.allocatedQty}/{r.expectedQty}
                      </span>
                    </div>
                  </button>
                );
              })
            )}
          </CardContent>
        </Card>

        <Card className="border-orange-200/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="h-4 w-4 text-orange-600" />
              Unallocated stock
              {selectedRequest && skuSuggestionsForSelectedRequest.size > 0 ? (
                <Badge className="bg-emerald-600 ml-2">
                  <Sparkles className="h-3 w-3 mr-1" />
                  {skuSuggestionsForSelectedRequest.size} match
                  {skuSuggestionsForSelectedRequest.size > 1 ? "es" : ""}
                </Badge>
              ) : null}
            </CardTitle>
            <CardDescription className="text-xs">
              Each row is one SKU line inside a carton (or pallet). Closed walk-in units: search by
              lot or carton, assign the registered client, then open-receive SKUs into their
              inventory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredUnallocated.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No unallocated stock.</p>
            ) : (
              filteredUnallocated.map((u) => {
                const key = u.cartonId + ":" + u.line.lineId;
                const closedCrossdock = isCrossdockClosedSku(u.line.sku);
                const closedReturn =
                  closedCrossdock &&
                  (/^Closed return\b/i.test(String(u.line.productTitle ?? "")) ||
                    Boolean(u.line.productReturnId?.trim()));
                const closedClient = closedCrossdock && u.line.clientId
                  ? clientById.get(u.line.clientId)
                  : null;
                const closedClientLabel =
                  closedCrossdock && !closedClient && u.line.productTitle
                    ? u.line.productTitle
                        .replace(/^Closed return — /i, "")
                        .replace(/^Closed cross-dock — /i, "")
                        .trim()
                    : null;
                const receiveClient = !closedCrossdock && u.cartonClientId
                  ? clientById.get(u.cartonClientId)
                  : null;
                const receiveClientLabel =
                  !closedCrossdock && !receiveClient && u.cartonClientLabel
                    ? u.cartonClientLabel
                    : null;
                const isMatch =
                  !closedCrossdock &&
                  selectedRequest &&
                  skuSuggestionsForSelectedRequest.has(key);
                const bucket = agingBucket(u.ageDays);
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-md border px-3 py-2 space-y-2",
                      closedCrossdock
                        ? closedReturn
                          ? "border-orange-200 bg-orange-50/40 dark:bg-orange-950/20"
                          : "border-indigo-200 bg-indigo-50/40 dark:bg-indigo-950/20"
                        : isMatch
                        ? "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30"
                        : u.line.condition === "damaged"
                        ? "border-red-200 bg-red-50/30"
                        : "bg-background"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        {closedCrossdock ? (
                          <>
                            <Badge
                              variant="outline"
                              className={
                                closedReturn
                                  ? "bg-orange-100 border-orange-300 text-orange-900"
                                  : "bg-indigo-100 border-indigo-300 text-indigo-900"
                              }
                            >
                              {closedReturn ? "Closed return" : "Closed carton"}
                            </Badge>
                            <span className="font-mono text-sm font-semibold">{u.cartonCode}</span>
                          </>
                        ) : (
                          <>
                            <span className="font-mono text-sm font-semibold">{u.line.sku}</span>
                            <span className="text-sm">× {u.line.quantity}</span>
                          </>
                        )}
                        {u.line.condition === "damaged" ? (
                          <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                            DMG
                          </Badge>
                        ) : null}
                        <Badge
                          variant="outline"
                          className={cn("tabular-nums", BUCKET_CLASS[bucket])}
                          title={
                            u.ageDays != null
                              ? u.ageDays === 1
                                ? "1 day in warehouse"
                                : `${u.ageDays} days in warehouse`
                              : undefined
                          }
                        >
                          {formatAgeDaysLabel(u.ageDays)}
                        </Badge>
                        {u.binPath ? (
                          <Badge variant="outline" className="font-mono text-[10px]">
                            {u.binPath}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="bg-orange-100 border-orange-300 text-orange-800">
                            In staging
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {closedCrossdock ? (
                        closedClient || closedClientLabel ? (
                          <>
                            Client:{" "}
                            {closedClient
                              ? closedClient.name || closedClient.email
                              : closedClientLabel}
                            {u.receiveLot || u.line.lot
                              ? ` · Lot ${u.receiveLot || u.line.lot}`
                              : ""}{" "}
                            — open-receive SKUs next
                          </>
                        ) : (
                          <>
                            Contents not opened
                            {u.receiveLot || u.line.lot
                              ? ` · Lot ${u.receiveLot || u.line.lot}`
                              : ""}{" "}
                            — assign client and open-receive.
                          </>
                        )
                      ) : (
                        <>
                          {receiveClient || receiveClientLabel ? (
                            <>
                              Client at receive:{" "}
                              {receiveClient
                                ? receiveClient.name || receiveClient.email
                                : receiveClientLabel}
                              {" · "}
                            </>
                          ) : null}
                          {u.cartonCode}
                          {u.receiveLot || u.line.lot
                            ? ` · Lot ${u.receiveLot || u.line.lot}`
                            : ""}
                          {u.line.expiry ? ` · Exp ${u.line.expiry.slice(0, 10)}` : ""}
                        </>
                      )}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {closedCrossdock ? (
                        <Button
                          size="sm"
                          className="bg-indigo-600 hover:bg-indigo-700"
                          onClick={() => openClosedReceiveDialog(u)}
                        >
                          <PackageOpen className="h-3 w-3 mr-1" />
                          {closedClient || closedClientLabel || u.cartonClientId
                            ? "Open receive (enter SKUs)…"
                            : "Assign client & open receive…"}
                        </Button>
                      ) : null}
                      {!closedCrossdock && selectedRequest ? (
                        <Button
                          size="sm"
                          onClick={() => handleAllocateClick(u, selectedRequest)}
                          className="bg-emerald-600 hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Allocate to {selectedRequest.clientDisplayName.split(" ")[0]}
                        </Button>
                      ) : !closedCrossdock ? (
                        <span className="text-xs text-muted-foreground">
                          Select a request on the left to allocate.
                        </span>
                      ) : null}
                      {!closedCrossdock ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setRestockTarget(u);
                            setRestockClient(u.cartonClientId ?? "");
                          }}
                        >
                          Restock to client…
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-orange-300 text-orange-800 hover:bg-orange-50"
                        onClick={() => void openReturnDialog(u)}
                      >
                        <Undo2 className="h-3 w-3 mr-1" />
                        Return…
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>
      </div>

      {selectedRequest && selectedRequest.allocations.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              Allocated to {selectedRequest.clientDisplayName}
            </CardTitle>
            <CardDescription className="text-xs">
              {selectedRequest.allocatedQty}/{selectedRequest.expectedQty} units
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {selectedRequest.allocations.map((a) => (
              <div
                key={`${a.cartonId}:${a.lineId}`}
                className="flex items-center justify-between rounded border px-2 py-1.5 text-xs"
              >
                <span className="font-mono">
                  {a.cartonCode} · {a.sku} × {a.quantity}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleUnallocate(a.cartonId, a.lineId)}
                >
                  Un-allocate
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={!!restockTarget} onOpenChange={(o) => !o && setRestockTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restock to client</DialogTitle>
            <DialogDescription>
              Reserves this stock to a client without an inventory request. Use when stock
              was received as a re-stock or you’re manually assigning it.
            </DialogDescription>
          </DialogHeader>
          {restockTarget ? (
            <div className="space-y-3">
              <div className="rounded border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-mono">{restockTarget.line.sku}</span> ×{" "}
                {restockTarget.line.quantity}{" "}
                {restockTarget.line.condition === "damaged" ? (
                  <span className="text-red-700 font-medium">(damaged)</span>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Carton {restockTarget.cartonCode}
                  {restockTarget.binPath ? ` · Bin ${restockTarget.binPath}` : " · in staging"}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Client</Label>
                <Select value={restockClient || ""} onValueChange={setRestockClient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.uid} value={c.uid}>
                        {c.name || c.email || c.uid}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestockTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void handleRestock()} disabled={restockSaving || !restockClient}>
              {restockSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Restock"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!returnTarget}
        onOpenChange={(o) => {
          if (!o) {
            setReturnTarget(null);
            setReturnClient("");
            setReturnPackAreaId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Undo2 className="h-4 w-4 text-orange-700" />
              Return to pack
            </DialogTitle>
            <DialogDescription>
              Putaway this unallocated stock into a packing area. After warehouse pack confirms,
              it moves to the dispatch queue.
            </DialogDescription>
          </DialogHeader>
          {returnTarget ? (
            <div className="space-y-3">
              <div className="rounded border bg-muted/40 px-3 py-2 text-sm">
                <span className="font-mono">
                  {isCrossdockClosedSku(returnTarget.line.sku)
                    ? returnTarget.cartonCode
                    : returnTarget.line.sku}
                </span>
                {!isCrossdockClosedSku(returnTarget.line.sku) ? (
                  <> × {returnTarget.line.quantity}</>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Carton {returnTarget.cartonCode}
                  {returnTarget.binPath
                    ? ` · Bin ${returnTarget.binPath}`
                    : returnTarget.stagingArea
                      ? ` · Area ${returnTarget.stagingArea}`
                      : " · in staging"}
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Client (for dispatch / shipped record)</Label>
                <Select value={returnClient || ""} onValueChange={setReturnClient}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick a client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.uid} value={c.uid}>
                        {c.name || c.email || c.uid}
                        {c.clientId ? ` (${c.clientId})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Packing area</Label>
                {packingAreas.length === 0 ? (
                  <p className="text-xs text-amber-700">
                    No packing area found. Add an area with Packing purpose in warehouse
                    management.
                  </p>
                ) : (
                  <Select value={returnPackAreaId || ""} onValueChange={setReturnPackAreaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Pick packing area" />
                    </SelectTrigger>
                    <SelectContent>
                      {packingAreas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code}
                          {a.name ? ` — ${a.name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void handleReturnToPack()}
              disabled={returnSaving || !returnClient || !returnPackAreaId}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {returnSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Putaway to pack"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!openReceiveTarget}
        onOpenChange={(o) => {
          if (!o) {
            setOpenReceiveTarget(null);
            setOpenReceiveClient("");
            setOpenReceiveClientLabel("");
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageOpen className="h-4 w-4 text-indigo-600" />
              Open receive for client
            </DialogTitle>
            <DialogDescription>
              Same as open receiving at the dock: pick the registered client, count SKUs (good +
              damaged), then inventory updates if already put away — otherwise putaway next.
            </DialogDescription>
          </DialogHeader>
          {openReceiveTarget ? (
            <div className="space-y-4">
              <div className="rounded border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-mono font-semibold">{openReceiveTarget.cartonCode}</p>
                <p className="text-xs text-muted-foreground">
                  {openReceiveTarget.receiveLot || openReceiveTarget.line.lot
                    ? `Lot ${openReceiveTarget.receiveLot || openReceiveTarget.line.lot}`
                    : "No lot on file"}
                  {openReceiveTarget.stagingArea
                    ? ` · Area ${openReceiveTarget.stagingArea}`
                    : openReceiveTarget.binPath
                      ? ` · ${openReceiveTarget.binPath}`
                      : " · not put away yet"}
                </p>
              </div>

              <div className="space-y-1 rounded-md border border-emerald-200/80 bg-emerald-50/30 p-3">
                <Label className="text-xs">Client (required)</Label>
                <CrossdockClientCombobox
                  clients={clients}
                  clientId={openReceiveClient}
                  clientLabel={openReceiveClientLabel}
                  onChange={({ clientId, clientLabel }) => {
                    setOpenReceiveClient(clientId);
                    setOpenReceiveClientLabel(clientLabel);
                  }}
                />
                <p className="text-[10px] text-muted-foreground">
                  Select a registered client from the list so counted SKUs land in their inventory.
                </p>
              </div>

              <div className="space-y-3">
                <Label className="text-xs font-semibold">SKU lines</Label>
                {openReceiveLines.map((line) => {
                  const good = Math.max(0, parseInt(line.goodQty, 10) || 0);
                  const dmg = Math.max(0, parseInt(line.damagedQty, 10) || 0);
                  return (
                    <div
                      key={line.id}
                      className="space-y-3 rounded-md border border-emerald-200/60 bg-card p-3"
                    >
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label className="text-xs">SKU</Label>
                          <div className="flex gap-2">
                            <Input
                              value={line.sku}
                              onChange={(e) =>
                                updateOpenReceiveLine(line.id, { sku: e.target.value })
                              }
                              placeholder="Required"
                            />
                            <ScanLookupPopover
                              onPick={(m) =>
                                updateOpenReceiveLine(line.id, {
                                  sku: m.sku,
                                  productTitle: m.productName,
                                })
                              }
                              onAcceptRaw={(raw) =>
                                updateOpenReceiveLine(line.id, { sku: raw })
                              }
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Product name (optional)</Label>
                          <Input
                            value={line.productTitle}
                            onChange={(e) =>
                              updateOpenReceiveLine(line.id, {
                                productTitle: e.target.value,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                        <div className="space-y-1">
                          <Label className="text-xs">Good qty</Label>
                          <Input
                            type="number"
                            min={0}
                            value={line.goodQty}
                            onChange={(e) =>
                              updateOpenReceiveLine(line.id, { goodQty: e.target.value })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-red-700">Damaged qty</Label>
                          <Input
                            type="number"
                            min={0}
                            value={line.damagedQty}
                            onChange={(e) =>
                              updateOpenReceiveLine(line.id, {
                                damagedQty: e.target.value,
                              })
                            }
                            className={dmg > 0 ? "border-red-300" : ""}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Lot (required)</Label>
                          <Input
                            value={line.lot}
                            onChange={(e) =>
                              updateOpenReceiveLine(line.id, { lot: e.target.value })
                            }
                            placeholder="Or leave blank to auto-generate"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Expiry (optional)</Label>
                          <Input
                            type="date"
                            value={line.expiry}
                            onChange={(e) =>
                              updateOpenReceiveLine(line.id, { expiry: e.target.value })
                            }
                          />
                        </div>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Lot: enter your own, or leave blank —{" "}
                        <span className="font-mono">{describeReceiveLotPattern()}</span>.{" "}
                        {describeReceiveLotHint()}
                      </p>
                      {good + dmg > 0 ? (
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          Line total: {good + dmg} ({good} good
                          {dmg > 0 ? `, ${dmg} damaged → quarantine` : ""})
                        </p>
                      ) : null}
                      {openReceiveLines.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-muted-foreground"
                          onClick={() =>
                            setOpenReceiveLines((prev) =>
                              prev.filter((l) => l.id !== line.id)
                            )
                          }
                        >
                          Remove line
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setOpenReceiveLines((prev) => [
                      ...prev,
                      newOpenReceiveLine(openReceiveTarget.receiveLot ?? ""),
                    ])
                  }
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Add SKU line
                </Button>
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOpenReceiveTarget(null);
                setOpenReceiveClient("");
                setOpenReceiveClientLabel("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => void handleOpenReceiveConfirm()}
              disabled={openReceiveSaving || !openReceiveClient}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {openReceiveSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Open receive & update inventory"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!overrideTarget} onOpenChange={(o) => !o && setOverrideTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              SKU mismatch
            </DialogTitle>
            <DialogDescription>
              The request SKU doesn’t match the inventory SKU. You can override with a reason.
            </DialogDescription>
          </DialogHeader>
          {overrideTarget ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded border bg-blue-50 dark:bg-blue-950/30 p-2">
                  <p className="text-muted-foreground">Request</p>
                  <p className="font-mono font-semibold">{overrideTarget.request.sku ?? "—"}</p>
                  <p>{overrideTarget.request.productName}</p>
                </div>
                <div className="rounded border bg-orange-50 dark:bg-orange-950/30 p-2">
                  <p className="text-muted-foreground">Inventory</p>
                  <p className="font-mono font-semibold">{overrideTarget.line.line.sku}</p>
                  <p>{overrideTarget.line.line.quantity} units</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Override reason</Label>
                <Textarea
                  rows={2}
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  placeholder="e.g. Client confirmed SKU change in email"
                />
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverrideTarget(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmOverride()} disabled={overrideSaving || !overrideReason.trim()}>
              {overrideSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Override & allocate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
