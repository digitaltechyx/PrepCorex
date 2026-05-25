"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
import type { WarehouseDoc, WarehouseCartonDoc } from "@/types";
import {
  createReceiveBatch,
  listWarehouseCartons,
  listWarehousePallets,
} from "@/lib/warehouse-carton-firestore";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { buildWarehousePalletLabelsPdf } from "@/lib/warehouse-pallet-label-pdf";
import {
  Loader2,
  Plus,
  Trash2,
  Package,
  Printer,
  Copy,
  AlertTriangle,
  Layers,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type LineDraft = {
  id: string;
  sku: string;
  productTitle: string;
  goodQty: string;
  damagedQty: string;
  lot: string;
  expiry: string;
};

type CartonDraft = {
  id: string;
  copies: string;
  lines: LineDraft[];
  collapsed: boolean;
};

type Props = {
  warehouse: WarehouseDoc;
};

const CARRIERS = ["UPS", "FedEx", "USPS", "DHL", "Amazon Logistics", "Other"];

function uid(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function newLine(): LineDraft {
  return {
    id: uid("ln"),
    sku: "",
    productTitle: "",
    goodQty: "1",
    damagedQty: "0",
    lot: "",
    expiry: "",
  };
}

function newCarton(): CartonDraft {
  return {
    id: uid("ctn"),
    copies: "1",
    lines: [newLine()],
    collapsed: false,
  };
}

export function WarehouseOpsReceiving({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorName = userProfile?.name || userProfile?.email || user?.uid || null;

  const [onPallet, setOnPallet] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [cartons, setCartons] = useState<CartonDraft[]>([newCarton()]);
  const [saving, setSaving] = useState(false);
  const [lastBatch, setLastBatch] = useState<{
    palletCode: string | null;
    cartons: WarehouseCartonDoc[];
  } | null>(null);

  const totalCartonCount = cartons.reduce(
    (s, c) => s + Math.max(1, parseInt(c.copies, 10) || 1),
    0
  );
  const totalLineCount = cartons.reduce((s, c) => s + c.lines.length, 0);
  const totalUnitCount = cartons.reduce((sum, c) => {
    const copies = Math.max(1, parseInt(c.copies, 10) || 1);
    const cartonUnits = c.lines.reduce((u, l) => {
      const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
      const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
      return u + good + dmg;
    }, 0);
    return sum + copies * cartonUnits;
  }, 0);
  const hasAnyDamaged = cartons.some((c) =>
    c.lines.some((l) => (parseInt(l.damagedQty, 10) || 0) > 0)
  );
  const hasAnyMixed = cartons.some((c) => new Set(c.lines.map((l) => l.sku.trim()).filter(Boolean)).size > 1);

  function updateCarton(cartonId: string, patch: Partial<CartonDraft>) {
    setCartons((prev) => prev.map((c) => (c.id === cartonId ? { ...c, ...patch } : c)));
  }

  function updateLine(cartonId: string, lineId: string, patch: Partial<LineDraft>) {
    setCartons((prev) =>
      prev.map((c) =>
        c.id === cartonId
          ? { ...c, lines: c.lines.map((l) => (l.id === lineId ? { ...l, ...patch } : l)) }
          : c
      )
    );
  }

  function addLine(cartonId: string) {
    setCartons((prev) =>
      prev.map((c) => (c.id === cartonId ? { ...c, lines: [...c.lines, newLine()] } : c))
    );
  }

  function removeLine(cartonId: string, lineId: string) {
    setCartons((prev) =>
      prev.map((c) =>
        c.id === cartonId
          ? {
              ...c,
              lines: c.lines.length > 1 ? c.lines.filter((l) => l.id !== lineId) : c.lines,
            }
          : c
      )
    );
  }

  function addCarton() {
    setCartons((prev) => [...prev, newCarton()]);
  }

  function duplicateCarton(cartonId: string) {
    setCartons((prev) => {
      const idx = prev.findIndex((c) => c.id === cartonId);
      if (idx < 0) return prev;
      const src = prev[idx];
      const copy: CartonDraft = {
        ...src,
        id: uid("ctn"),
        lines: src.lines.map((l) => ({ ...l, id: uid("ln") })),
        collapsed: false,
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }

  function removeCarton(cartonId: string) {
    setCartons((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== cartonId) : prev));
  }

  function resetForm() {
    setOnPallet(false);
    setTrackingNumber("");
    setCarrier("");
    setNotes("");
    setCartons([newCarton()]);
  }

  async function handleReceive() {
    for (const c of cartons) {
      for (const l of c.lines) {
        if (!l.sku.trim()) {
          toast({
            title: "Missing SKU",
            description: "Every line needs a SKU before receiving.",
            variant: "destructive",
          });
          return;
        }
        const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
        const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
        if (good + dmg < 1) {
          toast({
            title: "Quantity required",
            description: `SKU ${l.sku} needs at least 1 good or damaged unit.`,
            variant: "destructive",
          });
          return;
        }
      }
    }

    setSaving(true);
    try {
      const payloadCartons = cartons.map((c) => {
        const copies = Math.max(1, parseInt(c.copies, 10) || 1);
        const flatLines: Array<{
          sku: string;
          productTitle?: string | null;
          quantity: number;
          lot?: string | null;
          expiry?: string | null;
          damaged?: boolean;
        }> = [];
        for (const l of c.lines) {
          const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
          const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
          if (good > 0) {
            flatLines.push({
              sku: l.sku.trim(),
              productTitle: l.productTitle.trim() || null,
              quantity: good,
              lot: l.lot.trim() || null,
              expiry: l.expiry.trim() || null,
              damaged: false,
            });
          }
          if (dmg > 0) {
            flatLines.push({
              sku: l.sku.trim(),
              productTitle: l.productTitle.trim() || null,
              quantity: dmg,
              lot: l.lot.trim() || null,
              expiry: l.expiry.trim() || null,
              damaged: true,
            });
          }
        }
        return { copies, lines: flatLines };
      });

      const { palletId, cartonIds } = await createReceiveBatch({
        warehouseId: warehouse.id,
        receivedBy: operatorName,
        stagingArea: "RCV-STAGE",
        pallet: onPallet
          ? {
              trackingNumber: trackingNumber.trim() || null,
              carrier: carrier || null,
              notes: notes.trim() || null,
              photoUrl: null,
            }
          : undefined,
        cartons: payloadCartons.map((c) => ({
          ...c,
          trackingNumber: !onPallet ? trackingNumber.trim() || null : null,
          carrier: !onPallet ? carrier || null : null,
          notes: !onPallet ? notes.trim() || null : null,
        })),
      });

      const [allCartons, allPallets] = await Promise.all([
        listWarehouseCartons(warehouse.id),
        palletId ? listWarehousePallets(warehouse.id) : Promise.resolve([]),
      ]);
      const created = cartonIds
        .map((id) => allCartons.find((c) => c.id === id))
        .filter((c): c is WarehouseCartonDoc => !!c);
      const createdPallet = palletId ? allPallets.find((p) => p.id === palletId) : null;

      if (created.length > 0) {
        const cartonPdf = await buildWarehouseCartonLabelsPdf({
          title: `${warehouse.code} — ${created.length} carton label${created.length > 1 ? "s" : ""}`,
          cartons: created,
        });
        downloadUint8ArrayAsFile(
          cartonPdf,
          `carton-labels-${created[0].cartonCode}-${created.length}.pdf`
        );
      }
      if (createdPallet) {
        const palletPdf = await buildWarehousePalletLabelsPdf({
          title: `${warehouse.code} — ${createdPallet.palletCode}`,
          pallets: [createdPallet],
        });
        downloadUint8ArrayAsFile(palletPdf, `${createdPallet.palletCode}.pdf`);
      }

      setLastBatch({ palletCode: createdPallet?.palletCode ?? null, cartons: created });

      toast({
        title: "Received",
        description: `${created.length} carton${created.length > 1 ? "s" : ""} parked in receiving staging. Stick labels before moving to putaway.`,
      });
      resetForm();
    } catch (e) {
      toast({
        title: "Receive failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-6">
      <WarehouseOpsHeader title="Receive inventory" />

      <Card className="border-orange-200/60 bg-orange-50/30 dark:bg-orange-950/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Package className="h-4 w-4 text-orange-600" />
            How this works
          </CardTitle>
          <CardDescription className="text-xs leading-relaxed">
            Receive inventory <strong>blind</strong> — no client or request is needed at the dock.
            Add one carton, or add multiple cartons (with copies). Each carton can hold one SKU
            or many SKUs (mixed). Print labels here, stick them on the boxes, then move to{" "}
            <strong>Putaway</strong>. Admin will <strong>Allocate</strong> stock to client requests later.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Inbound shipment details (optional)</CardTitle>
          <CardDescription className="text-xs">
            Capture once for the whole truck/box so admin can reconcile later.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Tracking #</Label>
              <Input
                value={trackingNumber}
                onChange={(e) => setTrackingNumber(e.target.value)}
                placeholder="e.g. 1Z999AA10123456784"
              />
            </div>
            <div className="space-y-1">
              <Label>Carrier</Label>
              <Select value={carrier || "__none__"} onValueChange={(v) => setCarrier(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="—" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">—</SelectItem>
                  {CARRIERS.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1">
            <Label>Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder='e.g. "Outer box crushed, contents OK"'
            />
          </div>
          <div className="flex items-center justify-between rounded-md border p-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Layers className="h-4 w-4" />
                On a pallet
              </div>
              <p className="text-xs text-muted-foreground">
                Wraps all cartons below in a new pallet. A pallet label will also be printed.
              </p>
            </div>
            <Switch checked={onPallet} onCheckedChange={setOnPallet} />
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">
            Cartons ({cartons.length})
          </h2>
          <Button type="button" variant="outline" size="sm" onClick={addCarton}>
            <Plus className="h-4 w-4 mr-1" />
            Add another carton
          </Button>
        </div>

        {cartons.map((c, idx) => {
          const distinctSkus = new Set(c.lines.map((l) => l.sku.trim()).filter(Boolean));
          const isMixed = distinctSkus.size > 1;
          const totalCopies = Math.max(1, parseInt(c.copies, 10) || 1);
          const cartonUnits = c.lines.reduce((u, l) => {
            return u + Math.max(0, parseInt(l.goodQty, 10) || 0) + Math.max(0, parseInt(l.damagedQty, 10) || 0);
          }, 0);
          const hasDamaged = c.lines.some((l) => (parseInt(l.damagedQty, 10) || 0) > 0);
          return (
            <Card key={c.id} className="border-slate-200">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-sm">Carton #{idx + 1}</CardTitle>
                    {isMixed ? (
                      <Badge variant="outline" className="bg-amber-100 border-amber-300 text-amber-800">
                        Mixed · {distinctSkus.size} SKUs
                      </Badge>
                    ) : (
                      <Badge variant="outline">Single SKU</Badge>
                    )}
                    {hasDamaged ? (
                      <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Has damaged
                      </Badge>
                    ) : null}
                    {totalCopies > 1 ? (
                      <Badge variant="outline" className="bg-blue-50 border-blue-300 text-blue-800">
                        × {totalCopies} copies
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => duplicateCarton(c.id)}
                      title="Duplicate this carton"
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                    {cartons.length > 1 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeCarton(c.id)}
                        title="Remove this carton"
                      >
                        <Trash2 className="h-4 w-4 text-red-600" />
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {c.lines.map((line, lineIdx) => {
                  const good = Math.max(0, parseInt(line.goodQty, 10) || 0);
                  const dmg = Math.max(0, parseInt(line.damagedQty, 10) || 0);
                  return (
                    <div
                      key={line.id}
                      className={cn(
                        "rounded-md border p-3 space-y-2",
                        dmg > 0 && "border-red-200 bg-red-50/40"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Line {lineIdx + 1}
                        </span>
                        {c.lines.length > 1 ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeLine(c.id, line.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        ) : null}
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="space-y-1 sm:col-span-1">
                          <Label className="text-xs">SKU</Label>
                          <Input
                            value={line.sku}
                            onChange={(e) => updateLine(c.id, line.id, { sku: e.target.value })}
                            placeholder="Required"
                          />
                        </div>
                        <div className="space-y-1 sm:col-span-1">
                          <Label className="text-xs">Product name (optional)</Label>
                          <Input
                            value={line.productTitle}
                            onChange={(e) =>
                              updateLine(c.id, line.id, { productTitle: e.target.value })
                            }
                            placeholder="Display name"
                          />
                        </div>
                      </div>
                      <div className="grid gap-2 grid-cols-2 sm:grid-cols-4">
                        <div className="space-y-1">
                          <Label className="text-xs">Good qty</Label>
                          <Input
                            type="number"
                            min={0}
                            value={line.goodQty}
                            onChange={(e) => updateLine(c.id, line.id, { goodQty: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-red-700">Damaged qty</Label>
                          <Input
                            type="number"
                            min={0}
                            value={line.damagedQty}
                            onChange={(e) =>
                              updateLine(c.id, line.id, { damagedQty: e.target.value })
                            }
                            className={dmg > 0 ? "border-red-300" : ""}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Lot (optional)</Label>
                          <Input
                            value={line.lot}
                            onChange={(e) => updateLine(c.id, line.id, { lot: e.target.value })}
                          />
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Expiry (optional)</Label>
                          <Input
                            type="date"
                            value={line.expiry}
                            onChange={(e) => updateLine(c.id, line.id, { expiry: e.target.value })}
                          />
                        </div>
                      </div>
                      {good + dmg > 0 ? (
                        <p className="text-[10px] text-muted-foreground tabular-nums">
                          Line total: {good + dmg} ({good} good
                          {dmg > 0 ? `, ${dmg} damaged → quarantine` : ""})
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addLine(c.id)}
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    Add line (another SKU in this carton)
                  </Button>
                  <div className="flex items-end gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Copies of this carton</Label>
                      <Input
                        type="number"
                        min={1}
                        value={c.copies}
                        onChange={(e) => updateCarton(c.id, { copies: e.target.value })}
                        className="w-24"
                      />
                    </div>
                    <span className="text-xs text-muted-foreground pb-2">
                      = {totalCopies * cartonUnits} units total
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-orange-300 sticky bottom-4 bg-background shadow-lg">
        <CardContent className="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {totalCartonCount} carton{totalCartonCount === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">
              {totalLineCount} line{totalLineCount === 1 ? "" : "s"}
            </Badge>
            <Badge variant="outline">{totalUnitCount} units</Badge>
            {onPallet ? <Badge className="bg-indigo-600">+ 1 pallet label</Badge> : null}
            {hasAnyMixed ? (
              <Badge variant="outline" className="bg-amber-100 border-amber-300 text-amber-800">
                Includes mixed
              </Badge>
            ) : null}
            {hasAnyDamaged ? (
              <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                Includes damaged → quarantine
              </Badge>
            ) : null}
          </div>
          <Button
            size="lg"
            className="bg-orange-600 hover:bg-orange-700"
            onClick={() => void handleReceive()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Printer className="h-4 w-4 mr-2" />
                Receive &amp; print labels
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {lastBatch ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Last batch ({lastBatch.cartons.length} carton{lastBatch.cartons.length === 1 ? "" : "s"})</CardTitle>
            <CardDescription className="text-xs">
              Labels downloaded — stick them now. Stock is parked in Receiving Staging.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {lastBatch.palletCode ? (
              <div className="flex items-center justify-between rounded-md border bg-indigo-50/60 px-3 py-2 text-sm">
                <span className="font-mono">{lastBatch.palletCode}</span>
                <Badge className="bg-indigo-600">Pallet</Badge>
              </div>
            ) : null}
            <div className="space-y-1 max-h-[200px] overflow-y-auto">
              {lastBatch.cartons.map((c) => (
                <div
                  key={c.id}
                  className="flex justify-between items-center text-sm font-mono border rounded px-3 py-2"
                >
                  <span>{c.cartonCode}</span>
                  <span className="text-xs text-muted-foreground">
                    {c.isMixed
                      ? `Mixed · ${c.lines?.length ?? 0} SKUs · ${c.quantity}u`
                      : `${c.sku} × ${c.quantity}`}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex gap-2 pt-2">
              <Button variant="outline" size="sm" asChild>
                <Link href="/warehouse-ops/putaway">
                  Continue to putaway
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
