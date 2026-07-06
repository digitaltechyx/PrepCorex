"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronRight, Download, FileUp, Info, Loader2, RotateCcw, Trash2, Upload } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  downloadBuyLabelsBulkTemplate,
  parseBuyLabelsBulkCsv,
  pickShippingRate,
  validateBuyLabelsBulkRows,
  type BuyLabelLocationInput,
  type BuyLabelsBulkRowError,
  type BuyLabelsBulkValidatedRow,
} from "@/lib/buy-labels-bulk-import";
import { formatWarehouseDisplayName } from "@/lib/warehouse-display";
import type { ParcelDetails, ShippingAddress, ShippingRate } from "@/types";

export type BuyLabelCartImportItem = {
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: ParcelDetails & { weight: number; weightUnit: "lb" };
  selectedRate: ShippingRate;
  shipmentId: string | null;
};

type BulkImportRatedRow = {
  row: BuyLabelsBulkValidatedRow;
  rates: ShippingRate[];
  shipmentId: string | null;
  selectedRate: ShippingRate | null;
  rateError?: string;
  excluded: boolean;
};

type BuyLabelsBulkImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationOptions: BuyLabelLocationInput[];
  defaultFromName: string;
  defaultFromPhone?: string;
  onAddToCart: (items: BuyLabelCartImportItem[]) => void;
};

function formatRatePrice(rate: ShippingRate): string {
  return `$${parseFloat(rate.amount).toFixed(2)}`;
}

