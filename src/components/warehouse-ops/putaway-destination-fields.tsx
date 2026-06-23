"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  areasEligibleForPutawayLine,
  classifyBin,
  defaultPutawayPlacementMode,
  formatWarehouseAreaOption,
  lineEligibleAreasHaveBins,
  validateLineToArea,
  validateLineToBin,
  type PutawayPlacementMode,
} from "@/lib/warehouse-putaway";
import type { WarehouseAreaDoc, WarehouseBinDoc, WarehouseCartonLine } from "@/types";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type { PutawayPlacementMode };

export type PutawayDestinationContext = {
  areas: WarehouseAreaDoc[];
  bins: WarehouseBinDoc[];
};

export type ResolvedBin = {
  bin: WarehouseBinDoc;
  contents: { skus: string[]; hasDamaged: boolean; cartonCount: number };
};

export type PutawayLineSlot = {
  mode: PutawayPlacementMode;
  binPath: string;
  resolved: ResolvedBin | null;
  loading: boolean;
  error: string | null;
  areaCode: string;
};

export function emptyPutawayLineSlot(
  line?: WarehouseCartonLine,
  ctx?: PutawayDestinationContext
): PutawayLineSlot {
  const mode =
    line && ctx ? defaultPutawayPlacementMode(line, ctx.areas, ctx.bins) : "bin";
  return {
    mode,
    binPath: "",
    resolved: null,
    loading: false,
    error: null,
    areaCode: "",
  };
}

export function BinSummary({
  resolved,
  warehouseAreas = [],
}: {
  resolved: ResolvedBin;
  warehouseAreas?: WarehouseAreaDoc[];
}) {
  const kind = classifyBin(resolved.bin, warehouseAreas);
  return (
    <div className="rounded border bg-muted/40 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono font-medium">{resolved.bin.path}</span>
        <Badge
          variant="outline"
          className={cn(
            kind === "quarantine" && "bg-red-100 border-red-300 text-red-800",
            kind === "receiving_staging" && "bg-orange-100 border-orange-300 text-orange-800",
            kind === "normal" && "bg-blue-50 border-blue-300 text-blue-800"
          )}
        >
          {kind === "quarantine"
            ? "Quarantine"
            : kind === "receiving_staging"
              ? "Receiving staging"
              : "Storage"}
        </Badge>
      </div>
      {resolved.contents.cartonCount > 0 ? (
        <p className="text-muted-foreground">
          Currently holds {resolved.contents.cartonCount} carton
          {resolved.contents.cartonCount === 1 ? "" : "s"}
          {resolved.contents.skus.length > 0
            ? ` · SKUs: ${resolved.contents.skus.join(", ")}`
            : ""}
        </p>
      ) : (
        <p className="text-muted-foreground">Empty bin</p>
      )}
    </div>
  );
}

type Props = {
  line: WarehouseCartonLine;
  slot: PutawayLineSlot;
  warehouseAreas: WarehouseAreaDoc[];
  warehouseBins: WarehouseBinDoc[];
  areasLoading?: boolean;
  onBinPathChange: (value: string) => void;
  onResolveBin: (pathOverride?: string) => void;
  onAreaChange: (areaCode: string) => void;
  onClear?: () => void;
  showClear?: boolean;
};

