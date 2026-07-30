"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ProductUnitMeasurementDraft = {
  unitLengthIn: string;
  unitWidthIn: string;
  unitHeightIn: string;
  unitWeightLb: string;
};

export const EMPTY_UNIT_MEASUREMENTS: ProductUnitMeasurementDraft = {
  unitLengthIn: "",
  unitWidthIn: "",
  unitHeightIn: "",
  unitWeightLb: "",
};

export function draftFromMeasurementSource(
  source: Record<string, unknown> | null | undefined
): ProductUnitMeasurementDraft {
  const str = (v: unknown) =>
    v == null || v === "" ? "" : String(v);
  return {
    unitLengthIn: str(source?.unitLengthIn),
    unitWidthIn: str(source?.unitWidthIn),
    unitHeightIn: str(source?.unitHeightIn),
    unitWeightLb: str(source?.unitWeightLb),
  };
}

type Props = {
  value: ProductUnitMeasurementDraft;
  onChange: (next: ProductUnitMeasurementDraft) => void;
  className?: string;
  compact?: boolean;
  idPrefix?: string;
};

export function ProductUnitMeasurementsFields({
  value,
  onChange,
  className,
  compact,
  idPrefix = "unit-m",
}: Props) {
  const set = (key: keyof ProductUnitMeasurementDraft, raw: string) => {
    onChange({ ...value, [key]: raw });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div>
        <Label className={cn(compact ? "text-xs text-muted-foreground" : "text-sm font-medium")}>
          Unit dimensions & weight (optional)
        </Label>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Per sellable unit (inches / lb). Used for box suggestions on outbound — leave blank if unknown.
        </p>
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-l`} className="text-xs text-muted-foreground">
            Length (in)
          </Label>
          <Input
            id={`${idPrefix}-l`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="L"
            value={value.unitLengthIn}
            onChange={(e) => set("unitLengthIn", e.target.value)}
            className={compact ? "h-9" : "h-11 rounded-lg"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-w`} className="text-xs text-muted-foreground">
            Width (in)
          </Label>
          <Input
            id={`${idPrefix}-w`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="W"
            value={value.unitWidthIn}
            onChange={(e) => set("unitWidthIn", e.target.value)}
            className={compact ? "h-9" : "h-11 rounded-lg"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-h`} className="text-xs text-muted-foreground">
            Height (in)
          </Label>
          <Input
            id={`${idPrefix}-h`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="H"
            value={value.unitHeightIn}
            onChange={(e) => set("unitHeightIn", e.target.value)}
            className={compact ? "h-9" : "h-11 rounded-lg"}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${idPrefix}-wt`} className="text-xs text-muted-foreground">
            Weight (lb)
          </Label>
          <Input
            id={`${idPrefix}-wt`}
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="lb"
            value={value.unitWeightLb}
            onChange={(e) => set("unitWeightLb", e.target.value)}
            className={compact ? "h-9" : "h-11 rounded-lg"}
          />
        </div>
      </div>
    </div>
  );
}
