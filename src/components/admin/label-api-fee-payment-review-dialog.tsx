"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { formatLabelBillingMoney, labelApiFeePaymentPath } from "@/lib/label-billing";
import {
  LABEL_WALLET_MAX_PROOF_FILES,
  uploadLabelWalletAdminEvidence,
  validateLabelWalletProofFile,
} from "@/lib/label-wallet-proof";
import type { LabelApiFeePaymentRequest } from "@/types";
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
import { ExternalLink, ImagePlus, Loader2, X } from "lucide-react";

type Props = {
  open: boolean;
  userId: string | null;
  paymentRequestId: string | null;
  viewOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved?: () => void;
};

export function LabelApiFeePaymentReviewDialog({
  open,
  userId,
  paymentRequestId,
  viewOnly = false,
  onOpenChange,
  onResolved,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [request, setRequest] = useState<LabelApiFeePaymentRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [adminEvidenceUrls, setAdminEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !userId || !paymentRequestId) {
      setRequest(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRejectionReason("");
    setAdminEvidenceUrls([]);
    void getDoc(doc(db, labelApiFeePaymentPath(userId), paymentRequestId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setRequest(null);
          return;
        }
        setRequest({ id: snap.id, ...(snap.data() as Omit<LabelApiFeePaymentRequest, "id">) });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast({
          variant: "destructive",
          title: "Could not load request",
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
  }, [open, userId, paymentRequestId, toast]);

  const handleEvidencePick = async (files: FileList | null) => {
    if (!files?.length || !userId) return;
    const remaining = LABEL_WALLET_MAX_PROOF_FILES - adminEvidenceUrls.length;
    if (remaining <= 0) return;
    setUploading(true);
    try {
      const next = [...adminEvidenceUrls];
      for (const file of Array.from(files).slice(0, remaining)) {
        const err = validateLabelWalletProofFile(file);
        if (err) {
          toast({ variant: "destructive", title: "Invalid file", description: err });
          continue;
        }
        next.push(await uploadLabelWalletAdminEvidence(userId, file));
      }
      setAdminEvidenceUrls(next);
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

  const runReview = async (action: "approve" | "reject") => {
    if (!user || !userId || !paymentRequestId) return;
    if (action === "reject" && rejectionReason.trim().length < 3) {
      toast({
        variant: "destructive",
        title: "Rejection reason required",
        description: "Tell the client why this API fee payment was declined.",
      });
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/label-api-fee/payment-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId,
          paymentRequestId,
          action,
          rejectionReason: action === "reject" ? rejectionReason.trim() : undefined,
          adminEvidenceUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      toast({
        title: action === "approve" ? "API fee approved" : "API fee declined",
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

  const receipts = request?.receiptUrls || [];
  const canReview = !viewOnly && String(request?.status || "").toLowerCase() === "pending";

  return (
    <Dialog open={open} onOpenChange={(n) => !busy && onOpenChange(n)}>
      <DialogContent className="max-h-[min(92vh,820px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>API fee payment review</DialogTitle>
          <DialogDescription>
            Verify the receipt, then approve to unlock Buy Labels or decline with a reason.
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
            <p>
              <span className="text-muted-foreground">Amount: </span>
              {formatLabelBillingMoney(request.amountCents || 0)}
              {" · "}
              {request.cadence === "onetime" ? "One-time" : "Monthly"}
            </p>
            {request.note ? (
              <p className="rounded-md border px-3 py-2 whitespace-pre-wrap">{request.note}</p>
            ) : null}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Client receipt
              </p>
              <div className="flex flex-wrap gap-2">
                {receipts.map((url) => (
                  <a
                    key={url}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="relative block h-20 w-20 overflow-hidden rounded border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Receipt" className="h-full w-full object-cover" />
                    <ExternalLink className="absolute bottom-1 right-1 h-3 w-3 text-white drop-shadow" />
                  </a>
                ))}
              </div>
            </div>

            {canReview ? (
              <>
                <div className="space-y-2">
                  <Label>Admin evidence (optional)</Label>
                  <div className="flex flex-wrap gap-2">
                    {adminEvidenceUrls.map((url) => (
                      <div key={url} className="relative h-14 w-14 overflow-hidden rounded border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="Evidence" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"
                          onClick={() =>
                            setAdminEvidenceUrls((prev) => prev.filter((u) => u !== url))
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ImagePlus className="mr-2 h-4 w-4" />
                      )}
                      Attach
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => void handleEvidencePick(e.target.files)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Rejection reason</Label>
                  <Textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="Required when declining…"
                    className="min-h-[64px]"
                  />
                </div>
              </>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {canReview ? (
            <>
              <Button
                type="button"
                variant="destructive"
                disabled={busy}
                onClick={() => void runReview("reject")}
              >
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Decline
              </Button>
              <Button type="button" disabled={busy} onClick={() => void runReview("approve")}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Approve &amp; unlock
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
