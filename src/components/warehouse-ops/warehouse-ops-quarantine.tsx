"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { format } from "date-fns";
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowRight,
  Loader2,
  Package,
  RotateCcw,
  Trash2,
  Truck,
} from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { WarehouseOpsActivityLog } from "@/components/warehouse-ops/warehouse-ops-activity-log";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  disposeQuarantineLine,
  listQuarantineHolds,
  releaseQuarantineLineToStorage,
  returnQuarantineLineToPack,
  returnQuarantineLineToPutaway,
  type QuarantineHoldRow,
} from "@/lib/warehouse-quarantine";
import { areasForPacking, listWarehouseAreas } from "@/lib/warehouse-putaway-disposition";
import type { WarehouseAreaDoc, WarehouseDoc } from "@/types";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

function ageBadgeClass(days: number): string {
  if (days >= 14) return "bg-red-100 border-red-300 text-red-900";
  if (days >= 7) return "bg-amber-50 border-amber-300 text-amber-900";
  return "bg-muted border-border text-muted-foreground";
}

function formatAgeBadge(days: number): string {
  if (days <= 0) return "New today";
  return `${days}d`;
}

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
  const [packAreas, setPackAreas] = useState<WarehouseAreaDoc[]>([]);
  const [packAreaId, setPackAreaId] = useState("");

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const areas = await listWarehouseAreas(warehouse.id);
        if (cancelled) return;
        const packing = areasForPacking(areas);
        setPackAreas(packing);
        setPackAreaId((prev) => prev || packing[0]?.id || "");
      } catch {
        if (!cancelled) setPackAreas([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouse.id]);

  function selectRow(row: QuarantineHoldRow) {
    setSelected(row);
    setQty(String(row.line.quantity));
    setBinPath("");
  }

  async function handleReturnToPutaway() {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await returnQuarantineLineToPutaway({
        warehouseId: warehouse.id,
        cartonId: selected.cartonId,
        lineId: selected.line.lineId,
        quantity: parseInt(qty, 10) || selected.line.quantity,
        operatorId,
      });
      toast({
        title: "Returned to Putaway",
        description: `${result.returnedQty}u of ${selected.line.sku} (${result.cartonCode}) is ready on Putaway — stow to a bin or area to update stock.`,
      });
      setSelected(null);
      setBinPath("");
      await reload();
    } catch (e) {
      toast({
        title: "Return failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleSendToPack() {
    if (!selected) return;
    if (!packAreaId) {
      toast({
        title: "Select a packing area",
        description: "Configure a packing-purpose area in warehouse setup, then select it here.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const result = await returnQuarantineLineToPack({
        warehouseId: warehouse.id,
        cartonId: selected.cartonId,
        lineId: selected.line.lineId,
        packAreaId,
        quantity: parseInt(qty, 10) || selected.line.quantity,
        operatorId,
      });
      toast({
        title: "Sent to Pack",
        description: `${result.returnedQty}u → pack area ${result.packAreaCode}. Complete Pack, then Dispatch to create the shipped entry.`,
      });
      setSelected(null);
      await reload();
    } catch (e) {
      toast({
        title: "Send to pack failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
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
        title: "Stowed as good",
        description: `${result.releasedQty}u of ${selected.line.sku} are now good stock in client inventory.`,
      });
      setSelected(null);
      setBinPath("");
      await reload();
    } catch (e) {
      toast({
        title: "Stow failed",
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

      <Tabs defaultValue="work">
        <TabsList>
          <TabsTrigger value="work">Quarantine</TabsTrigger>
          <TabsTrigger value="log">Log</TabsTrigger>
        </TabsList>
        <TabsContent value="work" className="mt-4 space-y-6">
      <Card className="border-red-200/70 bg-red-50/30">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600" />
            Damaged hold
          </CardTitle>
          <CardDescription className="text-xs space-y-1">
            <p>
              Hold damaged stock until you decide. Age badge shows how long it has been here —
              there is no auto-dispose deadline.
            </p>
            <p>
              <strong>Return → Putaway</strong> to stow again (good stock),{" "}
              <strong>Send to Pack</strong> to ship via Pack → Dispatch, or{" "}
              <strong>Dispose now</strong> to remove it manually.
            </p>
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
            const active =
              selected?.cartonId === row.cartonId && selected.line.lineId === row.line.lineId;
            return (
              <button
                key={key}
                type="button"
                onClick={() => selectRow(row)}
                className={cn(
                  "w-full text-left rounded-lg border px-3 py-3 transition-colors",
                  active ? "border-red-400 bg-red-50" : "bg-card hover:bg-muted/40"
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
                      {row.clientId
                        ? ` · client ${row.clientId.slice(0, 8)}…`
                        : row.clientLabel
                          ? ` · ${row.clientLabel}`
                          : " · no client"}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      In quarantine since {format(row.quarantineAt, "MMM d, yyyy")}
                    </p>
                  </div>
                  <Badge
                    variant="outline"
                    className={ageBadgeClass(row.daysInQuarantine)}
                    title={`In quarantine ${row.daysInQuarantine} day${row.daysInQuarantine === 1 ? "" : "s"}`}
                  >
                    Age {formatAgeBadge(row.daysInQuarantine)}
                  </Badge>
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
              Putaway again, send to Pack to ship, stow now, or dispose manually.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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

            <div className="rounded-md border bg-muted/30 p-3 space-y-2">
              <p className="text-xs font-medium">Primary actions</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleReturnToPutaway()} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  ) : (
                    <RotateCcw className="h-4 w-4 mr-1" />
                  )}
                  Return
                  <ArrowRight className="h-3.5 w-3.5 ml-1 opacity-70" />
                  Putaway
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void handleSendToPack()}
                  disabled={saving || packAreas.length === 0}
                >
                  <Truck className="h-4 w-4 mr-1" />
                  Send to Pack
                </Button>
              </div>
              {packAreas.length > 0 ? (
                <div className="max-w-xs space-y-1">
                  <Label className="text-xs">Packing area</Label>
                  <Select value={packAreaId} onValueChange={setPackAreaId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select packing area" />
                    </SelectTrigger>
                    <SelectContent>
                      {packAreas.map((a) => (
                        <SelectItem key={a.id} value={a.id}>
                          {a.code}
                          {a.name ? ` — ${a.name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-muted-foreground">
                    Moves to the packing area. Complete pack on the Pack page, then Dispatch to
                    create the client <strong>Shipped</strong> entry (use a partial qty above if
                    only some units ship).
                  </p>
                </div>
              ) : (
                <p className="text-[11px] text-amber-800">
                  No packing area found — add an area with Packing purpose to enable Send to Pack.
                </p>
              )}
              <Button variant="outline" size="sm" asChild>
                <Link href="/warehouse-ops/putaway">
                  <Package className="h-3.5 w-3.5 mr-1" />
                  Open Putaway
                </Link>
              </Button>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Optional: stow now into storage bin</Label>
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
              <Button
                variant="outline"
                onClick={() => void handleRelease()}
                disabled={saving || !binPath.trim()}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <ArchiveRestore className="h-4 w-4 mr-1" />
                )}
                Stow now (update stock)
              </Button>
              <Button variant="destructive" onClick={() => void handleDisposeNow()} disabled={saving}>
                <Trash2 className="h-4 w-4 mr-1" />
                Dispose now
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelected(null)}
                disabled={saving}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
        </TabsContent>
        <TabsContent value="log" className="mt-4">
          <WarehouseOpsActivityLog warehouse={warehouse} module="quarantine" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
