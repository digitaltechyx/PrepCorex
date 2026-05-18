"use client";

import { useEffect, useMemo, useState } from "react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2 } from "lucide-react";
import type { WarehouseBinDoc } from "@/types";
import {
  buildBayCodes,
  buildBaysPerRowFromCounts,
  buildLevelCodes,
  countBinSlotsInDetailedRack,
} from "@/lib/warehouse-storage-layout";
import { inferRowRackLayoutFromBins } from "@/lib/warehouse-row-rack";

export type RowRackSavePayload = {
  rowCode: string;
  baysByRow: string[][];
  levelsPerBay: number[][];
  binsPerLevel: number[][][];
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rowCode: string;
  areaCode: string;
  warehouseCode: string;
  bins: WarehouseBinDoc[];
  saving: boolean;
  /** True when refilling an empty gap row (no bins yet). */
  isRefill?: boolean;
  onSave: (payload: RowRackSavePayload) => void | Promise<void>;
};

export function WarehouseRowEditDialog({
  open,
  onOpenChange,
  rowCode,
  areaCode,
  warehouseCode,
  bins,
  saving,
  isRefill,
  onSave,
}: Props) {
  const [bayCountStr, setBayCountStr] = useState("1");
  const [levelsPerBay, setLevelsPerBay] = useState<number[][]>([[]]);
  const [binsPerLevel, setBinsPerLevel] = useState<number[][][]>([[]]);

  useEffect(() => {
    if (!open) return;
    const inferred = inferRowRackLayoutFromBins(bins, areaCode, rowCode);
    setBayCountStr(String(inferred.bayCodes.length));
    setLevelsPerBay([inferred.levelsPerBay]);
    setBinsPerLevel([inferred.binsPerLevel]);
  }, [open, bins, areaCode, rowCode]);

  const layout = useMemo(() => {
    try {
      const bayCount = Number.parseInt(bayCountStr, 10);
      if (!Number.isFinite(bayCount) || bayCount < 1 || bayCount > 99) return null;
      const rowCodes = [rowCode];
      const baysByRow = buildBaysPerRowFromCounts(rowCodes, [bayCount]);
      if (levelsPerBay[0]?.length !== bayCount || binsPerLevel[0]?.length !== bayCount) return null;
      for (let bi = 0; bi < bayCount; bi++) {
        const L = levelsPerBay[0][bi];
        if (!Number.isFinite(L) || L < 1 || L > 99) return null;
        if (binsPerLevel[0][bi]?.length !== L) return null;
        for (let li = 0; li < L; li++) {
          const c = binsPerLevel[0][bi][li];
          if (!Number.isFinite(c) || c < 1 || c > 999) return null;
        }
      }
      const estimated = countBinSlotsInDetailedRack(baysByRow, levelsPerBay, binsPerLevel);
      return { baysByRow, estimated };
    } catch {
      return null;
    }
  }, [bayCountStr, levelsPerBay, binsPerLevel, rowCode]);

  const bayCount = useMemo(() => {
    const n = Number.parseInt(bayCountStr, 10);
    return Number.isFinite(n) && n >= 1 && n <= 99 ? n : null;
  }, [bayCountStr]);

  /** UI always shows every bay from the count — not gated on layout validation. */
  const bayCodes = useMemo(() => buildBayCodes(bayCount ?? 1), [bayCount]);

  const estimatedBins = useMemo(() => {
    if (layout) return layout.estimated;
    const n = bayCount ?? 1;
    let total = 0;
    for (let bi = 0; bi < n; bi++) {
      const L = levelsPerBay[0]?.[bi];
      const levelCount = Number.isFinite(L) && L >= 1 ? L : 0;
      for (let li = 0; li < levelCount; li++) {
        const c = binsPerLevel[0]?.[bi]?.[li];
        if (Number.isFinite(c) && c >= 1) total += c;
      }
    }
    return total;
  }, [layout, bayCount, levelsPerBay, binsPerLevel]);

  const patchBayCount = (count: number) => {
    setLevelsPerBay([
      buildBayCodes(count).map((_, bi) => {
        const v = levelsPerBay[0]?.[bi];
        return Number.isFinite(v) && v >= 1 ? v : 4;
      }),
    ]);
    setBinsPerLevel([
      buildBayCodes(count).map((_, bi) => {
        const L = levelsPerBay[0]?.[bi] ?? 4;
        const levelCount = Number.isFinite(L) && L >= 1 ? L : 4;
        const prev = binsPerLevel[0]?.[bi];
        return Array.from({ length: levelCount }, (_, li) => {
          const v = prev?.[li];
          return Number.isFinite(v) && v >= 1 ? v : 3;
        });
      }),
    ]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {isRefill ? "Refill row" : "Edit row"} {rowCode}
          </DialogTitle>
          <DialogDescription>
            Set bays, levels per bay, and bin slots per level for this row. Saving replaces all bins on row{" "}
            <span className="font-mono">{rowCode}</span> in area <span className="font-mono">{areaCode}</span> (
            paths like <span className="font-mono">{warehouseCode}-{areaCode}-{rowCode}-…</span>).
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 min-h-0 max-h-[55vh] pr-3">
          <div className="space-y-4 py-1">
            <div className="flex items-end gap-3">
              <div className="space-y-2">
                <Label>Bays in this row</Label>
                <Input
                  inputMode="numeric"
                  className="w-24"
                  value={bayCountStr}
                  onChange={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    setBayCountStr(e.target.value);
                    if (Number.isFinite(v) && v >= 1 && v <= 99) {
                      patchBayCount(v);
                    }
                  }}
                />
              </div>
              {estimatedBins > 0 ? (
                <p className="text-xs text-muted-foreground pb-2">
                  About <strong>{estimatedBins.toLocaleString()}</strong> bin paths on this row.
                  {!layout ? " — complete all bay, level, and bin fields to save." : null}
                </p>
              ) : null}
            </div>

            {bayCodes.map((bayCode, bi) => (
              <div key={bayCode} className="rounded-lg border p-3 space-y-3">
                <p className="text-sm font-mono font-medium">
                  Row {rowCode} — Bay {bayCode}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Levels in this bay</Label>
                    <Input
                      inputMode="numeric"
                      className="w-24"
                      value={
                        levelsPerBay[0]?.[bi] != null && levelsPerBay[0][bi] >= 1
                          ? String(levelsPerBay[0][bi])
                          : ""
                      }
                      onChange={(e) => {
                        const v = Number.parseInt(e.target.value, 10);
                        setLevelsPerBay((prev) => {
                          const next = prev.map((row) => [...row]);
                          if (!next[0]) next[0] = [];
                          while (next[0].length < bayCodes.length) next[0].push(4);
                          next[0][bi] = Number.isFinite(v) ? v : 0;
                          return next;
                        });
                        if (Number.isFinite(v) && v >= 1 && v <= 99) {
                          setBinsPerLevel((prev) => {
                            const next = prev.map((row) => row.map((bay) => [...bay]));
                            if (!next[0]) next[0] = [];
                            while (next[0].length < bayCodes.length) {
                              next[0].push(Array.from({ length: 4 }, () => 3));
                            }
                            const prevBay = next[0][bi] ?? [];
                            next[0][bi] = Array.from({ length: v }, (_, li) => prevBay[li] ?? 3);
                            return next;
                          });
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {Array.from(
                    { length: levelsPerBay[0]?.[bi] && levelsPerBay[0][bi] >= 1 ? levelsPerBay[0][bi] : 0 },
                    (_, li) => {
                      const levelLabel = buildLevelCodes(levelsPerBay[0][bi])[li] ?? String(li + 1);
                      return (
                        <div key={li} className="space-y-1 rounded-md bg-muted/30 p-2">
                          <Label className="text-xs text-muted-foreground">Level {levelLabel} — bins</Label>
                          <Input
                            inputMode="numeric"
                            className="h-8"
                            value={
                              binsPerLevel[0]?.[bi]?.[li] != null && binsPerLevel[0][bi][li] >= 1
                                ? String(binsPerLevel[0][bi][li])
                                : ""
                            }
                            onChange={(e) => {
                              const v = Number.parseInt(e.target.value, 10);
                              setBinsPerLevel((prev) => {
                                const next = prev.map((row) => row.map((bay) => [...bay]));
                                if (!next[0]) next[0] = [];
                                if (!next[0][bi]) next[0][bi] = [];
                                next[0][bi][li] = Number.isFinite(v) ? v : 0;
                                return next;
                              });
                            }}
                          />
                        </div>
                      );
                    }
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !layout}
            onClick={() => {
              if (!layout) return;
              void onSave({
                rowCode,
                baysByRow: layout.baysByRow,
                levelsPerBay,
                binsPerLevel,
              });
            }}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : isRefill ? "Create row bins" : "Save row layout"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
