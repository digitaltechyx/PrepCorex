"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

export type OutboundLotOption = {
  expiry: string;
  quantity: number;
  lot?: string | null;
};

export type OutboundLotAllocationValue = {
  expiry: string;
  quantity: number;
  lot?: string | null;
};

function formatLotExpiry(expiry: string): string {
  const iso = String(expiry || "").trim();
  if (!iso) return "—";
  try {
    return format(parseISO(iso.length === 10 ? `${iso}T12:00:00` : iso), "MMM d, yyyy");
  } catch {
    return iso;
  }
}

type Props = {
  lots: OutboundLotOption[];
  /** Units required for this line (boxes × packOf on the parent line). */
  requiredUnits: number;
  value: OutboundLotAllocationValue[];
  onChange: (next: OutboundLotAllocationValue[]) => void;
  /** When lot qty changes, parent can sync line qty to the total units. */
  onTotalsChange?: (totals: { totalUnits: number; suggestedBoxes: number; suggestedPackOf: number }) => void;
  className?: string;
};

/**
 * Per-lot unit qty for outbound “Choose lots”.
 * Line-level Pack stays on the shipment row — not per lot.
 */
export function OutboundLotAllocationFields({
  lots,
  requiredUnits,
  value,
  onChange,
  onTotalsChange,
  className,
}: Props) {
  const byExpiry = new Map(
    value.map((row) => [
      String(row.expiry).trim(),
      Math.max(0, Math.floor(Number(row.quantity) || 0)),
    ])
  );

  const emit = (next: OutboundLotAllocationValue[]) => {
    const normalized = next
      .map((row) => ({
        expiry: String(row.expiry || "").trim(),
        quantity: Math.max(0, Math.floor(Number(row.quantity) || 0)),
        lot: row.lot ?? null,
      }))
      .filter((row) => row.expiry && row.quantity > 0);

    onChange(normalized);
    const totalUnits = normalized.reduce((sum, row) => sum + row.quantity, 0);
    onTotalsChange?.({
      totalUnits,
      suggestedBoxes: totalUnits,
      suggestedPackOf: 1,
    });
  };

  const setLotQty = (expiry: string, raw: string, lot?: string | null) => {
    const max = lots.find((l) => l.expiry === expiry)?.quantity ?? 0;
    const nextQty = Math.max(0, Math.min(max, Math.floor(Number(raw) || 0)));
    const without = value.filter((row) => String(row.expiry).trim() !== expiry);
    if (nextQty <= 0) {
      emit(without);
      return;
    }
    emit([...without, { expiry, quantity: nextQty, lot: lot ?? null }]);
  };

  const allocated = Array.from(byExpiry.values()).reduce((sum, n) => sum + n, 0);
  const remaining = requiredUnits - allocated;
  const ok = requiredUnits > 0 && remaining === 0;

  if (lots.length === 0) {
    return (
      <p className={cn("text-[10px] text-muted-foreground", className)}>
        No expiry lots on file for this product.
      </p>
    );
  }

  return (
    <div className={cn("space-y-1.5 rounded-md border bg-muted/20 p-1.5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-1 text-[10px]">
        <span className="font-medium text-foreground">Units per lot</span>
        <span className={cn("tabular-nums", ok ? "text-emerald-700" : "text-amber-700")}>
          Total {allocated} units
          {requiredUnits > 0
            ? ok
              ? ` · matches line`
              : ` · line needs ${requiredUnits}`
            : ""}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_64px] gap-1 px-0.5 text-[9px] font-medium text-muted-foreground">
        <div>Lot</div>
        <div>Qty</div>
      </div>
      <div className="space-y-1">
        {lots.map((lot) => {
          const current = byExpiry.get(lot.expiry) ?? 0;
          return (
            <div
              key={lot.expiry}
              className="grid grid-cols-[1fr_64px] items-center gap-1 text-[10px]"
            >
              <div className="min-w-0 leading-snug">
                <div className="truncate font-medium">{formatLotExpiry(lot.expiry)}</div>
                <div className="text-muted-foreground">{lot.quantity} avail</div>
              </div>
              <Input
                type="number"
                min={0}
                max={lot.quantity}
                className="h-7 px-1.5 text-[11px]"
                value={current || ""}
                placeholder="0"
                onChange={(e) => setLotQty(lot.expiry, e.target.value, lot.lot)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
