"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/types";

export function formatRestockProductLabel(product: InventoryItem): string {
  const sku = product.sku ? ` (SKU: ${product.sku})` : "";
  return `${product.productName}${sku} - Qty: ${product.quantity}`;
}

type Props = {
  products: InventoryItem[];
  value: string;
  onSelect: (product: InventoryItem) => void;
  disabled?: boolean;
  placeholder?: string;
  emptyLabel?: string;
};

export function RestockProductCombobox({
  products,
  value,
  onSelect,
  disabled,
  placeholder = "Select a product to restock",
  emptyLabel = "No products available for restock",
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = useMemo(
    () => products.find((p) => p.id === value) ?? null,
    [products, value]
  );

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => {
      const name = (p.productName ?? "").toLowerCase();
      const sku = (p.sku ?? "").toLowerCase();
      const id = (p.id ?? "").toLowerCase();
      return name.includes(q) || sku.includes(q) || id.includes(q);
    });
  }, [products, query]);

  function pick(product: InventoryItem) {
    onSelect(product);
    setOpen(false);
    setQuery("");
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
            "h-11 w-full justify-between rounded-lg font-normal",
            !selected && "text-muted-foreground"
          )}
        >
          <span className="truncate text-left">
            {selected ? formatRestockProductLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="flex items-center border-b px-3">
          <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (filtered.length === 1) pick(filtered[0]!);
            }}
            placeholder="Search by name or SKU…"
            className="h-10 border-0 shadow-none focus-visible:ring-0"
            autoFocus
          />
        </div>
        <div
          className="max-h-[280px] overflow-y-auto overscroll-contain p-1"
          role="listbox"
        >
          {products.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">{emptyLabel}</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No matching products.</p>
          ) : (
            filtered.map((product) => (
              <button
                key={product.id}
                type="button"
                role="option"
                aria-selected={value === product.id}
                className={cn(
                  "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm",
                  "cursor-pointer touch-manipulation",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                )}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  pick(product);
                }}
              >
                <Check
                  className={cn(
                    "h-4 w-4 shrink-0",
                    value === product.id ? "opacity-100" : "opacity-0"
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {formatRestockProductLabel(product)}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
