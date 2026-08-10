"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import {
  formatLabelAge,
  formatLabelMoney,
  formatLabelProviderName,
  labelRefundRequestsPath,
} from "@/lib/label-refund";
import type { LabelRefundRequest } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { AlertTriangle, ExternalLink, Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  userId: string | null;
  refundRequestId: string | null;
  viewOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved?: () => void;
};

export function LabelRefundReviewDialog({
  open,
  userId,
  refundRequestId,
  viewOnly = false,
  onOpenChange,
  onResolved,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [request, setRequest] = useState<LabelRefundRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");

  useEffect(() => {
    if (!open || !userId || !refundRequestId) {
      setRequest(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void getDoc(doc(db, labelRefundRequestsPath(userId), refundRequestId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setRequest(null);
          return;
        }
        setRequest({ id: snap.id, ...(snap.data() as Omit<LabelRefundRequest, "id">) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Could not load refund request",
          description: error instanceof Error ? error.message : "Try again.",
        });
        setRequest(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, userId, refundRequestId, toast]);

  const runReview = async (action: "approve" | "reject") => {
    if (!user || !userId || !refundRequestId) return;
    if (action === "reject" && rejectionReason.trim().length < 3) {
      toast({
        variant: "destructive",
        title: "Rejection reason required",
        description: "Tell the client why this refund was declined.",
      });
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/label-refunds/review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId,
          refundRequestId,
          action,
          rejectionReason: action === "reject" ? rejectionReason.trim() : undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not process refund.");
      }
      toast({
        title: action === "approve" ? "Refund approved" : "Refund declined",
        description:
          action === "approve"
            ? "Stripe refund was created. The client has been notified."
            : "The client has been notified.",
      });
      onOpenChange(false);
      onResolved?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Review failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setBusy(false);
    }
  };

  const generatedAt = request?.labelGeneratedAtMs
    ? format(new Date(request.labelGeneratedAtMs), "PPp")
    : "N/A";
  const providerName = formatLabelProviderName(request?.labelProvider);
  const showPlatformIssue = Boolean(request?.platformIssueClaimed || request?.platformIssueDetected);
  const proofUrls = Array.isArray(request?.proofUrls) ? request!.proofUrls!.filter(Boolean) : [];

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[min(92vh,820px)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Label refund review</DialogTitle>
          <DialogDescription>
            Verify Shippo / ShipBest purchase details, then approve to refund via Stripe or decline.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !request ? (
          <p className="text-sm text-muted-foreground">Request not found.</p>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="capitalize">
                {request.status}
              </Badge>
              <Badge variant="secondary">{providerName}</Badge>
              <span className="text-muted-foreground">{request.userName}</span>
            </div>

            {showPlatformIssue ? (
              <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-100">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-medium">Possible issue on our side</p>
                  <p className="text-xs opacity-90">
                    {request.platformIssueDetected
                      ? "System detected a label-generation / integration failure."
                      : "Client marked this as a PrepCorex / platform problem."}
                    {request.platformIssueClaimed && request.platformIssueDetected
                      ? " Client also confirmed this."
                      : null}
                  </p>
                </div>
              </div>
            ) : null}

            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5">
              <p>
                <span className="text-muted-foreground">Price paid: </span>
                <span className="font-semibold">
                  {formatLabelMoney(request.paymentAmount, request.paymentCurrency)}
                </span>
                {request.selectedRateAmount ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · rate {request.selectedRateAmount}{" "}
                    {String(request.selectedRateCurrency || "").toUpperCase()}
                  </span>
                ) : null}
              </p>
              <p>
                <span className="text-muted-foreground">Label provider: </span>
                <span className="font-medium">{providerName}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Carrier / service: </span>
                {[request.carrierProvider, request.serviceLevel].filter(Boolean).join(" · ") || "N/A"}
              </p>
              <p>
                <span className="text-muted-foreground">Purchase status: </span>
                <span className="capitalize">
                  {String(request.labelPurchaseStatus || "unknown").replace(/_/g, " ")}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Label generated: </span>
                {generatedAt}
              </p>
              <p>
                <span className="text-muted-foreground">Age: </span>
                {formatLabelAge(request.labelGeneratedAtMs)}
              </p>
              <p>
                <span className="text-muted-foreground">Tracking: </span>
                {request.trackingNumber ? (
                  <span className="font-mono text-xs">{request.trackingNumber}</span>
                ) : (
                  "Not available"
                )}
              </p>
              {request.labelUrl ? (
                <p>
                  <span className="text-muted-foreground">Label PDF: </span>
                  <a
                    href={request.labelUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                  >
                    Open label
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </p>
              ) : null}
              {String(request.labelProvider || "").toLowerCase() === "shippo" ||
              request.shippoTransactionId ? (
                <p>
                  <span className="text-muted-foreground">Shippo transaction: </span>
                  <span className="font-mono text-xs">{request.shippoTransactionId || "—"}</span>
                </p>
              ) : null}
              {String(request.labelProvider || "").toLowerCase() === "shipbest" ||
              request.shipbestOrderNo ||
              request.shipbestCustomNo ? (
                <>
                  <p>
                    <span className="text-muted-foreground">ShipBest order: </span>
                    <span className="font-mono text-xs">{request.shipbestOrderNo || "—"}</span>
                  </p>
                  <p>
                    <span className="text-muted-foreground">ShipBest custom no: </span>
                    <span className="font-mono text-xs">{request.shipbestCustomNo || "—"}</span>
                  </p>
                </>
              ) : null}
              <p>
                <span className="text-muted-foreground">Stripe PI: </span>
                <span className="font-mono text-xs">{request.stripePaymentIntentId}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Ship from → to: </span>
                {[request.fromName, [request.toName, request.toCity, request.toCountry].filter(Boolean).join(", ")]
                  .filter(Boolean)
                  .join(" → ") || "N/A"}
              </p>
              <p>
                <span className="text-muted-foreground">Label ID: </span>
                <span className="font-mono text-xs">{request.labelPurchaseId}</span>
              </p>
              {request.errorMessage ? (
                <p className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-destructive">
                  <span className="font-medium">Purchase error: </span>
                  {request.errorMessage}
                </p>
              ) : null}
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Client reason
              </p>
              <p className="rounded-md border px-3 py-2 whitespace-pre-wrap">{request.reason}</p>
            </div>

            {proofUrls.length > 0 ? (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Client proof
                </p>
                <div className="flex flex-wrap gap-2">
                  {proofUrls.map((url) => (
                    <a
                      key={url}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block h-20 w-20 overflow-hidden rounded-md border ring-offset-background hover:ring-2 hover:ring-primary/40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={url} alt="Refund proof" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {!viewOnly && request.status === "pending" ? (
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor="label-refund-reject-reason">Rejection reason (if declining)</Label>
                <Textarea
                  id="label-refund-reject-reason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="Optional unless you decline…"
                  className="min-h-[80px]"
                  disabled={busy}
                />
              </div>
            ) : null}

            {request.status === "rejected" && request.rejectionReason ? (
              <p className="text-sm text-destructive">Declined: {request.rejectionReason}</p>
            ) : null}
            {request.status === "approved" && request.stripeRefundId ? (
              <p className="text-sm text-emerald-700">
                Stripe refund: <span className="font-mono text-xs">{request.stripeRefundId}</span>
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!viewOnly && request?.status === "pending" ? (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={busy || loading}
                onClick={() => void runReview("reject")}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Decline
              </Button>
              <Button
                type="button"
                disabled={busy || loading}
                onClick={() => void runReview("approve")}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Approve &amp; refund
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
