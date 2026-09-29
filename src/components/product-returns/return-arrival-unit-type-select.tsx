"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatReturnArrivalUnitType } from "@/lib/product-return-arrivals";
import type { ReturnArrivalUnitType } from "@/types";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  value: ReturnArrivalUnitType;
  onChange: (unitType: ReturnArrivalUnitType) => void;
  disabled?: boolean;
  saving?: boolean;
  className?: string;
};

/** Compact unit-type picker for correcting mistaken package/carton/pallet. */
export function ReturnArrivalUnitTypeSelect({
  value,
  onChange,
  disabled,
  saving,
  className,
}: Props) {
  return (
    <Select
      value={value}
      disabled={disabled || saving}
      onValueChange={(v) => onChange(v as ReturnArrivalUnitType)}
    >
      <SelectTrigger
        className={cn(
          "h-7 w-auto min-w-[7.5rem] gap-1 border-dashed px-2 text-xs font-medium",
          className
        )}
        title="Change unit type"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
        ) : null}
        <SelectValue>{formatReturnArrivalUnitType(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="carton">Carton</SelectItem>
        <SelectItem value="pallet">Pallet</SelectItem>
        <SelectItem value="package">Package</SelectItem>
      </SelectContent>
    </Select>
  );
}
