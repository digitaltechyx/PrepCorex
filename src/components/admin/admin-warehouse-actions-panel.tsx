"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Download, Loader2, PackageCheck, Truck, Warehouse } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { useCollection } from "@/hooks/use-collection";
import {
  adminCompleteInboundReceiveAndPutaway,
  type AdminInboundCompleteResult,
  hasAdminWarehouseOverride,
} from "@/lib/admin-warehouse-override";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import {
  findBinByPath,
  inspectBinContents,
  loadOccupiedBinIds,
} from "@/lib/warehouse-putaway";
import {
  PutawayDestinationFields,
  emptyPutawayLineSlot,
  isPutawayLineSlotReady,
  type PutawayLineSlot,
} from "@/components/warehouse-ops/putaway-destination-fields";
import { completeDispatchHandoff } from "@/lib/warehouse-pack";
import { downloadReceiveLabels } from "@/lib/warehouse-receive-label-download";
import { pushShopifyInventoryHints } from "@/lib/shopify-inventory-sync";
import { pushEbayInventoryHints } from "@/lib/ebay-inventory-sync";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import type {
  InventoryRequest,
  ShipmentRequest,
  UserProfile,
  WarehouseAreaDoc,
  WarehouseBinDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

type InboundProps = {
  mode: "inbound";
  clientUserId: string;
  clientDisplayName?: string | null;
  request: InventoryRequest;
  onComplete?: () => void;
};

type OutboundProps = {
  mode: "outbound";
  clientUserId: string;
  request: ShipmentRequest & { id: string };
  onComplete?: () => void;
};

type AdminWarehouseActionsPanelProps = InboundProps | OutboundProps;

function remainingInboundQty(req: InventoryRequest): number {
  const expected =
    typeof req.receivedQuantity === "number" && req.receivedQuantity > 0
      ? req.receivedQuantity
      : typeof req.requestedQuantity === "number" && req.requestedQuantity > 0
        ? req.requestedQuantity
        : Math.max(0, req.quantity ?? 0);
  const received = Math.max(0, Number(req.warehouseGoodReceivedQty ?? 0));
  return Math.max(0, expected - received);
}

export function AdminWarehouseActionsPanel(props: AdminWarehouseActionsPanelProps) {
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const canOverride = hasAdminWarehouseOverride(userProfile);
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [bins, setBins] = useState<WarehouseBinDoc[]>([]);
  const [occupiedBinIds, setOccupiedBinIds] = useState<Set<string>>(new Set());
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationSlot, setDestinationSlot] = useState<PutawayLineSlot>(
    emptyPutawayLineSlot()
  );
  const [damagedDestinationSlot, setDamagedDestinationSlot] =
    useState<PutawayLineSlot>(emptyPutawayLineSlot());
  const [qty, setQty] = useState(0);
  const [damagedQty, setDamagedQty] = useState(0);
  const [unitType, setUnitType] = useState<"loose" | "carton" | "pallet">("carton");
  const [packageCount, setPackageCount] = useState(1);
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [carrier, setCarrier] = useState("");
  const [inboundTracking, setInboundTracking] = useState("");
  const [inboundNotes, setInboundNotes] = useState("");
  const [lastInboundResult, setLastInboundResult] =
    useState<AdminInboundCompleteResult | null>(null);
  const [trackingScan, setTrackingScan] = useState("");
  const [busy, setBusy] = useState(false);
  const inboundRequest = props.mode === "inbound" ? props.request : null;
  const destinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "ADMIN-PREVIEW",
      sku: String(inboundRequest?.sku ?? "").trim(),
      productTitle: inboundRequest?.productName?.trim() || null,
      quantity: Math.max(1, qty),
      lot: lot.trim() || null,
      expiry: expiry.trim() || null,
      condition: "good",
      binId: null,
      allocationStatus: "allocated",
      clientId: props.mode === "inbound" ? props.clientUserId : null,
      inventoryRequestId: inboundRequest?.id ?? null,
    }),
    [expiry, inboundRequest, lot, props, qty]
  );
  const damagedDestinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "ADMIN-PREVIEW-DMG",
      sku: String(inboundRequest?.sku ?? "").trim(),
      productTitle: inboundRequest?.productName?.trim() || null,
      quantity: Math.max(1, damagedQty),
      lot: lot.trim() || null,
      expiry: expiry.trim() || null,
      condition: "damaged",
      binId: null,
      allocationStatus: "allocated",
      clientId: props.mode === "inbound" ? props.clientUserId : null,
      inventoryRequestId: inboundRequest?.id ?? null,
    }),
    [damagedQty, expiry, inboundRequest, lot, props]
  );

  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      const nj2 = activeWarehouses.find(
        (w) => isDefaultNj2Warehouse(w.name) || isDefaultNj2Warehouse(w.code)
      );
      setWarehouseId(nj2?.id ?? activeWarehouses[0].id);
    }
  }, [activeWarehouses, warehouseId]);

  useEffect(() => {
    if (!warehouseId) {
      setAreas([]);
      setBins([]);
      setOccupiedBinIds(new Set());
      setDestinationSlot(emptyPutawayLineSlot());
      setDamagedDestinationSlot(emptyPutawayLineSlot());
      return;
    }
    let cancelled = false;
    setDestinationsLoading(true);
    void Promise.all([
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
        setDamagedDestinationSlot(emptyPutawayLineSlot());
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Could not load putaway destinations",
          description: error instanceof Error ? error.message : "Try selecting the warehouse again.",
        });
      })
      .finally(() => {
        if (!cancelled) setDestinationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast, warehouseId]);

  useEffect(() => {
    if (props.mode === "inbound") {
      setQty(remainingInboundQty(props.request));
      setDamagedQty(0);
      setPackageCount(1);
      setLastInboundResult(null);
      setDestinationSlot(emptyPutawayLineSlot());
      setDamagedDestinationSlot(emptyPutawayLineSlot());
    }
  }, [props]);

  if (!canOverride) return null;

  if (props.mode === "inbound") {
    const { request, clientUserId, clientDisplayName, onComplete } = props;
    const isProduct = request.inventoryType === "product";
    const isApproved = request.status === "approved";
    // Exact "open" only — missing status means legacy admin-fulfilled, not Warehouse Ops.
    const isOpen = String(request.fulfillmentStatus ?? "").trim().toLowerCase() === "open";
    const remaining = remainingInboundQty(request);

    if (!isProduct || !isApproved || !isOpen || remaining <= 0) return null;
    const goodDestinationReady =
      qty <= 0 ||
      isPutawayLineSlotReady(destinationLine, destinationSlot, { areas, bins });
    const damagedDestinationReady =
      damagedQty <= 0 ||
      isPutawayLineSlotReady(damagedDestinationLine, damagedDestinationSlot, {
        areas,
        bins,
      });
    const destinationReady =
      qty + damagedQty >= 1 && goodDestinationReady && damagedDestinationReady;

    const resolveDestinationBin = async (
      pathOverride?: string,
      target: "good" | "damaged" = "good"
    ) => {
      const slot = target === "good" ? destinationSlot : damagedDestinationSlot;
      const setSlot =
        target === "good" ? setDestinationSlot : setDamagedDestinationSlot;
      const path = (pathOverride ?? slot.binPath).trim();
      if (!warehouseId || !path) return;
      setSlot((previous) => ({
        ...previous,
        binPath: path,
        resolved: null,
        loading: true,
        error: null,
      }));
      try {
        const bin = await findBinByPath(warehouseId, path);
        if (!bin) throw new Error("Bin not found. Search and select a valid warehouse bin.");
        const contents = await inspectBinContents(warehouseId, bin.id);
        setSlot((previous) => ({
          ...previous,
          binPath: bin.path,
          resolved: { bin, contents },
          loading: false,
          error: null,
        }));
      } catch (error: unknown) {
        setSlot((previous) => ({
          ...previous,
          resolved: null,
          loading: false,
          error: error instanceof Error ? error.message : "Could not validate bin.",
        }));
      }
    };

    const handleReceive = async () => {
      if (!warehouseId) {
        toast({ variant: "destructive", title: "Select a warehouse" });
        return;
      }
      if (qty + damagedQty < 1) {
        toast({
          variant: "destructive",
          title: "Quantity required",
          description: "Enter at least 1 good or damaged unit.",
        });
        return;
      }
      if (!destinationReady) {
        toast({
          variant: "destructive",
          title: "Select and validate putaway destinations",
          description:
            damagedQty > 0
              ? "Good stock needs a storage bin; damaged needs a quarantine bin."
              : "Select and validate a storage bin for good stock.",
        });
        return;
      }
      setBusy(true);
      try {
        const result = await adminCompleteInboundReceiveAndPutaway({
          clientUserId,
          requestId: request.id,
          warehouseId,
          stagingArea: destinationSlot.areaCode || null,
          binPath: destinationSlot.resolved?.bin.path || null,
          damagedStagingArea: damagedDestinationSlot.areaCode || null,
          damagedBinPath: damagedDestinationSlot.resolved?.bin.path || null,
          quantity: qty,
          damagedQuantity: damagedQty,
          unitType,
          packageCount,
          lot,
          expiry,
          carrier,
          trackingNumber: inboundTracking,
          notes: inboundNotes,
          operatorId: userProfile?.uid ?? null,
          clientDisplayName,
        });
        setLastInboundResult(result);
        if (user && (result.shopifyPushHints?.length || result.ebayPushHints?.length)) {
          try {
            const token = await user.getIdToken();
            if (result.shopifyPushHints?.length) {
              const sync = await pushShopifyInventoryHints(token, result.shopifyPushHints);
              if (sync.errors.length > 0) {
                toast({
                  variant: "destructive",
                  title: "PrepCorex updated; Shopify did not update",
                  description: sync.errors[0],
                });
              }
            }
            if (result.ebayPushHints?.length) {
              const sync = await pushEbayInventoryHints(token, result.ebayPushHints);
              if (sync.errors.length > 0) {
                toast({
                  variant: "destructive",
                  title: "PrepCorex updated; eBay did not update",
                  description: sync.errors[0],
                });
              }
            }
          } catch (e) {
            toast({
              variant: "destructive",
              title: "PrepCorex updated; channel inventory did not update",
              description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
            });
          }
        }
        toast({
          title: "Stock added to client inventory",
          description: `${result.quantityReceived} unit(s) received in ${result.cartonCodes.length} carton(s) → ${result.putawayDestination}.`,
        });
        const selectedWarehouse = activeWarehouses.find(
          (warehouse) => warehouse.id === warehouseId
        );
        try {
          await downloadReceiveLabels({
            warehouseCode:
              selectedWarehouse?.code || selectedWarehouse?.name || warehouseId,
            cartons: result.cartons,
            pallets: result.pallets,
          });
        } catch (labelError: unknown) {
          toast({
            title: "Receive complete — labels need reprint",
            description:
              labelError instanceof Error
                ? labelError.message
                : "Use the warehouse receive log to reprint labels.",
          });
        }
        onComplete?.();
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Receive failed",
          description: error instanceof Error ? error.message : "Could not complete receive.",
        });
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Warehouse className="h-4 w-4 text-primary" />
          Admin inbound processing
        </div>
        <p className="text-xs text-muted-foreground">
          Uses the same receive, warehouse-label, putaway, and inventory sync as Warehouse Ops in one
          faster form. {remaining} unit(s) remain on this request.
        </p>
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
              onValueChange={(value) =>
                setUnitType(value as "loose" | "carton" | "pallet")
              }
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
          <div className="space-y-1.5">
            <Label>Good qty</Label>
            <Input
              type="number"
              min={0}
              max={remaining}
              value={qty}
              onChange={(e) =>
                setQty(Math.max(0, Math.min(remaining, parseInt(e.target.value, 10) || 0)))
              }
            />
            <p className="text-[10px] text-muted-foreground">
              Can leave at 0 if only damaged units were received
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-red-700">Damaged qty</Label>
            <Input
              type="number"
              min={0}
              value={damagedQty}
              onChange={(e) =>
                setDamagedQty(Math.max(0, parseInt(e.target.value, 10) || 0))
              }
              className={damagedQty > 0 ? "border-red-300" : ""}
            />
          </div>
          {unitType !== "loose" && qty > 0 ? (
            <div className="space-y-1.5">
              <Label>{unitType === "pallet" ? "Cartons on pallet" : "Number of cartons"}</Label>
              <Input
                type="number"
                min={1}
                max={Math.max(1, qty)}
                value={packageCount}
                onChange={(e) =>
                  setPackageCount(
                    Math.max(1, Math.min(Math.max(1, qty), parseInt(e.target.value, 10) || 1))
                  )
                }
              />
            </div>
          ) : null}
          {qty > 0 ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Good putaway (storage)</Label>
              <p className="text-xs text-muted-foreground">
                Search and click a storage bin, or select an area when that zone has no bins.
              </p>
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
                onResolveBin={(path) => void resolveDestinationBin(path, "good")}
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
          ) : null}
          {damagedQty > 0 ? (
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-red-700">Damaged putaway (quarantine)</Label>
              <p className="text-xs text-muted-foreground">
                Damaged units must go to a quarantine bin or quarantine area, same as Warehouse Ops.
              </p>
              <PutawayDestinationFields
                line={damagedDestinationLine}
                slot={damagedDestinationSlot}
                warehouseAreas={areas}
                warehouseBins={bins}
                occupiedBinIds={occupiedBinIds}
                occupancyLoading={destinationsLoading}
                areasLoading={destinationsLoading}
                onBinPathChange={(value) =>
                  setDamagedDestinationSlot((previous) => ({
                    ...previous,
                    binPath: value,
                    resolved: null,
                    error: null,
                  }))
                }
                onResolveBin={(path) => void resolveDestinationBin(path, "damaged")}
                onAreaChange={(areaCode) =>
                  setDamagedDestinationSlot((previous) => ({
                    ...previous,
                    areaCode,
                    resolved: null,
                    error: null,
                  }))
                }
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>Lot (optional)</Label>
            <Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="Lot number" />
          </div>
          <div className="space-y-1.5">
            <Label>Expiry (optional)</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Carrier (optional)</Label>
            <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS, FedEx, USPS…" />
          </div>
          <div className="space-y-1.5">
            <Label>Inbound tracking (optional)</Label>
            <Input
              value={inboundTracking}
              onChange={(e) => setInboundTracking(e.target.value)}
              placeholder="Tracking number"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Receiving notes (optional)</Label>
            <Textarea
              value={inboundNotes}
              onChange={(e) => setInboundNotes(e.target.value)}
              placeholder="Condition, package details, or admin notes"
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || !warehouseId || destinationsLoading || !destinationReady}
            onClick={() => void handleReceive()}
          >
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
            Receive &amp; put away
          </Button>
          {lastInboundResult ? (
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                const warehouse = activeWarehouses.find((item) => item.id === warehouseId);
                try {
                  await downloadReceiveLabels({
                    warehouseCode: warehouse?.code || warehouse?.name || warehouseId,
                    cartons: lastInboundResult.cartons,
                    pallets: lastInboundResult.pallets,
                  });
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Label download failed",
                    description: error instanceof Error ? error.message : "Could not create labels.",
                  });
                }
              }}
            >
              <Download className="mr-2 h-4 w-4" />
              Download warehouse labels
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  const { request, clientUserId, onComplete } = props;
  const packStatus = String((request as unknown as Record<string, unknown>).warehousePackStatus ?? "")
    .trim()
    .toLowerCase();
  const dispatchStatus = String((request as unknown as Record<string, unknown>).warehouseDispatchStatus ?? "")
    .trim()
    .toLowerCase();
  const pickStatus = String((request as unknown as Record<string, unknown>).warehousePickStatus ?? "")
    .trim()
    .toLowerCase();
  const requestWarehouseId = String(
    (request as unknown as Record<string, unknown>).warehouseId ?? ""
  ).trim();
  const status = String(request.status ?? "").trim().toLowerCase();
  const readyToDispatch = packStatus === "ready_to_dispatch" && dispatchStatus !== "dispatched";
  const isDispatched = dispatchStatus === "dispatched";
  const isPicked = pickStatus === "picked";
  const needsPick =
    status === "confirmed" &&
    !isDispatched &&
    !readyToDispatch &&
    !isPicked &&
    pickStatus !== "skipped";
  const needsPack = status === "confirmed" && isPicked && !readyToDispatch && !isDispatched;
  const focusQuery = `userId=${encodeURIComponent(clientUserId)}&requestId=${encodeURIComponent(request.id)}`;
  const primaryHref = readyToDispatch
    ? `/warehouse-ops/dispatch?${focusQuery}`
    : needsPack
      ? `/warehouse-ops/pack?${focusQuery}`
      : `/warehouse-ops/pick?tab=ready&${focusQuery}`;
  const primaryLabel = readyToDispatch
    ? "Open focused dispatch"
    : needsPack
      ? "Open focused pack"
      : "Open focused pick";
  const preferredWarehouseId = requestWarehouseId || warehouseId || activeWarehouses[0]?.id || "";

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-primary" />
        Admin outbound fulfillment
      </div>
      <p className="text-xs text-muted-foreground">
        Continue this order in Warehouse Ops using the shared pick, pack, and dispatch engine. Prefer
        the focused link for this request.
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border bg-background px-2 py-1">Status: {status || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Pick: {pickStatus || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Pack: {packStatus || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Dispatch: {dispatchStatus || "—"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {!isDispatched ? (
          <Button type="button" size="sm" asChild>
            <Link href={primaryHref}>{primaryLabel}</Link>
          </Button>
        ) : null}
        {needsPick || needsPack || readyToDispatch ? (
          <>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/warehouse-ops/pick?tab=ready&${focusQuery}`}>Pick queue</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/warehouse-ops/pack?${focusQuery}`}>Pack queue</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href={`/warehouse-ops/dispatch?${focusQuery}`}>Dispatch queue</Link>
            </Button>
          </>
        ) : null}
      </div>
      {readyToDispatch ? (
        <div className="space-y-2 border-t pt-3">
          <Label>Scan / enter courier tracking to dispatch</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              value={trackingScan}
              onChange={(e) => setTrackingScan(e.target.value)}
              placeholder="Tracking barcode or number"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !trackingScan.trim() || !preferredWarehouseId}
              onClick={async () => {
                const wh = preferredWarehouseId;
                if (!wh) {
                  toast({ variant: "destructive", title: "No warehouse configured" });
                  return;
                }
                setBusy(true);
                try {
                  await completeDispatchHandoff({
                    warehouseId: wh,
                    clientUserId,
                    shipmentRequestId: request.id,
                    scannedValue: trackingScan.trim(),
                    qcUnitType: "package",
                    operatorId: userProfile?.uid ?? null,
                  });
                  toast({ title: "Order dispatched", description: "Client inventory updated." });
                  setTrackingScan("");
                  onComplete?.();
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Dispatch failed",
                    description: error instanceof Error ? error.message : "Could not dispatch.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm dispatch
            </Button>
          </div>
          {activeWarehouses.length > 1 && !requestWarehouseId ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Warehouse (for activity log)</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="h-8 max-w-xs">
                  <SelectValue placeholder="Warehouse" />
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
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
