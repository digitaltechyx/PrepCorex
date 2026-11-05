"use client";

import { useEffect, useMemo, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Download, Package, ExternalLink, Filter, RotateCcw } from "lucide-react";
import type { LabelPurchase, LabelRefundRequest } from "@/types";
import { getBuyLabelRateDisplay } from "@/lib/buy-label-rate-display";
import {
  canRequestLabelRefund,
  formatLabelRefundCountdown,
  labelPurchaseAnchorMs,
  isWalletLabelPayment,
  labelRefundDisplayStatus,
  LABEL_REFUND_REQUESTS_COLLECTION,
} from "@/lib/label-refund";
import { LabelRefundRequestDialog } from "@/components/labels/label-refund-request-dialog";
import { format } from "date-fns";

const PAGE_SIZE = 10;

type PurchasedLabelsPanelProps = {
  userId: string | null | undefined;
  emptyHint?: string;
  /** Tighter spacing for admin Buy Labels purchased tab. */
  compactLayout?: boolean;
};

function getStatusBadge(label: LabelPurchase) {
  const { status, paymentStatus, errorMessage, refundStatus } = label;
  const refundDisplay = labelRefundDisplayStatus(refundStatus);

  if (refundDisplay === "approved") {
    return <Badge className="bg-emerald-600 text-white">Refunded</Badge>;
  }
  if (refundDisplay === "declined") {
    return <Badge variant="destructive">Refund declined</Badge>;
  }
  if (refundDisplay === "pending") {
    return <Badge className="bg-amber-500 text-white">Refund pending</Badge>;
  }

  if (paymentStatus === "failed") {
    return <Badge variant="destructive">Payment Failed</Badge>;
  }

  if (paymentStatus === "canceled") {
    return <Badge className="bg-orange-500 text-white">Payment Canceled</Badge>;
  }

  if (paymentStatus === "pending" && errorMessage) {
    return <Badge className="bg-amber-500 text-white">Payment Issue</Badge>;
  }

  if (!status) return <Badge variant="outline">Unknown</Badge>;

  switch (status) {
    case "completed":
    case "label_purchased":
      return <Badge className="bg-green-500">Completed</Badge>;
    case "payment_succeeded":
      return <Badge className="bg-blue-500">Processing</Badge>;
    case "payment_pending":
      return <Badge className="bg-yellow-500">Pending</Badge>;
    case "label_failed":
      return <Badge variant="destructive">Label Failed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function sanitizeErrorMessage(message?: string | null) {
  if (!message) return "";
  return message.replace(/stripe/gi, "payment processor").trim();
}

function getStatusDetail(label: LabelPurchase): {
  tone: "warning" | "error" | "info";
  title: string;
  message: string;
} | null {
  const { status, paymentStatus, errorMessage } = label;
  const sanitizedError = sanitizeErrorMessage(errorMessage);

  if (paymentStatus === "failed") {
    return {
      tone: "error",
      title: "Payment declined",
      message:
        sanitizedError ||
        "Your payment provider declined this charge. Please verify details with your bank or update the card before trying again.",
    };
  }

  if (paymentStatus === "canceled") {
    return {
      tone: "warning",
      title: "Payment canceled",
      message: "You canceled this payment before it completed. Start a new purchase when you're ready.",
    };
  }

  if (paymentStatus === "pending" && errorMessage) {
    return {
      tone: "warning",
      title: "Action required",
      message:
        sanitizedError ||
        "Your payment provider needs confirmation. Complete any authentication prompts or contact them, then retry the payment.",
    };
  }

  if (status === "label_failed") {
    const alreadyRefunded =
      String(label.refundStatus || "").toLowerCase() === "refunded" ||
      label.autoRefundedOnFailure === true;
    return {
      tone: alreadyRefunded ? "info" : "error",
      title: alreadyRefunded ? "Label failed — refunded" : "Label not created",
      message: alreadyRefunded
        ? sanitizedError
          ? `${sanitizedError} This amount was returned to your label wallet.`
          : "Label creation failed. This amount was returned to your label wallet."
        : sanitizedError ||
          "Payment went through but the carrier could not generate the label. Check phone numbers and addresses, then buy again or contact support for a refund.",
    };
  }

  if (status === "payment_pending" && paymentStatus === "pending") {
    return {
      tone: "info",
      title: "Processing",
      message:
        "Awaiting confirmation from your payment provider. If your card shows declined or incomplete, resolve it with them and retry the purchase.",
    };
  }

  return null;
}

function getRefundRejectionReason(
  label: LabelPurchase,
  refundByPurchaseId: Map<string, LabelRefundRequest>
): string | null {
  const fromLabel = String(label.refundRejectionReason || "").trim();
  if (fromLabel) return fromLabel;
  const linked = refundByPurchaseId.get(label.id);
  const fromRequest = String(linked?.rejectionReason || "").trim();
  return fromRequest || null;
}

function handleDownloadLabel(labelUrl: string) {
  if (labelUrl) {
    window.open(labelUrl, "_blank");
  } else {
    alert("Label URL not available");
  }
}

function handleTrackShipment(trackingNumber: string, provider: string) {
  let trackingUrl = "";
  switch (provider.toLowerCase()) {
    case "usps":
      trackingUrl = `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingNumber}`;
      break;
    case "ups":
      trackingUrl = `https://www.ups.com/track?tracknum=${trackingNumber}`;
      break;
    case "fedex":
      trackingUrl = `https://www.fedex.com/fedextrack/?trknbr=${trackingNumber}`;
      break;
    case "dhl":
      trackingUrl = `https://www.dhl.com/en/express/tracking.html?AWB=${trackingNumber}`;
      break;
    default:
      trackingUrl = `https://www.google.com/search?q=track+${trackingNumber}`;
  }
  window.open(trackingUrl, "_blank");
}

function formatLabelDate(label: LabelPurchase): string {
  if (!label.createdAt) return "—";
  try {
    const date =
      typeof label.createdAt === "string"
        ? new Date(label.createdAt)
        : label.createdAt?.seconds
          ? new Date(label.createdAt.seconds * 1000)
          : null;
    if (!date || Number.isNaN(date.getTime())) return "Invalid date";
    return format(date, "MMM d, yyyy");
  } catch {
    return "Invalid date";
  }
}

function carrierServiceLabel(label: LabelPurchase): string {
  const display = getBuyLabelRateDisplay({
    provider: label.selectedRate?.provider,
    serviceLevel: label.selectedRate?.serviceLevel,
    labelProvider: label.selectedRate?.labelProvider,
    objectId: label.selectedRate?.objectId,
  });
  return `${display.provider} · ${display.service}`;
}

function LabelRefundActions({
  label,
  refundByPurchaseId,
  onRequestRefund,
}: {
  label: LabelPurchase;
  refundByPurchaseId: Map<string, LabelRefundRequest>;
  onRequestRefund: (label: LabelPurchase) => void;
}) {
  const refundDisplay = labelRefundDisplayStatus(label.refundStatus);

  if (refundDisplay === "approved") {
    const walletRefund = isWalletLabelPayment(label);
    const autoRefund = label.autoRefundedOnFailure === true;
    return (
      <p className="max-w-[220px] text-[11px] leading-snug text-emerald-700">
        {autoRefund
          ? "Auto-refunded to wallet after label failure."
          : walletRefund
            ? "Refund approved — credited to wallet."
            : "Refund approved — sent to original payment."}
      </p>
    );
  }

  if (refundDisplay === "declined") {
    const rejectionReason = getRefundRejectionReason(label, refundByPurchaseId);
    return (
      <p className="max-w-[220px] text-[11px] leading-snug text-red-700">
        {rejectionReason || "Refund declined."}
      </p>
    );
  }

  if (refundDisplay === "pending") {
    return (
      <Button size="sm" variant="secondary" disabled className="h-8">
        Refund pending
      </Button>
    );
  }

  const eligibility = canRequestLabelRefund(label);
  const anchorMs = labelPurchaseAnchorMs(label);

  return (
    <div className="space-y-1">
      <Button
        size="sm"
        variant="outline"
        className="h-8"
        disabled={!eligibility.ok}
        title={eligibility.reason}
        onClick={() => onRequestRefund(label)}
      >
        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
        {eligibility.ok ? "Refund" : "No refund"}
      </Button>
      <p className="max-w-[200px] text-[10px] leading-snug text-muted-foreground">
        {eligibility.ok
          ? `Available for ${formatLabelRefundCountdown(anchorMs)}`
          : eligibility.reason}
      </p>
    </div>
  );
}

export function PurchasedLabelsPanel({
  userId,
  emptyHint = "Purchase your first shipping label to get started",
  compactLayout = false,
}: PurchasedLabelsPanelProps) {
  const outerGap = compactLayout ? "space-y-3 sm:space-y-6" : "space-y-6";
  const cardPad = compactLayout ? "p-3 sm:p-6" : undefined;
  const { data: labels, loading } = useCollection<LabelPurchase>(
    userId ? `users/${userId}/labelPurchases` : ""
  );
  const { data: refundRequests } = useCollection<LabelRefundRequest>(
    userId ? `users/${userId}/${LABEL_REFUND_REQUESTS_COLLECTION}` : ""
  );

  const refundByPurchaseId = useMemo(() => {
    const map = new Map<string, LabelRefundRequest>();
    for (const request of refundRequests || []) {
      if (request.labelPurchaseId) {
        map.set(request.labelPurchaseId, request);
      }
    }
    return map;
  }, [refundRequests]);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [refundLabel, setRefundLabel] = useState<LabelPurchase | null>(null);
  const safeLabels = labels || [];

  const filteredLabels = useMemo(() => {
    const getCreatedAtMs = (label: LabelPurchase): number => {
      if (!label.createdAt) return 0;
      try {
        if (typeof label.createdAt === "string") {
          const ms = new Date(label.createdAt).getTime();
          return Number.isFinite(ms) ? ms : 0;
        }
        if (typeof label.createdAt === "object" && "seconds" in label.createdAt) {
          return (label.createdAt as { seconds: number }).seconds * 1000;
        }
      } catch {
        return 0;
      }
      return 0;
    };

    let list = safeLabels;

    if (startDate || endDate) {
      list = safeLabels.filter((label) => {
        if (!label.createdAt) return false;

        let labelDate: Date;
        try {
          if (typeof label.createdAt === "string") {
            labelDate = new Date(label.createdAt);
          } else if (label.createdAt && typeof label.createdAt === "object" && "seconds" in label.createdAt) {
            labelDate = new Date((label.createdAt as { seconds: number }).seconds * 1000);
          } else {
            return false;
          }
        } catch {
          return false;
        }

        const labelDateOnly = new Date(
          labelDate.getFullYear(),
          labelDate.getMonth(),
          labelDate.getDate()
        );

        if (startDate && endDate) {
          const fromDate = new Date(startDate);
          const toDate = new Date(endDate);
          const fromDateOnly = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
          const toDateOnly = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
          return labelDateOnly >= fromDateOnly && labelDateOnly <= toDateOnly;
        }
        if (startDate) {
          const fromDate = new Date(startDate);
          const fromDateOnly = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
          return labelDateOnly >= fromDateOnly;
        }
        if (endDate) {
          const toDate = new Date(endDate);
          const toDateOnly = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
          return labelDateOnly <= toDateOnly;
        }
        return true;
      });
    }

    return [...list].sort((a, b) => getCreatedAtMs(b) - getCreatedAtMs(a));
  }, [safeLabels, startDate, endDate]);

  const totalPages = Math.max(1, Math.ceil(filteredLabels.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate, userId]);

  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [currentPage, totalPages]);

  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, filteredLabels.length);
  const pageLabels = filteredLabels.slice(pageStart, pageEnd);

  if (!userId) {
    return (
      <Card className="min-w-0 overflow-hidden">
        <CardContent className={`flex flex-col items-center justify-center py-8 sm:py-12 ${cardPad ?? ""}`}>
          <Package className="mb-4 h-12 w-12 text-muted-foreground" />
          <p className="text-lg font-medium">Select an account</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose whose purchased labels you want to view.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className={`min-w-0 ${outerGap}`}>
      {safeLabels.length > 0 && (
        <Card
          className={`min-w-0 overflow-hidden border border-border/70 shadow-sm ${compactLayout ? "rounded-xl sm:rounded-2xl" : "rounded-2xl"}`}
        >
          <CardHeader
            className={
              compactLayout
                ? "border-b bg-muted/20 p-3 pb-3 sm:p-6 sm:pb-4"
                : "pb-4"
            }
          >
            <div className="flex flex-wrap items-center justify-between gap-3 sm:gap-4">
              <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary sm:h-9 sm:w-9">
                  <Filter className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <CardTitle className={compactLayout ? "text-sm sm:text-base" : "text-base"}>
                    Filter by Date
                  </CardTitle>
                  <CardDescription className={compactLayout ? "text-xs sm:text-sm" : undefined}>
                    Narrow labels by purchase date range.
                  </CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className={compactLayout ? "p-3 pt-0 sm:p-6 sm:pt-0" : "pt-0"}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="purchased-labels-start-date"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  From Date
                </Label>
                <Input
                  id="purchased-labels-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="purchased-labels-end-date"
                  className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  To Date
                </Label>
                <Input
                  id="purchased-labels-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>
            {(startDate || endDate) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="mt-3 w-full sm:mt-4 sm:w-auto"
              >
                Clear Date Filter
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {safeLabels.length === 0 ? (
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="flex flex-col items-center justify-center py-8 sm:py-12">
            <Package className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">No labels purchased yet</p>
            <p className="mt-2 text-sm text-muted-foreground">{emptyHint}</p>
          </CardContent>
        </Card>
      ) : filteredLabels.length === 0 ? (
        <Card className="min-w-0 overflow-hidden">
          <CardContent className="flex flex-col items-center justify-center py-8 sm:py-12">
            <Package className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">No labels found</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {startDate || endDate
                ? "No labels match the selected date range. Try adjusting your filters."
                : emptyHint}
            </p>
            {(startDate || endDate) && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStartDate("");
                  setEndDate("");
                }}
                className="mt-3 w-full sm:mt-4 sm:w-auto"
              >
                Clear Date Filter
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card
          className={`min-w-0 overflow-hidden border border-border/70 shadow-sm ${compactLayout ? "rounded-xl sm:rounded-2xl" : "rounded-2xl"}`}
        >
          <CardContent className={compactLayout ? "p-0 sm:p-0" : "p-0"}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[100px]">Label</TableHead>
                    <TableHead className="min-w-[120px]">Status</TableHead>
                    <TableHead className="min-w-[140px]">Carrier</TableHead>
                    <TableHead className="min-w-[120px]">Destination</TableHead>
                    <TableHead className="min-w-[140px]">Tracking</TableHead>
                    <TableHead className="min-w-[100px]">Date</TableHead>
                    <TableHead className="min-w-[90px] text-right">Amount</TableHead>
                    <TableHead className="min-w-[220px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageLabels.map((label, index) => {
                    const detail = getStatusDetail(label);
                    const toneText: Record<"warning" | "error" | "info", string> = {
                      warning: "text-amber-700",
                      error: "text-red-700",
                      info: "text-sky-700",
                    };
                    const canDownload =
                      Boolean(label.labelUrl) &&
                      (label.status === "label_purchased" || label.status === "completed") &&
                      String(label.refundStatus || "").toLowerCase() !== "refunded";

                    return (
                      <TableRow key={label.id || `label-${pageStart + index}`}>
                        <TableCell className="align-top font-medium">
                          #{label.id ? label.id.slice(0, 8) : "N/A"}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="space-y-1">
                            {getStatusBadge(label)}
                            {detail ? (
                              <p className={`max-w-[180px] text-[11px] leading-snug ${toneText[detail.tone]}`}>
                                <span className="font-semibold">{detail.title}: </span>
                                {detail.message}
                              </p>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="align-top text-sm text-muted-foreground">
                          {carrierServiceLabel(label)}
                        </TableCell>
                        <TableCell className="align-top text-sm">
                          {label.toAddress?.city || "N/A"}, {label.toAddress?.state || "N/A"}
                        </TableCell>
                        <TableCell className="align-top">
                          {label.trackingNumber ? (
                            <span className="font-mono text-xs">{label.trackingNumber}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="align-top whitespace-nowrap text-sm text-muted-foreground">
                          {formatLabelDate(label)}
                        </TableCell>
                        <TableCell className="align-top whitespace-nowrap text-right font-semibold">
                          {label.paymentCurrency?.toUpperCase() || "USD"} $
                          {label.paymentAmount ? (label.paymentAmount / 100).toFixed(2) : "0.00"}
                        </TableCell>
                        <TableCell className="align-top">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap gap-1.5">
                              {canDownload ? (
                                <Button
                                  size="sm"
                                  className="h-8"
                                  onClick={() => handleDownloadLabel(label.labelUrl!)}
                                >
                                  <Download className="mr-1.5 h-3.5 w-3.5" />
                                  Download
                                </Button>
                              ) : null}
                              {label.trackingNumber ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-8"
                                  onClick={() =>
                                    handleTrackShipment(
                                      label.trackingNumber!,
                                      label.selectedRate?.provider || ""
                                    )
                                  }
                                >
                                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                                  Track
                                </Button>
                              ) : null}
                            </div>
                            <LabelRefundActions
                              label={label}
                              refundByPurchaseId={refundByPurchaseId}
                              onRequestRefund={setRefundLabel}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <p className="text-sm text-muted-foreground">
                Showing {pageStart + 1} to {pageEnd} of {filteredLabels.length} labels
              </p>
              {filteredLabels.length > PAGE_SIZE ? (
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm tabular-nums">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          </CardContent>
        </Card>
      )}

      <LabelRefundRequestDialog
        open={Boolean(refundLabel)}
        label={refundLabel}
        onOpenChange={(open) => {
          if (!open) setRefundLabel(null);
        }}
      />
    </div>
  );
}
