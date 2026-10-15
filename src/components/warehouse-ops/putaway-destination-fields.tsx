"use client";

import { useState } from "react";
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
import { PutawayBinWritePicker } from "@/components/warehouse-ops/putaway-bin-write-picker";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  areasEligibleForPutawayLine,
  binsEligibleForPutawayLine,
  classifyBin,
  defaultPutawayPlacementMode,
  formatWarehouseAreaOption,
  lineEligibleAreasHaveBins,
  validateLineToArea,
  validateLineToBin,
  type PutawayPlacementMode,
} from "@/lib/warehouse-putaway";
import type { WarehouseAreaDoc, WarehouseBinDoc, WarehouseCartonLine } from "@/types";
import { AlertTriangle, CheckCircle2, Keyboard, Loader2, ScanLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type BinEntryMode = "write" | "scan";

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
  /** Units to putaway now (may be less than line.quantity; remainder stays for later). */
  putawayQty: string;
};

export function emptyPutawayLineSlot(
  line?: WarehouseCartonLine,
  ctx?: PutawayDestinationContext
): PutawayLineSlot {
  const mode =
    line && ctx ? defaultPutawayPlacementMode(line, ctx.areas, ctx.bins) : "bin";
  const qty = line && line.quantity > 0 ? String(line.quantity) : "1";
  return {
    mode,
    binPath: "",
    resolved: null,
    loading: false,
    error: null,
    areaCode: "",
    putawayQty: qty,
  };
}

/** Parsed putaway qty for a slot — clamped to 1…line.quantity. */
export function parsePutawayQty(
  line: WarehouseCartonLine,
  slot: PutawayLineSlot | undefined
): number {
  const max = Math.max(1, Math.floor(line.quantity));
  const raw = parseInt(slot?.putawayQty ?? String(max), 10);
  if (!Number.isFinite(raw) || raw < 1) return max;
  return Math.min(max, Math.floor(raw));
}

