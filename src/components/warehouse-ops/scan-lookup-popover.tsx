"use client";

import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScanLine, Loader2, Search } from "lucide-react";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import {
  lookupProductByCode,
  type ProductMatch,
} from "@/lib/warehouse-product-lookup";
import type { UserProfile } from "@/types";

type Props = {
  /** Called when the user picks a match. */
  onPick: (match: ProductMatch) => void;
  /** Called with the raw scanned/typed value when the user confirms with no lookup match. */
  onAcceptRaw?: (raw: string) => void;
  /** Optional initial value of the scan box. */
  initialQuery?: string;
};

const REASON_LABEL: Record<ProductMatch["matchReason"], string> = {
  sku_exact: "SKU match",
  upc_exact: "UPC match",
  sku_contains: "SKU contains",
  name_contains: "Name match",
};

export function ScanLookupPopover({ onPick, onAcceptRaw, initialQuery = "" }: Props) {
  const { toast } = useToast();
  const { data: users } = useCollection<UserProfile>("users");
  const userById = new Map(users.map((u) => [u.uid, u]));

  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initialQuery);
  const [matches, setMatches] = useState<ProductMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 100);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = q.trim();
    if (!trimmed) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await lookupProductByCode(trimmed);
        if (!cancelled) setMatches(r);
      } catch (e) {
        if (!cancelled) {
          toast({
            title: "Lookup failed",
            description: e instanceof Error ? e.message : "Unknown error",
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q, open, toast]);

  function handlePick(m: ProductMatch) {
    onPick(m);
    setOpen(false);
    setQ("");
    setMatches([]);
  }

  function handleAcceptRaw() {
    const v = q.trim();
    if (!v || !onAcceptRaw) return;
    onAcceptRaw(v);
    setOpen(false);
    setQ("");
    setMatches([]);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-9 w-9 shrink-0"
          title="Scan UPC / SKU"
        >
          <ScanLine className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-3">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Scan or type UPC / SKU</p>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    if (matches[0]) handlePick(matches[0]);
                    else handleAcceptRaw();
                  }
                }}
                placeholder="Type or use camera"
                className="pl-7"
              />
            </div>
            <ScanCameraButton
              onScan={(text) => setQ(text)}
              scannerTitle="Scan product barcode"
              scannerDescription="Point at the UPC/EAN on the product or box."
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto -mx-3 px-3">
            {loading ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Searching…
              </div>
            ) : q.trim() && matches.length === 0 ? (
              <div className="space-y-2 py-2">
                <p className="text-xs text-muted-foreground">
                  No match in any client catalog.
                </p>
                {onAcceptRaw ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="w-full"
                    onClick={handleAcceptRaw}
                  >
                    Use “{q.trim()}” as the SKU anyway
                  </Button>
                ) : null}
              </div>
            ) : matches.length > 0 ? (
              <div className="space-y-1">
                {matches.map((m) => {
                  const owner = userById.get(m.clientUserId);
                  const ownerName = owner?.name || owner?.email || m.clientUserId.slice(0, 8);
                  return (
                    <button
                      key={`${m.clientUserId}:${m.productId}`}
                      type="button"
                      onClick={() => handlePick(m)}
                      className="w-full text-left rounded-md border px-2 py-2 hover:bg-muted/50 transition-colors space-y-1"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold truncate">
                          {m.sku || "(no SKU)"}
                        </span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {REASON_LABEL[m.matchReason]}
                        </Badge>
                      </div>
                      <p className="text-xs truncate">{m.productName}</p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {ownerName}
                        {m.retailIdentifier ? ` · UPC ${m.retailIdentifier}` : ""}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">
                Scan a barcode or type a SKU/UPC to search.
              </p>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
