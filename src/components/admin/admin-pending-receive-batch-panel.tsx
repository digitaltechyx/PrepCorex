"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, PackageCheck, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import {
  adminBatchReceiveInboundRequests,
  hasAdminWarehouseOverride,
} from "@/lib/admin-warehouse-override";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import { findBinByPath, inspectBinContents, loadOccupiedBinIds } from "@/lib/warehouse-putaway";
import {
  PutawayDestinationFields,
  emptyPutawayLineSlot,
  isPutawayLineSlotReady,
  type PutawayLineSlot,
} from "@/components/warehouse-ops/putaway-destination-fields";
import { downloadReceiveLabels } from "@/lib/warehouse-receive-label-download";
import { pushShopifyInventoryHints } from "@/lib/shopify-inventory-sync";
import { pushEbayInventoryHints } from "@/lib/ebay-inventory-sync";
import type { PendingReceiveItem } from "@/lib/admin-pending-receive";
import type { UserProfile, WarehouseAreaDoc, WarehouseBinDoc, WarehouseCartonLine, WarehouseDoc } from "@/types";

type Props = {
  items: PendingReceiveItem[];
  usersById: Map<string, UserProfile>;
  onComplete: () => void;
  onReceiveOne?: (item: PendingReceiveItem) => void;
};

function rowKey(item: PendingReceiveItem): string {
  return `${item.userId}:${item.requestId}`;
}

