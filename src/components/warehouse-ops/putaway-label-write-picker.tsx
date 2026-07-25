"use client";

import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { PutawayQueueLabel } from "@/lib/warehouse-putaway-queue";
import { cn } from "@/lib/utils";

type Props = {
  labels: PutawayQueueLabel[];
  value: string;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  onChange: (code: string) => void;
  onSelect: (label: PutawayQueueLabel) => void;
  onSubmitTyped?: () => void;
};

export function PutawayLabelWritePicker({
  labels,
  value,
  loading = false,
  disabled,
  placeholder = "Search or select label…",
  onChange,
  onSelect,
  onSubmitTyped,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);

  useEffect(() => {
    setQuery(value);
  }, [value]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return labels;
    return labels.filter((l) => {
      return (
        l.code.toLowerCase().includes(q) ||
        l.badge.toLowerCase().includes(q) ||
        l.subtitle.toLowerCase().includes(q)
      );
    });
  }, [labels, query]);

  function pick(label: PutawayQueueLabel) {
    onChange(label.code);
    setQuery(label.code);
    setOpen(false);
    onSelect(label);
  }

  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (filtered.length === 1) {
      pick(filtered[0]);
      return;
    }
    const exact = labels.find((l) => l.code.toLowerCase() === query.trim().toLowerCase());
    if (exact) {
      pick(exact);
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
        className="w-[var(--radix-popover-trigger-width)] min-w-[300px] p-0"
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
            placeholder="Type CTN / PKG / PAL…"
            className="h-8 border-0 shadow-none focus-visible:ring-0 font-mono px-0"
            autoFocus
          />
        </div>
        <div className="max-h-72 overflow-y-auto p-1">
          {loading ? (
            <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading putaway labels…
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">
              {labels.length === 0
                ? "No labels awaiting putaway."
                : "No matching labels."}
            </p>
          ) : (
            filtered.map((label) => {
              const selected = value.trim().toLowerCase() === label.code.toLowerCase();
              return (
                <button
                  key={`${label.kind}-${label.id}`}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected && "bg-accent/60"
                  )}
                  onClick={() => pick(label)}
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs font-semibold">{label.code}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] px-1.5 py-0 font-medium",
                          label.kind === "pallet"
                            ? "bg-indigo-50 border-indigo-300 text-indigo-900"
                            : label.badge === "Package"
                              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                              : "bg-orange-50 border-orange-300 text-orange-900"
                        )}
                      >
                        {label.badge}
                      </Badge>
                    </div>
                    {label.subtitle ? (
                      <p className="text-[11px] text-muted-foreground truncate">
                        {label.subtitle}
                      </p>
                    ) : null}
                  </div>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-primary mt-0.5" /> : null}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
