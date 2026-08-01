"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export type UnitWeightUnit = "lb" | "oz";

export type ProductUnitMeasurementDraft = {
  unitLengthIn: string;
  unitWidthIn: string;
  unitHeightIn: string;
  /** Numeric string in the currently selected `weightUnit` (converted to lb on save). */
  unitWeightLb: string;
  weightUnit: UnitWeightUnit;
};

export const EMPTY_UNIT_MEASUREMENTS: ProductUnitMeasurementDraft = {
  unitLengthIn: "",
  unitWidthIn: "",
  unitHeightIn: "",
  unitWeightLb: "",
  weightUnit: "lb",
};

function trimNum(n: number): string {
  if (!Number.isFinite(n)) return "";
  const rounded = Math.round(n * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

/** Load stored lb weight into the draft (defaults to lb unit). */
export function draftFromMeasurementSource(
  source: Record<string, unknown> | null | undefined
): ProductUnitMeasurementDraft {
  const str = (v: unknown) => (v == null || v === "" ? "" : String(v));
  return {
    unitLengthIn: str(source?.unitLengthIn),
    unitWidthIn: str(source?.unitWidthIn),
    unitHeightIn: str(source?.unitHeightIn),
    unitWeightLb: str(source?.unitWeightLb),
    weightUnit: "lb",
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
  const weightUnit: UnitWeightUnit = value.weightUnit === "oz" ? "oz" : "lb";

  const set = (key: keyof ProductUnitMeasurementDraft, raw: string) => {
    onChange({ ...value, weightUnit, [key]: raw });
  };

  const setWeightUnit = (next: UnitWeightUnit) => {
    if (next === weightUnit) return;
    const n = Number(String(value.unitWeightLb ?? "").trim());
    if (!Number.isFinite(n) || n <= 0 || String(value.unitWeightLb ?? "").trim() === "") {
      onChange({ ...value, weightUnit: next });
      return;
    }
    // Convert the displayed number when switching units
    const asLb = weightUnit === "oz" ? n / 16 : n;
    const display = next === "oz" ? asLb * 16 : asLb;
    onChange({
      ...value,
      weightUnit: next,
      unitWeightLb: trimNum(display),
    });
  };

  return (
    <div className={cn("space-y-2", className)}>
      <div>
        <Label className={cn(compact ? "text-xs text-muted-foreground" : "text-sm font-medium")}>
          Unit dimensions & weight (optional)
        </Label>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Per sellable unit (inches). Weight can be entered in lb or oz — saved as pounds for box
          suggestions and Buy Labels. Leave blank if unknown.
        </p>
      </div>
      <div
        className={cn(
          "grid gap-2",
          compact ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-2 sm:grid-cols-4"
        )}
      >
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
            Weight
          </Label>
          <div className="flex gap-1">
            <Input
              id={`${idPrefix}-wt`}
              type="number"
              min={0}
              step={weightUnit === "oz" ? "0.001" : "0.01"}
              inputMode="decimal"
              placeholder={weightUnit === "oz" ? "oz" : "lb"}
              value={value.unitWeightLb}
              onChange={(e) => set("unitWeightLb", e.target.value)}
              className={cn("min-w-0 flex-1", compact ? "h-9" : "h-11 rounded-lg")}
            />
            <Select value={weightUnit} onValueChange={(v) => setWeightUnit(v as UnitWeightUnit)}>
              <SelectTrigger
                className={cn("w-[4.5rem] shrink-0", compact ? "h-9" : "h-11 rounded-lg")}
                aria-label="Weight unit"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="lb">lb</SelectItem>
                <SelectItem value="oz">oz</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}
