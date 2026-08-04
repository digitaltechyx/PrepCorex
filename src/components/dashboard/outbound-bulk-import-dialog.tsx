"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { collection, doc, Timestamp, writeBatch } from "firebase/firestore";
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
import { useUserPricingCollections } from "@/hooks/use-user-pricing-collections";
import { db } from "@/lib/firebase";
import {
  getPricingProfileCollectionPath,
  resolveUserPricingProfileId,
} from "@/lib/pricing-profiles";
import type { FbaPackAddOnConfig } from "@/lib/pricing-utils";
import {
  downloadOutboundBulkTemplate,
  isOutboundTemplateEligible,
  outboundBulkRowToFirestoreDoc,
  parseOutboundBulkCsv,
  validateOutboundBulkRows,
  type OutboundBulkRowError,
  type OutboundBulkValidatedRow,
} from "@/lib/outbound-bulk-import";
import type { InventoryItem, UserProfile } from "@/types";
import { formatServiceLabel } from "@/types";

type FbaPackAddOnPricingDoc = FbaPackAddOnConfig & { id: string };

type OutboundBulkImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ownerId: string;
  ownerDisplayName: string;
  inventory: InventoryItem[];
  pricingUser?: Pick<UserProfile, "uid" | "pricingProfileId"> | null;
  onSuccess?: () => void;
};

export function OutboundBulkImportDialog({
  open,
  onOpenChange,
  ownerId,
  ownerDisplayName,
  inventory,
  pricingUser,
  onSuccess,
}: OutboundBulkImportDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [validRows, setValidRows] = useState<OutboundBulkValidatedRow[]>([]);
  const [rowErrors, setRowErrors] = useState<OutboundBulkRowError[]>([]);
  const [rowWarnings, setRowWarnings] = useState<OutboundBulkRowError[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const resolvedPricingUser = useMemo(
    () => pricingUser ?? { uid: ownerId, pricingProfileId: null },
    [pricingUser, ownerId]
  );

  const { pricingRules: effectivePricingRules } =
    useUserPricingCollections(resolvedPricingUser);

  const profileId = resolveUserPricingProfileId(resolvedPricingUser);
  const fbaPackPath = getPricingProfileCollectionPath(profileId, "fbaPackAddOn");
  const standardFbaPackPath = getPricingProfileCollectionPath("standard", "fbaPackAddOn");

  const { data: fbaPackAddOnPricing } = useCollection<FbaPackAddOnPricingDoc>(
    ownerId ? fbaPackPath : ""
  );
  const { data: standardFbaPackAddOnPricing } = useCollection<FbaPackAddOnPricingDoc>(
    ownerId && profileId !== "standard" ? standardFbaPackPath : ""
  );

  const latestFbaPackAddOnConfig = useMemo((): FbaPackAddOnConfig | undefined => {
    const list =
      fbaPackAddOnPricing && fbaPackAddOnPricing.length > 0
        ? fbaPackAddOnPricing
        : standardFbaPackAddOnPricing || [];
    if (list.length === 0) return undefined;
    const sorted = [...list].sort((a, b) => {
      const aT = (a as FbaPackAddOnPricingDoc).updatedAt?.seconds ?? 0;
      const bT = (b as FbaPackAddOnPricingDoc).updatedAt?.seconds ?? 0;
      return bT - aT;
    });
    const latest = sorted[0];
    return {
      pack2to3AddOn: latest.pack2to3AddOn,
      pack4to12AddOn: latest.pack4to12AddOn,
    };
  }, [fbaPackAddOnPricing, standardFbaPackAddOnPricing]);

  const resetState = useCallback(() => {
    setFileName("");
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
    const { rows, errors: parseErrs } = parseOutboundBulkCsv(text);
    setParseErrors(parseErrs);
    setFileName(file.name);

    if (parseErrs.length > 0) {
      setValidRows([]);
      setRowErrors([]);
      setRowWarnings([]);
      return;
    }

    const { valid, errors, warnings } = validateOutboundBulkRows(rows, {
      inventory,
      pricingRules: effectivePricingRules,
      packConfig: latestFbaPackAddOnConfig,
    });
    setValidRows(valid);
    setRowErrors(errors);
    setRowWarnings(warnings);
  };

  const previewSummary = useMemo(() => {
    if (validRows.length === 0 && rowErrors.length === 0 && parseErrors.length === 0) {
      return null;
    }
    return { valid: validRows.length, invalid: rowErrors.length, warnings: rowWarnings.length };
  }, [validRows.length, rowErrors.length, rowWarnings.length, parseErrors.length]);

  const shippableCount = useMemo(
    () => inventory.filter(isOutboundTemplateEligible).length,
    [inventory]
  );

  const handleSubmit = async () => {
    if (!user || !ownerId || validRows.length === 0 || rowErrors.length > 0 || parseErrors.length > 0) {
      return;
    }

    setSubmitting(true);
    try {
      const batch = writeBatch(db);
      const requestedAt = Timestamp.now();

      for (const row of validRows) {
        const ref = doc(collection(db, `users/${ownerId}/shipmentRequests`));
        batch.set(
          ref,
          outboundBulkRowToFirestoreDoc(row, {
            ownerId,
            ownerDisplayName,
            requestedAt,
          })
        );
      }

      await batch.commit();

      toast({
        title: "Import successful",
        description: `${validRows.length} outbound shipment request${validRows.length === 1 ? "" : "s"} submitted for admin review. Upload labels from each shipment when ready.`,
      });
      onSuccess?.();
      handleOpenChange(false);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Import failed",
        description: e instanceof Error ? e.message : "Could not submit bulk outbound requests.",
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
            Bulk import outbound shipments
          </DialogTitle>
          <DialogDescription>
            Download a template with your in-stock products. Fill Service, Shipping Date, Shipment
            Preference (SPD/LTL), and Quantity only on rows you want to ship — leave other rows blank.
            Each filled row creates one pending outbound request. FBA rows use the master-case label
            workflow; upload labels after warehouse posts case details.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!ownerId || shippableCount === 0}
            onClick={() => downloadOutboundBulkTemplate(inventory)}
          >
            <Download className="mr-2 h-4 w-4" />
            Download template ({shippableCount} product{shippableCount === 1 ? "" : "s"})
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
            <div className="max-h-36 overflow-y-auto rounded-lg border text-xs">
              <table className="w-full">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Product</th>
                    <th className="px-2 py-1.5 text-left font-medium">Service</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 8).map((row) => (
                    <tr key={row.rowNumber} className="border-t">
                      <td className="px-2 py-1 truncate max-w-[140px]">{row.productName}</td>
                      <td className="px-2 py-1">{formatServiceLabel(row.service)}</td>
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
              !user ||
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