export function PutawayDestinationFields({
  line,
  slot,
  warehouseAreas,
  warehouseBins,
  areasLoading = false,
  onBinPathChange,
  onResolveBin,
  onAreaChange,
  onClear,
  showClear = false,
}: Props) {
  const eligibleAreas = areasEligibleForPutawayLine(warehouseAreas, line);
  const selectedArea = eligibleAreas.find((a) => a.code === slot.areaCode) ?? null;
  const useBinScan = lineEligibleAreasHaveBins(warehouseAreas, warehouseBins, line);
  const placementMode: PutawayPlacementMode = useBinScan ? "bin" : "area";

  const validationError =
    placementMode === "bin"
      ? slot.resolved
        ? (() => {
            const r = validateLineToBin(
              line,
              slot.resolved.bin,
              slot.resolved.contents,
              warehouseAreas
            );
            return r.ok ? null : r.reason;
          })()
        : null
      : selectedArea
        ? (() => {
            const r = validateLineToArea(line, selectedArea);
            return r.ok ? null : r.reason;
          })()
        : null;

  const ready =
    placementMode === "bin"
      ? Boolean(slot.resolved) && !validationError
      : Boolean(selectedArea) && !validationError;

  return (
    <div className="space-y-2">
      {showClear && onClear ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      ) : null}

      {placementMode === "bin" ? (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            {line.condition === "damaged"
              ? "Scan quarantine bin"
              : "Scan storage bin"}
          </Label>
          <div className="flex gap-2">
            <Input
              value={slot.binPath}
              onChange={(e) => onBinPathChange(e.target.value)}
              placeholder="Camera or type bin path"
              onKeyDown={(e) => {
                if (e.key === "Enter") onResolveBin();
              }}
              className="flex-1"
            />
            <ScanCameraButton
              onScan={(text) => {
                onBinPathChange(text);
                onResolveBin(text);
              }}
              scannerTitle="Scan bin label"
              scannerDescription="Scan the QR on the destination bin."
            />
            <Button onClick={() => onResolveBin()} disabled={slot.loading}>
              {slot.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">
            Select floor area (no bins set up in this zone yet)
          </Label>
          <Select
            value={slot.areaCode || undefined}
            onValueChange={onAreaChange}
            disabled={areasLoading || eligibleAreas.length === 0}
          >
            <SelectTrigger>
              <SelectValue
                placeholder={
                  areasLoading
                    ? "Loading areas…"
                    : eligibleAreas.length === 0
                      ? "No eligible areas — ask admin to add one"
                      : "Choose area"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {eligibleAreas.map((area) => (
                <SelectItem key={area.id} value={area.code}>
                  {formatWarehouseAreaOption(area)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {slot.error ? <p className="text-xs text-red-600">{slot.error}</p> : null}

      {placementMode === "bin" && slot.resolved ? (
        <BinSummary resolved={slot.resolved} warehouseAreas={warehouseAreas} />
      ) : null}

      {validationError ? (
        <div className="flex items-start gap-1 rounded bg-red-50 text-red-800 border border-red-200 px-2 py-1 text-xs">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{validationError}</span>
        </div>
      ) : ready ? (
        <div className="flex items-start gap-1 rounded bg-green-50 text-green-800 border border-green-200 px-2 py-1 text-xs">
          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            OK — lands in{" "}
            {placementMode === "bin"
              ? slot.resolved!.bin.path
              : `area ${selectedArea!.code}`}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export function isPutawayLineSlotReady(
  line: WarehouseCartonLine,
  slot: PutawayLineSlot | undefined,
  ctx: PutawayDestinationContext
): boolean {
  if (!slot) return false;
  const useBinScan = lineEligibleAreasHaveBins(ctx.areas, ctx.bins, line);
  if (useBinScan) {
    if (!slot.resolved) return false;
    const r = validateLineToBin(
      line,
      slot.resolved.bin,
      slot.resolved.contents,
      ctx.areas
    );
    return r.ok;
  }
  const area = ctx.areas.find((a) => a.code === slot.areaCode);
  if (!area) return false;
  return validateLineToArea(line, area).ok;
}

function PutawayLineSku({
  line,
  className,
}: {
  line: Pick<WarehouseCartonLine, "sku" | "productTitle">;
  className?: string;
}) {
  const title = line.productTitle?.trim();
  return (
    <span className={className}>
      <span className="font-mono font-semibold">{line.sku}</span>
      {title ? <span className="font-normal text-muted-foreground"> — {title}</span> : null}
    </span>
  );
}

export function PutawayLineDestinationCard({
  line,
  slot,
  warehouseAreas,
  warehouseBins,
  areasLoading = false,
  damagedBadge = "Damaged",
  onUpdateSlot,
  onResolveBin,
  onClear,
}: {
  line: WarehouseCartonLine;
  slot: PutawayLineSlot;
  warehouseAreas: WarehouseAreaDoc[];
  warehouseBins: WarehouseBinDoc[];
  areasLoading?: boolean;
  damagedBadge?: string;
  onUpdateSlot: (patch: Partial<PutawayLineSlot>) => void;
  onResolveBin: (pathOverride?: string) => void;
  onClear?: () => void;
}) {
  const ctx = { areas: warehouseAreas, bins: warehouseBins };
  const ready = isPutawayLineSlotReady(line, slot, ctx);

  return (
    <Card className={cn(line.condition === "damaged" && "border-red-200 bg-red-50/30")}>
      <CardContent className="py-3 space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm">
            <PutawayLineSku line={line} /> × {line.quantity}
            {line.condition === "damaged" ? (
              <Badge variant="outline" className="ml-2 bg-red-100 border-red-300 text-red-800">
                {damagedBadge}
              </Badge>
            ) : null}
            {line.lot ? (
              <span className="text-xs text-muted-foreground ml-2">Lot {line.lot}</span>
            ) : null}
          </div>
          {ready && onClear ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClear}>
              Clear
            </Button>
          ) : null}
        </div>
        <PutawayDestinationFields
          line={line}
          slot={slot}
          warehouseAreas={warehouseAreas}
          warehouseBins={warehouseBins}
          areasLoading={areasLoading}
          onBinPathChange={(value) =>
            onUpdateSlot({ binPath: value, resolved: null, error: null })
          }
          onResolveBin={onResolveBin}
          onAreaChange={(areaCode) => onUpdateSlot({ areaCode, resolved: null, error: null })}
        />
      </CardContent>
    </Card>
  );
}
