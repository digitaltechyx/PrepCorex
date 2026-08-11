"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { hasRole } from "@/lib/permissions";
import {
  formatLabelBillingMoney,
  formatLabelBillingPeriod,
  labelBillingRemainingCents,
  labelBillingSummaryLine,
} from "@/lib/label-billing";
import type { LabelBillingPeriod, LabelBillingSettings } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

export function AdminLabelBillingPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { managedUsers } = useManagedUsers();
  const [userId, setUserId] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<LabelBillingSettings | null>(null);
  const [mode, setMode] = useState<"limit" | "wallet">("limit");
  const [period, setPeriod] = useState<LabelBillingPeriod>("monthly");
  const [limitDollars, setLimitDollars] = useState("50");
  const [walletDollars, setWalletDollars] = useState("0");
  const [reissueDollars, setReissueDollars] = useState("");
  const [reason, setReason] = useState("");

  const clientOptions = useMemo(
    () =>
      (managedUsers || [])
        .filter((u) => hasRole(u, "user") || hasRole(u, "commission_agent"))
        .filter((u) => u.status === "approved" || !u.status)
        .filter((u) => u.status !== "deleted")
        .map((u) => ({
          uid: u.uid,
          label: formatUserDisplayName(u, { showEmail: true }),
        }))
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [managedUsers]
  );

  const load = useCallback(async () => {
    if (!user || !userId) {
      setSettings(null);
      return;
    }
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/label-billing?userId=${encodeURIComponent(userId)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load");
      const s = data.settings as LabelBillingSettings;
      setSettings(s);
      setMode(s.mode);
      setPeriod(s.period);
      setLimitDollars((s.limitAmountCents / 100).toFixed(2));
      setWalletDollars(((s.walletBalanceCents || 0) / 100).toFixed(2));
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Could not load billing",
        description: error instanceof Error ? error.message : "Try again.",
      });
      setSettings(null);
    } finally {
      setLoading(false);
    }
  }, [user, userId, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  const patch = async (body: Record<string, unknown>, okTitle: string) => {
    if (!user || !userId) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/label-billing", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ userId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Update failed");
      toast({ title: okTitle });
      setReason("");
      setReissueDollars("");
      await load();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Update failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Label billing settings</CardTitle>
        <CardDescription>
          Default is a $50 monthly purchase limit. Switch a user to wallet for ACH/Zelle top-ups, with a
          calendar spend cap.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label>Client</Label>
          <Select value={userId || undefined} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Select client…" />
            </SelectTrigger>
            <SelectContent>
              {clientOptions.map((c) => (
                <SelectItem key={c.uid} value={c.uid}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {!userId ? (
          <p className="text-sm text-muted-foreground">Select a client to manage billing.</p>
        ) : loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : settings ? (
          <>
            <p className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
              {labelBillingSummaryLine(settings)}
              <span className="text-muted-foreground">
                {" "}
                · Remaining {formatLabelBillingMoney(labelBillingRemainingCents(settings))}
              </span>
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Mode</Label>
                <Select value={mode} onValueChange={(v) => setMode(v as "limit" | "wallet")}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="limit">Purchase limit</SelectItem>
                    <SelectItem value="wallet">Wallet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Period</Label>
                <Select value={period} onValueChange={(v) => setPeriod(v as LabelBillingPeriod)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="yearly">Yearly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  {mode === "wallet" ? "Wallet spend limit (USD)" : "Purchase limit (USD)"} /{" "}
                  {formatLabelBillingPeriod(period)}
                </Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={limitDollars}
                  onChange={(e) => setLimitDollars(e.target.value)}
                />
              </div>
              {mode === "wallet" ? (
                <div className="space-y-2">
                  <Label>Wallet balance (USD)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={walletDollars}
                    onChange={(e) => setWalletDollars(e.target.value)}
                  />
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label>Reason (for adjust / reissue / reset)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Optional note stored in wallet history…"
                className="min-h-[64px]"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={saving}
                onClick={() =>
                  void patch(
                    {
                      mode,
                      period,
                      limitAmountDollars: Number(limitDollars),
                      reason: reason || undefined,
                    },
                    "Billing settings saved"
                  )
                }
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save mode / limit / period
              </Button>
              <Button
                variant="outline"
                disabled={saving}
                onClick={() =>
                  void patch(
                    { resetPeriodUsed: true, reason: reason || "Period usage reset" },
                    "Period usage reset to $0"
                  )
                }
              >
                Reset used (keep limit &amp; end date)
              </Button>
              {mode === "wallet" ? (
                <>
                  <Button
                    variant="secondary"
                    disabled={saving}
                    onClick={() =>
                      void patch(
                        {
                          walletBalanceDollars: Number(walletDollars),
                          reason: reason || "Admin wallet balance change",
                        },
                        "Wallet balance updated"
                      )
                    }
                  >
                    Set wallet balance
                  </Button>
                  <div className="flex items-center gap-2">
                    <Input
                      className="w-28"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder="Credit $"
                      value={reissueDollars}
                      onChange={(e) => setReissueDollars(e.target.value)}
                    />
                    <Button
                      variant="secondary"
                      disabled={saving || !reissueDollars}
                      onClick={() =>
                        void patch(
                          {
                            reissueCreditDollars: Number(reissueDollars),
                            reason: reason || "Reissue credit",
                          },
                          "Credit reissued"
                        )
                      }
                    >
                      Reissue credit
                    </Button>
                  </div>
                </>
              ) : null}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">No billing data.</p>
        )}
      </CardContent>
    </Card>
  );
}
