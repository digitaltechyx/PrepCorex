"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  LABEL_WALLET_ACH,
  LABEL_WALLET_TOPUP_DISCLAIMER,
  LABEL_WALLET_ZELLE,
} from "@/lib/label-billing-payment-details";
import {
  LABEL_WALLET_MAX_PROOF_FILES,
  uploadLabelWalletTopupReceipt,
  validateLabelWalletProofFile,
} from "@/lib/label-wallet-proof";
import { Button } from "@/components/ui/button";
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
import { ImagePlus, Loader2, X } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmitted?: () => void;
};

export function LabelWalletTopupDialog({ open, onOpenChange, onSubmitted }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [claimedDollars, setClaimedDollars] = useState("");
  const [note, setNote] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setClaimedDollars("");
    setNote("");
    setReceiptUrls([]);
  }, [open]);

  const handlePick = async (files: FileList | null) => {
    if (!files?.length || !user) return;
    const remaining = LABEL_WALLET_MAX_PROOF_FILES - receiptUrls.length;
    if (remaining <= 0) {
      toast({
        variant: "destructive",
        title: "Limit reached",
        description: `Up to ${LABEL_WALLET_MAX_PROOF_FILES} images.`,
      });
      return;
    }
    setUploading(true);
    try {
      const next = [...receiptUrls];
      for (const file of Array.from(files).slice(0, remaining)) {
        const err = validateLabelWalletProofFile(file);
        if (err) {
          toast({ variant: "destructive", title: "Invalid file", description: err });
          continue;
        }
        next.push(await uploadLabelWalletTopupReceipt(user.uid, file));
      }
      setReceiptUrls(next);
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
    if (!user) return;
    if (receiptUrls.length < 1) {
      toast({
        variant: "destructive",
        title: "Receipt required",
        description: "Upload a screenshot of your ACH or Zelle payment.",
      });
      return;
    }
    setSubmitting(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/label-wallet/topup-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          claimedAmountDollars: claimedDollars ? Number(claimedDollars) : undefined,
          note: note.trim() || undefined,
          receiptUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      toast({
        title: "Top-up submitted",
        description: "Admin will review your receipt and credit your wallet.",
      });
      onOpenChange(false);
      onSubmitted?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Could not submit",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(n) => !submitting && onOpenChange(n)}>
      <DialogContent className="max-h-[min(92vh,860px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Top-up Wallet</DialogTitle>
          <DialogDescription>
            Send payment via Zelle (preferred) or ACH, then upload your receipt for admin approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-950 dark:text-amber-100">
            {LABEL_WALLET_TOPUP_DISCLAIMER}
          </p>

          <div className="space-y-2 rounded-md border-2 border-violet-500/70 bg-violet-500/5 px-3 py-3">
            <p className="font-medium text-violet-800 dark:text-violet-200">Zelle (Preferred)</p>
            <p>
              Name: <span className="font-medium">{LABEL_WALLET_ZELLE.recipientName}</span>
            </p>
            <p>
              Phone: <span className="font-medium">{LABEL_WALLET_ZELLE.phone}</span>
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={LABEL_WALLET_ZELLE.qrImageSrc}
              alt="Zelle QR code"
              className="mx-auto max-h-56 w-auto rounded-md border border-violet-200 bg-white p-2"
            />
          </div>

          <div className="space-y-1 rounded-md border-2 border-sky-500/70 bg-sky-500/5 px-3 py-3">
            <p className="font-medium text-sky-800 dark:text-sky-200">ACH / Bank transfer</p>
            <p>
              Routing Number:{" "}
              <span className="font-mono">{LABEL_WALLET_ACH.abaRoutingNumber}</span>
            </p>
            <p>
              Account Number:{" "}
              <span className="font-mono">{LABEL_WALLET_ACH.accountNumber}</span> (
              {LABEL_WALLET_ACH.accountKind})
            </p>
            <p>Bank Name: {LABEL_WALLET_ACH.bankName}</p>
            <p className="text-xs text-muted-foreground">{LABEL_WALLET_ACH.bankNote}</p>
            <p>Bank Address: {LABEL_WALLET_ACH.bankAddress}</p>
            <p>Beneficiary Name: {LABEL_WALLET_ACH.beneficiaryName}</p>
            <p>Beneficiary Address: {LABEL_WALLET_ACH.beneficiaryAddress}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="topup-amount">Amount Sent (USD, optional)</Label>
            <Input
              id="topup-amount"
              type="number"
              min="0"
              step="0.01"
              value={claimedDollars}
              onChange={(e) => setClaimedDollars(e.target.value)}
              placeholder="e.g. 200.00"
              disabled={submitting}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="topup-note">Note (optional)</Label>
            <Textarea
              id="topup-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Reference / confirmation number…"
              disabled={submitting}
            />
          </div>

          <div className="space-y-2">
            <Label>Receipt Screenshot</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              multiple
              onChange={(e) => void handlePick(e.target.files)}
            />
            <Button
              type="button"
              variant="outline"
              disabled={uploading || submitting}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ImagePlus className="mr-2 h-4 w-4" />}
              Upload receipt
            </Button>
            <div className="flex flex-wrap gap-2">
              {receiptUrls.map((url) => (
                <div key={url} className="relative h-16 w-16 overflow-hidden rounded-md border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt="Receipt" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"
                    onClick={() => setReceiptUrls((prev) => prev.filter((u) => u !== url))}
                    disabled={submitting}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={submitting || uploading} onClick={() => void handleSubmit()}>
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit for review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
