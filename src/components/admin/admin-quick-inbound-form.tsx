"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Warehouse } from "lucide-react";

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
import { AddInventoryRequestForm } from "@/components/dashboard/add-inventory-request-form";
import {
  PutawayDestinationFields,
  emptyPutawayLineSlot,
  type PutawayLineSlot,
} from "@/components/warehouse-ops/putaway-destination-fields";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import {
  findBinByPath,
  firstAvailablePutawayBin,
  inspectBinContents,
  loadOccupiedBinIds,
} from "@/lib/warehouse-putaway";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import { downloadReceiveLabels } from "@/lib/warehouse-receive-label-download";
import { pushShopifyInventoryHints } from "@/lib/shopify-inventory-sync";
import { pushEbayInventoryHints } from "@/lib/ebay-inventory-sync";
import { adminQuickInboundStockAfterCreate } from "@/lib/admin-quick-inbound-stock";
import type {
  WarehouseAreaDoc,
  WarehouseBinDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";

type Props = {
  userId: string;
  userName: string;
};

export function AdminQuickInboundForm({ userId, userName }: Props) {
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [unitType, setUnitType] = useState<"loose" | "carton" | "pallet">("carton");
  const [packageCount, setPackageCount] = useState(1);
  const [damagedQty, setDamagedQty] = useState(0);
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [carrier, setCarrier] = useState("");
  const [inboundTracking, setInboundTracking] = useState("");
  const [inboundNotes, setInboundNotes] = useState("");
  const [destinationSlot, setDestinationSlot] = useState<PutawayLineSlot>(() =>
    emptyPutawayLineSlot()
  );
  const [damagedDestinationSlot, setDamagedDestinationSlot] = useState<PutawayLineSlot>(() =>
    emptyPutawayLineSlot()
  );
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [bins, setBins] = useState<WarehouseBinDoc[]>([]);
  const [occupiedBinIds, setOccupiedBinIds] = useState<Set<string>>(new Set());
  const [destinationsLoading, setDestinationsLoading] = useState(false);

  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      const nj2 = activeWarehouses.find(
        (w) => isDefaultNj2Warehouse(w.name) || isDefaultNj2Warehouse(w.code)
      );
      setWarehouseId(nj2?.id || activeWarehouses[0]!.id);
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
    setDestinationSlot(emptyPutawayLineSlot());
    setDamagedDestinationSlot(emptyPutawayLineSlot());
    Promise.all([
      listWarehouseAreas(warehouseId),
      listActiveWarehouseBins(warehouseId),
      loadOccupiedBinIds(warehouseId),
    ])
      .then(async ([nextAreas, nextBins, occupied]) => {
        if (cancelled) return;
        setAreas(nextAreas);
        setBins(nextBins);
        setOccupiedBinIds(occupied);

        // Default storage bin: first empty eligible bin (admin can change).
        const probeLine = {
          lineId: "quick-good",
          sku: "PENDING",
          productTitle: null,
          quantity: 1,
          lot: null,
          expiry: null,
          condition: "good" as const,
          binId: null,
          allocationStatus: "allocated" as const,
          clientId: userId,
          inventoryRequestId: null,
        };
        const first = firstAvailablePutawayBin(nextAreas, nextBins, probeLine, occupied);
        if (!first) return;

        setDestinationSlot((previous) => ({
          ...previous,
          binPath: first.path,
          resolved: null,
          loading: true,
          error: null,
        }));
        try {
          const bin = await findBinByPath(warehouseId, first.path);
          if (cancelled) return;
          if (!bin) throw new Error("Default bin was not found.");
          const contents = await inspectBinContents(warehouseId, bin.id);
          if (cancelled) return;
          setDestinationSlot((previous) => ({
            ...previous,
            binPath: bin.path,
            resolved: { bin, contents },
            loading: false,
            error: null,
          }));
        } catch (error: unknown) {
          if (cancelled) return;
          setDestinationSlot((previous) => ({
            ...previous,
            resolved: null,
            loading: false,
            error:
              error instanceof Error
                ? error.message
                : "Could not validate the default storage bin.",
          }));
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Could not load putaway destinations",
          description: error instanceof Error ? error.message : "Try another warehouse.",
        });
      })
      .finally(() => {
        if (!cancelled) setDestinationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [toast, userId, warehouseId]);

  const destinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "quick-good",
      sku: "PENDING",
      productTitle: null,
      quantity: 1,
      lot: lot.trim() || null,
      expiry: expiry.trim() || null,
      condition: "good",
      binId: null,
      allocationStatus: "allocated",
      clientId: userId,
      inventoryRequestId: null,
    }),
    [expiry, lot, userId]
  );

  const damagedDestinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      ...destinationLine,
      lineId: "quick-damaged",
      condition: "damaged",
    }),
    [destinationLine]
  );

  const goodDestinationReady = Boolean(
    destinationSlot.resolved?.bin || destinationSlot.areaCode.trim()
  );
  const damagedDestinationReady =
    damagedQty <= 0 ||
    Boolean(
      damagedDestinationSlot.resolved?.bin || damagedDestinationSlot.areaCode.trim()
    );
  const destinationReady = goodDestinationReady && damagedDestinationReady;

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

  const putawaySection: ReactNode = (
    <div className="space-y-3 rounded-lg border border-indigo-300/60 bg-indigo-50/50 p-4 dark:bg-indigo-950/20">
      <div className="flex items-center gap-2 text-sm font-semibold text-indigo-900 dark:text-indigo-100">
        <Warehouse className="h-4 w-4" />
        Inbound putaway (required)
      </div>
      <p className="text-xs text-muted-foreground">
        Stock is received and put away immediately — no pending request for the client to wait on.
        Fill the inbound details above, then choose warehouse + bin here.
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
            onValueChange={(value) => setUnitType(value as "loose" | "carton" | "pallet")}
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
        {unitType !== "loose" ? (
          <div className="space-y-1.5">
            <Label>{unitType === "pallet" ? "Cartons on pallet" : "Number of cartons"}</Label>
            <Input
              type="number"
              min={1}
              value={packageCount}
              onChange={(e) =>
                setPackageCount(Math.max(1, parseInt(e.target.value, 10) || 1))
              }
            />
          </div>
        ) : null}
        <div className="space-y-1.5">
          <Label className="text-red-700">Damaged qty (optional)</Label>
          <Input
            type="number"
            min={0}
            value={damagedQty}
            onChange={(e) => setDamagedQty(Math.max(0, parseInt(e.target.value, 10) || 0))}
            className={damagedQty > 0 ? "border-red-300" : ""}
          />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>Good putaway (storage)</Label>
          <p className="text-xs text-muted-foreground">
            First available empty bin is selected by default — change it if you need a different location.
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
        {damagedQty > 0 ? (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="text-red-700">Damaged putaway (quarantine)</Label>
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
          <Input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="UPS, FedEx, USPS…"
          />
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
    </div>
  );

  return (
    <AddInventoryRequestForm
      targetUserId={userId}
      targetUserName={userName}
      mode="inline"
      submitMode="adminQuickStock"
      extraBeforeSubmit={putawaySection}
      validateBeforeSubmit={() => {
        if (!warehouseId) return "Select a warehouse for putaway.";
        if (destinationsLoading) return "Putaway destinations are still loading.";
        if (!destinationReady) {
          return damagedQty > 0
            ? "Validate storage putaway for good stock and quarantine putaway for damaged."
            : "Select and validate a storage bin (or area) for putaway.";
        }
        return null;
      }}
      afterRequestsCreated={async ({ requestIds }) => {
        if (!userProfile?.uid) throw new Error("Admin session required.");
        const { results, errors } = await adminQuickInboundStockAfterCreate({
          clientUserId: userId,
          clientDisplayName: userName,
          requestIds,
          adminUid: userProfile.uid,
          putaway: {
            warehouseId,
            stagingArea: destinationSlot.areaCode || null,
            binPath: destinationSlot.resolved?.bin.path || null,
            damagedStagingArea: damagedDestinationSlot.areaCode || null,
            damagedBinPath: damagedDestinationSlot.resolved?.bin.path || null,
            damagedQuantity: damagedQty,
            unitType,
            packageCount,
            lot: lot.trim() || null,
            expiry: expiry.trim() || null,
            carrier: carrier.trim() || null,
            trackingNumber: inboundTracking.trim() || null,
            notes: inboundNotes.trim() || null,
            operatorId: userProfile.uid,
          },
        });

        if (errors.length > 0 && results.length === 0) {
          throw new Error(errors.map((e) => e.error).join(" · "));
        }

        const units = results.reduce((sum, r) => sum + (r.quantityReceived || 0), 0);
        if (user && results.some((r) => r.shopifyPushHints?.length || r.ebayPushHints?.length)) {
          try {
            const token = await user.getIdToken();
            for (const result of results) {
              if (result.shopifyPushHints?.length) {
                const sync = await pushShopifyInventoryHints(token, result.shopifyPushHints);
                if (sync.errors.length > 0) {
                  toast({
                    variant: "destructive",
                    title: "Stock saved; Shopify did not update",
                    description: sync.errors[0],
                  });
                }
              }
              if (result.ebayPushHints?.length) {
                const sync = await pushEbayInventoryHints(token, result.ebayPushHints);
                if (sync.errors.length > 0) {
                  toast({
                    variant: "destructive",
                    title: "Stock saved; eBay did not update",
                    description: sync.errors[0],
                  });
                }
              }
            }
          } catch (e) {
            toast({
              variant: "destructive",
              title: "Stock saved; channel inventory did not update",
              description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
            });
          }
        }

        const selectedWarehouse = activeWarehouses.find((w) => w.id === warehouseId);
        try {
          await downloadReceiveLabels({
            warehouseCode:
              selectedWarehouse?.code || selectedWarehouse?.name || warehouseId,
            cartons: results.flatMap((r) => r.cartons),
            pallets: results.flatMap((r) => r.pallets),
          });
        } catch (labelError: unknown) {
          toast({
            title: "Stock added — labels need reprint",
            description:
              labelError instanceof Error
                ? labelError.message
                : "Use warehouse receive log to reprint labels.",
          });
        }

        if (errors.length > 0) {
          return {
            successDescription: `Added ${units} unit(s) for ${results.length} line(s). ${errors.length} line(s) failed: ${errors[0]?.error}`,
          };
        }

        const dest = results[0]?.putawayDestination || "warehouse";
        return {
          successDescription: `Added ${units} unit(s) to ${userName}'s inventory and put away at ${dest}.`,
        };
      }}
    />
  );
}
