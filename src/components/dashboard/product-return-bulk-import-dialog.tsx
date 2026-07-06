"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { collection, addDoc, Timestamp } from "firebase/firestore";
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
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { db } from "@/lib/firebase";
import { buildReturnTrackingEntries } from "@/lib/return-tracking-client";
import {
  returnDraftToFirestore,
  validateReturnDraft,
} from "@/lib/product-return-draft";
import {
  downloadExistingProductReturnTemplate,
  downloadNewProductReturnTemplate,
  isProductReturnTemplateEligible,
  parseProductReturnBulkCsv,
  validateExistingProductReturnRows,
  validateNewProductReturnRows,
  validatedRowToReturnDraft,
  type ProductReturnBulkImportKind,
  type ProductReturnBulkRowError,
  type ProductReturnBulkValidatedRow,
} from "@/lib/product-return-bulk-import";
import type { InventoryItem } from "@/types";

type ProductReturnBulkImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  inventory: InventoryItem[];
  onSuccess?: () => void;
};

export function ProductReturnBulkImportDialog({
  open,
  onOpenChange,
  ownerId,
  inventory,
  onSuccess,
}: ProductReturnBulkImportDialogProps) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [importKind, setImportKind] = useState<ProductReturnBulkImportKind | null>(null);
  const [validRows, setValidRows] = useState<ProductReturnBulkValidatedRow[]>([]);
  const [rowErrors, setRowErrors] = useState<ProductReturnBulkRowError[]>([]);
  const [rowWarnings, setRowWarnings] = useState<ProductReturnBulkRowError[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const eligibleCount = useMemo(
    () => inventory.filter(isProductReturnTemplateEligible).length,
    [inventory]
  );

  const resetState = useCallback(() => {
    setFileName("");
    setImportKind(null);
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

  const revalidate = (text: string) => {
    const { kind, existingRows, newRows, errors: parseErrs } = parseProductReturnBulkCsv(text);
    setParseErrors(parseErrs);
    setImportKind(kind);

    if (parseErrs.length > 0 || !kind) {
      setValidRows([]);
      setRowErrors([]);
      setRowWarnings([]);
      return;
    }

    if (kind === "existing") {
      const { valid, errors, warnings } = validateExistingProductReturnRows(existingRows, {
        inventory,
      });
      setValidRows(valid);
      setRowErrors(errors);
      setRowWarnings(warnings);
      return;
    }

    const { valid, errors, warnings } = validateNewProductReturnRows(newRows);
    setValidRows(valid);
    setRowErrors(errors);
    setRowWarnings(warnings);
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
    setFileName(file.name);
    revalidate(text);
  };

  const previewSummary = useMemo(() => {
    if (validRows.length === 0 && rowErrors.length === 0 && parseErrors.length === 0) {
      return null;
    }
    return { valid: validRows.length, invalid: rowErrors.length, warnings: rowWarnings.length };
  }, [validRows.length, rowErrors.length, rowWarnings.length, parseErrors.length]);

  const totalUnits = useMemo(
    () => validRows.reduce((sum, row) => sum + row.requestedQuantity, 0),
    [validRows]
  );

  const handleSubmit = async () => {
    if (
      !user ||
      !ownerId ||
      validRows.length === 0 ||
      rowErrors.length > 0 ||
      parseErrors.length > 0
    ) {
      return;
    }

    setSubmitting(true);
    try {
      const now = Timestamp.now();
      const addedBy = userProfile?.uid ?? null;

      for (const row of validRows) {
        const draft = validatedRowToReturnDraft(row);
        const draftErr = validateReturnDraft(draft, row.rowNumber - 2);
        if (draftErr) {
          throw new Error(draftErr);
        }

        const returnTrackings = buildReturnTrackingEntries(draft.tracking, addedBy);
        const payload = returnDraftToFirestore(draft, {
          userId: ownerId,
          now,
          returnTrackings,
          addedBy,
        });

        await addDoc(collection(db, `users/${ownerId}/productReturns`), payload);
      }

      toast({
        title: "Returns submitted",
        description: `${validRows.length} return request${validRows.length === 1 ? "" : "s"} (${totalUnits} units) created successfully.`,
      });
      onSuccess?.();
      handleOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: e instanceof Error ? e.message : "Could not submit return requests.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Import product returns (CSV)
          </DialogTitle>
          <DialogDescription>
            Download a template for existing inventory (pre-filled) or new products (blank rows).
            Fill in Requested Quantity and optional fields, then upload. Product images can be added
            later from return history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!ownerId || eligibleCount === 0}
              onClick={() => downloadExistingProductReturnTemplate(inventory)}
            >
              <Download className="mr-2 h-4 w-4 shrink-0" />
              Existing products ({eligibleCount})
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              disabled={!ownerId}
              onClick={() => downloadNewProductReturnTemplate()}
            >
              <Download className="mr-2 h-4 w-4 shrink-0" />
              New products (blank)
            </Button>
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
            {importKind && parseErrors.length === 0 && (
              <p className="mt-1 text-center text-xs text-muted-foreground">
                Detected: {importKind === "existing" ? "existing product" : "new product"} template
              </p>
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
                  {previewSummary.valid} return{previewSummary.valid === 1 ? "" : "s"} ready
                </span>
                {previewSummary.valid > 0 && (
                  <>
                    {" · "}
                    <span className="font-medium">{totalUnits} units total</span>
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
                    <th className="px-2 py-1.5 text-left font-medium">Type</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 10).map((row) => (
                    <tr key={row.rowNumber} className="border-t">
                      <td className="px-2 py-1 truncate max-w-[140px]">{row.productName}</td>
                      <td className="px-2 py-1 capitalize">{row.type}</td>
                      <td className="px-2 py-1 text-right tabular-nums font-medium">
                        {row.requestedQuantity}
                      </td>
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
              validRows.length === 0 ||
              rowErrors.length > 0 ||
              parseErrors.length > 0
            }
            onClick={() => void handleSubmit()}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit {validRows.length > 0 ? `${validRows.length} return${validRows.length === 1 ? "" : "s"}` : "returns"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
