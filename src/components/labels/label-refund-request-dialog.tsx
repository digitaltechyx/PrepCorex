"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import type { LabelPurchase } from "@/types";
import {
  canRequestLabelRefund,
  detectLabelPlatformIssue,
  formatLabelAge,
  formatLabelMoney,
  formatLabelProviderName,
  formatLabelRefundCountdown,
  labelPurchaseAnchorMs,
} from "@/lib/label-refund";
import {
  LABEL_REFUND_MAX_PROOF_FILES,
  uploadLabelRefundProof,
  validateLabelRefundProofFile,
} from "@/lib/label-refund-proof";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { ImagePlus, Loader2, X } from "lucide-react";

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
  const [platformIssueClaimed, setPlatformIssueClaimed] = useState(false);
  const [proofUrls, setProofUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const anchorMs = label ? labelPurchaseAnchorMs(label) : 0;
  const eligibility = label ? canRequestLabelRefund(label) : { ok: false, reason: "No label" };
  const provider = label
    ? formatLabelProviderName(label.labelProvider || label.selectedRate?.labelProvider)
    : "";
  const detectedIssue = label ? detectLabelPlatformIssue(label) : false;

  useEffect(() => {
    if (!open || !label) return;
    setPlatformIssueClaimed(detectLabelPlatformIssue(label));
  }, [open, label?.id]);

  const resetForm = () => {
    setReason("");
    setPlatformIssueClaimed(false);
    setProofUrls([]);
  };

  const handleProofPick = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    const remaining = LABEL_REFUND_MAX_PROOF_FILES - proofUrls.length;
    if (remaining <= 0) {
      toast({
        variant: "destructive",
        title: "Proof limit reached",
        description: `You can upload up to ${LABEL_REFUND_MAX_PROOF_FILES} images.`,
      });
      return;
    }

    setUploading(true);
    try {
      const next: string[] = [...proofUrls];
      for (const file of Array.from(files).slice(0, remaining)) {
        const err = validateLabelRefundProofFile(file);
        if (err) {
          toast({ variant: "destructive", title: "Invalid file", description: err });
          continue;
        }
        const url = await uploadLabelRefundProof(user.uid, file);
        next.push(url);
      }
      setProofUrls(next);
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

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
          platformIssueClaimed,
          proofUrls,
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
      resetForm();
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
        if (!submitting && !uploading) {
          onOpenChange(next);
          if (!next) resetForm();
        }
      }}
    >
      <DialogContent className="max-h-[min(92vh,720px)] overflow-y-auto sm:max-w-lg">
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
                <span className="text-muted-foreground">Provider: </span>
                <span className="font-medium">{provider}</span>
                {label.selectedRate?.provider || label.selectedRate?.serviceLevel ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · {[label.selectedRate?.provider, label.selectedRate?.serviceLevel]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                ) : null}
              </p>
              <p>
                <span className="text-muted-foreground">Status: </span>
                <span className="capitalize">{String(label.status || "").replace(/_/g, " ")}</span>
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
              {label.errorMessage ? (
                <p className="text-destructive">
                  <span className="font-medium">Error: </span>
                  {label.errorMessage}
                </p>
              ) : null}
              {detectedIssue ? (
                <p className="rounded-md bg-amber-500/10 px-2 py-1.5 text-amber-900 dark:text-amber-200">
                  System detected a possible PrepCorex / label-generation issue on this purchase.
                </p>
              ) : null}
            </div>

            {!eligibility.ok ? (
              <p className="text-sm text-destructive">{eligibility.reason}</p>
            ) : (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="label-refund-reason">Reason *</Label>
                  <Textarea
                    id="label-refund-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why do you need a refund?"
                    className="min-h-[100px]"
                    disabled={submitting || uploading}
                  />
                </div>

                <label className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2">
                  <Checkbox
                    checked={platformIssueClaimed}
                    onCheckedChange={(v) => setPlatformIssueClaimed(v === true)}
                    disabled={submitting || uploading}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="font-medium">Something went wrong on PrepCorex / our side</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      Check this if the label failed to generate, payment succeeded without a label, or
                      you hit a system/integration error (not a carrier delivery problem).
                    </span>
                  </span>
                </label>

                <div className="space-y-2">
                  <Label>Proof (optional)</Label>
                  <p className="text-xs text-muted-foreground">
                    Upload up to {LABEL_REFUND_MAX_PROOF_FILES} screenshots (error messages, payment
                    confirmation, etc.).
                  </p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleProofPick(e.target.files)}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      submitting ||
                      uploading ||
                      proofUrls.length >= LABEL_REFUND_MAX_PROOF_FILES
                    }
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <ImagePlus className="mr-2 h-4 w-4" />
                    )}
                    Upload image
                  </Button>
                  {proofUrls.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {proofUrls.map((url) => (
                        <div key={url} className="relative h-16 w-16 overflow-hidden rounded-md border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="Refund proof" className="h-full w-full object-cover" />
                          <button
                            type="button"
                            className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5 shadow"
                            disabled={submitting || uploading}
                            onClick={() => setProofUrls((prev) => prev.filter((u) => u !== url))}
                            aria-label="Remove proof image"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={submitting || uploading}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={submitting || uploading || !eligibility.ok}
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
