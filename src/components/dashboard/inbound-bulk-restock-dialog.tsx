"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileUp, ListPlus, PackagePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import type { InventoryItem } from "@/types";
import type { InboundBulkValidatedRow } from "@/lib/inbound-bulk-import";
import {
  downloadRestockBulkTemplate,
  filterRestockEligibleProducts,
  parseRestockBulkCsv,
  validateRestockBulkRows,
} from "@/lib/inbound-bulk-restock";

type InboundBulkRestockDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  inventory: InventoryItem[];
  onRowsImported: (rows: InboundBulkValidatedRow[]) => void | Promise<void>;
};

export function InboundBulkRestockDialog({
  open,
  onOpenChange,
  inventory,
  onRowsImported,
}: InboundBulkRestockDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [validRows, setValidRows] = useState<InboundBulkValidatedRow[]>([]);
  const [rowErrors, setRowErrors] = useState<{ rowNumber: number; message: string }[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [skippedEmpty, setSkippedEmpty] = useState(0);

  const restockCatalogCount = useMemo(
    () => filterRestockEligibleProducts(inventory).filter((p) => String(p.sku ?? "").trim()).length,
    [inventory]
  );

  const resetState = useCallback(() => {
    setFileName("");
    setValidRows([]);
    setRowErrors([]);
    setParseErrors([]);
    setSkippedEmpty(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  const processFile = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      toast({
        variant: "destructive",
        title: "Invalid file",
        description: "Please upload a .csv file.",
      });
      return;
    }

    const text = await file.text();
    const { rows, errors: parseErrs } = parseRestockBulkCsv(text);
    setParseErrors(parseErrs);
    setFileName(file.name);

    if (parseErrs.length > 0) {
      setValidRows([]);
      setRowErrors([]);
      setSkippedEmpty(0);
      return;
    }

    const { valid, errors, skippedEmpty: skipped } = validateRestockBulkRows(rows, inventory);
    setValidRows(valid);
    setRowErrors(errors);
    setSkippedEmpty(skipped);

    if (valid.length === 0 && errors.length === 0) {
      setParseErrors(["No restock rows found. Enter Quantity on at least one SKU."]);
    }
  };

  const previewSummary = useMemo(() => {
    if (validRows.length === 0 && rowErrors.length === 0 && parseErrors.length === 0) {
      return null;
    }
    return { valid: validRows.length, invalid: rowErrors.length, skipped: skippedEmpty };
  }, [validRows.length, rowErrors.length, parseErrors.length, skippedEmpty]);

  const handleAddToList = async () => {
    if (validRows.length === 0 || rowErrors.length > 0 || parseErrors.length > 0) return;
    await onRowsImported(validRows);
    toast({
      title: "Added to request",
      description: `${validRows.length} restock line${validRows.length === 1 ? "" : "s"} added. Review the list, then submit.`,
    });
    handleOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-5 w-5 text-primary" />
            Bulk restock import
          </DialogTitle>
          <DialogDescription>
            Download a CSV with your product SKUs, fill in Quantity for items you want to restock,
            then upload. Empty quantity rows are ignored.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => downloadRestockBulkTemplate(inventory)}
          >
            <Download className="mr-2 h-4 w-4" />
            Download my restock template
            {restockCatalogCount > 0 ? ` (${restockCatalogCount} SKUs)` : ""}
          </Button>

          <div className="rounded-lg border border-dashed bg-muted/30 p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void processFile(file);
              }}
            />
            <Button
              type="button"
              variant="secondary"
              className="w-full"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp className="mr-2 h-4 w-4" />
              {fileName ? "Choose a different file" : "Upload filled CSV"}
            </Button>
            {fileName && (
              <p className="mt-2 text-center text-xs text-muted-foreground truncate">{fileName}</p>
            )}
          </div>

          {parseErrors.length > 0 && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p className="font-medium text-destructive">File errors</p>
              <ul className="mt-1 list-disc pl-5 text-destructive/90">
                {parseErrors.map((err) => (
                  <li key={err}>{err}</li>
                ))}
              </ul>
            </div>
          )}

          {previewSummary && parseErrors.length === 0 && (
            <div className="rounded-lg border bg-card p-3 text-sm">
              <p>
                <span className="font-medium text-emerald-700 dark:text-emerald-400">
                  {previewSummary.valid} restock row{previewSummary.valid === 1 ? "" : "s"} ready
                </span>
                {previewSummary.skipped > 0 && (
                  <>
                    {" · "}
                    <span className="text-muted-foreground">
                      {previewSummary.skipped} empty row{previewSummary.skipped === 1 ? "" : "s"} skipped
                    </span>
                  </>
                )}
                {previewSummary.invalid > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-destructive">
                      {previewSummary.invalid} error{previewSummary.invalid === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}

          {rowErrors.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border bg-muted/20 p-3 text-sm">
              <p className="font-medium mb-2">Row errors</p>
              <ul className="space-y-1">
                {rowErrors.map((err) => (
                  <li key={`${err.rowNumber}-${err.message}`} className="text-destructive">
                    Row {err.rowNumber}: {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validRows.length > 0 && rowErrors.length === 0 && (
            <div className="max-h-36 overflow-y-auto rounded-lg border text-xs">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">SKU</th>
                    <th className="px-2 py-1.5 text-left font-medium">Product</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 8).map((row) => (
                    <tr key={row.rowNumber} className="border-t">
                      <td className="px-2 py-1 font-mono">{row.sku}</td>
                      <td className="px-2 py-1 truncate max-w-[160px]">{row.productName}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validRows.length > 8 && (
                <p className="px-2 py-1 text-muted-foreground border-t">
                  +{validRows.length - 8} more rows
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={validRows.length === 0 || rowErrors.length > 0 || parseErrors.length > 0}
            onClick={handleAddToList}
          >
            <ListPlus className="mr-2 h-4 w-4" />
            Add {validRows.length > 0 ? `${validRows.length} ` : ""}to list
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
