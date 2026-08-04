"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { LabelPurchase } from "@/types";
import {
  canRequestLabelRefund,
  formatLabelAge,
  formatLabelMoney,
  formatLabelRefundCountdown,
  labelPurchaseAnchorMs,
} from "@/lib/label-refund";
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
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  label: LabelPurchase | null;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
};

export function LabelRefundRequestDialog({ open, label, onOpenChange, onSubmitted }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const anchorMs = label ? labelPurchaseAnchorMs(label) : 0;
  const eligibility = label ? canRequestLabelRefund(label) : { ok: false, reason: "No label" };

  const handleSubmit = async () => {
    if (!label || !user) return;
    if (!eligibility.ok) {
      toast({
        variant: "destructive",
        title: "Refund unavailable",
        description: eligibility.reason,
      });
      return;
    }
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      toast({
        variant: "destructive",
        title: "Reason required",
        description: "Please explain why you need a refund (at least 5 characters).",
      });
      return;
    }

    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/label-refunds/request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          labelPurchaseId: label.id,
          reason: trimmed,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        throw new Error(data.error || "Could not submit refund request.");
      }
      toast({
        title: "Refund requested",
        description: "An admin will review your request. You’ll get a notification with the decision.",
      });
      setReason("");
      onOpenChange(false);
      onSubmitted?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Request failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!submitting) {
          onOpenChange(next);
          if (!next) setReason("");
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Request label refund</DialogTitle>
          <DialogDescription>
            Refund requests are available for 2 hours after purchase. An admin must approve before
            Stripe issues the refund.
          </DialogDescription>
        </DialogHeader>

        {label ? (
          <div className="space-y-3 text-sm">
            <div className="rounded-md border bg-muted/40 px-3 py-2 space-y-1">
              <p>
                <span className="text-muted-foreground">Amount: </span>
                <span className="font-medium">
                  {formatLabelMoney(label.paymentAmount, label.paymentCurrency)}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">Age: </span>
                {formatLabelAge(anchorMs)} · {formatLabelRefundCountdown(anchorMs)}
              </p>
              {label.trackingNumber ? (
                <p>
                  <span className="text-muted-foreground">Tracking: </span>
                  <span className="font-mono text-xs">{label.trackingNumber}</span>
                </p>
              ) : null}
            </div>

            {!eligibility.ok ? (
              <p className="text-sm text-destructive">{eligibility.reason}</p>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="label-refund-reason">Reason *</Label>
                <Textarea
                  id="label-refund-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why do you need a refund?"
                  className="min-h-[110px]"
                  disabled={submitting}
                />
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || !eligibility.ok}
            onClick={() => void handleSubmit()}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
