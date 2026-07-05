"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Download, FileUp, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import {
  bulkRowToDisposeLineInput,
  submitDisposeBatch,
} from "@/lib/dispose-batch";
import {
  downloadDisposeBulkTemplate,
  parseDisposeBulkCsv,
  validateDisposeBulkRows,
  type DisposeBulkRowError,
  type DisposeBulkValidatedRow,
} from "@/lib/dispose-bulk-import";
import type { InventoryItem } from "@/types";

type DisposeBulkImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  ownerDisplayName: string;
  inventory: InventoryItem[];
  onSuccess?: (batchId: string) => void;
};

export function DisposeBulkImportDialog({
  open,
  onOpenChange,
  ownerId,
  ownerDisplayName,
  inventory,
  onSuccess,
}: DisposeBulkImportDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [batchReason, setBatchReason] = useState("");
  const [validRows, setValidRows] = useState<DisposeBulkValidatedRow[]>([]);
  const [rowErrors, setRowErrors] = useState<DisposeBulkRowError[]>([]);
  const [rowWarnings, setRowWarnings] = useState<DisposeBulkRowError[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const resetState = useCallback(() => {
    setFileName("");
    setBatchReason("");
    setValidRows([]);
    setRowErrors([]);
    setRowWarnings([]);
    setParseErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  const revalidate = (text: string, reason: string) => {
    const { rows, errors: parseErrs } = parseDisposeBulkCsv(text);
    setParseErrors(parseErrs);
    if (parseErrs.length > 0) {
      setValidRows([]);
      setRowErrors([]);
      setRowWarnings([]);
      return;
    }
    const { valid, errors, warnings } = validateDisposeBulkRows(rows, {
      inventory,
      batchReason: reason,
    });
    setValidRows(valid);
    setRowErrors(errors);
    setRowWarnings(warnings);
  };

  const [lastFileText, setLastFileText] = useState("");

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
    setLastFileText(text);
    setFileName(file.name);
    revalidate(text, batchReason);
  };

  const handleBatchReasonChange = (value: string) => {
    setBatchReason(value);
    if (lastFileText) {
      revalidate(lastFileText, value);
    }
  };

  const previewSummary = useMemo(() => {
    if (validRows.length === 0 && rowErrors.length === 0 && parseErrors.length === 0) {
      return null;
    }
    return { valid: validRows.length, invalid: rowErrors.length, warnings: rowWarnings.length };
  }, [validRows.length, rowErrors.length, rowWarnings.length, parseErrors.length]);

  const totalDisposeUnits = useMemo(
    () => validRows.reduce((sum, row) => sum + row.disposeQuantity, 0),
    [validRows]
  );

  const handleSubmit = async () => {
    if (
      !user ||
      !ownerId ||
      !batchReason.trim() ||
      validRows.length === 0 ||
      rowErrors.length > 0 ||
      parseErrors.length > 0
    ) {
      return;
    }

    setSubmitting(true);
    try {
      const batchId = await submitDisposeBatch({
        userId: ownerId,
        userName: ownerDisplayName,
        reason: batchReason.trim(),
        lines: validRows.map(bulkRowToDisposeLineInput),
      });

      toast({
        title: "Dispose batch submitted",
        description: `${validRows.length} line${validRows.length === 1 ? "" : "s"} (${totalDisposeUnits} units) sent for admin review.`,
      });
      onSuccess?.(batchId);
      handleOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: e instanceof Error ? e.message : "Could not submit dispose batch.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const eligibleCount = inventory.filter((item) => Number(item.quantity) > 0).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Import dispose inventory (CSV)
          </DialogTitle>
          <DialogDescription>
            Download a template with your in-stock products (including low stock and expired). Fill in
            Dispose Quantity for items you want to dispose, review, then submit one batch request.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!ownerId || eligibleCount === 0}
            onClick={() => downloadDisposeBulkTemplate(inventory)}
          >
            <Download className="mr-2 h-4 w-4" />
            Download template ({eligibleCount} product{eligibleCount === 1 ? "" : "s"})
          </Button>

          <div className="space-y-2">
            <Label>Batch reason (required)</Label>
            <Textarea
              value={batchReason}
              onChange={(e) => handleBatchReasonChange(e.target.value)}
              placeholder="Why are you disposing these items? Used for rows without their own Reason."
              rows={2}
            />
          </div>

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
              disabled={!ownerId}
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
                  {previewSummary.valid} line{previewSummary.valid === 1 ? "" : "s"} to dispose
                </span>
                {previewSummary.valid > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium">{totalDisposeUnits} units total</span>
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
                {previewSummary.warnings > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium text-amber-700 dark:text-amber-400">
                      {previewSummary.warnings} warning{previewSummary.warnings === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </p>
            </div>
          )}

          {rowWarnings.length > 0 && (
            <div className="max-h-28 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
              <p className="font-medium mb-2 text-amber-900">Warnings</p>
              <ul className="space-y-1">
                {rowWarnings.map((err) => (
                  <li key={`${err.rowNumber}-${err.message}`} className="text-amber-800">
                    Row {err.rowNumber}: {err.message}
                  </li>
                ))}
              </ul>
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
            <div className="max-h-44 overflow-y-auto rounded-lg border text-xs">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Product</th>
                    <th className="px-2 py-1.5 text-left font-medium">Status</th>
                    <th className="px-2 py-1.5 text-right font-medium">Current</th>
                    <th className="px-2 py-1.5 text-right font-medium">Dispose</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 10).map((row) => (
                    <tr key={row.rowNumber} className="border-t">
                      <td className="px-2 py-1 truncate max-w-[120px]">{row.productName}</td>
                      <td className="px-2 py-1">{row.stockStatus}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.currentQuantity}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{row.disposeQuantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validRows.length > 10 && (
                <p className="px-2 py-1 text-muted-foreground border-t">
                  +{validRows.length - 10} more rows
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              submitting ||
              !user ||
              !ownerId ||
              !batchReason.trim() ||
              validRows.length === 0 ||
              rowErrors.length > 0 ||
              parseErrors.length > 0
            }
            onClick={() => void handleSubmit()}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit batch ({validRows.length > 0 ? `${validRows.length} lines` : "0 lines"})
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