export function putawayQtyError(
  line: WarehouseCartonLine,
  slot: PutawayLineSlot | undefined
): string | null {
  if (!slot) return null;
  if (line.quantity <= 1) return null;
  const raw = parseInt(slot.putawayQty, 10);
  if (!Number.isFinite(raw) || raw < 1) return "Enter a putaway quantity of at least 1.";
  if (raw > line.quantity) return `Only ${line.quantity} units available on this line.`;
  return null;
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
    <div className="min-w-0 space-y-1 overflow-hidden rounded border bg-muted/40 px-2.5 py-2 text-xs sm:px-3">
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-2">
        <span className="min-w-0 break-all font-mono text-[11px] font-medium sm:text-xs">
          {resolved.bin.path}
        </span>
        <Badge
          variant="outline"
          className={cn(
            "w-fit shrink-0",
            kind === "quarantine" && "border-red-300 bg-red-100 text-red-800",
            kind === "receiving_staging" && "border-orange-300 bg-orange-100 text-orange-800",
            kind === "normal" && "border-blue-300 bg-blue-50 text-blue-800"
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
        <p className="break-words text-muted-foreground">
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
  occupiedBinIds?: ReadonlySet<string>;
  occupancyLoading?: boolean;
  areasLoading?: boolean;
  onBinPathChange: (value: string) => void;
  onResolveBin: (pathOverride?: string) => void;
  onAreaChange: (areaCode: string) => void;
  onPutawayQtyChange?: (value: string) => void;
  onClear?: () => void;
  showClear?: boolean;
};

export function PutawayDestinationFields({
  line,
  slot,
  warehouseAreas,
  warehouseBins,
  occupiedBinIds,
  occupancyLoading = false,
  areasLoading = false,
  onBinPathChange,
  onResolveBin,
  onAreaChange,
  onPutawayQtyChange,
  onClear,
  showClear = false,
}: Props) {
  const [binEntryMode, setBinEntryMode] = useState<BinEntryMode>("write");
  const eligibleAreas = areasEligibleForPutawayLine(warehouseAreas, line);
  const eligibleBins = binsEligibleForPutawayLine(warehouseAreas, warehouseBins, line);
  const selectedArea = eligibleAreas.find((a) => a.code === slot.areaCode) ?? null;
  const useBinScan = lineEligibleAreasHaveBins(warehouseAreas, warehouseBins, line);
  const placementMode: PutawayPlacementMode = useBinScan ? "bin" : "area";

  const putQty = parsePutawayQty(line, slot);
  const qtyErr = putawayQtyError(line, slot);
  const remainingAfter = Math.max(0, line.quantity - putQty);
  const canSplitQty = line.quantity > 1;
  const probeLine = canSplitQty ? { ...line, quantity: putQty } : line;

  const validationError =
    placementMode === "bin"
      ? slot.resolved
        ? (() => {
            const r = validateLineToBin(
              probeLine,
              slot.resolved.bin,
              slot.resolved.contents,
              warehouseAreas
            );
            return r.ok ? null : r.reason;
          })()
        : null
      : selectedArea
        ? (() => {
            const r = validateLineToArea(probeLine, selectedArea);
            return r.ok ? null : r.reason;
          })()
        : null;

  const ready =
    !qtyErr &&
    (placementMode === "bin"
      ? Boolean(slot.resolved) && !validationError
      : Boolean(selectedArea) && !validationError);

  return (
    <div className="min-w-0 space-y-2 overflow-hidden">
      {showClear && onClear ? (
        <div className="flex justify-end">
          <Button type="button" variant="ghost" size="sm" onClick={onClear}>
            Clear
          </Button>
        </div>
      ) : null}

      {canSplitQty && onPutawayQtyChange ? (
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">
            {line.condition === "damaged" ? "Damaged qty to putaway" : "Good qty to putaway"}
          </Label>
          <div className="flex min-w-0 flex-wrap items-end gap-2">
            <Input
              type="number"
              min={1}
              max={line.quantity}
              value={slot.putawayQty}
              onChange={(e) => onPutawayQtyChange(e.target.value)}
              className="w-24 shrink-0"
            />
            <p className="min-w-0 flex-1 break-words pb-2 text-xs text-muted-foreground">
              of {line.quantity}
              {remainingAfter > 0
                ? ` · ${remainingAfter} remain for another bin (or same bin later)`
                : " · all units this putaway"}
            </p>
          </div>
          {qtyErr ? <p className="text-xs text-red-600">{qtyErr}</p> : null}
        </div>
      ) : null}

      {placementMode === "bin" ? (
        <div className="min-w-0 space-y-2">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <Label className="text-xs text-muted-foreground">
              {line.condition === "damaged" ? "Quarantine bin" : "Storage bin"}
            </Label>
            <div className="inline-flex w-fit rounded-md border bg-muted/40 p-0.5">
              <Button
                type="button"
                size="sm"
                variant={binEntryMode === "write" ? "default" : "ghost"}
                className="h-8 gap-1 px-2.5 text-xs sm:h-7"
                onClick={() => setBinEntryMode("write")}
              >
                <Keyboard className="h-3.5 w-3.5" />
                Write
              </Button>
              <Button
                type="button"
                size="sm"
                variant={binEntryMode === "scan" ? "default" : "ghost"}
                className="h-8 gap-1 px-2.5 text-xs sm:h-7"
                onClick={() => setBinEntryMode("scan")}
              >
                <ScanLine className="h-3.5 w-3.5" />
                Scan
              </Button>
            </div>
          </div>
          {binEntryMode === "write" ? (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <PutawayBinWritePicker
                  bins={eligibleBins}
                  value={slot.binPath}
                  occupiedBinIds={occupiedBinIds}
                  occupancyLoading={occupancyLoading}
                  disabled={areasLoading || eligibleBins.length === 0}
                  placeholder={
                    areasLoading
                      ? "Loading bins…"
                      : eligibleBins.length === 0
                        ? "No eligible bins"
                        : "Search or select bin…"
                  }
                  onChange={onBinPathChange}
                  onSelect={(bin) => onResolveBin(bin.path)}
                  onSubmitTyped={() => onResolveBin()}
                />
              </div>
              <Button
                className="h-10 w-full shrink-0 sm:h-9 sm:w-auto"
                onClick={() => onResolveBin()}
                disabled={slot.loading || !slot.binPath.trim()}
              >
                {slot.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                value={slot.binPath}
                onChange={(e) => onBinPathChange(e.target.value)}
                placeholder="Scan or type bin path"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onResolveBin();
                }}
                className="min-w-0 flex-1 font-mono text-xs sm:text-sm"
              />
              <div className="flex gap-2">
                <ScanCameraButton
                  onScan={(text) => {
                    onBinPathChange(text);
                    onResolveBin(text);
                  }}
                  scannerTitle="Scan bin label"
                  scannerDescription="Scan the QR on the destination bin."
                />
                <Button
                  className="h-10 flex-1 sm:h-9 sm:flex-none"
                  onClick={() => onResolveBin()}
                  disabled={slot.loading}
                >
                  {slot.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
                </Button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="min-w-0 space-y-1">
          <Label className="text-xs text-muted-foreground">
            Select floor area (no bins set up in this zone yet)
          </Label>
          <Select
            value={slot.areaCode || undefined}
            onValueChange={onAreaChange}
            disabled={areasLoading || eligibleAreas.length === 0}
          >
            <SelectTrigger className="min-w-0">
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

      {slot.error ? <p className="break-words text-xs text-red-600">{slot.error}</p> : null}

      {placementMode === "bin" && slot.resolved ? (
        <BinSummary resolved={slot.resolved} warehouseAreas={warehouseAreas} />
      ) : null}

      {validationError ? (
        <div className="flex min-w-0 items-start gap-1 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-800">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-words">{validationError}</span>
        </div>
      ) : ready ? (
        <div className="flex min-w-0 items-start gap-1 rounded border border-green-200 bg-green-50 px-2 py-1 text-xs text-green-800">
          <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" />
          <span className="min-w-0 break-all">
            OK — putaway {putQty}
            {line.quantity > 1 ? ` of ${line.quantity}` : ""} →{" "}
            {placementMode === "bin"
              ? slot.resolved!.bin.path
              : `area ${selectedArea!.code}`}
            {remainingAfter > 0 ? ` · ${remainingAfter} stay pending` : ""}
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
  const putQty = parsePutawayQty(line, slot);
  const probeLine = line.quantity > 1 ? { ...line, quantity: putQty } : line;
  if (useBinScan) {
    if (!slot.resolved) return false;
    const r = validateLineToBin(
      probeLine,
      slot.resolved.bin,
      slot.resolved.contents,
      ctx.areas
    );
    return r.ok;
  }
  const area = ctx.areas.find((a) => a.code === slot.areaCode);
  if (!area) return false;
  return validateLineToArea(probeLine, area).ok;
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
  occupiedBinIds,
  occupancyLoading = false,
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
  occupiedBinIds?: ReadonlySet<string>;
  occupancyLoading?: boolean;
  areasLoading?: boolean;
  damagedBadge?: string;
  onUpdateSlot: (patch: Partial<PutawayLineSlot>) => void;
  onResolveBin: (pathOverride?: string) => void;
  onClear?: () => void;
}) {
  const ctx = { areas: warehouseAreas, bins: warehouseBins };
  const ready = isPutawayLineSlotReady(line, slot, ctx);
  const putQty = parsePutawayQty(line, slot);

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
            ) : line.condition === "good" ? (
              <Badge variant="outline" className="ml-2 bg-emerald-50 border-emerald-300 text-emerald-800">
                Good
              </Badge>
            ) : null}
            {line.lot ? (
              <span className="text-xs text-muted-foreground ml-2">Lot {line.lot}</span>
            ) : null}
            {line.quantity > 1 && putQty < line.quantity ? (
              <span className="text-xs text-blue-700 ml-2">
                Putting {putQty} now
              </span>
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
          occupiedBinIds={occupiedBinIds}
          occupancyLoading={occupancyLoading}
          areasLoading={areasLoading}
          onBinPathChange={(value) =>
            onUpdateSlot({ binPath: value, resolved: null, error: null })
          }
          onResolveBin={onResolveBin}
          onAreaChange={(areaCode) => onUpdateSlot({ areaCode, resolved: null, error: null })}
          onPutawayQtyChange={(value) => onUpdateSlot({ putawayQty: value })}
        />
      </CardContent>
    </Card>
  );
}
