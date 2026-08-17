"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, PiggyBank } from "lucide-react";
import {
  DEFAULT_LABEL_SAVINGS_BENCHMARKS,
  type LabelSavingsBenchmarks,
} from "@/lib/label-savings-benchmarks";

export function LabelMarketRatesPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [usps, setUsps] = useState(String(DEFAULT_LABEL_SAVINGS_BENCHMARKS.usps));
  const [ups, setUps] = useState(String(DEFAULT_LABEL_SAVINGS_BENCHMARKS.ups));
  const [fedex, setFedex] = useState(String(DEFAULT_LABEL_SAVINGS_BENCHMARKS.fedex));

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/admin/label-market-rates", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load rates");
        const b = data.benchmarks as LabelSavingsBenchmarks;
        if (!cancelled && b) {
          setUsps(String(b.usps));
          setUps(String(b.ups));
          setFedex(String(b.fedex));
        }
      } catch (e) {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Could not load market rates",
            description: e instanceof Error ? e.message : "Try again.",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, toast]);

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/admin/label-market-rates", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          usps: Number(usps),
          ups: Number(ups),
          fedex: Number(fedex),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      const b = data.benchmarks as LabelSavingsBenchmarks;
      if (b) {
        setUsps(String(b.usps));
        setUps(String(b.ups));
        setFedex(String(b.fedex));
      }
      toast({
        title: "Market rates saved",
        description: "Client Reports will use these approximate courier prices for GOFO savings.",
      });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Save failed",
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PiggyBank className="h-5 w-5" />
          Label savings market rates
        </CardTitle>
        <CardDescription>
          Approximate Ground-style prices used on client Reports. Compared against what the client
          actually paid for PrepCorex GOFO. These are estimates, not live carrier quotes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="market-usps">USPS (approx $)</Label>
                <Input
                  id="market-usps"
                  type="number"
                  min={0}
                  step="0.01"
                  value={usps}
                  onChange={(e) => setUsps(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="market-ups">UPS (approx $)</Label>
                <Input
                  id="market-ups"
                  type="number"
                  min={0}
                  step="0.01"
                  value={ups}
                  onChange={(e) => setUps(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="market-fedex">FedEx (approx $)</Label>
                <Input
                  id="market-fedex"
                  type="number"
                  min={0}
                  step="0.01"
                  value={fedex}
                  onChange={(e) => setFedex(e.target.value)}
                />
              </div>
            </div>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save market rates
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
