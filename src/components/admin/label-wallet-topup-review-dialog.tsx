"use client";

import { useEffect, useRef, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { formatLabelBillingMoney, labelWalletTopupPath } from "@/lib/label-billing";
import {
  LABEL_WALLET_MAX_PROOF_FILES,
  uploadLabelWalletAdminEvidence,
  validateLabelWalletProofFile,
} from "@/lib/label-wallet-proof";
import type { LabelWalletTopupRequest } from "@/types";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, ImagePlus, Loader2, X } from "lucide-react";

type Props = {
  open: boolean;
  userId: string | null;
  topupRequestId: string | null;
  viewOnly?: boolean;
  onOpenChange: (open: boolean) => void;
  onResolved?: () => void;
};

export function LabelWalletTopupReviewDialog({
  open,
  userId,
  topupRequestId,
  viewOnly = false,
  onOpenChange,
  onResolved,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [request, setRequest] = useState<LabelWalletTopupRequest | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [creditDollars, setCreditDollars] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [adminEvidenceUrls, setAdminEvidenceUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || !userId || !topupRequestId) {
      setRequest(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setRejectionReason("");
    setAdminEvidenceUrls([]);
    void getDoc(doc(db, labelWalletTopupPath(userId), topupRequestId))
      .then((snap) => {
        if (cancelled) return;
        if (!snap.exists()) {
          setRequest(null);
          return;
        }
        const data = { id: snap.id, ...(snap.data() as Omit<LabelWalletTopupRequest, "id">) };
        setRequest(data);
        if (data.claimedAmountCents) {
          setCreditDollars((data.claimedAmountCents / 100).toFixed(2));
        } else {
          setCreditDollars("");
        }
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
  }, [open, userId, topupRequestId, toast]);

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
    if (!user || !userId || !topupRequestId) return;
    if (action === "reject" && rejectionReason.trim().length < 3) {
      toast({
        variant: "destructive",
        title: "Rejection reason required",
        description: "Tell the client why this top-up was declined.",
      });
      return;
    }
    if (action === "approve" && !(Number(creditDollars) > 0)) {
      toast({
        variant: "destructive",
        title: "Credit amount required",
        description: "Enter the USD balance to add to their wallet.",
      });
      return;
    }
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/label-wallet/topup-review", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId,
          topupRequestId,
          action,
          creditedAmountDollars: action === "approve" ? Number(creditDollars) : undefined,
          rejectionReason: action === "reject" ? rejectionReason.trim() : undefined,
          adminEvidenceUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      toast({
        title: action === "approve" ? "Top-up approved" : "Top-up declined",
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

  return (
    <Dialog open={open} onOpenChange={(n) => !busy && onOpenChange(n)}>
      <DialogContent className="max-h-[min(92vh,820px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Wallet top-up review</DialogTitle>
          <DialogDescription>
            Verify the receipt, then approve with a credit amount or decline with a reason. You can attach
            evidence on either action.
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
              <span className="text-muted-foreground">Claimed: </span>
              {request.claimedAmountCents
                ? formatLabelBillingMoney(request.claimedAmountCents)
                : "Not specified"}
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
                    rel="noopener noreferrer"
                    className="block h-20 w-20 overflow-hidden rounded-md border"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Receipt" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            </div>

            {!viewOnly && request.status === "pending" ? (
              <>
                <div className="space-y-2">
                  <Label>Credit amount (USD) on approve</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={creditDollars}
                    onChange={(e) => setCreditDollars(e.target.value)}
                    disabled={busy}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Rejection reason (if declining)</Label>
                  <Textarea
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    disabled={busy}
                    placeholder="Required when declining…"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Admin evidence (optional)</Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleEvidencePick(e.target.files)}
                  />
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
                    Upload evidence
                  </Button>
                  <div className="flex flex-wrap gap-2">
                    {adminEvidenceUrls.map((url) => (
                      <div key={url} className="relative h-14 w-14 overflow-hidden rounded border">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="Evidence" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          className="absolute right-0 top-0 bg-black/60 p-0.5 text-white"
                          onClick={() => setAdminEvidenceUrls((p) => p.filter((u) => u !== url))}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            {request.status === "approved" && request.creditedAmountCents ? (
              <p className="text-emerald-700">
                Credited {formatLabelBillingMoney(request.creditedAmountCents)}
              </p>
            ) : null}
            {request.status === "rejected" && request.rejectionReason ? (
              <p className="text-destructive">Declined: {request.rejectionReason}</p>
            ) : null}
            {request.reviewedAt ? (
              <p className="text-xs text-muted-foreground">
                Reviewed{" "}
                {format(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (request.reviewedAt as any)?.toDate?.() || new Date(),
                  "PPp"
                )}
              </p>
            ) : null}
            {(request.adminEvidenceUrls || []).length > 0 ? (
              <a
                href={request.adminEvidenceUrls![0]}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
              >
                Admin evidence <ExternalLink className="h-3.5 w-3.5" />
              </a>
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
              <Button type="button" disabled={busy || loading} onClick={() => void runReview("approve")}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Approve &amp; credit
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
