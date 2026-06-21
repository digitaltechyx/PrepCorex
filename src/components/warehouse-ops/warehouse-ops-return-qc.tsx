"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { findBinByPath } from "@/lib/warehouse-putaway";
import {
  applyReturnQcDamaged,
  applyReturnQcDispose,
  applyReturnQcRestock,
} from "@/lib/warehouse-returns";
import type { WarehouseCartonDoc, WarehouseDoc } from "@/types";
import { CheckCircle2, Loader2, RotateCcw, Trash2, XCircle } from "lucide-react";

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseOpsReturnQc({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;
  const { quarantineReturnCartons: cartons, liveLoading: loading } = useWarehouseOpsLive();

  const [selected, setSelected] = useState<WarehouseCartonDoc | null>(null);
  const [binScan, setBinScan] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleRestock() {
    if (!selected) return;
    const v = binScan.trim();
    if (!v) {
      toast({ title: "Scan destination bin", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const bin = await findBinByPath(warehouse.id, v);
      if (!bin) {
        toast({ title: "Bin not found", variant: "destructive" });
        return;
      }
      await applyReturnQcRestock({
        warehouseId: warehouse.id,
        cartonId: selected.id,
        binId: bin.id,
        binPath: bin.path,
        operatorId,
      });
      toast({ title: "Restocked", description: bin.path });
      setSelected(null);
      setBinScan("");
      setNotes("");
    } catch (e) {
      toast({
        title: "Restock failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDamaged() {
    if (!selected) return;
    setSaving(true);
    try {
      await applyReturnQcDamaged({
        warehouseId: warehouse.id,
        cartonId: selected.id,
        notes: notes.trim() || null,
        operatorId,
      });
      toast({ title: "Marked damaged" });
      setSelected(null);
      setNotes("");
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDispose() {
    if (!selected) return;
    setSaving(true);
    try {
      await applyReturnQcDispose({
        warehouseId: warehouse.id,
        cartonId: selected.id,
        notes: notes.trim() || null,
        operatorId,
      });
      toast({ title: "Marked for dispose" });
      setSelected(null);
      setNotes("");
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <WarehouseOpsHeader title="Return QC" />

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading quarantine returns…
        </div>
      ) : cartons.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            No return cartons awaiting QC.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cartons.map((c) => (
            <Card
              key={c.id}
              className={
                selected?.id === c.id ? "border-orange-400" : "cursor-pointer hover:border-orange-200"
              }
              onClick={() => setSelected(c)}
            >
              <CardHeader className="pb-2">
                <div className="flex justify-between gap-2">
                  <CardTitle className="text-base font-mono">{c.cartonCode}</CardTitle>
                  <Badge variant="secondary">quarantine</Badge>
                </div>
                <CardDescription>
                  {c.productTitle || c.sku} · {c.quantity} units
                </CardDescription>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}

      {selected ? (
        <Card className="border-orange-200/60">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <RotateCcw className="h-4 w-4" />
              QC — {selected.cartonCode}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Restock — scan bin</Label>
              <div className="flex gap-2">
                <Input
                  value={binScan}
                  onChange={(e) => setBinScan(e.target.value)}
                  placeholder="Bin path"
                  className="font-mono"
                />
                <ScanCameraButton onScan={(v) => setBinScan(v)} />
              </div>
              <Button className="w-full" disabled={saving} onClick={() => void handleRestock()}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Restock to bin
              </Button>
            </div>
            <div className="space-y-2 border-t pt-4">
              <Label>Notes</Label>
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" disabled={saving} onClick={() => void handleDamaged()}>
                  <XCircle className="h-4 w-4 mr-1" />
                  Damaged
                </Button>
                <Button variant="destructive" disabled={saving} onClick={() => void handleDispose()}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Dispose
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
