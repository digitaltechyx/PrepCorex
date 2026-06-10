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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import type { WarehouseAreaDoc, WarehouseBinDoc, WarehouseDoc } from "@/types";
import { classifyBin } from "@/lib/warehouse-putaway";
import {
  aggregateBinSkuStock,
  findBinByPath,
  inspectBinContents,
  listCartonsInBin,
  type BinSkuStockRow,
} from "@/lib/warehouse-internal-move";
import {
  applyBinSkuToAreaMove,
  formatAreaOption,
  loadActiveWarehouseAreas,
} from "@/lib/warehouse-area-move";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Loader2,
  MapPin,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

type ResolvedBin = {
  bin: WarehouseBinDoc;
  contents: { skus: string[]; hasDamaged: boolean; cartonCount: number };
};

export function WarehouseOpsAreaMove({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;

  const [sourceScan, setSourceScan] = useState("");
  const [sourceBin, setSourceBin] = useState<ResolvedBin | null>(null);
  const [stockRows, setStockRows] = useState<BinSkuStockRow[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [moveQty, setMoveQty] = useState("");
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [destAreaId, setDestAreaId] = useState("");
  const [loadingSource, setLoadingSource] = useState(false);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [saving, setSaving] = useState(false);

  const sourceInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    sourceInputRef.current?.focus();
  }, []);

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

  const selectedRow = useMemo(
    () => stockRows.find((r) => r.key === selectedKey) ?? null,
    [stockRows, selectedKey]
  );

  const destArea = useMemo(
    () => areas.find((a) => a.id === destAreaId) ?? null,
    [areas, destAreaId]
  );

  const qtyNum = parseInt(moveQty, 10) || 0;
  const canConfirm =
    sourceBin &&
    selectedRow &&
    destArea &&
    qtyNum >= 1 &&
    qtyNum <= selectedRow.quantity;

  function resetAll() {
    setSourceScan("");
    setSourceBin(null);
    setStockRows([]);
    setSelectedKey(null);
    setMoveQty("");
    setDestAreaId("");
    setTimeout(() => sourceInputRef.current?.focus(), 50);
  }

  async function handleResolveSource(pathOverride?: string) {
    const v = (pathOverride ?? sourceScan).trim();
    if (!v) return;
    if (pathOverride != null) setSourceScan(pathOverride);
    setLoadingSource(true);
    try {
      const bin = await findBinByPath(warehouse.id, v);
      if (!bin) {
        toast({ title: "Bin not found", variant: "destructive" });
        setSourceBin(null);
        setStockRows([]);
        return;
      }
      const contents = await inspectBinContents(warehouse.id, bin.id);
      setSourceBin({ bin, contents });
      const occupants = await listCartonsInBin(warehouse.id, bin.id);
      const rows = aggregateBinSkuStock(occupants);
      setStockRows(rows);
      setSelectedKey(null);
      setMoveQty("");
      setDestAreaId("");
    } catch (e) {
      toast({
        title: "Lookup failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoadingSource(false);
    }
  }

  function pickRow(row: BinSkuStockRow) {
    setSelectedKey(row.key);
    setMoveQty(String(row.quantity));
  }

  async function handleConfirm() {
    if (!canConfirm || !sourceBin || !selectedRow || !destArea) return;
    setSaving(true);
    try {
      const result = await applyBinSkuToAreaMove({
        warehouseId: warehouse.id,
        sourceBinId: sourceBin.bin.id,
        sourceBinPath: sourceBin.bin.path,
        sourceAreaCode: sourceBin.bin.area,
        destAreaId: destArea.id,
        sku: selectedRow.sku,
        lot: selectedRow.lot,
        condition: selectedRow.condition,
        quantity: qtyNum,
        operatorId,
      });
      toast({
        title: "Moved to area",
        description: `${result.movedQty} × ${selectedRow.sku} → Area ${result.destAreaCode}`,
      });
      await handleResolveSource(sourceBin.bin.path);
      setDestAreaId("");
      setSelectedKey(null);
      setMoveQty("");
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

  return (
    <div className="max-w-4xl space-y-6">
      <Card className="border-amber-200/60 bg-amber-50/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <MapPin className="h-4 w-4 text-amber-600" />
            Bin → area (SKU qty)
          </CardTitle>
          <CardDescription className="text-xs">
            Scan a storage bin, pick SKU and quantity, then choose a destination area (quarantine,
            damaged, returns, etc.). No destination bin — stock sits in the area floor.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Step 1 — Source bin</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              ref={sourceInputRef}
              value={sourceScan}
              onChange={(e) => setSourceScan(e.target.value)}
              placeholder="Scan source bin"
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleResolveSource();
              }}
            />
            <ScanCameraButton
              onScan={(text) => void handleResolveSource(text)}
              scannerTitle="Scan source bin"
              scannerDescription="Scan the bin stock is leaving."
            />
            <Button onClick={() => void handleResolveSource()} disabled={loadingSource}>
              {loadingSource ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
            </Button>
          </div>
          {sourceBin ? <BinChip resolved={sourceBin} label="From" /> : null}
        </CardContent>
      </Card>

      <Card className={cn(!sourceBin && "opacity-60 pointer-events-none")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Step 2 — SKU & quantity</CardTitle>
          <CardDescription className="text-xs">
            Tap a row to select what to move. Edit quantity for partial moves.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {stockRows.length === 0 && sourceBin ? (
            <p className="text-sm text-muted-foreground">No movable stock in this bin.</p>
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
                    ? "border-amber-400 bg-amber-50"
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

      <Card
        className={cn(
          (!sourceBin || !selectedRow || qtyNum < 1) && "opacity-60 pointer-events-none"
        )}
      >
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Step 3 — Destination area</CardTitle>
          <CardDescription className="text-xs">
            Choose the area where stock should sit (no bin scan).
          </CardDescription>
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
              <Label className="text-xs">Area</Label>
              <Select value={destAreaId} onValueChange={setDestAreaId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select destination area" />
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
          {canConfirm && destArea ? (
            <div className="flex items-start gap-1 rounded bg-green-50 text-green-800 border border-green-200 px-2 py-1 text-xs">
              <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
              <span>
                Move {qtyNum} × {selectedRow?.sku} from {sourceBin?.bin.path} → Area{" "}
                {destArea.code}
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
          className="bg-amber-600 hover:bg-amber-700"
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

function BinChip({ resolved, label }: { resolved: ResolvedBin; label: string }) {
  const kind = classifyBin(resolved.bin);
  return (
    <div className="rounded border bg-background px-3 py-2 text-xs flex flex-wrap items-center gap-2">
      <Badge variant="outline">{label}</Badge>
      <span className="font-mono font-semibold">{resolved.bin.path}</span>
      <span className="text-muted-foreground">Area {resolved.bin.area}</span>
      <span className="text-muted-foreground">
        {resolved.contents.skus.length
          ? resolved.contents.skus.slice(0, 3).join(", ")
          : "Empty"}
      </span>
      {kind === "quarantine" ? (
        <Badge variant="outline" className="bg-amber-100">
          Quarantine bin
        </Badge>
      ) : null}
    </div>
  );
}
