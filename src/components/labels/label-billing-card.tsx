"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  collection,
  getDocs,
  limit,
  orderBy,
  query,
} from "firebase/firestore";
import { format, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import {
  formatLabelBillingMoney,
  formatLabelBillingPeriod,
  formatLabelBillingPeriodAdjective,
  formatLabelBillingPeriodNoun,
  formatSignedLabelBillingMoney,
  labelBillingPeriodEndsAt,
  labelBillingRemainingCents,
  labelBillingSummaryLine,
  labelWalletLedgerPath,
  labelWalletTopupPath,
  normalizeLabelBillingSettings,
} from "@/lib/label-billing";
import type {
  LabelBillingSettings,
  LabelWalletLedgerEntry,
  LabelWalletLedgerType,
  LabelWalletTopupRequest,
} from "@/types";
import { LabelWalletTopupDialog } from "@/components/labels/label-wallet-topup-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, ExternalLink, History, Loader2, ShoppingBag, Wallet } from "lucide-react";

function toDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (
    typeof value === "object" &&
    value &&
    "toDate" in value &&
    typeof (value as { toDate: () => Date }).toDate === "function"
  ) {
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

function ledgerTypeLabel(type: LabelWalletLedgerType | string): string {
  switch (type) {
    case "admin_adjust":
      return "By Admin";
    case "reissue_credit":
      return "Reissue Credit";
    case "period_reset":
      return "Period Reset";
    case "topup":
      return "Top-up";
    case "purchase":
      return "Purchase";
    case "purchase_refund":
      return "Purchase Refund";
    default:
      return String(type).replace(/_/g, " ");
  }
}

/** Hide reason when it only repeats the type title (e.g. "Reissue credit"). */
function shouldShowLedgerReason(type: LabelWalletLedgerType | string, reason?: string | null): boolean {
  const text = String(reason || "").trim();
  if (!text) return false;
  const normalizedReason = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const normalizedType = ledgerTypeLabel(type).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (normalizedReason === normalizedType) return false;
  // Legacy default copy that duplicates "By Admin"
  if (
    type === "admin_adjust" &&
    (normalizedReason === "admin wallet balance change" ||
      normalizedReason === "wallet balance adjusted by admin" ||
      normalizedReason === "wallet balance updated by admin")
  ) {
    return false;
  }
  if (type === "reissue_credit" && normalizedReason === "reissue credit") return false;
  return true;
}

type HistoryKind = "topups" | "purchases" | null;

type Props = {
  onBillingLoaded?: (settings: LabelBillingSettings) => void;
};

export function LabelBillingCard({ onBillingLoaded }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [settings, setSettings] = useState<LabelBillingSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [topupOpen, setTopupOpen] = useState(false);
  const [historyKind, setHistoryKind] = useState<HistoryKind>(null);
  const [ledger, setLedger] = useState<LabelWalletLedgerEntry[]>([]);
  const [topups, setTopups] = useState<LabelWalletTopupRequest[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Filters inside history dialog
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterQuery, setFilterQuery] = useState("");

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
          query(collection(db, labelWalletLedgerPath(user.uid)), orderBy("createdAt", "desc"), limit(100))
        ),
        getDocs(
          query(collection(db, labelWalletTopupPath(user.uid)), orderBy("requestedAt", "desc"), limit(50))
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

  useEffect(() => {
    if (!historyKind) return;
    setFilterFrom("");
    setFilterTo("");
    setFilterStatus("all");
    setFilterType("all");
    setFilterQuery("");
  }, [historyKind]);

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

  const inDateRange = (d: Date | null) => {
    if (!d) return true;
    if (filterFrom) {
      const from = startOfDay(new Date(filterFrom));
      if (isBefore(d, from)) return false;
    }
    if (filterTo) {
      const to = endOfDay(new Date(filterTo));
      if (isAfter(d, to)) return false;
    }
    return true;
  };

  const filteredTopupRequests = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return topups.filter((t) => {
      if (filterStatus !== "all" && String(t.status).toLowerCase() !== filterStatus) return false;
      if (!inDateRange(toDate(t.requestedAt))) return false;
      if (!q) return true;
      const hay = `${t.status} ${t.note || ""} ${t.rejectionReason || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [topups, filterStatus, filterFrom, filterTo, filterQuery]);

  const filteredTopupLedger = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return topupLike
      .filter((e) => e.type !== "topup" || !e.topupRequestId)
      .filter((e) => {
        if (filterType !== "all" && e.type !== filterType) return false;
        if (!inDateRange(toDate(e.createdAt))) return false;
        if (!q) return true;
        const hay = `${ledgerTypeLabel(e.type)} ${e.reason || ""}`.toLowerCase();
        return hay.includes(q);
      });
  }, [topupLike, filterType, filterFrom, filterTo, filterQuery]);

  const filteredPurchases = useMemo(() => {
    const q = filterQuery.trim().toLowerCase();
    return purchases.filter((e) => {
      if (filterType !== "all" && e.type !== filterType) return false;
      if (!inDateRange(toDate(e.createdAt))) return false;
      if (!q) return true;
      const hay = `${ledgerTypeLabel(e.type)} ${e.reason || ""} ${e.labelPurchaseId || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [purchases, filterType, filterFrom, filterTo, filterQuery]);

  const ends = settings ? labelBillingPeriodEndsAt(settings.period) : null;

  const downloadCurrentHistory = () => {
    if (historyKind === "topups") {
      downloadCsv("wallet-topup-history.csv", [
        ["Date", "Source", "Status / Type", "Amount", "Reason / Note", "Receipt"],
        ...filteredTopupRequests.map((t) => [
          toDate(t.requestedAt)?.toISOString() || "",
          "Request",
          t.status,
          t.creditedAmountCents != null
            ? (t.creditedAmountCents / 100).toFixed(2)
            : t.claimedAmountCents != null
              ? (t.claimedAmountCents / 100).toFixed(2)
              : "",
          t.note || t.rejectionReason || "",
          (t.receiptUrls || [])[0] || "",
        ]),
        ...filteredTopupLedger.map((e) => [
          toDate(e.createdAt)?.toISOString() || "",
          "Ledger",
          ledgerTypeLabel(e.type),
          (e.amountCents / 100).toFixed(2),
          e.reason || "",
          (e.receiptUrls || [])[0] || "",
        ]),
      ]);
    } else if (historyKind === "purchases") {
      downloadCsv("wallet-purchase-history.csv", [
        ["Date", "Type", "Amount", "Balance after", "Label ID", "Reason"],
        ...filteredPurchases.map((e) => [
          toDate(e.createdAt)?.toISOString() || "",
          ledgerTypeLabel(e.type),
          (e.amountCents / 100).toFixed(2),
          e.balanceAfterCents != null ? (e.balanceAfterCents / 100).toFixed(2) : "",
          e.labelPurchaseId || "",
          e.reason || "",
        ]),
      ]);
    }
    toast({ title: "CSV downloaded" });
  };

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
          <CardTitle className="text-lg">Trial Label Purchase Limit</CardTitle>
          <CardDescription>
            {labelBillingSummaryLine(settings)}
            {ends ? ` · Resets ${format(ends, "PPp")}` : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          When your trial {formatLabelBillingPeriod(settings.period)} label purchase limit is used up,
          purchases are blocked until the period resets or an administrator raises your limit.
          Remaining:{" "}
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
        <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Wallet className="h-5 w-5" />
              Label Wallet
            </CardTitle>
            <CardDescription className="mt-1">{labelBillingSummaryLine(settings)}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setTopupOpen(true)}>Top up</Button>
            <Button type="button" variant="outline" onClick={() => setHistoryKind("topups")}>
              <History className="mr-2 h-4 w-4" />
              Top-up History
            </Button>
            <Button type="button" variant="outline" onClick={() => setHistoryKind("purchases")}>
              <ShoppingBag className="mr-2 h-4 w-4" />
              Purchase History
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3 text-sm">
            <div className="rounded-md border px-3 py-2">
              <p className="text-muted-foreground">Available Balance</p>
              <p className="text-xl font-semibold">
                {formatLabelBillingMoney(settings.walletBalanceCents || 0)}
              </p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="text-muted-foreground">
                {formatLabelBillingPeriodAdjective(settings.period)} Spending Limit
              </p>
              <p className="text-xl font-semibold">
                {formatLabelBillingMoney(settings.limitAmountCents)}
              </p>
            </div>
            <div className="rounded-md border px-3 py-2">
              <p className="text-muted-foreground">
                Remaining Limit for this {formatLabelBillingPeriodNoun(settings.period)}
              </p>
              <p className="text-xl font-semibold">
                {formatLabelBillingMoney(labelBillingRemainingCents(settings))}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={historyKind != null} onOpenChange={(open) => !open && setHistoryKind(null)}>
        <DialogContent className="max-h-[min(92vh,860px)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {historyKind === "purchases" ? "Purchase History" : "Top-up History"}
            </DialogTitle>
            <DialogDescription>
              Filter entries, then download the filtered list as CSV.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="hist-from">From</Label>
              <Input
                id="hist-from"
                type="date"
                value={filterFrom}
                onChange={(e) => setFilterFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hist-to">To</Label>
              <Input
                id="hist-to"
                type="date"
                value={filterTo}
                onChange={(e) => setFilterTo(e.target.value)}
              />
            </div>
            {historyKind === "topups" ? (
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All statuses</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {historyKind === "topups" ? (
                    <>
                      <SelectItem value="admin_adjust">By Admin</SelectItem>
                      <SelectItem value="reissue_credit">Reissue Credit</SelectItem>
                      <SelectItem value="period_reset">Period Reset</SelectItem>
                      <SelectItem value="topup">Top-up</SelectItem>
                    </>
                  ) : (
                    <>
                      <SelectItem value="purchase">Purchase</SelectItem>
                      <SelectItem value="purchase_refund">Purchase Refund</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-4">
              <Label htmlFor="hist-q">Search</Label>
              <Input
                id="hist-q"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="Search note, reason, label ID…"
              />
            </div>
          </div>

          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={historyLoading}
              onClick={downloadCurrentHistory}
            >
              <Download className="mr-2 h-4 w-4" />
              Download CSV
            </Button>
          </div>

          {historyLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : historyKind === "topups" ? (
            filteredTopupRequests.length === 0 && filteredTopupLedger.length === 0 ? (
              <p className="text-sm text-muted-foreground">No matching top-up history.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {filteredTopupRequests.map((t) => (
                  <li key={t.id} className="rounded-md border px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium capitalize">{t.status}</span>
                      <span className="text-muted-foreground">
                        {toDate(t.requestedAt) ? format(toDate(t.requestedAt)!, "PPp") : "—"}
                      </span>
                    </div>
                    <p>
                      Claimed:{" "}
                      {t.claimedAmountCents ? formatLabelBillingMoney(t.claimedAmountCents) : "—"}
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
                {filteredTopupLedger.map((e) => (
                  <li key={e.id} className="rounded-md border px-3 py-2">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{ledgerTypeLabel(e.type)}</span>
                      <span
                        className={
                          e.amountCents < 0
                            ? "text-destructive"
                            : e.amountCents > 0
                              ? "text-emerald-700"
                              : undefined
                        }
                      >
                        {formatSignedLabelBillingMoney(e.amountCents)}
                      </span>
                    </div>
                    {shouldShowLedgerReason(e.type, e.reason) ? (
                      <p className="text-muted-foreground">{e.reason}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {toDate(e.createdAt) ? format(toDate(e.createdAt)!, "PPp") : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )
          ) : filteredPurchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No matching purchase history.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {filteredPurchases.map((e) => (
                <li key={e.id} className="flex justify-between gap-2 rounded-md border px-3 py-2">
                  <div>
                    <p className="font-medium">{ledgerTypeLabel(e.type)}</p>
                    {shouldShowLedgerReason(e.type, e.reason) ? (
                      <p className="text-muted-foreground">{e.reason}</p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">
                      {toDate(e.createdAt) ? format(toDate(e.createdAt)!, "PPp") : ""}
                      {e.labelPurchaseId ? ` · ${e.labelPurchaseId}` : ""}
                    </p>
                  </div>
                  <span
                    className={
                      e.amountCents < 0
                        ? "text-destructive"
                        : e.amountCents > 0
                          ? "text-emerald-700"
                          : undefined
                    }
                  >
                    {formatSignedLabelBillingMoney(e.amountCents)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>

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
