"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, X } from "lucide-react";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { hasRole } from "@/lib/permissions";
import { CLIENT_INVOICE_LATE_FEE_AMOUNT } from "@/lib/client-invoice-lifecycle";
import { Button } from "@/components/ui/button";
import type { Invoice } from "@/types";

const DISMISS_KEY_PREFIX = "prepcorex:late-fee-notice-dismissed:";

function lateFeeAmount(invoice: Invoice): number {
  const amount = Number(
    invoice.lateFeeAmount ?? (invoice as Invoice & { lateFee?: number }).lateFee ?? 0
  );
  return Number.isFinite(amount) ? amount : 0;
}

function formatMoney(n: number): string {
  return `$${n.toFixed(2)}`;
}

/**
 * Account-wide notice slider when the client has pending invoices with a late fee.
 * Uses a pending-only invoices query (not the full sidebar invoices listener).
 */
export function ClientInvoiceLateFeeNotice() {
  const { userProfile } = useAuth();
  const uid = userProfile?.uid || "";
  const isClient = hasRole(userProfile, "user");

  const pendingQuery = useMemo(() => {
    if (!uid || !isClient) return undefined;
    return query(
      collection(db, `users/${uid}/invoices`),
      where("status", "==", "pending")
    );
  }, [uid, isClient]);

  const { data: pendingInvoices } = useCollection<Invoice>(
    uid && isClient ? `users/${uid}/invoices` : "",
    pendingQuery
  );

  const lateFeeInvoices = useMemo(
    () =>
      (pendingInvoices || [])
        .filter((inv) => lateFeeAmount(inv) > 0.009)
        .sort((a, b) => String(b.invoiceNumber || "").localeCompare(String(a.invoiceNumber || ""))),
    [pendingInvoices]
  );

  const fingerprint = useMemo(
    () =>
      lateFeeInvoices
        .map((inv) => `${inv.id}:${lateFeeAmount(inv).toFixed(2)}`)
        .join("|"),
    [lateFeeInvoices]
  );

  const [dismissedFingerprint, setDismissedFingerprint] = useState<string | null>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!uid || !fingerprint) {
      setDismissedFingerprint(null);
      return;
    }
    try {
      setDismissedFingerprint(sessionStorage.getItem(`${DISMISS_KEY_PREFIX}${uid}`) || null);
    } catch {
      setDismissedFingerprint(null);
    }
  }, [uid, fingerprint]);

  useEffect(() => {
    setIndex(0);
  }, [fingerprint]);

  useEffect(() => {
    if (lateFeeInvoices.length <= 1) return;
    const timer = window.setInterval(() => {
      setIndex((prev) => (prev + 1) % lateFeeInvoices.length);
    }, 6000);
    return () => window.clearInterval(timer);
  }, [lateFeeInvoices.length, fingerprint]);

  if (!isClient || !uid || lateFeeInvoices.length === 0) return null;
  if (dismissedFingerprint && dismissedFingerprint === fingerprint) return null;

  const safeIndex = Math.min(index, lateFeeInvoices.length - 1);
  const current = lateFeeInvoices[safeIndex];
  const fee = lateFeeAmount(current);
  const totalLateFees = lateFeeInvoices.reduce((sum, inv) => sum + lateFeeAmount(inv), 0);

  const dismiss = () => {
    try {
      sessionStorage.setItem(`${DISMISS_KEY_PREFIX}${uid}`, fingerprint);
    } catch {
      /* ignore */
    }
    setDismissedFingerprint(fingerprint);
  };

  return (
    <div
      className="relative overflow-hidden rounded-lg border-2 border-amber-400 bg-gradient-to-r from-amber-50 via-orange-50 to-rose-50 text-amber-950 shadow-sm dark:border-amber-700 dark:from-amber-950/50 dark:via-orange-950/40 dark:to-rose-950/40 dark:text-amber-50"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-200/80 text-amber-800 dark:bg-amber-800/60 dark:text-amber-100">
          <AlertTriangle className="h-5 w-5" />
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-semibold sm:text-base">
            Late fee applied on pending invoice
            {lateFeeInvoices.length > 1 ? `s (${lateFeeInvoices.length})` : ""}
          </p>
          <p className="text-xs leading-relaxed text-amber-900/90 dark:text-amber-100/90 sm:text-sm">
            Invoice <span className="font-semibold">{current.invoiceNumber}</span> has a{" "}
            <span className="font-semibold">{formatMoney(fee)}</span> late fee
            {current.lateFeeReason ? ` (${current.lateFeeReason})` : ""}. Please pay the
            outstanding balance to avoid service pauses.
            {lateFeeInvoices.length > 1 ? (
              <>
                {" "}
                Combined late fees: <span className="font-semibold">{formatMoney(totalLateFees)}</span>.
              </>
            ) : null}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button asChild size="sm" className="h-8 bg-amber-700 hover:bg-amber-800">
              <Link href="/dashboard/invoices">View invoices</Link>
            </Button>
            {lateFeeInvoices.length > 1 ? (
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() =>
                    setIndex((prev) => (prev - 1 + lateFeeInvoices.length) % lateFeeInvoices.length)
                  }
                  aria-label="Previous late-fee notice"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {safeIndex + 1}/{lateFeeInvoices.length}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setIndex((prev) => (prev + 1) % lateFeeInvoices.length)}
                  aria-label="Next late-fee notice"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            ) : null}
            <span className="text-[11px] text-muted-foreground">
              Standard late fee is ${CLIENT_INVOICE_LATE_FEE_AMOUNT}.
            </span>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={dismiss}
          title="Dismiss until this session ends or fees change"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
