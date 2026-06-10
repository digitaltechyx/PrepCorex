"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { findPalletByCode } from "@/lib/warehouse-carton-firestore";
import { resolveScan } from "@/lib/warehouse-putaway";
import { getWarehouseCarton } from "@/lib/warehouse-receive-corrections";
import type { WarehouseAreaDoc, WarehouseDoc, WarehousePalletDoc } from "@/types";
import type { BinSkuStockRow } from "@/lib/warehouse-internal-move";
import {
  aggregateAreaSkuStock,
  applyAreaSkuToAreaMove,
  applyCartonAreaToAreaMove,
  applyPalletAreaToAreaMove,
  formatAreaOption,
  linesInAreaForCarton,
  listAreaFloorCartonSummaries,
  listCartonsInArea,
  listPalletsInArea,
  loadActiveWarehouseAreas,
  palletIsOnAreaFloor,
  type AreaFloorCartonSummary,
} from "@/lib/warehouse-area-move";
import {
  ArrowLeft,
  ArrowRightLeft,
  Box,
  CheckCircle2,
  ChevronRight,
  Layers,
  Loader2,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

type MoveMode = "sku" | "carton" | "pallet";

export function WarehouseOpsAreaToAreaMove({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;

  const [moveMode, setMoveMode] = useState<MoveMode>("sku");
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [sourceAreaId, setSourceAreaId] = useState("");
  const [destAreaId, setDestAreaId] = useState("");
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [loadingStock, setLoadingStock] = useState(false);
  const [saving, setSaving] = useState(false);

  const [stockRows, setStockRows] = useState<BinSkuStockRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [moveQty, setMoveQty] = useState("");

  const [cartonSummaries, setCartonSummaries] = useState<AreaFloorCartonSummary[]>([]);
  const [activeCarton, setActiveCarton] = useState<AreaFloorCartonSummary | null>(null);
  const [cartonScan, setCartonScan] = useState("");
  const [resolvingCarton, setResolvingCarton] = useState(false);

  const [areaPallets, setAreaPallets] = useState<WarehousePalletDoc[]>([]);
  const [activePallet, setActivePallet] = useState<WarehousePalletDoc | null>(null);
  const [palletScan, setPalletScan] = useState("");
  const [resolvingPallet, setResolvingPallet] = useState(false);

  const cartonInputRef = useRef<HTMLInputElement | null>(null);
  const palletInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingAreas(true);
    void loadActiveWarehouseAreas(warehouse.id)
      .then((list) => {
        if (!cancelled) setAreas(list);
      })
      .catch(() => {
        if (!cancelled) setAreas([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingAreas(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouse.id]);

  const sourceArea = useMemo(
    () => areas.find((a) => a.id === sourceAreaId) ?? null,
    [areas, sourceAreaId]
  );

  const destArea = useMemo(
    () => areas.find((a) => a.id === destAreaId) ?? null,
    [areas, destAreaId]
  );

  const destAreaOptions = useMemo(
    () => areas.filter((a) => a.id !== sourceAreaId),
    [areas, sourceAreaId]
  );

  const selectedRow = useMemo(
    () => stockRows.find((r) => r.key === selectedKey) ?? null,
    [stockRows, selectedKey]
  );

  const qtyNum = parseInt(moveQty, 10) || 0;

  const canConfirmSku =
    sourceArea && selectedRow && destArea && qtyNum >= 1 && qtyNum <= selectedRow.quantity;

  const canConfirmCarton = sourceArea && activeCarton && destArea;
  const canConfirmPallet = sourceArea && activePallet && destArea;

  const canConfirm =
    moveMode === "sku"
      ? canConfirmSku
      : moveMode === "carton"
        ? canConfirmCarton
        : canConfirmPallet;

  function resetSelections() {
    setStockRows([]);
    setSelectedKey(null);
    setMoveQty("");
    setCartonSummaries([]);
    setActiveCarton(null);
    setCartonScan("");
    setAreaPallets([]);
    setActivePallet(null);
    setPalletScan("");
    setDestAreaId("");
  }

  function resetAll() {
    setSourceAreaId("");
    resetSelections();
  }

  async function loadSourceAreaData(area: WarehouseAreaDoc) {
    setLoadingStock(true);
    try {
      const [occupants, summaries, pallets] = await Promise.all([
        listCartonsInArea(warehouse.id, area.code),
        listAreaFloorCartonSummaries(warehouse.id, area.code),
        listPalletsInArea(warehouse.id, area.code),
      ]);
      setStockRows(aggregateAreaSkuStock(occupants));
      setCartonSummaries(summaries);
      setAreaPallets(pallets);
      setSelectedKey(null);
      setMoveQty("");
      setActiveCarton(null);
      setCartonScan("");
      setActivePallet(null);
      setPalletScan("");
      setDestAreaId("");
    } catch (e) {
      toast({
        title: "Lookup failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      resetSelections();
    } finally {
      setLoadingStock(false);
    }
  }

  async function handleSourceAreaChange(areaId: string) {
    setSourceAreaId(areaId);
    const area = areas.find((a) => a.id === areaId);
    if (!area) {
      resetSelections();
      return;
    }
    await loadSourceAreaData(area);
  }

  function pickRow(row: BinSkuStockRow) {
    setSelectedKey(row.key);
    setMoveQty(String(row.quantity));
  }

  function pickCarton(summary: AreaFloorCartonSummary) {
    setActiveCarton(summary);
    setCartonScan(summary.carton.cartonCode);
  }

  function pickPallet(pallet: WarehousePalletDoc) {
    setActivePallet(pallet);
    setPalletScan(pallet.palletCode);
  }

  async function handleResolveCarton(pathOverride?: string) {
    if (!sourceArea) {
      toast({ title: "Select source area first", variant: "destructive" });
      return;
    }
    const code = (pathOverride ?? cartonScan).trim();
    if (!code) return;
    if (pathOverride != null) setCartonScan(pathOverride);

    setResolvingCarton(true);
    try {
      const resolved = await resolveScan(warehouse.id, code);
      if (resolved.kind !== "carton") {
        toast({
          title: "Carton not found",
          description: "Scan a carton or package label (CTN / PKG).",
          variant: "destructive",
        });
        setActiveCarton(null);
        return;
      }

      const carton = await getWarehouseCarton(warehouse.id, resolved.carton.id);
      if (!carton || carton.status === "voided" || carton.status === "closed") {
        toast({ title: "Carton not available", variant: "destructive" });
        setActiveCarton(null);
        return;
      }

      const linesInArea = linesInAreaForCarton(carton, sourceArea.code);
      if (linesInArea.length === 0) {
        toast({
          title: "Not in source area",
          description: `${carton.cartonCode} has no floor stock in Area ${sourceArea.code}.`,
          variant: "destructive",
        });
        setActiveCarton(null);
        return;
      }

      setActiveCarton({
        carton,
        linesInArea,
        units: linesInArea.reduce((sum, l) => sum + l.quantity, 0),
      });
      setCartonScan(carton.cartonCode);
    } catch (e) {
      toast({
        title: "Lookup failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolvingCarton(false);
    }
  }

  async function handleResolvePallet(pathOverride?: string) {
    if (!sourceArea) {
      toast({ title: "Select source area first", variant: "destructive" });
      return;
    }
    const code = (pathOverride ?? palletScan).trim();
    if (!code) return;
    if (pathOverride != null) setPalletScan(pathOverride);

    setResolvingPallet(true);
    try {
      const resolved = await resolveScan(warehouse.id, code);
      let pallet: WarehousePalletDoc | null = null;
      if (resolved.kind === "pallet") {
        pallet = await findPalletByCode(warehouse.id, resolved.palletCode);
      } else {
        pallet = await findPalletByCode(warehouse.id, code);
      }

      if (!pallet) {
        toast({
          title: "Pallet not found",
          description: "Scan a pallet label (PAL-…).",
          variant: "destructive",
        });
        setActivePallet(null);
        return;
      }

      if (!palletIsOnAreaFloor(pallet, sourceArea.code)) {
        toast({
          title: "Not in source area",
          description: `${pallet.palletCode} is not on the floor in Area ${sourceArea.code}.`,
          variant: "destructive",
        });
        setActivePallet(null);
        return;
      }

      setActivePallet(pallet);
      setPalletScan(pallet.palletCode);
    } catch (e) {
      toast({
        title: "Lookup failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolvingPallet(false);
    }
  }

  async function handleConfirm() {
    if (!canConfirm || !sourceArea || !destArea) return;
    setSaving(true);
    try {
      if (moveMode === "sku" && selectedRow) {
        const result = await applyAreaSkuToAreaMove({
          warehouseId: warehouse.id,
          sourceAreaId: sourceArea.id,
          destAreaId: destArea.id,
          sku: selectedRow.sku,
          lot: selectedRow.lot,
          condition: selectedRow.condition,
          quantity: qtyNum,
          operatorId,
        });
        toast({
          title: "Moved between areas",
          description: `${result.movedQty} × ${selectedRow.sku}: ${result.sourceAreaCode} → ${result.destAreaCode}`,
        });
      } else if (moveMode === "carton" && activeCarton) {
        const result = await applyCartonAreaToAreaMove({
          warehouseId: warehouse.id,
          sourceAreaId: sourceArea.id,
          destAreaId: destArea.id,
          cartonId: activeCarton.carton.id,
          operatorId,
        });
        toast({
          title: "Carton moved",
          description: `${result.cartonCode} (${result.unitsMoved} units): ${result.sourceAreaCode} → ${result.destAreaCode}`,
        });
      } else if (moveMode === "pallet" && activePallet) {
        const result = await applyPalletAreaToAreaMove({
          warehouseId: warehouse.id,
          sourceAreaId: sourceArea.id,
          destAreaId: destArea.id,
          palletId: activePallet.id,
          operatorId,
        });
        toast({
          title: "Pallet moved",
          description: `${result.palletCode}: ${result.sourceAreaCode} → ${result.destAreaCode}${
            result.cartonsUpdated ? ` · ${result.cartonsUpdated} carton(s)` : ""
          }`,
        });
      }
      await loadSourceAreaData(sourceArea);
    } catch (e) {
      toast({
        title: "Move failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    if (moveMode === "carton") cartonInputRef.current?.focus();
    if (moveMode === "pallet") palletInputRef.current?.focus();
  }, [moveMode, sourceAreaId]);

  return (
    <div className="max-w-4xl space-y-6">
      <Card className="border-violet-200/60 bg-violet-50/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-violet-600" />
            Area → area
          </CardTitle>
          <CardDescription className="text-xs">
            Move floor stock between areas by SKU quantity, carton scan, or pallet scan — for
            quarantine, damaged, returns, dispatch, and similar flows.
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs
        value={moveMode}
        onValueChange={(v) => setMoveMode(v as MoveMode)}
        className="w-full"
      >
        <TabsList className="grid w-full max-w-lg grid-cols-3">
          <TabsTrigger value="sku">SKU qty</TabsTrigger>
          <TabsTrigger value="carton">Carton</TabsTrigger>
          <TabsTrigger value="pallet">Pallet</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Step 1 — Source area</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loadingAreas ? (
            <p className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading areas…
            </p>
          ) : areas.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No active areas in this warehouse. Ask admin to create areas first.
            </p>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">Source area</Label>
              <Select value={sourceAreaId} onValueChange={(v) => void handleSourceAreaChange(v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select source area" />
                </SelectTrigger>
                <SelectContent>
                  {areas.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                      {formatAreaOption(area)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {sourceArea ? (
            <div className="rounded border bg-background px-3 py-2 text-xs flex flex-wrap items-center gap-2">
              <Badge variant="outline">From</Badge>
              <span className="font-mono font-semibold">{sourceArea.code}</span>
              {loadingStock ? (
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              ) : (
                <span className="text-muted-foreground">
                  {moveMode === "sku" &&
                    (stockRows.length
                      ? `${stockRows.length} SKU${stockRows.length === 1 ? "" : "s"}`
                      : "No floor stock")}
                  {moveMode === "carton" &&
                    (cartonSummaries.length
                      ? `${cartonSummaries.length} carton${cartonSummaries.length === 1 ? "" : "s"}`
                      : "No cartons on floor")}
                  {moveMode === "pallet" &&
                    (areaPallets.length
                      ? `${areaPallets.length} pallet${areaPallets.length === 1 ? "" : "s"}`
                      : "No pallets on floor")}
                </span>
              )}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {moveMode === "sku" ? (
        <Card className={cn(!sourceArea && "opacity-60 pointer-events-none")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Step 2 — SKU & quantity</CardTitle>
            <CardDescription className="text-xs">
              Tap a row for partial SKU moves (FEFO).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {sourceArea && !loadingStock && stockRows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No movable stock in this area.</p>
            ) : null}
            <div className="space-y-2">
              {stockRows.map((row) => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => pickRow(row)}
                  className={cn(
                    "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                    selectedKey === row.key
                      ? "border-violet-400 bg-violet-50"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex justify-between gap-2 items-start">
                    <div>
                      <p className="font-mono font-semibold text-sm">{row.sku}</p>
                      {row.productTitle ? (
                        <p className="text-xs text-muted-foreground">{row.productTitle}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {row.lot ? `Lot ${row.lot}` : "No lot"}
                        {row.expiry ? ` · Exp ${row.expiry.slice(0, 10)}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-semibold">{row.quantity}</p>
                      {row.condition === "damaged" ? (
                        <Badge variant="outline" className="text-xs bg-red-100 border-red-300">
                          Damaged
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {selectedRow ? (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs">Quantity to move (max {selectedRow.quantity})</Label>
                <Input
                  type="number"
                  min={1}
                  max={selectedRow.quantity}
                  value={moveQty}
                  onChange={(e) => setMoveQty(e.target.value)}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {moveMode === "carton" ? (
        <Card className={cn(!sourceArea && "opacity-60 pointer-events-none")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Box className="h-4 w-4" />
              Step 2 — Carton
            </CardTitle>
            <CardDescription className="text-xs">
              Scan a carton label or tap one from the list. Moves all floor stock for that carton in
              the source area.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                ref={cartonInputRef}
                value={cartonScan}
                onChange={(e) => setCartonScan(e.target.value)}
                placeholder="Scan carton (CTN / PKG)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleResolveCarton();
                }}
              />
              <ScanCameraButton
                onScan={(text) => void handleResolveCarton(text)}
                scannerTitle="Scan carton"
                scannerDescription="Scan the carton QR on the label."
              />
              <Button onClick={() => void handleResolveCarton()} disabled={resolvingCarton}>
                {resolvingCarton ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
              </Button>
            </div>
            {activeCarton ? (
              <div className="rounded border border-violet-200 bg-violet-50/50 px-3 py-2 text-xs">
                <p className="font-mono font-semibold">{activeCarton.carton.cartonCode}</p>
                <p className="text-muted-foreground mt-0.5">
                  {activeCarton.units} units · {activeCarton.linesInArea.length} line(s) in Area{" "}
                  {sourceArea?.code}
                </p>
              </div>
            ) : null}
            {sourceArea && !loadingStock && cartonSummaries.length > 0 ? (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs">Or pick from area</Label>
                {cartonSummaries.map((summary) => (
                  <button
                    key={summary.carton.id}
                    type="button"
                    onClick={() => pickCarton(summary)}
                    className={cn(
                      "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                      activeCarton?.carton.id === summary.carton.id
                        ? "border-violet-400 bg-violet-50"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-mono font-semibold text-sm">
                        {summary.carton.cartonCode}
                      </span>
                      <span className="text-sm font-semibold">{summary.units} units</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {summary.carton.sku}
                      {summary.carton.isMixed ? " · Mixed" : ""}
                    </p>
                  </button>
                ))}
              </div>
            ) : null}
            {sourceArea && !loadingStock && cartonSummaries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No cartons on the floor in this area.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {moveMode === "pallet" ? (
        <Card className={cn(!sourceArea && "opacity-60 pointer-events-none")}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers className="h-4 w-4" />
              Step 2 — Pallet
            </CardTitle>
            <CardDescription className="text-xs">
              Scan a pallet label or tap one from the list. Moves the pallet and linked cartons on
              the floor in the source area.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                ref={palletInputRef}
                value={palletScan}
                onChange={(e) => setPalletScan(e.target.value)}
                placeholder="Scan pallet (PAL-…)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleResolvePallet();
                }}
              />
              <ScanCameraButton
                onScan={(text) => void handleResolvePallet(text)}
                scannerTitle="Scan pallet"
                scannerDescription="Scan the pallet QR on the label."
              />
              <Button onClick={() => void handleResolvePallet()} disabled={resolvingPallet}>
                {resolvingPallet ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
              </Button>
            </div>
            {activePallet ? (
              <div className="rounded border border-violet-200 bg-violet-50/50 px-3 py-2 text-xs">
                <p className="font-mono font-semibold">{activePallet.palletCode}</p>
                <p className="text-muted-foreground mt-0.5">
                  On floor in Area {sourceArea?.code}
                  {activePallet.isClosedCrossdock ? " · Closed cross-dock" : ""}
                </p>
              </div>
            ) : null}
            {sourceArea && !loadingStock && areaPallets.length > 0 ? (
              <div className="space-y-2 pt-2 border-t">
                <Label className="text-xs">Or pick from area</Label>
                {areaPallets.map((pallet) => (
                  <button
                    key={pallet.id}
                    type="button"
                    onClick={() => pickPallet(pallet)}
                    className={cn(
                      "w-full text-left rounded-lg border px-3 py-2 transition-colors",
                      activePallet?.id === pallet.id
                        ? "border-violet-400 bg-violet-50"
                        : "hover:bg-muted/50"
                    )}
                  >
                    <div className="flex justify-between gap-2 items-center">
                      <span className="font-mono font-semibold text-sm">{pallet.palletCode}</span>
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
            {sourceArea && !loadingStock && areaPallets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No pallets on the floor in this area.</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card
        className={cn(
          (!sourceArea ||
            (moveMode === "sku" && (!selectedRow || qtyNum < 1)) ||
            (moveMode === "carton" && !activeCarton) ||
            (moveMode === "pallet" && !activePallet)) &&
            "opacity-60 pointer-events-none"
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Step 3 — Destination area</CardTitle>
          <CardDescription className="text-xs">
            Choose where stock should sit on the floor (must differ from source).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {destAreaOptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">Select a source area first.</p>
          ) : (
            <div className="space-y-2">
              <Label className="text-xs">Destination area</Label>
              <Select value={destAreaId} onValueChange={setDestAreaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination area" />
                </SelectTrigger>
                <SelectContent>
                  {destAreaOptions.map((area) => (
                    <SelectItem key={area.id} value={area.id}>
                      {formatAreaOption(area)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {canConfirm && destArea && sourceArea ? (
            <div className="flex items-start gap-1 rounded bg-green-50 text-green-800 border border-green-200 px-2 py-1 text-xs">
              <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                {moveMode === "sku" && selectedRow
                  ? `Move ${qtyNum} × ${selectedRow.sku}`
                  : moveMode === "carton" && activeCarton
                    ? `Move carton ${activeCarton.carton.cartonCode} (${activeCarton.units} units)`
                    : moveMode === "pallet" && activePallet
                      ? `Move pallet ${activePallet.palletCode}`
                      : "Move"}{" "}
                from Area {sourceArea.code} → Area {destArea.code}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2 justify-between items-center sticky bottom-4 bg-background/95 py-2 border-t">
        <Button type="button" variant="ghost" size="sm" onClick={resetAll}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Start over
        </Button>
        <Button
          size="lg"
          className="bg-violet-600 hover:bg-violet-700"
          disabled={!canConfirm || saving}
          onClick={() => void handleConfirm()}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <>
              Move to area
              <ChevronRight className="h-4 w-4 ml-1" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
