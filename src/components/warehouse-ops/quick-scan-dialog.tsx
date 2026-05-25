"use client";

import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  lookupProductByCode,
  type ProductMatch,
} from "@/lib/warehouse-product-lookup";
import { Loader2, ScanLine, Trash2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

export type QuickScanLine = {
  sku: string;
  productTitle: string;
  goodQty: string;
  damagedQty: string;
  lot: string;
  expiry: string;
};

type ScanEvent = {
  id: string;
  sku: string;
  productName: string | null;
  qty: number;
  damaged: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Receives a list of finalized lines to append/replace into a carton. */
  onApply: (lines: QuickScanLine[]) => void;
  title?: string;
};

export function QuickScanDialog({ open, onOpenChange, onApply, title }: Props) {
  const { toast } = useToast();
  const [scanValue, setScanValue] = useState("");
  const [resolving, setResolving] = useState(false);
  const [damaged, setDamaged] = useState(false);
  const [events, setEvents] = useState<ScanEvent[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setScanValue("");
      setEvents([]);
      setDamaged(false);
    } else {
      const t = setTimeout(() => inputRef.current?.focus(), 100);
      return () => clearTimeout(t);
    }
  }, [open]);

  async function handleScan() {
    const v = scanValue.trim();
    if (!v) return;
    setResolving(true);
    try {
      const matches = await lookupProductByCode(v);
      const best: ProductMatch | undefined = matches[0];
      const skuToUse = best?.sku || v;
      const titleToUse = best?.productName ?? null;

      setEvents((prev) => {
        const same = prev.find(
          (e) =>
            e.sku.toUpperCase() === skuToUse.toUpperCase() && e.damaged === damaged
        );
        if (same) {
          return prev.map((e) =>
            e === same ? { ...e, qty: e.qty + 1 } : e
          );
        }
        return [
          ...prev,
          {
            id: `s_${Math.random().toString(36).slice(2, 9)}`,
            sku: skuToUse,
            productName: titleToUse,
            qty: 1,
            damaged,
          },
        ];
      });

      setScanValue("");
      inputRef.current?.focus();
    } catch (e) {
      toast({
        title: "Scan failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  }

  function adjustQty(id: string, delta: number) {
    setEvents((prev) =>
      prev
        .map((e) => (e.id === id ? { ...e, qty: e.qty + delta } : e))
        .filter((e) => e.qty > 0)
    );
  }

  function removeEvent(id: string) {
    setEvents((prev) => prev.filter((e) => e.id !== id));
  }

  function handleApply() {
    if (events.length === 0) {
      onOpenChange(false);
      return;
    }
    // Merge events into QuickScanLine shape: one line per (SKU, condition).
    const lines: QuickScanLine[] = events.map((e) => ({
      sku: e.sku,
      productTitle: e.productName ?? "",
      goodQty: e.damaged ? "0" : String(e.qty),
      damagedQty: e.damaged ? String(e.qty) : "0",
      lot: "",
      expiry: "",
    }));
    onApply(lines);
    onOpenChange(false);
  }

  const totalUnits = events.reduce((s, e) => s + e.qty, 0);
  const totalDamaged = events.filter((e) => e.damaged).reduce((s, e) => s + e.qty, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            {title ?? "Quick scan items"}
          </DialogTitle>
          <DialogDescription>
            Scan each item — repeat scans bump quantity. Toggle “Damaged” before scanning to
            log damaged units. Hit Apply to add all lines to this carton.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between rounded border p-2">
            <div className="flex items-center gap-2 text-sm">
              <AlertTriangle
                className={cn("h-4 w-4", damaged ? "text-red-600" : "text-muted-foreground")}
              />
              Next scan is damaged
            </div>
            <Switch checked={damaged} onCheckedChange={setDamaged} />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Scan</Label>
            <div className="flex gap-2">
              <Input
                ref={inputRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleScan();
                }}
                placeholder="Aim scanner here…"
                autoFocus
              />
              <Button
                type="button"
                onClick={() => void handleScan()}
                disabled={resolving || !scanValue.trim()}
              >
                {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Each scan looks up your client catalog by UPC/SKU. Unknown codes are kept as-is.
            </p>
          </div>

          <div className="space-y-2 max-h-[260px] overflow-y-auto">
            {events.length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">No scans yet.</p>
            ) : (
              events.map((e) => (
                <div
                  key={e.id}
                  className={cn(
                    "rounded border px-2 py-2 flex items-center gap-2",
                    e.damaged && "border-red-200 bg-red-50/40"
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold truncate">{e.sku}</span>
                      {e.damaged ? (
                        <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                          DMG
                        </Badge>
                      ) : null}
                    </div>
                    {e.productName ? (
                      <p className="text-xs text-muted-foreground truncate">{e.productName}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => adjustQty(e.id, -1)}
                    >
                      −
                    </Button>
                    <span className="font-mono text-sm w-7 text-center tabular-nums">{e.qty}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => adjustQty(e.id, +1)}
                    >
                      +
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeEvent(e.id)}
                    >
                      <Trash2 className="h-3 w-3 text-red-600" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2">
          <div className="text-xs text-muted-foreground">
            {totalUnits} unit{totalUnits === 1 ? "" : "s"}
            {totalDamaged > 0 ? ` · ${totalDamaged} damaged` : ""}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleApply} disabled={events.length === 0}>
              Apply to carton
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
