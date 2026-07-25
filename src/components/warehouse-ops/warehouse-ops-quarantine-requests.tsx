"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowLeft,
  Check,
  Loader2,
  MapPin,
  PackageSearch,
  ShieldAlert,
  Trash2,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useWarehouseOpsClients } from "@/hooks/use-warehouse-ops-clients";
import { formatClientOptionLabel } from "@/components/warehouse-ops/crossdock-client-combobox";
import {
  PutawayDestinationFields,
  emptyPutawayLineSlot,
  type PutawayLineSlot,
} from "@/components/warehouse-ops/putaway-destination-fields";
import {
  findBinByPath,
  inspectBinContents,
  loadOccupiedBinIds,
} from "@/lib/warehouse-putaway";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import {
  approveQuarantineRequest,
  completeQuarantineRequest,
  findQuarantineSources,
  listOpenQuarantineRequests,
  quarantineRequestKindLabel,
  requestSortMs,
  type QuarantineSourceRow,
} from "@/lib/quarantine-request-ops";
import { cn } from "@/lib/utils";
import type {
  QuarantineRequest,
  WarehouseAreaDoc,
  WarehouseBinDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

type StatusFilter = "all" | "pending" | "approved";

const STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 border-amber-300 text-amber-900",
  approved: "bg-sky-100 border-sky-300 text-sky-900",
};

function formatWhen(value: QuarantineRequest["requestedAt"]): string {
  const ms = requestSortMs({ requestedAt: value } as QuarantineRequest);
  if (!ms) return "";
  return format(new Date(ms), "MMM d, yyyy · h:mm a");
}

/**
 * Synthetic line used purely to drive destination validation — `damaged` restricts the
 * picker to quarantine bins/areas, `good` to normal storage.
 */
function destinationProbe(request: QuarantineRequest, quantity: number): WarehouseCartonLine {
  return {
    lineId: "dest",
    sku: request.sku,
    productTitle: request.productName,
    quantity: Math.max(1, quantity),
    lot: null,
    expiry: null,
    condition: request.kind === "quarantine" ? "damaged" : "good",
    binId: null,
    allocationStatus: "unallocated",
    clientId: request.userId,
    inventoryRequestId: null,
  };
}

