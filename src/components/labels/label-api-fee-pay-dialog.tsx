"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  formatLabelBillingMoney,
  isLabelApiFeeBlocking,
  labelApiFeeBlockMessage,
  normalizeLabelApiFeeSettings,
} from "@/lib/label-billing";
import {
  LABEL_WALLET_ACH,
  LABEL_WALLET_TOPUP_DISCLAIMER,
  LABEL_WALLET_ZELLE,
} from "@/lib/label-billing-payment-details";
import {
  LABEL_WALLET_MAX_PROOF_FILES,
  uploadLabelApiFeeReceipt,
  validateLabelWalletProofFile,
} from "@/lib/label-wallet-proof";
import type { LabelBillingSettings } from "@/types";
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
import { ImagePlus, Loader2, Wallet, X } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  settings: LabelBillingSettings | null;
  onPaid?: () => void;
};

export function LabelApiFeePayDialog({ open, onOpenChange, settings, onPaid }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fee = normalizeLabelApiFeeSettings(settings?.apiFee);
  const [note, setNote] = useState("");
  const [receiptUrls, setReceiptUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [payingWallet, setPayingWallet] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setNote("");
    setReceiptUrls([]);
  }, [open]);

  const walletBalance = settings?.walletBalanceCents || 0;
  const canPayWallet = walletBalance >= fee.amountCents && fee.status !== "pending";
  const blocking = settings ? isLabelApiFeeBlocking(settings) : false;

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
        next.push(await uploadLabelApiFeeReceipt(user.uid, file));
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

  const payWithWallet = async () => {
    if (!user) return;
    setPayingWallet(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/label-api-fee/pay-wallet", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      toast({
        title: "API fee paid",
        description: "Wallet charged. You can buy labels now.",
      });
      onOpenChange(false);
      onPaid?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Wallet payment failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setPayingWallet(false);
    }
  };

  const submitAch = async () => {
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
      const res = await fetch("/api/label-api-fee/payment-request", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          note: note.trim() || undefined,
          receiptUrls,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submit failed");
      toast({
        title: "Payment submitted",
        description: "Admin will review your receipt. Buy Labels unlocks after approval.",
      });
      onOpenChange(false);
      onPaid?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Submit failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const busy = payingWallet || submitting || uploading;

  return (
    <Dialog open={open} onOpenChange={(n) => !busy && onOpenChange(n)}>
      <DialogContent className="max-h-[min(92vh,860px)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Pay Buy Labels API fee</DialogTitle>
          <DialogDescription>
            {blocking
              ? labelApiFeeBlockMessage(fee)
              : "API fee is not currently blocking this account."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 text-sm">
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <p>
              Amount: <strong>{formatLabelBillingMoney(fee.amountCents)}</strong>
            </p>
            <p className="text-muted-foreground">
              Type: {fee.cadence === "onetime" ? "One-time" : "Monthly (30 days)"}
              {fee.status === "pending" ? " · Pending review" : ""}
              {fee.status === "rejected" && fee.lastRejectionReason
                ? ` · Last rejection: ${fee.lastRejectionReason}`
                : ""}
            </p>
            <p className="text-muted-foreground">
              Wallet balance: {formatLabelBillingMoney(walletBalance)}
            </p>
          </div>

          <div className="space-y-2 rounded-md border p-3">
            <p className="font-medium flex items-center gap-2">
              <Wallet className="h-4 w-4" /> Pay with wallet
            </p>
            <p className="text-xs text-muted-foreground">
              Instant unlock if your wallet covers the fee.
            </p>
            <Button
              type="button"
              disabled={busy || !canPayWallet || !blocking}
              onClick={() => void payWithWallet()}
            >
              {payingWallet ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Pay {formatLabelBillingMoney(fee.amountCents)} from wallet
            </Button>
            {!canPayWallet && fee.status !== "pending" ? (
              <p className="text-xs text-muted-foreground">
                Wallet balance is too low — use ACH/Zelle below, or top up first.
              </p>
            ) : null}
          </div>

          <div className="space-y-3 rounded-md border p-3">
            <p className="font-medium">Pay with ACH / Zelle</p>
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
              <Label>Receipt screenshot(s)</Label>
              <div className="flex flex-wrap gap-2">
                {receiptUrls.map((url) => (
                  <div key={url} className="relative h-16 w-16 overflow-hidden rounded border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="Receipt" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white"
                      onClick={() => setReceiptUrls((prev) => prev.filter((u) => u !== url))}
                      disabled={busy}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy || fee.status === "pending" || !blocking}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <ImagePlus className="mr-2 h-4 w-4" />
                  )}
                  Upload
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => void handlePick(e.target.files)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Note (optional)</Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Transaction ID, sender name…"
                className="min-h-[64px]"
                disabled={busy || fee.status === "pending"}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy || fee.status === "pending" || !blocking || receiptUrls.length < 1}
              onClick={() => void submitAch()}
            >
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit for admin review
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
