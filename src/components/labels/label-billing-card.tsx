"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { format } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import {
  formatLabelBillingMoney,
  formatLabelBillingPeriod,
  labelBillingPeriodEndsAt,
  labelBillingRemainingCents,
  labelBillingSummaryLine,
  labelWalletLedgerPath,
  labelWalletTopupPath,
  normalizeLabelBillingSettings,
} from "@/lib/label-billing";
import type { LabelBillingSettings, LabelWalletLedgerEntry, LabelWalletTopupRequest } from "@/types";
import { LabelWalletTopupDialog } from "@/components/labels/label-wallet-topup-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, ExternalLink, Loader2, Wallet } from "lucide-react";

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === "object" && value && "toDate" in value && typeof (value as { toDate: () => Date }).toDate === "function") {
    try {
      return (value as { toDate: () => Date }).toDate();
    } catch {
      return null;
    }
  }
  if (typeof value === "object" && value && "seconds" in value) {
    return new Date(Number((value as { seconds: number }).seconds) * 1000);
  }
  return null;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) =>
      r
        .map((cell) => {
          const s = String(cell ?? "");
          if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
          return s;
        })
        .join(",")
    )
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type Props = {
  /** When billing mode is wallet, parent can use this for checkout. */
  onBillingLoaded?: (settings: LabelBillingSettings) => void;
};

