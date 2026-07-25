"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  buildMaxLevelByBay,
  getBinLevelAccentHex,
} from "@/lib/warehouse-bin-level-color";
import { cn } from "@/lib/utils";
import type { WarehouseBinDoc } from "@/types";

type Props = {
  bins: WarehouseBinDoc[];
  value: string;
  occupiedBinIds?: ReadonlySet<string>;
  occupancyLoading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onChange: (path: string) => void;
  onSelect: (bin: WarehouseBinDoc) => void;
  onSubmitTyped?: () => void;
};

export function PutawayBinWritePicker({
  bins,
  value,
  occupiedBinIds,
  occupancyLoading = false,
  disabled,
  placeholder = "Search or select bin…",
  onChange,
  onSelect,
  onSubmitTyped,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const maxLevelByBay = useMemo(() => buildMaxLevelByBay(bins), [bins]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bins;
    return bins.filter((b) => {
      const path = b.path.toLowerCase();
      const code = (b.binCode ?? "").toLowerCase();
      const barcode = (b.barcode ?? "").toLowerCase();
      const area = (b.area ?? "").toLowerCase();
      return (
        path.includes(q) ||
        code.includes(q) ||
        barcode.includes(q) ||
        area.includes(q)
      );
    });
  }, [bins, query]);

  function pickBin(bin: WarehouseBinDoc) {
    onChange(bin.path);
    setQuery(bin.path);
    setOpen(false);
    onSelect(bin);
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (filtered.length === 1) {
      pickBin(filtered[0]);
      return;
    }
    const exact = bins.find(
      (b) =>
        b.path.toLowerCase() === query.trim().toLowerCase() ||
        b.barcode.toLowerCase() === query.trim().toLowerCase()
    );
    if (exact) {
      pickBin(exact);
      return;
    }
    onChange(query.trim());
    onSubmitTyped?.();
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal h-10 px-3",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate font-mono text-sm text-left">
            {value || placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
        align="start"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              onChange(e.target.value);
            }}
            onKeyDown={handleSearchKeyDown}
            placeholder="Type path or search…"
            className="h-8 border-0 shadow-none focus-visible:ring-0 font-mono px-0"
            autoFocus
          />
        </div>
        <div className="max-h-64 overflow-y-auto p-1">
          {occupancyLoading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading bin status…
            </div>
          ) : null}
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No matching bins.</p>
          ) : (
            filtered.map((bin) => {
              const accent = getBinLevelAccentHex(bin, maxLevelByBay);
              const occupied = occupiedBinIds?.has(bin.id) ?? false;
              const selected =
                value.trim().toLowerCase() === bin.path.toLowerCase() ||
                value.trim().toLowerCase() === bin.barcode.toLowerCase();
              return (
                <button
                  key={bin.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "bg-accent/60"
                  )}
                  onClick={() => pickBin(bin)}
                >
                  <span
                    className="h-3.5 w-3.5 shrink-0 rounded-sm border border-black/10"
                    style={{ backgroundColor: accent }}
                    title={`Level ${bin.level} accent`}
                    aria-hidden
                  />
                  <span className="font-mono text-xs flex-1 truncate">{bin.path}</span>
                  {occupiedBinIds ? (
                    <Badge
                      variant="outline"
                      className={cn(
                        "shrink-0 text-[10px] px-1.5 py-0 font-medium",
                        occupied
                          ? "bg-amber-50 border-amber-300 text-amber-900"
                          : "bg-emerald-50 border-emerald-300 text-emerald-900"
                      )}
                    >
                      {occupied ? "Occupied" : "Available"}
                    </Badge>
                  ) : null}
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary" /> : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
