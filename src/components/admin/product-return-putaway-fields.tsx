"use client";

import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import { listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import { findBinByPath, inspectBinContents, loadOccupiedBinIds } from "@/lib/warehouse-putaway";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import {
  PutawayDestinationFields,
  emptyPutawayLineSlot,
  isPutawayLineSlotReady,
  type PutawayLineSlot,
} from "@/components/warehouse-ops/putaway-destination-fields";
import type { WarehouseAreaDoc, WarehouseBinDoc, WarehouseCartonLine, WarehouseDoc } from "@/types";

export type ReturnPutawayValue = {
  warehouseId: string;
  warehouseLabel: string;
  goodBinPath: string;
  damagedBinPath: string;
  lot: string;
  expiry: string;
  goodReady: boolean;
  damagedReady: boolean;
};

type Props = {
  goodQty: number;
  damagedQty: number;
  sku: string;
  productName: string;
  clientUserId: string;
  onChange: (value: ReturnPutawayValue) => void;
};

export function ProductReturnPutawayFields({
  goodQty,
  damagedQty,
  sku,
  productName,
  clientUserId,
  onChange,
}: Props) {
  const { toast } = useToast();
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");
  const activeWarehouses = useMemo(
    () => warehouses.filter((warehouse) => warehouse.active !== false),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [bins, setBins] = useState<WarehouseBinDoc[]>([]);
  const [occupiedBinIds, setOccupiedBinIds] = useState<Set<string>>(new Set());
  const [destinationsLoading, setDestinationsLoading] = useState(false);
  const [destinationSlot, setDestinationSlot] = useState<PutawayLineSlot>(emptyPutawayLineSlot());
  const [damagedDestinationSlot, setDamagedDestinationSlot] = useState<PutawayLineSlot>(
    emptyPutawayLineSlot()
  );
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");

  const destinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "RETURN-GOOD",
      sku: sku.trim(),
      productTitle: productName.trim() || null,
      quantity: Math.max(1, goodQty),
      lot: lot.trim() || null,
      expiry: expiry.trim() || null,
      condition: "good",
      binId: null,
      allocationStatus: "allocated",
      clientId: clientUserId,
    }),
    [clientUserId, expiry, goodQty, lot, productName, sku]
  );

  const damagedDestinationLine = useMemo<WarehouseCartonLine>(
    () => ({
      lineId: "RETURN-DAMAGED",
      sku: sku.trim(),
      productTitle: productName.trim() || null,
      quantity: Math.max(1, damagedQty),
      lot: lot.trim() || null,
      expiry: expiry.trim() || null,
      condition: "damaged",
      binId: null,
      allocationStatus: "allocated",
      clientId: clientUserId,
    }),
    [clientUserId, damagedQty, expiry, lot, productName, sku]
  );

  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      const nj2 = activeWarehouses.find(
        (warehouse) =>
          isDefaultNj2Warehouse(warehouse.name) || isDefaultNj2Warehouse(warehouse.code)
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

  const goodReady =
    goodQty > 0 && isPutawayLineSlotReady(destinationLine, destinationSlot, { areas, bins });
  const damagedReady =
    damagedQty <= 0 ||
    isPutawayLineSlotReady(damagedDestinationLine, damagedDestinationSlot, { areas, bins });

  const warehouseLabel =
    activeWarehouses.find((warehouse) => warehouse.id === warehouseId)?.name ||
    activeWarehouses.find((warehouse) => warehouse.id === warehouseId)?.code ||
    warehouseId;

  useEffect(() => {
    onChange({
      warehouseId,
      warehouseLabel,
      goodBinPath: destinationSlot.resolved?.bin.path || destinationSlot.areaCode || "",
      damagedBinPath:
        damagedDestinationSlot.resolved?.bin.path || damagedDestinationSlot.areaCode || "",
      lot: lot.trim(),
      expiry: expiry.trim(),
      goodReady,
      damagedReady,
    });
  }, [
    damagedDestinationSlot.areaCode,
    damagedDestinationSlot.resolved,
    damagedReady,
    destinationSlot.areaCode,
    destinationSlot.resolved,
    expiry,
    goodReady,
    lot,
    onChange,
    warehouseId,
    warehouseLabel,
  ]);

  const resolveDestinationBin = async (pathOverride: string | undefined, target: "good" | "damaged") => {
    const slot = target === "good" ? destinationSlot : damagedDestinationSlot;
    const setSlot = target === "good" ? setDestinationSlot : setDamagedDestinationSlot;
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

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2">
        <Label>Warehouse</Label>
        <Select value={warehouseId} onValueChange={setWarehouseId}>
          <SelectTrigger>
            <SelectValue placeholder="Select warehouse" />
          </SelectTrigger>
          <SelectContent>
            {activeWarehouses.map((warehouse) => (
              <SelectItem key={warehouse.id} value={warehouse.id}>
                {warehouse.name || warehouse.code || warehouse.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {goodQty > 0 ? (
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
            Damaged units must go to a quarantine bin or quarantine area, same as inbound.
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
        <Input value={lot} onChange={(event) => setLot(event.target.value)} placeholder="Lot number" />
      </div>
      <div className="space-y-1.5">
        <Label>Expiry (optional)</Label>
        <Input type="date" value={expiry} onChange={(event) => setExpiry(event.target.value)} />
      </div>
    </div>
  );
}
