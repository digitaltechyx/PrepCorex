"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, X } from "lucide-react";
import {
  mergePurposeOptions,
  normalizePurposeLabel,
  purposeKey,
} from "@/lib/warehouse-area-purposes";

type Props = {
  selected: string[];
  onChange: (next: string[]) => void;
  warehouseCustomPurposes?: string[];
  /** Other areas' purposes — keeps labels available in the list. */
  otherAreaPurposeLists?: string[][];
  onAddCustomToWarehouse?: (label: string) => Promise<void>;
  disabled?: boolean;
};

export function WarehouseAreaPurposesField({
  selected,
  onChange,
  warehouseCustomPurposes,
  otherAreaPurposeLists = [],
  onAddCustomToWarehouse,
  disabled,
}: Props) {
  const [customInput, setCustomInput] = useState("");

  const options = useMemo(
    () => mergePurposeOptions(warehouseCustomPurposes, [selected, ...otherAreaPurposeLists]),
    [warehouseCustomPurposes, otherAreaPurposeLists, selected]
  );

  const selectedKeys = useMemo(() => new Set(selected.map(purposeKey)), [selected]);

  const toggle = (label: string) => {
    const n = normalizePurposeLabel(label);
    if (!n) return;
    const k = purposeKey(n);
    if (selectedKeys.has(k)) {
      onChange(selected.filter((p) => purposeKey(p) !== k));
    } else {
      onChange([...selected, n]);
    }
  };

  const addCustom = async () => {
    const n = normalizePurposeLabel(customInput);
    if (!n) return;
    const k = purposeKey(n);
    if (!selectedKeys.has(k)) {
      onChange([...selected, n]);
    }
    if (onAddCustomToWarehouse) {
      await onAddCustomToWarehouse(n);
    }
    setCustomInput("");
  };

  return (
    <div className="space-y-3">
      <div>
        <Label>Purposes (what happens in this area)</Label>
        <p className="text-xs text-muted-foreground mt-1">
          Select any combination — e.g. Receiving + Packing in the same zone. Add your own labels below.
        </p>
      </div>

      {selected.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((p) => (
            <Badge key={purposeKey(p)} variant="secondary" className="gap-1 pr-1">
              {p}
              <button
                type="button"
                className="rounded-full hover:bg-muted p-0.5"
                disabled={disabled}
                onClick={() => toggle(p)}
                aria-label={`Remove ${p}`}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      <div className="rounded-md border p-3 max-h-48 overflow-y-auto space-y-2">
        {options.map((opt) => {
          const checked = selectedKeys.has(purposeKey(opt));
          return (
            <label key={purposeKey(opt)} className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => toggle(opt)} />
              <span>{opt}</span>
            </label>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <div className="flex-1 space-y-1">
          <Label className="text-xs text-muted-foreground">Add custom purpose</Label>
          <Input
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            placeholder="e.g. Staging, Overflow, Temp QC"
            disabled={disabled}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void addCustom();
              }
            }}
          />
        </div>
        <Button type="button" variant="secondary" disabled={disabled || !customInput.trim()} onClick={() => void addCustom()}>
          <Plus className="h-4 w-4 mr-1" />
          Add
        </Button>
      </div>
    </div>
  );
}
