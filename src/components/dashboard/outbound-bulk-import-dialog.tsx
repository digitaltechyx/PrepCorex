"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { Timestamp } from "firebase/firestore";
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
import { createOutboundRequestWithClientReserve } from "@/lib/client-inventory-outbound-sync";
import {
  getPricingProfileCollectionPath,
  resolveUserPricingProfileId,
} from "@/lib/pricing-profiles";
import {
  downloadOutboundBulkTemplate,
  groupOutboundBulkRows,
  isOutboundTemplateEligible,
  outboundBulkGroupToFirestoreDoc,
  parseOutboundBulkFile,
  validateOutboundBulkRows,
  type FbaPackAddOnConfig,
  type OutboundBulkRequestGroup,
  type OutboundBulkRowError,
  type OutboundBulkValidatedRow,
} from "@/lib/outbound-bulk-import";
import type { InventoryItem, UserProfile } from "@/types";
import { formatServiceLabel, formatShipmentPreferenceLabel } from "@/types";

type FbaPackAddOnPricingDoc = {
  id: string;
  pack2to3AddOn?: unknown;
  pack4to12AddOn?: unknown;
  updatedAt?: { seconds?: number } | null;
};

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
  const [requestGroups, setRequestGroups] = useState<OutboundBulkRequestGroup[]>([]);
  const [rowErrors, setRowErrors] = useState<OutboundBulkRowError[]>([]);
  const [rowWarnings, setRowWarnings] = useState<OutboundBulkRowError[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [downloading, setDownloading] = useState(false);

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
      const aT = a.updatedAt?.seconds ?? 0;
      const bT = b.updatedAt?.seconds ?? 0;
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
    setRequestGroups([]);
    setRowErrors([]);
    setRowWarnings([]);
    setParseErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  const handleDownloadTemplate = async () => {
    if (!ownerId) return;
    setDownloading(true);
    try {
      await downloadOutboundBulkTemplate(inventory);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: e instanceof Error ? e.message : "Could not build the Excel template.",
      });
    } finally {
      setDownloading(false);
    }
  };

  const processFile = async (file: File) => {
    const { rows, errors: parseErrs } = await parseOutboundBulkFile(file);
    setParseErrors(parseErrs);
    setFileName(file.name);

    if (parseErrs.length > 0) {
      setValidRows([]);
      setRequestGroups([]);
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
    setRequestGroups(groupOutboundBulkRows(valid));
    setRowErrors(errors);
    setRowWarnings(warnings);
  };

  const previewSummary = useMemo(() => {
    if (validRows.length === 0 && rowErrors.length === 0 && parseErrors.length === 0) {
      return null;
    }
    return {
      lines: validRows.length,
      requests: requestGroups.length,
      invalid: rowErrors.length,
      warnings: rowWarnings.length,
    };
  }, [
    validRows.length,
    requestGroups.length,
    rowErrors.length,
    rowWarnings.length,
    parseErrors.length,
  ]);

  const shippableCount = useMemo(
    () => inventory.filter(isOutboundTemplateEligible).length,
    [inventory]
  );

  const handleSubmit = async () => {
    if (
      !user ||
      !ownerId ||
      requestGroups.length === 0 ||
      rowErrors.length > 0 ||
      parseErrors.length > 0
    ) {
      return;
    }

    setSubmitting(true);
    try {
      const requestedAt = Timestamp.now();

      for (const group of requestGroups) {
        const requestData = outboundBulkGroupToFirestoreDoc(group, {
          ownerId,
          ownerDisplayName,
          requestedAt,
        });
        await createOutboundRequestWithClientReserve({
          clientUserId: ownerId,
          requestData,
        });
      }

      const lineCount = validRows.length;
      const reqCount = requestGroups.length;
      toast({
        title: "Import successful",
        description: `${reqCount} outbound request${reqCount === 1 ? "" : "s"} submitted (${lineCount} pack line${lineCount === 1 ? "" : "s"}). Inventory reserved until ship or cancel.`,
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
            Download the Excel template with warehouse stock (products, boxes, pallets — marketplace
            Other resources excluded). Service includes FBA/WFS/TFS, DTC/FBM, Carton Forwarding, and
            Pallet Forwarding. For Lot Selection → Choose lots…, pick up to 3 lots from each row’s Lot
            1/2/3 dropdowns (that product’s expiry lots) and enter Qty beside each. Copy a row for
            another pack line so lot dropdowns stay correct.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={!ownerId || shippableCount === 0 || downloading}
            onClick={() => void handleDownloadTemplate()}
          >
            {downloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download Excel template ({shippableCount} product{shippableCount === 1 ? "" : "s"})
          </Button>

          <div className="rounded-lg border border-dashed bg-muted/30 p-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xlsm,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
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
              {fileName ? "Choose a different file" : "Upload filled Excel / CSV"}
            </Button>
            {fileName && (
              <p className="mt-2 truncate text-center text-xs text-muted-foreground">{fileName}</p>
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
                  {previewSummary.requests} request{previewSummary.requests === 1 ? "" : "s"}
                </span>
                {" · "}
                <span className="font-medium">
                  {previewSummary.lines} pack line{previewSummary.lines === 1 ? "" : "s"}
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
              <p className="mb-2 font-medium text-amber-900">Warnings</p>
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
              <p className="mb-2 font-medium">Row errors</p>
              <ul className="space-y-1">
                {rowErrors.map((err) => (
                  <li key={`${err.rowNumber}-${err.message}`} className="text-destructive">
                    {err.rowNumber > 0 ? `Row ${err.rowNumber}: ` : ""}
                    {err.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {validRows.length > 0 && rowErrors.length === 0 && (
            <div className="max-h-36 overflow-y-auto rounded-lg border text-xs">
              <table className="w-full">
                <thead className="sticky top-0 bg-muted/50">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium">Product</th>
                    <th className="px-2 py-1.5 text-left font-medium">Service</th>
                    <th className="px-2 py-1.5 text-left font-medium">Pref</th>
                    <th className="px-2 py-1.5 text-right font-medium">Qty</th>
                    <th className="px-2 py-1.5 text-right font-medium">Pack</th>
                  </tr>
                </thead>
                <tbody>
                  {validRows.slice(0, 10).map((row) => (
                    <tr key={row.rowNumber} className="border-t">
                      <td className="max-w-[120px] truncate px-2 py-1">{row.productName}</td>
                      <td className="px-2 py-1">{formatServiceLabel(row.service)}</td>
                      <td className="px-2 py-1">
                        {formatShipmentPreferenceLabel(row.shipmentPreference)}
                      </td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.quantity}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{row.packOf}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validRows.length > 10 && (
                <p className="border-t px-2 py-1 text-muted-foreground">
                  +{validRows.length - 10} more pack lines
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={
              submitting ||
              !user ||
              !ownerId ||
              requestGroups.length === 0 ||
              rowErrors.length > 0 ||
              parseErrors.length > 0
            }
            onClick={() => void handleSubmit()}
          >
            {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Submit{" "}
            {requestGroups.length > 0
              ? `${requestGroups.length} request${requestGroups.length === 1 ? "" : "s"}`
              : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
