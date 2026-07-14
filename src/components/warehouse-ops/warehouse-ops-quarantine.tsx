"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ArchiveRestore, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  QUARANTINE_HOLD_DAYS,
  disposeQuarantineLine,
  listQuarantineHolds,
  releaseQuarantineLineToStorage,
  type QuarantineHoldRow,
} from "@/lib/warehouse-quarantine";
import type { WarehouseDoc } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseOpsQuarantine({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? null;
  const operatorName = userProfile?.name || userProfile?.email || null;

  const [rows, setRows] = useState<QuarantineHoldRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<QuarantineHoldRow | null>(null);
  const [binPath, setBinPath] = useState("");
  const [qty, setQty] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await listQuarantineHolds(warehouse.id);
      setRows(list);
    } catch (e) {
      toast({
        title: "Could not load quarantine",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [warehouse.id, toast]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function selectRow(row: QuarantineHoldRow) {
    setSelected(row);
    setQty(String(row.line.quantity));
    setBinPath("");
  }

  async function handleRelease() {
    if (!selected) return;
    const path = binPath.trim();
    if (!path) {
      toast({ title: "Scan a storage bin", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const result = await releaseQuarantineLineToStorage({
        warehouseId: warehouse.id,
        cartonId: selected.cartonId,
        lineId: selected.line.lineId,
        destBinPath: path,
        quantity: parseInt(qty, 10) || selected.line.quantity,
        operatorId,
      });
      toast({
        title: "Released to storage",
        description: `${result.releasedQty}u of ${selected.line.sku} are now good stock in client inventory.`,
      });
      setSelected(null);
      setBinPath("");
      await reload();
    } catch (e) {
      toast({
        title: "Release failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDisposeNow() {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await disposeQuarantineLine({
        warehouseId: warehouse.id,
        cartonId: selected.cartonId,
        lineId: selected.line.lineId,
        quantity: parseInt(qty, 10) || selected.line.quantity,
        auto: false,
        operatorId,
        operatorName,
      });
      toast({
        title: "Disposed",
        description: result.recycledId
          ? `${result.disposedQty}u moved to client disposed inventory with remarks.`
          : `${result.disposedQty}u removed from quarantine (no client linked).`,
      });
      setSelected(null);
      await reload();
    } catch (e) {
      toast({
        title: "Dispose failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <WarehouseOpsHeader title="Quarantine" />

      <Card className="border-red-200/70 bg-red-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            Damaged hold · {QUARANTINE_HOLD_DAYS} days
          </CardTitle>
          <CardDescription className="text-xs">
            Putaway damaged units land here. Operators can <strong>putaway as good</strong> into
            storage (shows in client inventory) before the deadline. If nothing is done after{" "}
            {QUARANTINE_HOLD_DAYS} days, stock is <strong>auto-disposed</strong> into the client&apos;s
            disposed inventory with remarks.
          </CardDescription>
        </CardHeader>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading quarantine…
        </div>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground text-center">
            No active quarantine stock in this warehouse.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {rows.map((row) => {
            const key = `${row.cartonId}:${row.line.lineId}`;
            const active = selected?.cartonId === row.cartonId && selected.line.lineId === row.line.lineId;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectRow(row)}
                className={cn(
                  "w-full text-left rounded-lg border px-3 py-3 transition-colors",
                  active ? "border-red-400 bg-red-50" : "bg-card hover:bg-muted/40",
                  row.isExpired && "border-red-500"
                )}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="font-mono text-sm font-semibold">
                      {row.cartonCode} · {row.line.sku}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Qty {row.line.quantity}
                      {row.line.lot ? ` · Lot ${row.line.lot}` : ""}
                      {row.clientId ? ` · client ${row.clientId.slice(0, 8)}…` : row.clientLabel ? ` · ${row.clientLabel}` : " · no client"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      In quarantine since {format(row.quarantineAt, "MMM d, yyyy")} · {row.daysInQuarantine}d
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {row.isExpired ? (
                      <Badge variant="destructive">Due for auto-dispose</Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-50 border-amber-300 text-amber-900">
                        {row.daysRemaining}d left
                      </Badge>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {selected ? (
        <Card className="border-orange-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {selected.cartonCode} · {selected.line.sku}
            </CardTitle>
            <CardDescription className="text-xs">
              Release to storage as good stock, or dispose now into the client disposed list.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="w-28">
              <Label className="text-xs">Qty</Label>
              <Input
                type="number"
                min={1}
                max={selected.line.quantity}
                value={qty}
                onChange={(e) => setQty(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Storage bin (for release / putaway as good)</Label>
              <div className="flex gap-2">
                <Input
                  value={binPath}
                  onChange={(e) => setBinPath(e.target.value)}
                  placeholder="Scan storage bin"
                  className="flex-1"
                />
                <ScanCameraButton
                  onScan={(text) => setBinPath(text)}
                  scannerTitle="Scan storage bin"
                  scannerDescription="Destination bin for good stock (not quarantine)."
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => void handleRelease()} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <ArchiveRestore className="h-4 w-4 mr-1" />
                )}
                Putaway as good
              </Button>
              <Button variant="destructive" onClick={() => void handleDisposeNow()} disabled={saving}>
                <Trash2 className="h-4 w-4 mr-1" />
                Dispose now
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelected(null)} disabled={saving}>
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