export function LabelBillingCard({ onBillingLoaded }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<LabelBillingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupOpen, setTopupOpen] = useState(false);
  const [ledger, setLedger] = useState<LabelWalletLedgerEntry[]>([]);
  const [topups, setTopups] = useState<LabelWalletTopupRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadBilling = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/label-billing?userId=${encodeURIComponent(user.uid)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load billing");
      const s = normalizeLabelBillingSettings(data.settings);
      setSettings(s);
      onBillingLoaded?.(s);
    } catch (error: unknown) {
      // Fall back to defaults client-side so Buy Labels still works offline of API.
      const fallback = normalizeLabelBillingSettings(null);
      setSettings(fallback);
      onBillingLoaded?.(fallback);
      toast({
        variant: "destructive",
        title: "Billing load warning",
        description: error instanceof Error ? error.message : "Using default $50 monthly limit.",
      });
    } finally {
      setLoading(false);
    }
  }, [user, onBillingLoaded, toast]);

  const loadHistory = useCallback(async () => {
    if (!user || !settings || settings.mode !== "wallet") return;
    setHistoryLoading(true);
    try {
      const [ledgerSnap, topupSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, labelWalletLedgerPath(user.uid)),
            orderBy("createdAt", "desc"),
            limit(100)
          )
        ),
        getDocs(
          query(
            collection(db, labelWalletTopupPath(user.uid)),
            orderBy("requestedAt", "desc"),
            limit(50)
          )
        ),
      ]);
      setLedger(
        ledgerSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabelWalletLedgerEntry, "id">) }))
      );
      setTopups(
        topupSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LabelWalletTopupRequest, "id">) }))
      );
    } catch (error: unknown) {
      console.warn("label billing history", error);
      // Fallback without orderBy if index missing
      try {
        const [ledgerSnap, topupSnap] = await Promise.all([
          getDocs(collection(db, labelWalletLedgerPath(user.uid))),
          getDocs(collection(db, labelWalletTopupPath(user.uid))),
        ]);
        setLedger(
          ledgerSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<LabelWalletLedgerEntry, "id">) }))
            .sort((a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0))
            .slice(0, 100)
        );
        setTopups(
          topupSnap.docs
            .map((d) => ({ id: d.id, ...(d.data() as Omit<LabelWalletTopupRequest, "id">) }))
            .sort(
              (a, b) =>
                (toDate(b.requestedAt)?.getTime() || 0) - (toDate(a.requestedAt)?.getTime() || 0)
            )
            .slice(0, 50)
        );
      } catch {
        /* ignore */
      }
    } finally {
      setHistoryLoading(false);
    }
  }, [user, settings]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const purchases = useMemo(
    () => ledger.filter((e) => e.type === "purchase" || e.type === "purchase_refund"),
    [ledger]
  );
  const topupLike = useMemo(
    () =>
      ledger.filter((e) =>
        ["topup", "reissue_credit", "admin_adjust", "period_reset"].includes(e.type)
      ),
    [ledger]
  );

  const ends = settings ? labelBillingPeriodEndsAt(settings.period) : null;

  if (loading || !settings) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (settings.mode === "limit") {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Label purchase limit</CardTitle>
          <CardDescription>
            {labelBillingSummaryLine(settings)}
            {ends ? ` · Resets ${format(ends, "PPp")}` : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          When your {formatLabelBillingPeriod(settings.period)} limit is used up, purchases are blocked
          until the period resets or administration raises your limit. Remaining:{" "}
          <span className="font-medium text-foreground">
            {formatLabelBillingMoney(labelBillingRemainingCents(settings))}
          </span>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-5 w-5" />
              Label wallet
            </CardTitle>
            <CardDescription className="mt-1">{labelBillingSummaryLine(settings)}</CardDescription>
          </div>
          <Button onClick={() => setTopupOpen(true)}>Top up</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-md border px-3 py-2">
              <p className="text-muted-foreground">Balance</p>
              <p className="text-xl font-semibold">
                {formatLabelBillingMoney(settings.walletBalanceCents || 0)}
              </p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="text-muted-foreground">
                {formatLabelBillingPeriod(settings.period)} limit
              </p>
              <p className="text-xl font-semibold">
                {formatLabelBillingMoney(settings.limitAmountCents)}
              </p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="text-muted-foreground">Left this period</p>
              <p className="text-xl font-semibold">
                {formatLabelBillingMoney(labelBillingRemainingCents(settings))}
              </p>
            </div>
          </div>

          <Tabs defaultValue="topups">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList>
                <TabsTrigger value="topups">Top-up history</TabsTrigger>
                <TabsTrigger value="purchases">Purchase history</TabsTrigger>
              </TabsList>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={historyLoading}
                onClick={() => {
                  if (topupLike.length) {
                    downloadCsv("wallet-topup-history.csv", [
                      ["Date", "Type", "Amount", "Balance after", "Reason", "Receipt"],
                      ...topupLike.map((e) => [
                        toDate(e.createdAt)?.toISOString() || "",
                        e.type,
                        (e.amountCents / 100).toFixed(2),
                        e.balanceAfterCents != null ? (e.balanceAfterCents / 100).toFixed(2) : "",
                        e.reason || "",
                        (e.receiptUrls || [])[0] || "",
                      ]),
                    ]);
                  }
                  if (purchases.length) {
                    downloadCsv("wallet-purchase-history.csv", [
                      ["Date", "Type", "Amount", "Balance after", "Label ID", "Reason"],
                      ...purchases.map((e) => [
                        toDate(e.createdAt)?.toISOString() || "",
                        e.type,
                        (e.amountCents / 100).toFixed(2),
                        e.balanceAfterCents != null ? (e.balanceAfterCents / 100).toFixed(2) : "",
                        e.labelPurchaseId || "",
                        e.reason || "",
                      ]),
                    ]);
                  }
                  toast({ title: "CSV downloaded" });
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
            </div>

            <TabsContent value="topups" className="space-y-2 pt-2">
              {historyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : topups.length === 0 && topupLike.length === 0 ? (
                <p className="text-sm text-muted-foreground">No top-ups yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {topups.map((t) => (
                    <li key={t.id} className="rounded-md border px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="capitalize font-medium">{t.status}</span>
                        <span className="text-muted-foreground">
                          {toDate(t.requestedAt) ? format(toDate(t.requestedAt)!, "PPp") : "—"}
                        </span>
                      </div>
                      <p>
                        Claimed:{" "}
                        {t.claimedAmountCents
                          ? formatLabelBillingMoney(t.claimedAmountCents)
                          : "—"}
                        {t.creditedAmountCents
                          ? ` · Credited ${formatLabelBillingMoney(t.creditedAmountCents)}`
                          : null}
                      </p>
                      {t.rejectionReason ? (
                        <p className="text-destructive">Declined: {t.rejectionReason}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-2">
                        {(t.receiptUrls || []).map((url) => (
                          <a
                            key={url}
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-primary underline-offset-2 hover:underline"
                          >
                            Receipt <ExternalLink className="h-3 w-3" />
                          </a>
                        ))}
                      </div>
                    </li>
                  ))}
                  {topupLike
                    .filter((e) => e.type !== "topup" || !e.topupRequestId)
                    .map((e) => (
                      <li key={e.id} className="rounded-md border px-3 py-2">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium capitalize">{e.type.replace(/_/g, " ")}</span>
                          <span>
                            {e.amountCents >= 0 ? "+" : ""}
                            {formatLabelBillingMoney(Math.abs(e.amountCents))}
                          </span>
                        </div>
                        {e.reason ? <p className="text-muted-foreground">{e.reason}</p> : null}
                        <p className="text-xs text-muted-foreground">
                          {toDate(e.createdAt) ? format(toDate(e.createdAt)!, "PPp") : ""}
                        </p>
                      </li>
                    ))}
                </ul>
              )}
            </TabsContent>

            <TabsContent value="purchases" className="space-y-2 pt-2">
              {historyLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : purchases.length === 0 ? (
                <p className="text-sm text-muted-foreground">No wallet purchases yet.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {purchases.map((e) => (
                    <li key={e.id} className="rounded-md border px-3 py-2 flex justify-between gap-2">
                      <div>
                        <p className="font-medium capitalize">{e.type.replace(/_/g, " ")}</p>
                        <p className="text-xs text-muted-foreground">
                          {toDate(e.createdAt) ? format(toDate(e.createdAt)!, "PPp") : ""}
                          {e.labelPurchaseId ? ` · ${e.labelPurchaseId}` : ""}
                        </p>
                      </div>
                      <span className={e.amountCents < 0 ? "text-destructive" : "text-emerald-700"}>
                        {formatLabelBillingMoney(e.amountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <LabelWalletTopupDialog
        open={topupOpen}
        onOpenChange={setTopupOpen}
        onSubmitted={() => {
          void loadBilling();
          void loadHistory();
        }}
      />
    </>
  );
}
