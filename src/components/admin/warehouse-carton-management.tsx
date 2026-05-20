"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Package, Plus, Printer } from "lucide-react";
import type { WarehouseCartonDoc, WarehouseCartonStatus, WarehouseDoc, WarehousePalletDoc } from "@/types";
import {
  createWarehouseCarton,
  createWarehousePallet,
  linkCartonsToPallet,
  listWarehouseCartons,
  listWarehousePallets,
  markExpiredCartonsForWarehouse,
  updateWarehouseCarton,
} from "@/lib/warehouse-carton-firestore";
import { aggregateCartonsToSkuTotals } from "@/lib/warehouse-carton-aggregation";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import {
  buildWarehousePalletLabelsPdf,
  downloadUint8ArrayAsFile as downloadPalletPdf,
} from "@/lib/warehouse-pallet-label-pdf";
import { CARTON_STATUS_LABELS } from "@/lib/warehouse-carton-states";

const STATUS_OPTIONS: WarehouseCartonStatus[] = [
  "receiving",
  "available",
  "quarantine",
  "damaged",
  "expired",
  "on_hold",
  "reserved",
];

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseCartonManagement({ warehouse }: Props) {
  const { toast } = useToast();
  const [cartons, setCartons] = useState<WarehouseCartonDoc[]>([]);
  const [pallets, setPallets] = useState<WarehousePalletDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [printing, setPrinting] = useState(false);

  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("1");
  const [lot, setLot] = useState("");
  const [expiry, setExpiry] = useState("");
  const [status, setStatus] = useState<WarehouseCartonStatus>("receiving");
  const [selectedPalletId, setSelectedPalletId] = useState<string>("__none__");
  const [selectedCartonIds, setSelectedCartonIds] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const expired = await markExpiredCartonsForWarehouse(warehouse.id);
      if (expired > 0) {
        toast({
          title: "Expiry check",
          description: `${expired} carton(s) marked expired.`,
        });
      }
      const [c, p] = await Promise.all([
        listWarehouseCartons(warehouse.id),
        listWarehousePallets(warehouse.id),
      ]);
      setCartons(c);
      setPallets(p);
    } catch (e) {
      toast({
        title: "Could not load cartons",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [warehouse.id, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const skuTotals = useMemo(() => aggregateCartonsToSkuTotals(cartons), [cartons]);

  const handleCreateCarton = async () => {
    setSaving(true);
    try {
      const palletId =
        selectedPalletId && selectedPalletId !== "__none__" ? selectedPalletId : null;
      await createWarehouseCarton({
        warehouseId: warehouse.id,
        sku,
        quantity: parseInt(qty, 10) || 0,
        lot: lot.trim() || null,
        expiry: expiry.trim() || null,
        status,
        palletId,
      });
      setSku("");
      setLot("");
      setExpiry("");
      setQty("1");
      toast({ title: "Carton created", description: "Print the label before moving it off the dock." });
      await refresh();
    } catch (e) {
      toast({
        title: "Create failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCreatePallet = async () => {
    setSaving(true);
    try {
      await createWarehousePallet({ warehouseId: warehouse.id });
      toast({ title: "Pallet created", description: "Link cartons below, then print the pallet label." });
      await refresh();
    } catch (e) {
      toast({
        title: "Create failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleLinkToPallet = async (palletId: string) => {
    const ids = [...selectedCartonIds];
    if (!ids.length) {
      toast({ title: "Select cartons", description: "Tick cartons to link to this pallet.", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await linkCartonsToPallet(warehouse.id, palletId, ids);
      setSelectedCartonIds(new Set());
      toast({ title: "Linked", description: `${ids.length} carton(s) on pallet.` });
      await refresh();
    } catch (e) {
      toast({
        title: "Link failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleCartonSelect = (id: string) => {
    setSelectedCartonIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePrintCartons = async (subset?: WarehouseCartonDoc[]) => {
    const toPrint = subset ?? cartons;
    if (!toPrint.length) return;
    setPrinting(true);
    try {
      const bytes = await buildWarehouseCartonLabelsPdf({
        title: `${warehouse.code} — Carton labels`,
        cartons: toPrint,
      });
      downloadUint8ArrayAsFile(bytes, `${warehouse.code}-carton-labels.pdf`);
    } catch (e) {
      toast({
        title: "PDF failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  const handlePrintPallets = async () => {
    if (!pallets.length) return;
    setPrinting(true);
    try {
      const bytes = await buildWarehousePalletLabelsPdf({
        title: `${warehouse.code} — Pallet labels`,
        pallets,
      });
      downloadPalletPdf(bytes, `${warehouse.code}-pallet-labels.pdf`);
    } catch (e) {
      toast({
        title: "PDF failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  };

  const handleStatusChange = async (cartonId: string, next: WarehouseCartonStatus) => {
    try {
      await updateWarehouseCarton(warehouse.id, cartonId, { status: next });
      await refresh();
    } catch (e) {
      toast({
        title: "Update failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Phase 2: create internal <strong>carton</strong> and <strong>pallet</strong> records, print QR labels, and
        preview SKU totals from carton-level stock. Receiving / putaway scan screens come in Phase 3.
      </p>

      <div className="rounded-lg border p-4 space-y-4 bg-muted/20">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Package className="h-4 w-4" />
          New carton (dock / test)
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1">
            <Label>SKU</Label>
            <Input value={sku} onChange={(e) => setSku(e.target.value)} placeholder="ABC-123" />
          </div>
          <div className="space-y-1">
            <Label>Quantity</Label>
            <Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Lot (optional)</Label>
            <Input value={lot} onChange={(e) => setLot(e.target.value)} placeholder="L2405A" />
          </div>
          <div className="space-y-1">
            <Label>Expiry (optional)</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as WarehouseCartonStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {CARTON_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Pallet (optional)</Label>
            <Select value={selectedPalletId} onValueChange={setSelectedPalletId}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {pallets.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.palletCode}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void handleCreateCarton()} disabled={saving || !sku.trim()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
            Create carton
          </Button>
          <Button type="button" variant="outline" onClick={() => void handleCreatePallet()} disabled={saving}>
            New pallet
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void handlePrintCartons()} disabled={printing || !cartons.length}>
          {printing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4 mr-2" />}
          Print all carton labels ({cartons.length})
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => void handlePrintPallets()}
          disabled={printing || !pallets.length}
        >
          Print pallet labels ({pallets.length})
        </Button>
      </div>

      {pallets.length > 0 ? (
        <div className="rounded-lg border p-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            Mixed pallet: select cartons in the table, then link to a pallet.
          </p>
          <div className="flex flex-wrap gap-2">
            {pallets.map((p) => (
              <Button
                key={p.id}
                type="button"
                size="sm"
                variant="secondary"
                disabled={saving || selectedCartonIds.size === 0}
                onClick={() => void handleLinkToPallet(p.id)}
              >
                Link {selectedCartonIds.size} → {p.palletCode}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      {skuTotals.length > 0 ? (
        <div className="rounded-lg border p-4">
          <h3 className="text-sm font-semibold mb-2">SKU totals (from cartons)</h3>
          <div className="flex flex-wrap gap-2">
            {skuTotals.map((t) => (
              <Badge key={t.sku} variant="outline" className="font-mono text-xs">
                {t.sku}: {t.totalQuantity} ({t.cartonCount} ctns, {t.pickableQuantity} pickable)
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading cartons…
        </div>
      ) : (
        <div className="border rounded-lg overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>Carton ID</TableHead>
                <TableHead>SKU</TableHead>
                <TableHead>Lot / Exp</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Pallet</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {cartons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                    No cartons yet — create one above (golden rule: every carton gets our label before leaving the dock).
                  </TableCell>
                </TableRow>
              ) : (
                cartons.map((c) => {
                  const pallet = pallets.find((p) => p.id === c.palletId);
                  return (
                    <TableRow key={c.id}>
                      <TableCell>
                        <input
                          type="checkbox"
                          checked={selectedCartonIds.has(c.id)}
                          onChange={() => toggleCartonSelect(c.id)}
                          aria-label={`Select ${c.cartonCode}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.cartonCode}</TableCell>
                      <TableCell className="font-mono text-xs">{c.sku}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.lot || "—"} / {c.expiry || "—"}
                      </TableCell>
                      <TableCell className="text-right">{c.quantity}</TableCell>
                      <TableCell>
                        <Select
                          value={c.status}
                          onValueChange={(v) => void handleStatusChange(c.id, v as WarehouseCartonStatus)}
                        >
                          <SelectTrigger className="h-8 text-xs w-[130px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STATUS_OPTIONS.map((s) => (
                              <SelectItem key={s} value={s}>
                                {CARTON_STATUS_LABELS[s]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="font-mono text-xs">{pallet?.palletCode ?? "—"}</TableCell>
                      <TableCell className="text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          disabled={printing}
                          onClick={() => void handlePrintCartons([c])}
                        >
                          <Printer className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
