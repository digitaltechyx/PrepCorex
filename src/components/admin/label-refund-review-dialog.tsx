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
import { Loader2 } from "lucide-react";

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

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Label refund review</DialogTitle>
          <DialogDescription>
            Review purchase details, then approve to refund via Stripe or decline the request.
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
              <span className="text-muted-foreground">{request.userName}</span>
            </div>

            <div className="rounded-md border bg-muted/30 px-3 py-2 space-y-1.5">
              <p>
                <span className="text-muted-foreground">Price paid: </span>
                <span className="font-semibold">
                  {formatLabelMoney(request.paymentAmount, request.paymentCurrency)}
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
              <p>
                <span className="text-muted-foreground">Service: </span>
                {[request.carrierProvider, request.serviceLevel].filter(Boolean).join(" · ") ||
                  "N/A"}
              </p>
              <p>
                <span className="text-muted-foreground">Label ID: </span>
                <span className="font-mono text-xs">{request.labelPurchaseId}</span>
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Client reason
              </p>
              <p className="rounded-md border px-3 py-2 whitespace-pre-wrap">{request.reason}</p>
            </div>

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
