"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { addDoc, collection, Timestamp } from "firebase/firestore";
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
import { useCollection } from "@/hooks/use-collection";
import { db } from "@/lib/firebase";
import { addInboundTrackingToRequests } from "@/lib/inbound-tracking-client";
import type { InventoryItem, InventoryRequest } from "@/types";
import {
  collectExistingStorageNames,
  downloadInboundBulkTemplate,
  inboundBulkRowToFirestoreDoc,
  parseInboundBulkCsv,
  validateInboundBulkRows,
  type InboundBulkRowError,
  type InboundBulkValidatedRow,
} from "@/lib/inbound-bulk-import";

type InboundBulkImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string | undefined;
  ownerName: string;
  onSuccess?: () => void;
};

export function InboundBulkImportDialog({
  open,
  onOpenChange,
  ownerId,
  ownerName,
  onSuccess,
}: InboundBulkImportDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [validRows, setValidRows] = useState<InboundBulkValidatedRow[]>([]);
  const [rowErrors, setRowErrors] = useState<InboundBulkRowError[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const { data: inventory } = useCollection<InventoryItem>(
    ownerId ? `users/${ownerId}/inventory` : ""
  );
  const { data: requests } = useCollection<InventoryRequest>(
    ownerId ? `users/${ownerId}/inventoryRequests` : ""
  );

  const resetState = useCallback(() => {
    setFileName("");
    setValidRows([]);
    setRowErrors([]);
    setParseErrors([]);
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
    const { rows, errors: parseErrs } = parseInboundBulkCsv(text);
    setParseErrors(parseErrs);
    setFileName(file.name);

    if (parseErrs.length > 0 || !ownerId) {
      setValidRows([]);
      setRowErrors([]);
      return;
    }

    const { valid, errors } = validateInboundBulkRows(rows, {
      ownerName,
      inventory,
      requests,
      existingStorageNames: collectExistingStorageNames(inventory, requests),
    });
    setValidRows(valid);
    setRowErrors(errors);
  };

  const previewSummary = useMemo(() => {
    if (validRows.length === 0 && rowErrors.length === 0 && parseErrors.length === 0) {
      return null;
    }
    return { valid: validRows.length, invalid: rowErrors.length };
  }, [validRows.length, rowErrors.length, parseErrors.length]);

  const handleSubmit = async () => {
    if (!ownerId || validRows.length === 0 || rowErrors.length > 0 || parseErrors.length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      const addDate = Timestamp.now();
      const requestedAt = Timestamp.now();
      const colRef = collection(db, `users/${ownerId}/inventoryRequests`);

      const created = await Promise.all(
        validRows.map(async (row) => {
          const ref = await addDoc(
            colRef,
            inboundBulkRowToFirestoreDoc(row, {
              ownerId,
              ownerName,
              addDate,
              requestedAt,
            })
          );
          return { requestId: ref.id, row };
        })
      );

      if (user) {
        try {
          await addInboundTrackingToRequests(
            user,
            ownerId,
            created.map(({ requestId, row }) => ({
              requestId,
              trackingNumber: row.trackingNumber,
              carrier: row.carrier,
            }))
          );
        } catch (trackingError) {
          toast({
            variant: "destructive",
            title: "Some tracking not saved",
            description:
              trackingError instanceof Error
                ? `${trackingError.message} You can add tracking from the inventory table.`
                : "Requests were created but tracking could not be added.",
          });
        }
      }

      toast({
        title: "Import successful",
        description: `${validRows.length} inbound request${validRows.length === 1 ? "" : "s"} submitted for admin review.`,
      });
      onSuccess?.();
      handleOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: e instanceof Error ? e.message : "Could not submit bulk requests.",
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
            Bulk import inbound requests
          </DialogTitle>
          <DialogDescription>
            Download the CSV template, fill in your products, then upload the file. Each row becomes
            one pending inbound request (same as the manual form). Optional Tracking Number and Carrier
            columns use the same tracking shown in your inventory list. Product photos can be added later
            in inventory.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button type="button" variant="outline" className="w-full" onClick={downloadInboundBulkTemplate}>
            <Download className="mr-2 h-4 w-4" />
            Download CSV template
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
                  {previewSummary.valid} valid row{previewSummary.valid === 1 ? "" : "s"}
                </span>
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
                    <th className="px-2 py-1.5 text-left font-medium">Type</th>
                    <th className="px-2 py-1.5 text-left font-medium">Name / SKU</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 8).map((row) => (
                    <tr key={row.rowNumber} className="border-t">
                      <td className="px-2 py-1 capitalize">{row.inventoryType}</td>
                      <td className="px-2 py-1 truncate max-w-[180px]">
                        {row.sku || row.productName}
                      </td>
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
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              submitting ||
              !ownerId ||
              validRows.length === 0 ||
              rowErrors.length > 0 ||
              parseErrors.length > 0
            }
            onClick={() => void handleSubmit()}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit {validRows.length > 0 ? `${validRows.length} request${validRows.length === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
