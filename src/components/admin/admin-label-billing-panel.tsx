"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { hasRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";

export function AdminLabelBillingPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { managedUsers } = useManagedUsers();
  const [userId, setUserId] = useState("");
  const [clientPickerOpen, setClientPickerOpen] = useState(false);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<LabelBillingSettings | null>(null);
  const [mode, setMode] = useState<"limit" | "wallet">("limit");
  const [period, setPeriod] = useState<LabelBillingPeriod>("monthly");
  const [limitDollars, setLimitDollars] = useState("50");
  const [walletDollars, setWalletDollars] = useState("0");
  const [reissueDollars, setReissueDollars] = useState("");
  const [markupDollars, setMarkupDollars] = useState("0.15");
  const [allowShippo, setAllowShippo] = useState(true);
  const [allowShipbest, setAllowShipbest] = useState(true);
  const [apiFeeEnabled, setApiFeeEnabled] = useState(false);
  const [apiFeeCadence, setApiFeeCadence] = useState<"monthly" | "onetime">("monthly");
  const [apiFeeDollars, setApiFeeDollars] = useState("0");
  const [reason, setReason] = useState("");

  const clientOptions = useMemo(() => {
    const rows = (managedUsers || [])
      .filter((u) => hasRole(u, "user") || hasRole(u, "commission_agent"))
      .filter((u) => u.status === "approved" || !u.status)
      .filter((u) => u.status !== "deleted")
      .map((u) => ({
        uid: u.uid,
        clientId: String(u.clientId || "").trim(),
        name: String(u.name || u.email || u.uid || "").trim(),
        email: String(u.email || "").trim(),
        label: formatUserDisplayName(u, { showEmail: true }),
      }));

    rows.sort((a, b) => {
      const aId = Number(a.clientId);
      const bId = Number(b.clientId);
      const aHas = Number.isFinite(aId) && a.clientId !== "";
      const bHas = Number.isFinite(bId) && b.clientId !== "";
      if (aHas && bHas && aId !== bId) return aId - bId;
      if (aHas && !bHas) return -1;
      if (!aHas && bHas) return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: "base" });
    });
    return rows;
  }, [managedUsers]);

  const filteredClientOptions = useMemo(() => {
    const q = clientSearchQuery.trim().toLowerCase();
    if (!q) return clientOptions;
    return clientOptions.filter((opt) => {
      const hay = `${opt.label} ${opt.clientId} ${opt.name} ${opt.email} ${opt.uid}`.toLowerCase();
      return hay.includes(q);
    });
  }, [clientOptions, clientSearchQuery]);

  const selectedClient = useMemo(
    () => clientOptions.find((c) => c.uid === userId) || null,
    [clientOptions, userId]
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
      setMarkupDollars(((s.markupCents ?? 15) / 100).toFixed(2));
      setAllowShippo(s.allowShippo !== false);
      setAllowShipbest(s.allowShipbest !== false);
      const fee = s.apiFee;
      setApiFeeEnabled(fee?.enabled === true);
      setApiFeeCadence(fee?.cadence === "onetime" ? "onetime" : "monthly");
      setApiFeeDollars((((fee?.amountCents ?? 0) || 0) / 100).toFixed(2));
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
          Default is a $20 monthly purchase limit, $0.15 rate markup, and both Shippo + PrepCorex GOFO
          rates. Adjust billing, markup, couriers, and optional API fee per client.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 overflow-visible">
        <div className="space-y-2">
          <Label>Client</Label>
          <Popover
            open={clientPickerOpen}
            modal={false}
            onOpenChange={(open) => {
              setClientPickerOpen(open);
              if (!open) setClientSearchQuery("");
            }}
          >
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                role="combobox"
                aria-expanded={clientPickerOpen}
                className="relative z-10 w-full max-w-xl justify-between font-normal pointer-events-auto"
              >
                <span className="truncate text-left">
                  {selectedClient ? selectedClient.label : "Select client…"}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="z-[200] w-[min(100vw-2rem,36rem)] p-0 pointer-events-auto"
              align="start"
              side="bottom"
              sideOffset={4}
              collisionPadding={16}
              onOpenAutoFocus={(e) => e.preventDefault()}
              onCloseAutoFocus={(e) => e.preventDefault()}
            >
              <div className="flex items-center gap-2 border-b px-3 py-2">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <Input
                  value={clientSearchQuery}
                  onChange={(e) => setClientSearchQuery(e.target.value)}
                  placeholder="Search by client ID, name, or email…"
                  className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                  autoFocus
                />
              </div>
              <div className="max-h-[280px] overflow-y-auto overscroll-contain p-1">
                {filteredClientOptions.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">No clients found.</p>
                ) : (
                  filteredClientOptions.map((opt) => {
                    const selected = userId === opt.uid;
                    return (
                      <button
                        key={opt.uid}
                        type="button"
                        className={cn(
                          "flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm hover:bg-accent hover:text-accent-foreground",
                          selected && "bg-accent"
                        )}
                        onClick={() => {
                          setUserId(opt.uid);
                          setClientPickerOpen(false);
                          setClientSearchQuery("");
                        }}
                      >
                        <Check
                          className={cn("h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")}
                        />
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </PopoverContent>
          </Popover>
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
              <div className="space-y-2">
                <Label>Rate markup (USD)</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={markupDollars}
                  onChange={(e) => setMarkupDollars(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Added on top of every quoted rate. Default $0.15.
                </p>
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label>Courier rates available to this client</Label>
                <div className="flex flex-wrap gap-4 rounded-md border px-3 py-3">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allowShippo}
                      onCheckedChange={(v) => setAllowShippo(v === true)}
                    />
                    Shippo
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={allowShipbest}
                      onCheckedChange={(v) => setAllowShipbest(v === true)}
                    />
                    PrepCorex GOFO (ShipBest)
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  Default is both. At least one courier must stay enabled.
                </p>
              </div>

              <div className="space-y-3 sm:col-span-2 rounded-md border px-3 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <Label>API fee (Buy Labels access)</Label>
                    <p className="text-xs text-muted-foreground mt-1">
                      When enabled, the client must pay this fee before buying labels (wallet or
                      ACH/Zelle). Monthly renews every 30 days; one-time unlocks permanently.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-sm shrink-0">
                    <Checkbox
                      checked={apiFeeEnabled}
                      onCheckedChange={(v) => setApiFeeEnabled(v === true)}
                    />
                    Enable
                  </label>
                </div>
                {apiFeeEnabled ? (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Fee type</Label>
                      <Select
                        value={apiFeeCadence}
                        onValueChange={(v) => setApiFeeCadence(v as "monthly" | "onetime")}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="monthly">Monthly (every 30 days)</SelectItem>
                          <SelectItem value="onetime">One-time</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>API fee amount (USD)</Label>
                      <Input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={apiFeeDollars}
                        onChange={(e) => setApiFeeDollars(e.target.value)}
                      />
                    </div>
                    {settings.apiFee?.enabled ? (
                      <p className="text-xs text-muted-foreground sm:col-span-2">
                        Current status: {settings.apiFee.status}
                        {settings.apiFee.paidUntilIso
                          ? ` · Paid until ${new Date(settings.apiFee.paidUntilIso).toLocaleString()}`
                          : settings.apiFee.status === "paid" &&
                              settings.apiFee.cadence === "onetime"
                            ? " · One-time paid"
                            : ""}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
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
                disabled={saving || (!allowShippo && !allowShipbest)}
                onClick={() =>
                  void patch(
                    {
                      mode,
                      period,
                      limitAmountDollars: Number(limitDollars),
                      markupDollars: Number(markupDollars),
                      allowShippo,
                      allowShipbest,
                      apiFeeEnabled,
                      apiFeeCadence,
                      apiFeeAmountDollars: Number(apiFeeDollars),
                      reason: reason || undefined,
                    },
                    "Billing settings saved"
                  )
                }
              >
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save billing settings
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
                          reason: reason || "Wallet balance adjusted by admin",
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