export function BuyLabelsBulkImportDialog({
  open,
  onOpenChange,
  locationOptions,
  defaultFromName,
  defaultFromPhone,
  onAddToCart,
}: BuyLabelsBulkImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [validRows, setValidRows] = useState<BuyLabelsBulkValidatedRow[]>([]);
  const [rowErrors, setRowErrors] = useState<BuyLabelsBulkRowError[]>([]);
  const [rowWarnings, setRowWarnings] = useState<BuyLabelsBulkRowError[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [rateProgress, setRateProgress] = useState<{ done: number; total: number } | null>(null);
  const [templateLocationId, setTemplateLocationId] = useState("");
  const [ratedRows, setRatedRows] = useState<BulkImportRatedRow[]>([]);
  const [reviewStep, setReviewStep] = useState(false);

  const locationsById = useMemo(
    () => new Map(locationOptions.map((loc) => [loc.id, loc])),
    [locationOptions]
  );

  const needsLocationPicker = locationOptions.length > 1;

  const resetState = useCallback(() => {
    setFileName("");
    setValidRows([]);
    setRowErrors([]);
    setRowWarnings([]);
    setParseErrors([]);
    setRateProgress(null);
    setRatedRows([]);
    setReviewStep(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleOpenChange = (next: boolean) => {
    if (!next) resetState();
    onOpenChange(next);
  };

  const effectiveTemplateLocationId = useMemo(() => {
    if (locationOptions.length === 0) return "";
    if (templateLocationId && locationOptions.some((loc) => loc.id === templateLocationId)) {
      return templateLocationId;
    }
    return locationOptions[0]?.id ?? "";
  }, [locationOptions, templateLocationId]);

  const revalidate = useCallback(
    (text: string) => {
      const { rows, errors: parseErrs } = parseBuyLabelsBulkCsv(text);
      setParseErrors(parseErrs);
      setRatedRows([]);
      setReviewStep(false);
      if (parseErrs.length > 0) {
        setValidRows([]);
        setRowErrors([]);
        setRowWarnings([]);
        return;
      }
      const { valid, errors, warnings } = validateBuyLabelsBulkRows(rows, {
        locations: locationOptions,
        defaultFromName,
        defaultFromPhone,
        templateLocationId: effectiveTemplateLocationId,
      });
      setValidRows(valid);
      setRowErrors(errors);
      setRowWarnings(warnings);
    },
    [locationOptions, defaultFromName, defaultFromPhone, effectiveTemplateLocationId]
  );

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

  const handleDownloadTemplate = () => {
    const location = locationsById.get(effectiveTemplateLocationId);
    if (!location) {
      toast({
        variant: "destructive",
        title: "No location",
        description: "Select a warehouse location before downloading the template.",
      });
      return;
    }

    downloadBuyLabelsBulkTemplate(location, {
      fromName: defaultFromName,
      fromPhone: defaultFromPhone,
    });

    toast({
      title: "Template downloaded",
      description: `From address filled for ${formatWarehouseDisplayName(location.name)}. Add To address and parcel details on each row you want to ship.`,
    });
  };

  const handleGetRates = async () => {
    if (validRows.length === 0 || rowErrors.length > 0 || parseErrors.length > 0) return;

    setSubmitting(true);
    setRateProgress({ done: 0, total: validRows.length });

    const nextRated: BulkImportRatedRow[] = [];
    const fetchErrors: BuyLabelsBulkRowError[] = [];

    try {
      for (let i = 0; i < validRows.length; i++) {
        const row = validRows[i];
        setRateProgress({ done: i, total: validRows.length });

        const response = await fetch("/api/shippo/rates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromAddress: row.fromAddress,
            toAddress: row.toAddress,
            parcel: row.parcel,
          }),
        });

        if (!response.ok) {
          let message = "Failed to get rates";
          try {
            const err = await response.json();
            message = err.error || message;
          } catch {
            /* ignore */
          }
          fetchErrors.push({ rowNumber: row.rowNumber, message });
          nextRated.push({
            row,
            rates: [],
            shipmentId: null,
            selectedRate: null,
            rateError: message,
            excluded: false,
          });
          continue;
        }

        const data = await response.json();
        const rates: ShippingRate[] = data.rates || [];
        const shipmentId = data.shipment_id || null;
        const selectedRate = pickShippingRate(rates);

        if (!selectedRate) {
          fetchErrors.push({
            rowNumber: row.rowNumber,
            message: "No shipping rates available.",
          });
          nextRated.push({
            row,
            rates: [],
            shipmentId,
            selectedRate: null,
            rateError: "No shipping rates available.",
            excluded: false,
          });
          continue;
        }

        nextRated.push({
          row,
          rates,
          shipmentId,
          selectedRate,
          excluded: false,
        });
      }

      setRateProgress({ done: validRows.length, total: validRows.length });
      setRatedRows(nextRated);
      setReviewStep(true);

      const readyCount = nextRated.filter((r) => r.selectedRate).length;
      if (readyCount === 0) {
        toast({
          variant: "destructive",
          title: "No rates found",
          description: "Could not get rates for any rows. Check addresses and parcel details.",
        });
        setRowErrors((prev) => [...prev, ...fetchErrors]);
        setReviewStep(false);
        return;
      }

      if (fetchErrors.length > 0) {
        setRowErrors((prev) => [...prev, ...fetchErrors]);
        toast({
          title: "Rates loaded with errors",
          description: `${readyCount} of ${validRows.length} labels have rates. Fix failed rows or remove them before checkout.`,
        });
      } else {
        toast({
          title: "Rates ready",
          description: `Cheapest rate selected for each label. Review carriers below, then add to cart.`,
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Failed to get rates",
        description: e instanceof Error ? e.message : "Could not fetch shipping rates.",
      });
    } finally {
      setSubmitting(false);
      setRateProgress(null);
    }
  };

  const handleSelectRate = (rowNumber: number, rate: ShippingRate) => {
    setRatedRows((prev) =>
      prev.map((entry) =>
        entry.row.rowNumber === rowNumber ? { ...entry, selectedRate: rate } : entry
      )
    );
  };

  const handleRemoveRow = (rowNumber: number) => {
    setRatedRows((prev) =>
      prev.map((entry) =>
        entry.row.rowNumber === rowNumber ? { ...entry, excluded: true } : entry
      )
    );
  };

  const handleRestoreRow = (rowNumber: number) => {
    setRatedRows((prev) =>
      prev.map((entry) =>
        entry.row.rowNumber === rowNumber ? { ...entry, excluded: false } : entry
      )
    );
  };

  const handleAddToCart = () => {
    const cartItems: BuyLabelCartImportItem[] = ratedRows
      .filter((entry) => !entry.excluded && entry.selectedRate)
      .map((entry) => ({
        fromAddress: entry.row.fromAddress,
        toAddress: entry.row.toAddress,
        parcel: entry.row.parcel,
        selectedRate: entry.selectedRate!,
        shipmentId: entry.shipmentId || entry.selectedRate!.shipment || null,
      }));

    if (cartItems.length === 0) {
      toast({
        variant: "destructive",
        title: "Nothing to add",
        description: "Select a shipping rate for at least one label.",
      });
      return;
    }

    onAddToCart(cartItems);

    const excludedCount = ratedRows.filter((r) => r.excluded).length;
    const noRateCount = ratedRows.filter((r) => !r.excluded && !r.selectedRate).length;
    if (excludedCount > 0 || noRateCount > 0) {
      const parts: string[] = [];
      if (excludedCount > 0) parts.push(`${excludedCount} removed`);
      if (noRateCount > 0) parts.push(`${noRateCount} without rates`);
      toast({
        title: "Added to cart",
        description: `${cartItems.length} label${cartItems.length === 1 ? "" : "s"} added (${parts.join(", ")} skipped).`,
      });
      handleOpenChange(false);
    } else {
      toast({
        title: "Added to cart",
        description: `${cartItems.length} label${cartItems.length === 1 ? "" : "s"} added. Review the cart and checkout when ready.`,
      });
      handleOpenChange(false);
    }
  };

  const handleBackToUpload = () => {
    setReviewStep(false);
    setRatedRows([]);
  };

  const cartReadyCount = ratedRows.filter((r) => !r.excluded && r.selectedRate).length;
  const cartTotal = ratedRows.reduce(
    (sum, entry) =>
      sum +
      (!entry.excluded && entry.selectedRate ? parseFloat(entry.selectedRate.amount) : 0),
    0
  );
  const excludedCount = ratedRows.filter((r) => r.excluded).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={`max-h-[90vh] overflow-y-auto ${reviewStep ? "sm:max-w-2xl" : "sm:max-w-lg"}`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Bulk import shipping labels
          </DialogTitle>
          <DialogDescription>
            {reviewStep
              ? "Review shipping rates for each label. The cheapest option is pre-selected — expand a row to compare carriers."
              : "Download a template with the same fields as the Buy Labels form. From address is pre-filled from your selected warehouse."}
          </DialogDescription>
        </DialogHeader>

        {!reviewStep ? (
          <div className="space-y-4">
            {locationOptions.length === 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm text-amber-900">
                No warehouse locations are available. Contact support to assign a location before
                using bulk import.
              </p>
            ) : (
              <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                {needsLocationPicker && (
                  <div className="space-y-2">
                    <Label>Warehouse location for template</Label>
                    <Select value={effectiveTemplateLocationId} onValueChange={setTemplateLocationId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select warehouse location" />
                      </SelectTrigger>
                      <SelectContent>
                        {locationOptions.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {formatWarehouseDisplayName(loc.name)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleDownloadTemplate}
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download template
                  {!needsLocationPicker && locationOptions[0]
                    ? ` (${formatWarehouseDisplayName(locationOptions[0].name)})`
                    : ""}
                </Button>
              </div>
            )}

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
                disabled={locationOptions.length === 0}
                onClick={() => fileInputRef.current?.click()}
              >
                <FileUp className="mr-2 h-4 w-4" />
                {fileName ? "Choose a different file" : "Upload filled CSV"}
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

            {rowWarnings.length > 0 && (
              <div className="max-h-28 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-sm">
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
                  <thead className="sticky top-0 bg-muted/50">
                    <tr>
                      <th className="px-2 py-1.5 text-left font-medium">To</th>
                      <th className="px-2 py-1.5 text-right font-medium">Weight</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.slice(0, 8).map((row) => (
                      <tr key={row.rowNumber} className="border-t">
                        <td className="max-w-[180px] truncate px-2 py-1">
                          {row.toAddress.name} — {row.toAddress.city}, {row.toAddress.state}
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums">
                          {row.parcel.weight.toFixed(2)} lb
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {rateProgress && (
              <p className="text-center text-sm text-muted-foreground">
                Fetching rates… {rateProgress.done}/{rateProgress.total}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex gap-2 rounded-lg border border-blue-200 bg-blue-50/80 p-3 text-sm text-blue-950 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100">
              <Info className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                The <strong>cheapest rate</strong> is selected for each label. Click{" "}
                <strong>See more pricing</strong> to compare carriers, or <strong>Remove</strong> any
                label you do not want in the cart.
              </p>
            </div>

            <Accordion type="multiple" className="rounded-lg border px-3">
              {ratedRows.map((entry) => {
                const { row, rates, selectedRate, rateError, excluded } = entry;
                const cheapest = pickShippingRate(rates);
                const isCheapestSelected =
                  selectedRate && cheapest && selectedRate.object_id === cheapest.object_id;

                if (excluded) {
                  return (
                    <div
                      key={row.rowNumber}
                      className="flex items-center justify-between gap-2 border-b py-3 opacity-60"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium line-through">
                          Row {row.rowNumber}: {row.toAddress.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {row.toAddress.city}, {row.toAddress.state} — removed from import
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="shrink-0"
                        onClick={() => handleRestoreRow(row.rowNumber)}
                      >
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Restore
                      </Button>
                    </div>
                  );
                }

                return (
                  <AccordionItem key={row.rowNumber} value={`row-${row.rowNumber}`}>
                    <div className="relative">
                      <AccordionTrigger className="py-3 pr-10 hover:no-underline">
                        <div className="flex flex-1 flex-col items-start gap-1 pr-2 text-left sm:flex-row sm:items-center sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              Row {row.rowNumber}: {row.toAddress.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {row.toAddress.city}, {row.toAddress.state} {row.toAddress.zip} ·{" "}
                              {row.parcel.weight.toFixed(2)} lb
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-start sm:items-end">
                            {rateError ? (
                              <span className="text-xs font-medium text-destructive">{rateError}</span>
                            ) : selectedRate ? (
                              <>
                                <span className="text-sm font-semibold text-primary">
                                  {selectedRate.provider} — {formatRatePrice(selectedRate)}
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {selectedRate.servicelevel.name}
                                  {isCheapestSelected ? " · Cheapest" : ""}
                                </span>
                              </>
                            ) : null}
                            <span className="mt-0.5 flex items-center text-xs font-medium text-primary">
                              See more pricing
                              <ChevronRight className="ml-0.5 h-3 w-3" />
                            </span>
                          </div>
                        </div>
                      </AccordionTrigger>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="absolute right-0 top-3 h-8 w-8 text-muted-foreground hover:text-destructive"
                        title="Remove from import"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveRow(row.rowNumber);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <AccordionContent>
                      {rateError ? (
                        <p className="text-sm text-destructive">{rateError}</p>
                      ) : rates.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No rates available.</p>
                      ) : (
                        <div className="space-y-2">
                          {rates.map((rate) => (
                            <Card
                              key={rate.object_id}
                              className={`cursor-pointer transition-all ${
                                selectedRate?.object_id === rate.object_id
                                  ? "border-primary bg-primary/5"
                                  : "hover:border-primary/50"
                              }`}
                              onClick={() => handleSelectRate(row.rowNumber, rate)}
                            >
                              <CardContent className="flex items-center justify-between p-3">
                                <div>
                                  <p className="font-semibold text-sm">{rate.provider}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {rate.servicelevel.name}
                                  </p>
                                  {rate.estimated_days != null && (
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                      Est. {rate.estimated_days} day
                                      {rate.estimated_days === 1 ? "" : "s"}
                                    </p>
                                  )}
                                  {cheapest?.object_id === rate.object_id && (
                                    <p className="text-xs font-medium text-emerald-600 mt-1">
                                      Cheapest
                                    </p>
                                  )}
                                </div>
                                <p className="font-bold text-lg">{formatRatePrice(rate)}</p>
                              </CardContent>
                            </Card>
                          ))}
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>

            {(cartReadyCount > 0 || excludedCount > 0) && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm flex flex-col gap-1 sm:flex-row sm:justify-between">
                <span>
                  {cartReadyCount} label{cartReadyCount === 1 ? "" : "s"} ready for cart
                  {excludedCount > 0 && (
                    <span className="text-muted-foreground">
                      {" "}
                      · {excludedCount} removed
                    </span>
                  )}
                </span>
                {cartReadyCount > 0 && (
                  <span className="font-semibold tabular-nums">Total: ${cartTotal.toFixed(2)}</span>
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {reviewStep ? (
            <>
              <Button type="button" variant="outline" onClick={handleBackToUpload} disabled={submitting}>
                Back
              </Button>
              <Button
                type="button"
                disabled={submitting || cartReadyCount === 0}
                onClick={handleAddToCart}
              >
                Add {cartReadyCount} to cart
              </Button>
            </>
          ) : (
            <>
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
                  locationOptions.length === 0 ||
                  validRows.length === 0 ||
                  rowErrors.length > 0 ||
                  parseErrors.length > 0
                }
                onClick={() => void handleGetRates()}
              >
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Getting rates…
                  </>
                ) : (
                  "Get shipping rates"
                )}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
