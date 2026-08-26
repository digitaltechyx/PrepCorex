"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Scissors } from "lucide-react";
import {
  DEFAULT_PREP_SAVINGS_BENCHMARKS,
  type PrepSavingsBenchmarks,
} from "@/lib/prep-savings-benchmarks";

export function PrepMarketRatesPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fbaPerUnit, setFbaPerUnit] = useState(String(DEFAULT_PREP_SAVINGS_BENCHMARKS.fbaPerUnit));
  const [fbmPerUnit, setFbmPerUnit] = useState(String(DEFAULT_PREP_SAVINGS_BENCHMARKS.fbmPerUnit));
  const [crossdockPerUnit, setCrossdockPerUnit] = useState(
    String(DEFAULT_PREP_SAVINGS_BENCHMARKS.crossdockPerUnit)
  );
  const [returnsPerUnit, setReturnsPerUnit] = useState(
    String(DEFAULT_PREP_SAVINGS_BENCHMARKS.returnsPerUnit)
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/admin/prep-market-rates", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Failed to load rates");
        const b = data.benchmarks as PrepSavingsBenchmarks;
        if (!cancelled && b) {
          setFbaPerUnit(String(b.fbaPerUnit));
          setFbmPerUnit(String(b.fbmPerUnit));
          setCrossdockPerUnit(String(b.crossdockPerUnit));
          setReturnsPerUnit(String(b.returnsPerUnit));
        }
      } catch (e) {
        if (!cancelled) {
          toast({
            variant: "destructive",
            title: "Could not load prep market rates",
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
      const res = await fetch("/api/admin/prep-market-rates", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fbaPerUnit: Number(fbaPerUnit),
          fbmPerUnit: Number(fbmPerUnit),
          crossdockPerUnit: Number(crossdockPerUnit),
          returnsPerUnit: Number(returnsPerUnit),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      const b = data.benchmarks as PrepSavingsBenchmarks;
      if (b) {
        setFbaPerUnit(String(b.fbaPerUnit));
        setFbmPerUnit(String(b.fbmPerUnit));
        setCrossdockPerUnit(String(b.crossdockPerUnit));
        setReturnsPerUnit(String(b.returnsPerUnit));
      }
      toast({ title: "Prep market rates saved" });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Could not save prep market rates",
        description: e instanceof Error ? e.message : "Try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Scissors className="h-4 w-4" />
          Prep savings market rates
        </CardTitle>
        <CardDescription>
          Per-unit rates used on client Reports to estimate savings vs a typical 3PL for FBA prep,
          FBM pick/pack, cross-dock handling, and product return processing.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="prep-fba-rate">Typical FBA prep / unit ($)</Label>
                <Input
                  id="prep-fba-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={fbaPerUnit}
                  onChange={(e) => setFbaPerUnit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prep-fbm-rate">Typical FBM pick/pack / unit ($)</Label>
                <Input
                  id="prep-fbm-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={fbmPerUnit}
                  onChange={(e) => setFbmPerUnit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prep-crossdock-rate">Typical cross-dock / unit ($)</Label>
                <Input
                  id="prep-crossdock-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={crossdockPerUnit}
                  onChange={(e) => setCrossdockPerUnit(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="prep-returns-rate">Typical return handling / unit ($)</Label>
                <Input
                  id="prep-returns-rate"
                  type="number"
                  min="0"
                  step="0.01"
                  value={returnsPerUnit}
                  onChange={(e) => setReturnsPerUnit(e.target.value)}
                />
              </div>
            </div>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save prep rates
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