export function WarehouseOpsQuarantineRequests({ warehouse }: { warehouse: WarehouseDoc }) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? null;
  const operatorName = userProfile?.name || userProfile?.email || null;

  const { clients } = useWarehouseOpsClients({ includeUnapproved: true });
  const clientNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of clients) map.set(c.uid, formatClientOptionLabel(c));
    return map;
  }, [clients]);

  const [requests, setRequests] = useState<QuarantineRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>("all");

  const [selected, setSelected] = useState<QuarantineRequest | null>(null);
  const [sources, setSources] = useState<QuarantineSourceRow[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [bins, setBins] = useState<WarehouseBinDoc[]>([]);
  const [occupiedBinIds, setOccupiedBinIds] = useState<Set<string>>(new Set());
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [slot, setSlot] = useState<PutawayLineSlot>(() => emptyPutawayLineSlot());

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setRequests(await listOpenQuarantineRequests());
    } catch (e) {
      toast({
        title: "Could not load quarantine requests",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setLocationsLoading(true);
    void Promise.all([
      listWarehouseAreas(warehouse.id),
      listActiveWarehouseBins(warehouse.id),
      loadOccupiedBinIds(warehouse.id),
    ])
      .then(([a, b, occupied]) => {
        if (cancelled) return;
        setAreas(a);
        setBins(b);
        setOccupiedBinIds(occupied);
      })
      .finally(() => {
        if (!cancelled) setLocationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, warehouse.id]);

  const openRequest = useCallback(
    async (request: QuarantineRequest) => {
      setSelected(request);
      setPicks({});
      setSlot(emptyPutawayLineSlot());
      setSourcesLoading(true);
      try {
        const rows = await findQuarantineSources(warehouse, request);
        setSources(rows);
        // Pre-fill picks greedily from the largest lines until the request qty is met.
        const prefill: Record<string, string> = {};
        let remaining = request.quantity;
        for (const row of rows) {
          if (remaining <= 0) break;
          const take = Math.min(remaining, row.availableQty);
          prefill[`${row.cartonId}:${row.lineId}`] = String(take);
          remaining -= take;
        }
        setPicks(prefill);
      } catch (e) {
        setSources([]);
        toast({
          title: "Could not locate stock",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setSourcesLoading(false);
      }
    },
    [toast, warehouse]
  );

  const pickedQty = useMemo(
    () =>
      Object.values(picks).reduce((sum, raw) => {
        const n = parseInt(raw, 10);
        return sum + (Number.isFinite(n) && n > 0 ? n : 0);
      }, 0),
    [picks]
  );

  const totalAvailable = sources.reduce((s, r) => s + r.availableQty, 0);
  const needsDestination = selected ? selected.kind !== "dispose" : false;
  const probe = selected ? destinationProbe(selected, pickedQty || selected.quantity) : null;

  // The destination panel reports "putaway N of M" from the slot, so keep it on the picked total.
  useEffect(() => {
    const next = String(Math.max(1, pickedQty));
    setSlot((s) => (s.putawayQty === next ? s : { ...s, putawayQty: next }));
  }, [pickedQty]);

  const resolveBin = useCallback(
    async (pathOverride?: string) => {
      const path = (pathOverride ?? slot.binPath).trim();
      if (!path) return;
      setSlot((s) => ({ ...s, loading: true, error: null }));
      try {
        const bin = await findBinByPath(warehouse.id, path);
        if (!bin) {
          setSlot((s) => ({
            ...s,
            loading: false,
            resolved: null,
            error: `Bin "${path}" not found in this warehouse.`,
          }));
          return;
        }
        const contents = await inspectBinContents(warehouse.id, bin.id);
        setSlot((s) => ({
          ...s,
          loading: false,
          binPath: bin.path,
          resolved: { bin, contents },
          error: null,
        }));
      } catch (e) {
        setSlot((s) => ({
          ...s,
          loading: false,
          resolved: null,
          error: e instanceof Error ? e.message : "Could not read that bin.",
        }));
      }
    },
    [slot.binPath, warehouse.id]
  );

  const destinationReady =
    !needsDestination || Boolean(slot.resolved) || Boolean(slot.areaCode.trim());

  async function handleApprove() {
    if (!selected || !operatorId) return;
    setSaving(true);
    try {
      await approveQuarantineRequest({
        request: selected,
        approverUid: operatorId,
        approverName: operatorName || "Warehouse operator",
      });
      toast({ title: "Approved", description: "You can now complete the move." });
      setSelected({ ...selected, status: "approved" });
      await reload();
    } catch (e) {
      toast({
        title: "Approve failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleComplete() {
    if (!selected) return;
    const chosen = Object.entries(picks)
      .map(([key, raw]) => {
        const [cartonId, lineId] = key.split(":");
        const quantity = parseInt(raw, 10);
        return { cartonId, lineId, quantity };
      })
      .filter((p) => Number.isFinite(p.quantity) && p.quantity > 0);

    if (chosen.length === 0) {
      toast({
        title: "Pick something first",
        description: "Enter how many units you pulled from each location.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const result = await completeQuarantineRequest({
        request: selected,
        warehouse,
        picks: chosen,
        destBinPath: slot.resolved?.bin.path ?? null,
        destAreaCode: slot.areaCode.trim() || null,
        operatorId,
        operatorName,
      });
      toast({
        title: "Request completed",
        description: `${result.movedQty} unit${result.movedQty === 1 ? "" : "s"} of ${
          selected.sku || selected.productName
        } processed.`,
      });
      setSelected(null);
      setSources([]);
      setPicks({});
      await reload();
    } catch (e) {
      toast({
        title: "Could not complete",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const filtered = useMemo(
    () =>
      requests
        .filter((r) => (filter === "all" ? true : r.status === filter))
        .sort((a, b) => requestSortMs(b) - requestSortMs(a)),
    [filter, requests]
  );

  const counts = useMemo(
    () => ({
      all: requests.length,
      pending: requests.filter((r) => r.status === "pending").length,
      approved: requests.filter((r) => r.status === "approved").length,
    }),
    [requests]
  );

  if (selected) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setSelected(null)} disabled={saving}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to requests
        </Button>

        <Card className="border-amber-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              {quarantineRequestKindLabel(selected.kind)}
              <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[selected.status])}>
                {selected.status === "pending" ? "Pending approval" : "Approved"}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs space-y-0.5">
              <span className="block font-medium text-foreground">
                {selected.productName}
                {selected.sku ? ` · ${selected.sku}` : ""} — {selected.quantity} units
              </span>
              <span className="block">
                Client: {clientNameById.get(selected.userId) || selected.userName}
              </span>
              <span className="block">Reason: {selected.reason}</span>
            </CardDescription>
          </CardHeader>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <MapPin className="h-4 w-4" />
              Where to pick
            </CardTitle>
            <CardDescription className="text-xs">
              {selected.kind === "quarantine"
                ? "Sellable stock for this client and SKU in this warehouse. Pull the units from these locations."
                : "This client's stock currently sitting in quarantine."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {sourcesLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                Locating stock…
              </div>
            ) : sources.length === 0 ? (
              <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                <PackageSearch className="mx-auto mb-2 h-8 w-8 opacity-50" />
                No matching stock in {warehouse.name || warehouse.code}. It may live at another
                site.
              </div>
            ) : (
              <>
                {sources.map((row) => {
                  const key = `${row.cartonId}:${row.lineId}`;
                  return (
                    <div
                      key={key}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"
                    >
                      <div className="min-w-0 space-y-0.5">
                        <p className="font-mono text-sm font-semibold">{row.locationLabel}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.cartonCode} · {row.availableQty} available
                          {row.lot ? ` · Lot ${row.lot}` : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted-foreground">Pick</Label>
                        <Input
                          type="number"
                          min={0}
                          max={row.availableQty}
                          value={picks[key] ?? ""}
                          onChange={(e) =>
                            setPicks((p) => ({ ...p, [key]: e.target.value }))
                          }
                          className="w-20"
                        />
                      </div>
                    </div>
                  );
                })}
                <p className="text-xs text-muted-foreground">
                  Picking {pickedQty} of {selected.quantity} requested · {totalAvailable} available
                  here.
                  {pickedQty > 0 && pickedQty < selected.quantity
                    ? " Completing with fewer units closes the request short."
                    : ""}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {needsDestination && probe ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {selected.kind === "quarantine" ? "Quarantine destination" : "Storage destination"}
              </CardTitle>
              <CardDescription className="text-xs">
                {selected.kind === "quarantine"
                  ? "Scan or select the quarantine bin. If that zone has no bins, pick the area instead."
                  : "Scan or select the storage bin the stock goes back into."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <PutawayDestinationFields
                line={probe}
                slot={slot}
                warehouseAreas={areas}
                warehouseBins={bins}
                occupiedBinIds={occupiedBinIds}
                areasLoading={locationsLoading}
                onBinPathChange={(value) =>
                  setSlot((s) => ({ ...s, binPath: value, resolved: null, error: null }))
                }
                onResolveBin={resolveBin}
                onAreaChange={(areaCode) =>
                  setSlot((s) => ({ ...s, areaCode, resolved: null, error: null }))
                }
              />
            </CardContent>
          </Card>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {selected.status === "pending" ? (
            <Button variant="secondary" onClick={() => void handleApprove()} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Check className="h-4 w-4 mr-1" />
              )}
              Approve
            </Button>
          ) : null}
          <Button
            onClick={() => void handleComplete()}
            disabled={saving || pickedQty < 1 || !destinationReady}
            variant={selected.kind === "dispose" ? "destructive" : "default"}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : selected.kind === "dispose" ? (
              <Trash2 className="h-4 w-4 mr-1" />
            ) : (
              <Check className="h-4 w-4 mr-1" />
            )}
            Mark completed
          </Button>
        </div>
        {!destinationReady ? (
          <p className="text-xs text-amber-800">
            Choose a destination {selected.kind === "quarantine" ? "quarantine" : "storage"}{" "}
            bin or area before completing.
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-amber-200/70 bg-amber-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Client requests
          </CardTitle>
          <CardDescription className="text-xs">
            Clients (and admins on their behalf) ask for stock to be quarantined, released, or
            disposed. Open one and the system shows you exactly where the stock lives.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={filter} onValueChange={(v) => setFilter(v as StatusFilter)}>
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="pending">Pending approval ({counts.pending})</TabsTrigger>
          <TabsTrigger value="approved">Ready to process ({counts.approved})</TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading requests…
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            No open quarantine requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((request) => (
            <button
              key={request.id}
              type="button"
              onClick={() => void openRequest(request)}
              className="w-full text-left rounded-lg border bg-card px-3 py-3 transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold">
                    {request.productName}
                    {request.sku ? (
                      <span className="font-mono font-normal text-muted-foreground">
                        {" "}
                        · {request.sku}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {quarantineRequestKindLabel(request.kind)} · {request.quantity} units ·{" "}
                    {clientNameById.get(request.userId) || request.userName}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {formatWhen(request.requestedAt)}
                  </p>
                </div>
                <Badge variant="outline" className={cn("text-[10px]", STATUS_TONE[request.status])}>
                  {request.status === "pending" ? "Pending approval" : "Ready to process"}
                </Badge>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