export function AdminPendingReceiveBatchPanel({
  items,
  usersById,
  onComplete,
  onReceiveOne,
}: Props) {
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const canOverride = hasAdminWarehouseOverride(userProfile);
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [warehouseId, setWarehouseId] = useState("");
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [bins, setBins] = useState<WarehouseBinDoc[]>([]);
  const [occupiedBinIds, setOccupiedBinIds] = useState<Set<string>>(new Set());
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationSlot, setDestinationSlot] = useState<PutawayLineSlot>(emptyPutawayLineSlot());
  const [unitType, setUnitType] = useState<"loose" | "carton" | "pallet">("carton");
  const [packageCount, setPackageCount] = useState(1);
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [carrier, setCarrier] = useState("");
  const [inboundTracking, setInboundTracking] = useState("");
  const [inboundNotes, setInboundNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const selectedItems = useMemo(
    () => items.filter((item) => selectedKeys.has(rowKey(item))),
    [items, selectedKeys]
  );

  const totalSelectedQty = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.remainingQty, 0),
    [selectedItems]
  );

  const destinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "ADMIN-BATCH",
      sku: "BATCH",
      productName: "Batch receive",
      quantity: totalSelectedQty || 1,
    }),
    [totalSelectedQty]
  );

  const destinationReady =
    totalSelectedQty >= 1 &&
    isPutawayLineSlotReady(destinationLine, destinationSlot, { areas, bins });

  useEffect(() => {
    setSelectedKeys(new Set());
  }, [items]);

  useEffect(() => {
    if (!warehouseId) {
      setAreas([]);
      setBins([]);
      setOccupiedBinIds(new Set());
      setDestinationSlot(emptyPutawayLineSlot());
      return;
    }
    let cancelled = false;
    setDestinationsLoading(true);
    Promise.all([
      listWarehouseAreas(warehouseId),
      listActiveWarehouseBins(warehouseId),
      loadOccupiedBinIds(warehouseId),
    ])
      .then(([loadedAreas, loadedBins, occupied]) => {
        if (cancelled) return;
        setAreas(loadedAreas);
        setBins(loadedBins);
        setOccupiedBinIds(occupied);
        setDestinationSlot(emptyPutawayLineSlot());
      })
      .finally(() => {
        if (!cancelled) setDestinationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  const resolveDestinationBin = async (pathOverride?: string) => {
    const path = (pathOverride ?? destinationSlot.binPath).trim();
    if (!warehouseId || !path) return;
    setDestinationSlot((previous) => ({
      ...previous,
      binPath: path,
      resolved: null,
      loading: true,
      error: null,
    }));
    try {
      const bin = await findBinByPath(warehouseId, path);
      if (!bin) throw new Error("Bin not found.");
      const contents = await inspectBinContents(warehouseId, bin.id);
      setDestinationSlot((previous) => ({
        ...previous,
        binPath: bin.path,
        resolved: { bin, contents },
        loading: false,
        error: null,
      }));
    } catch (error: unknown) {
      setDestinationSlot((previous) => ({
        ...previous,
        resolved: null,
        loading: false,
        error: error instanceof Error ? error.message : "Could not validate bin.",
      }));
    }
  };

  const toggleKey = (key: string, checked: boolean) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const handleBatchReceive = async () => {
    if (!user || selectedItems.length === 0) return;
    if (!warehouseId) {
      toast({ variant: "destructive", title: "Select a warehouse" });
      return;
    }
    if (!destinationReady) {
      toast({
        variant: "destructive",
        title: "Select putaway destination",
        description: "Choose and validate a storage bin before receiving.",
      });
      return;
    }

    setBusy(true);
    try {
      const stagingArea = destinationSlot.areaCode || null;
      const binPath = destinationSlot.resolved?.bin.path || null;

      const { results, errors } = await adminBatchReceiveInboundRequests({
        items: selectedItems.map((item) => ({
          clientUserId: item.userId,
          requestId: item.requestId,
          clientDisplayName: usersById.get(item.userId)?.name ?? null,
        })),
        shared: {
          warehouseId,
          stagingArea: stagingArea || null,
          binPath: binPath || null,
          unitType,
          packageCount,
          lot: lot.trim() || null,
          expiry: expiry.trim() || null,
          carrier: carrier.trim() || null,
          trackingNumber: inboundTracking.trim() || null,
          notes: inboundNotes.trim() || null,
          operatorId: user.uid,
        },
      });

      if (results.length > 0) {
        const token = await user.getIdToken();
        for (const result of results) {
          try {
            if (result.shopifyPushHints?.length) {
              await pushShopifyInventoryHints(token, result.shopifyPushHints);
            }
            if (result.ebayPushHints?.length) {
              await pushEbayInventoryHints(token, result.ebayPushHints);
            }
          } catch {
            // non-blocking
          }
        }
        const selectedWarehouse = activeWarehouses.find((w) => w.id === warehouseId);
        try {
          await downloadReceiveLabels({
            warehouseCode: selectedWarehouse?.code || selectedWarehouse?.name || warehouseId,
            cartons: results.flatMap((r) => r.cartons),
            pallets: results.flatMap((r) => r.pallets),
          });
        } catch {
          // labels optional
        }
      }

      if (results.length > 0) {
        toast({
          title: `Received ${results.length} request${results.length === 1 ? "" : "s"}`,
          description:
            errors.length > 0
              ? `${errors.length} could not be completed.`
              : "Stock added to client inventory.",
        });
      }
      if (errors.length > 0 && results.length === 0) {
        toast({
          variant: "destructive",
          title: "Batch receive failed",
          description: errors[0]?.error ?? "Could not receive selected requests.",
        });
      }

      setSelectedKeys(new Set());
      onComplete();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Batch receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!canOverride) return null;

  return (
    <div className="space-y-4">
      <Card className="border-primary/30">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <PackageCheck className="h-5 w-5" />
            Batch receive
          </CardTitle>
          <CardDescription>
            Select approved requests below, set warehouse and putaway once, then receive all selected
            at full remaining quantity (same as Warehouse Ops multi-select).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {activeWarehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name || w.code || w.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Receiving unit</Label>
              <Select
                value={unitType}
                onValueChange={(v) => setUnitType(v as "loose" | "carton" | "pallet")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="carton">Carton</SelectItem>
                  <SelectItem value="pallet">Pallet</SelectItem>
                  <SelectItem value="loose">Loose units</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {unitType !== "loose" && totalSelectedQty > 0 ? (
              <div className="space-y-1.5">
                <Label>{unitType === "pallet" ? "Cartons per request" : "Cartons per request"}</Label>
                <Input
                  type="number"
                  min={1}
                  value={packageCount}
                  onChange={(e) => setPackageCount(Math.max(1, parseInt(e.target.value, 10) || 1))}
                />
              </div>
            ) : null}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Good putaway (storage)</Label>
              <PutawayDestinationFields
                line={destinationLine}
                slot={destinationSlot}
                warehouseAreas={areas}
                warehouseBins={bins}
                occupiedBinIds={occupiedBinIds}
                occupancyLoading={destinationsLoading}
                areasLoading={destinationsLoading}
                onBinPathChange={(value) =>
                  setDestinationSlot((previous) => ({
                    ...previous,
                    binPath: value,
                    resolved: null,
                    error: null,
                  }))
                }
                onResolveBin={(path) => void resolveDestinationBin(path)}
                onAreaChange={(areaCode) =>
                  setDestinationSlot((previous) => ({
                    ...previous,
                    areaCode,
                    resolved: null,
                    error: null,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Tracking (optional)</Label>
              <Input
                value={inboundTracking}
                onChange={(e) => setInboundTracking(e.target.value)}
                placeholder="Carrier tracking"
                className="font-mono text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Carrier (optional)</Label>
              <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              disabled={busy || selectedItems.length === 0 || !destinationReady}
              onClick={() => void handleBatchReceive()}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Warehouse className="mr-2 h-4 w-4" />}
              Receive selected ({selectedItems.length})
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelectedKeys(new Set(items.map((i) => rowKey(i))))}
              disabled={items.length === 0}
            >
              Select all
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSelectedKeys(new Set())}
              disabled={selectedKeys.size === 0}
            >
              Clear
            </Button>
            {selectedItems.length > 0 ? (
              <span className="text-xs text-muted-foreground">
                {totalSelectedQty.toLocaleString()} units across {selectedItems.length} request
                {selectedItems.length === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No approved requests awaiting receive.
          </p>
        ) : (
          items.map((item) => {
            const key = rowKey(item);
            const u = usersById.get(item.userId);
            return (
              <div
                key={key}
                className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <Checkbox
                    checked={selectedKeys.has(key)}
                    onCheckedChange={(checked) => toggleKey(key, checked === true)}
                    className="mt-1"
                  />
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {u?.name || "Unknown"} · {item.remainingQty} units
                      {item.sku ? ` · SKU ${item.sku}` : ""}
                    </p>
                  </div>
                </div>
                {onReceiveOne ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => onReceiveOne(item)}
                  >
                    Receive one
                  </Button>
                ) : null}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
