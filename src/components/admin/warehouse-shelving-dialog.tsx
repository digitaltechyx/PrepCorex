"use client";

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { WarehouseAreaDoc, WarehouseBinDoc } from "@/types";
import { listGapRowCodes } from "@/lib/warehouse-row-rack";

type RowSummary = {
  row: string;
  binCount: number;
};

function summarizeRows(bins: WarehouseBinDoc[], areaCode: string): { areaBins: WarehouseBinDoc[]; rows: RowSummary[] } {
  const areaBins = bins.filter((b) => b.area === areaCode);
  const rowMap = new Map<string, number>();
  for (const b of areaBins) {
    const row = b.row || "?";
    rowMap.set(row, (rowMap.get(row) || 0) + 1);
  }
  const rows = [...rowMap.entries()]
    .map(([row, binCount]) => ({ row, binCount }))
    .sort((a, b) => a.row.localeCompare(b.row, undefined, { numeric: true }));
  return { areaBins, rows };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  area: WarehouseAreaDoc | null;
  warehouseCode: string;
  bins: WarehouseBinDoc[];
  saving: boolean;
  onAddShelving: () => void;
  onEditRow: (rowCode: string) => void;
  onRefillRow: (rowCode: string) => void;
  onRemoveRow: (rowCode: string) => void | Promise<void>;
  onClearAll: () => void | Promise<void>;
};

export function WarehouseShelvingDialog({
  open,
  onOpenChange,
  area,
  warehouseCode,
  bins,
  saving,
  onAddShelving,
  onEditRow,
  onRefillRow,
  onRemoveRow,
  onClearAll,
}: Props) {
  const summary = useMemo(() => {
    if (!area) return { areaBins: [] as WarehouseBinDoc[], rows: [] as RowSummary[] };
    return summarizeRows(bins, area.code);
  }, [bins, area]);

  const gapRows = useMemo(() => {
    if (!area) return [] as string[];
    const existing = summary.rows.map((r) => r.row);
    return listGapRowCodes(existing);
  }, [area, summary.rows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Shelving — {area?.code ?? "Area"}</DialogTitle>
          <DialogDescription>
            Add or remove rows of bins. Paths use prefix{" "}
            <span className="font-mono">
              {warehouseCode}-{area?.code}
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        {gapRows.length > 0 ? (
          <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-2">
            <p className="text-xs text-muted-foreground">
              Empty row numbers (gaps) — refill with bays, levels, and bins without renumbering later rows.
            </p>
            <div className="flex flex-wrap gap-2">
              {gapRows.map((row) => (
                <Button
                  key={row}
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="font-mono h-8"
                  disabled={saving}
                  onClick={() => onRefillRow(row)}
                >
                  Refill row {row}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {summary.rows.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            No shelving in this area yet. Use <strong className="text-foreground">Add shelving</strong> to create rows
            and bins.
          </p>
        ) : (
          <div>
            <p className="text-xs text-muted-foreground mb-2">
              Edit a row to change bays, levels, and bin counts. Remove deletes only that row.
            </p>
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Row</TableHead>
                    <TableHead className="w-20">Bins</TableHead>
                    <TableHead className="w-36 text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.rows.map((r) => (
                    <TableRow key={r.row}>
                      <TableCell className="font-mono">{r.row}</TableCell>
                      <TableCell>{r.binCount}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            disabled={saving}
                            onClick={() => onEditRow(r.row)}
                          >
                            <Pencil className="h-3.5 w-3.5 mr-1" />
                            Edit
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive h-8"
                                disabled={saving}
                              >
                                <Trash2 className="h-3.5 w-3.5 mr-1" />
                                Row
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Remove row {r.row}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Deletes {r.binCount} bin(s) on row {r.row} in area {area?.code}. Other rows are
                                  unchanged. You can refill this row number later.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => void onRemoveRow(r.row)}
                                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                >
                                  Remove row
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
          {summary.rows.length > 0 ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" className="text-destructive" disabled={saving}>
                  Clear all shelving
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear all shelving in {area?.code}?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Removes all {summary.areaBins.length} bin(s). The area record stays; use Add shelving to rebuild.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => void onClearAll()}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <div />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              type="button"
              onClick={() => {
                onOpenChange(false);
                onAddShelving();
              }}
              disabled={saving}
            >
              <Plus className="h-4 w-4 mr-2" />
              Add shelving
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
