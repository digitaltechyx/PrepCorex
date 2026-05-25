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
import type { UserProfile, WarehouseDoc } from "@/types";
import {
  agingBucket,
  allocateLine,
  loadAllocateData,
  loadOpenRequests,
  unallocateLine,
  type AgingBucket,
  type OpenInventoryRequest,
  type UnallocatedLine,
} from "@/lib/warehouse-allocate";
import {
  Loader2,
  CheckCircle2,
  RotateCcw,
  AlertTriangle,
  Search,
  Package,
  Boxes,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

const BUCKET_LABEL: Record<AgingBucket, string> = {
  fresh: "0–7 d",
  aging: "8–30 d",
  stale: "30+ d",
};

const BUCKET_CLASS: Record<AgingBucket, string> = {
  fresh: "bg-green-100 border-green-300 text-green-800",
  aging: "bg-yellow-100 border-yellow-300 text-yellow-800",
  stale: "bg-red-100 border-red-300 text-red-800",
};

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

  const [overrideTarget, setOverrideTarget] = useState<{
    request: OpenInventoryRequest;
    line: UnallocatedLine;
  } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideSaving, setOverrideSaving] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [data, reqs] = await Promise.all([
        loadAllocateData(warehouse),
        loadOpenRequests({ warehouse, clients }),
      ]);
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
    const skuQ = skuFilter.trim().toUpperCase();
    return unallocated.filter((u) => {
      if (skuQ && !u.line.sku.toUpperCase().includes(skuQ)) return false;
      return true;
    });
  }, [unallocated, skuFilter]);

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
            Manually match received stock to client requests, or restock directly to a client.
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
            <Label className="text-xs">SKU filter</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                value={skuFilter}
                onChange={(e) => setSkuFilter(e.target.value)}
                placeholder="Match either side"
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
              Click a request to highlight matching SKUs on the right.
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
              Cartons received but not yet matched to a client/request.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 max-h-[60vh] overflow-y-auto">
            {filteredUnallocated.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No unallocated stock.</p>
            ) : (
              filteredUnallocated.map((u) => {
                const key = u.cartonId + ":" + u.line.lineId;
                const isMatch =
                  selectedRequest && skuSuggestionsForSelectedRequest.has(key);
                const bucket = agingBucket(u.ageDays);
                return (
                  <div
                    key={key}
                    className={cn(
                      "rounded-md border px-3 py-2 space-y-2",
                      isMatch
                        ? "border-emerald-400 bg-emerald-50/60 dark:bg-emerald-950/30"
                        : u.line.condition === "damaged"
                        ? "border-red-200 bg-red-50/30"
                        : "bg-background"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold">{u.line.sku}</span>
                        <span className="text-sm">× {u.line.quantity}</span>
                        {u.line.condition === "damaged" ? (
                          <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                            DMG
                          </Badge>
                        ) : null}
                        <Badge variant="outline" className={cn(BUCKET_CLASS[bucket])}>
                          {BUCKET_LABEL[bucket]}
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
                      {u.cartonCode}
                      {u.line.lot ? ` · Lot ${u.line.lot}` : ""}
                      {u.line.expiry ? ` · Exp ${u.line.expiry.slice(0, 10)}` : ""}
                    </p>
                    <div className="flex flex-wrap gap-2 pt-1">
                      {selectedRequest ? (
                        <Button
                          size="sm"
                          onClick={() => handleAllocateClick(u, selectedRequest)}
                          className="bg-emerald-600 hover:bg-emerald-700"
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Allocate to {selectedRequest.clientDisplayName.split(" ")[0]}
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          Select a request on the left to allocate.
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setRestockTarget(u);
                          setRestockClient("");
                        }}
                      >
                        Restock to client…
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
