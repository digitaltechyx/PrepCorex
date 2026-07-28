"use client";

import { useMemo, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Download, Package, MapPin, Calendar, Truck, ExternalLink, Filter } from "lucide-react";
import type { LabelPurchase } from "@/types";
import { format } from "date-fns";

type PurchasedLabelsPanelProps = {
  userId: string | null | undefined;
  emptyHint?: string;
};

function getStatusBadge(label: LabelPurchase) {
  const { status, paymentStatus, errorMessage } = label;

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
    case "payment_failed":
      return <Badge variant="destructive">Payment Failed</Badge>;
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
    return {
      tone: "error",
      title: "Issue on our side",
      message:
        sanitizedError ||
        "We ran into an issue generating this label. Please try again in a moment or contact support.",
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

export function PurchasedLabelsPanel({
  userId,
  emptyHint = "Purchase your first shipping label to get started",
}: PurchasedLabelsPanelProps) {
  const { data: labels, loading } = useCollection<LabelPurchase>(
    userId ? `users/${userId}/labelPurchases` : ""
  );

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const safeLabels = labels || [];

  const filteredLabels = useMemo(() => {
    if (!startDate && !endDate) return safeLabels;

    return safeLabels.filter((label) => {
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
  }, [safeLabels, startDate, endDate]);

  if (!userId) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-12">
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
    <div className="space-y-6">
      {safeLabels.length > 0 && (
        <Card className="rounded-2xl border border-border/70 shadow-sm">
          <CardHeader className="pb-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Filter className="h-4 w-4" />
                </span>
                <div>
                  <CardTitle className="text-base">Filter by Date</CardTitle>
                  <CardDescription>Narrow labels by purchase date range.</CardDescription>
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                className="mt-4 w-full sm:w-auto"
              >
                Clear Date Filter
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {safeLabels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Package className="mb-4 h-12 w-12 text-muted-foreground" />
            <p className="text-lg font-medium">No labels purchased yet</p>
            <p className="mt-2 text-sm text-muted-foreground">{emptyHint}</p>
          </CardContent>
        </Card>
      ) : filteredLabels.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
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
                className="mt-4"
              >
                Clear Date Filter
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredLabels.map((label, index) => (
            <Card
              key={label.id || `label-${index}`}
              className="rounded-2xl border border-border/70 transition-shadow hover:shadow-md"
            >
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base font-semibold">
                      Label #{label.id ? label.id.slice(0, 8) : "N/A"}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {label.selectedRate?.provider || "Unknown"} •{" "}
                      {label.selectedRate?.serviceLevel || "Standard"}
                    </CardDescription>
                  </div>
                  {getStatusBadge(label)}
                </div>
              </CardHeader>
              <CardContent className="space-y-4 pt-0">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">To:</span>
                    <span className="text-muted-foreground">
                      {label.toAddress?.city || "N/A"}, {label.toAddress?.state || "N/A"}
                    </span>
                  </div>
                  {label.trackingNumber && (
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">Tracking:</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {label.trackingNumber}
                      </span>
                    </div>
                  )}
                  {label.createdAt && (
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">
                        {(() => {
                          try {
                            const date =
                              typeof label.createdAt === "string"
                                ? new Date(label.createdAt)
                                : label.createdAt?.seconds
                                  ? new Date(label.createdAt.seconds * 1000)
                                  : new Date();
                            return format(date, "MMM d, yyyy");
                          } catch {
                            return "Invalid date";
                          }
                        })()}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between border-t pt-2 text-xs">
                    <span className="text-muted-foreground">Amount</span>
                    <span className="text-base font-semibold">
                      {label.paymentCurrency?.toUpperCase() || "USD"} $
                      {label.paymentAmount ? (label.paymentAmount / 100).toFixed(2) : "0.00"}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  {label.labelUrl && label.status === "label_purchased" && (
                    <Button
                      size="sm"
                      onClick={() => handleDownloadLabel(label.labelUrl!)}
                      className="flex-1"
                    >
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </Button>
                  )}
                  {label.trackingNumber && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        handleTrackShipment(
                          label.trackingNumber!,
                          label.selectedRate?.provider || ""
                        )
                      }
                      className="flex-1"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Track
                    </Button>
                  )}
                </div>

                {(() => {
                  const detail = getStatusDetail(label);
                  if (!detail) return null;

                  const toneStyles: Record<typeof detail.tone, string> = {
                    warning: "border border-amber-200 bg-amber-50 text-amber-700",
                    error: "border border-red-200 bg-red-50 text-red-700",
                    info: "border border-sky-200 bg-sky-50 text-sky-700",
                  };

                  return (
                    <div className={`space-y-1 rounded p-3 text-xs ${toneStyles[detail.tone]}`}>
                      <p className="text-[11px] font-semibold uppercase tracking-wide opacity-80">
                        {detail.title}
                      </p>
                      <p className="text-[13px] leading-snug">{detail.message}</p>
                    </div>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
