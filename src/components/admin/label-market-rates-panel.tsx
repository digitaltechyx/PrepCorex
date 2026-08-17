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
  DEFAULT_LABEL_SAVINGS_BANDS,
  type LabelSavingsBenchmarks,
  type LabelSavingsWeightBand,
} from "@/lib/label-savings-benchmarks";

function cloneBands(bands: LabelSavingsWeightBand[]): LabelSavingsWeightBand[] {
  return bands.map((b) => ({ ...b }));
}

export function LabelMarketRatesPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [bands, setBands] = useState<LabelSavingsWeightBand[]>(() => cloneBands(DEFAULT_LABEL_SAVINGS_BANDS));

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
        if (!cancelled && b?.bands?.length) {
          setBands(cloneBands(b.bands));
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

  function updateBand(index: number, patch: Partial<LabelSavingsWeightBand>) {
    setBands((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

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
        body: JSON.stringify({ bands }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Save failed");
      const b = data.benchmarks as LabelSavingsBenchmarks;
      if (b?.bands?.length) setBands(cloneBands(b.bands));
      toast({
        title: "Market rates saved",
        description: "Client Reports will estimate USPS / UPS / FedEx from package weight.",
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
          Approximate Ground-style prices by package weight. Client Reports compare these against
          what the client paid for PrepCorex GOFO. A single $6.45 / $8.90 rate made heavier labels
          show $0 saved — this table scales USPS and UPS with weight. Estimates, not live quotes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="pb-2 pr-3 font-medium">Weight</th>
                    <th className="pb-2 pr-3 font-medium">USPS $</th>
                    <th className="pb-2 pr-3 font-medium">UPS $</th>
                    <th className="pb-2 font-medium">FedEx $</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((band, index) => (
                    <tr key={band.label || String(index)} className="border-b last:border-0">
                      <td className="py-2 pr-3 align-middle">
                        <Label className="sr-only" htmlFor={`market-band-${index}`}>
                          Weight band
                        </Label>
                        <Input
                          id={`market-band-${index}`}
                          value={band.label}
                          onChange={(e) => updateBand(index, { label: e.target.value })}
                          className="h-9"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={band.usps}
                          onChange={(e) => updateBand(index, { usps: Number(e.target.value) })}
                          className="h-9"
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={band.ups}
                          onChange={(e) => updateBand(index, { ups: Number(e.target.value) })}
                          className="h-9"
                        />
                      </td>
                      <td className="py-2">
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          value={band.fedex}
                          onChange={(e) => updateBand(index, { fedex: Number(e.target.value) })}
                          className="h-9"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
