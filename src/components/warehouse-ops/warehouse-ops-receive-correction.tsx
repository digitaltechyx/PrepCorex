"use client";

import { useMemo, useState } from "react";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import { resolveScan } from "@/lib/warehouse-putaway";
import { findPalletByCode } from "@/lib/warehouse-carton-firestore";
import { generateCrossdockReceiveLot } from "@/lib/warehouse-crossdock";
import {
  canEditReceivedCarton,
  canEditReceivedPallet,
  canVoidCarton,
  canVoidPallet,
  cartonHasPutaway,
  cartonToLineDrafts,
  correctReceivedCarton,
  correctReceivedPallet,
  lineDraftsToReceiveInput,
  palletHasPutaway,
  voidWarehouseCartons,
  voidWarehousePallet,
} from "@/lib/warehouse-receive-corrections";
import { CARTON_STATUS_LABELS } from "@/lib/warehouse-carton-states";
import {
  buildWarehouseCartonLabelsPdf,
  downloadUint8ArrayAsFile,
} from "@/lib/warehouse-carton-label-pdf";
import { buildWarehousePalletLabelsPdf } from "@/lib/warehouse-pallet-label-pdf";
import { buildWarehousePackageLabelsPdf } from "@/lib/warehouse-package-label-pdf";
import { CrossdockClientCombobox } from "@/components/warehouse-ops/crossdock-client-combobox";
import { ScanLookupPopover } from "@/components/warehouse-ops/scan-lookup-popover";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile, WarehouseCartonDoc, WarehouseDoc, WarehousePalletDoc } from "@/types";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Printer,
  ScanLine,
  Shield,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  describeReceiveLotHint,
  describeReceiveLotPattern,
} from "@/lib/warehouse-receive-lot";

type LineDraft = {
  id: string;
  sku: string;
  productTitle: string;
  goodQty: string;
  damagedQty: string;
  lot: string;
  expiry: string;
};

function newLine(): LineDraft {
  return {
    id: `ln_${Math.random().toString(36).slice(2, 9)}`,
    sku: "",
    productTitle: "",
    goodQty: "1",
    damagedQty: "0",
    lot: "",
    expiry: "",
  };
}

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseOpsReceiveCorrection({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const supervisor = isOpsSupervisor(userProfile);
  const operatorId = user?.uid ?? null;

  const { data: allUsers } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () =>
      allUsers
        .filter((u) => u.role === "user" || (u.roles ?? []).includes("user"))
        .sort((a, b) =>
          (a.name || a.email || a.uid).localeCompare(b.name || b.email || b.uid)
        ),
    [allUsers]
  );

  const [scan, setScan] = useState("");
  const [resolving, setResolving] = useState(false);
  const [carton, setCarton] = useState<WarehouseCartonDoc | null>(null);
  const [pallet, setPallet] = useState<WarehousePalletDoc | null>(null);
  const [palletClientId, setPalletClientId] = useState("");
  const [palletClientLabel, setPalletClientLabel] = useState("");
  const [palletReceiveLot, setPalletReceiveLot] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([newLine()]);
  const [trackingNumber, setTrackingNumber] = useState("");
  const [carrier, setCarrier] = useState("");
  const [notes, setNotes] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [saving, setSaving] = useState(false);

  const editable = carton ? canEditReceivedCarton(carton, supervisor) : false;
  const voidable = carton ? canVoidCarton(carton, supervisor) : false;
  const hasPutaway = carton ? cartonHasPutaway(carton) : false;

  const palletEditable = pallet ? canEditReceivedPallet(pallet, supervisor) : false;
  const palletVoidable = pallet ? canVoidPallet(pallet, supervisor) : false;
  const palletPutaway = pallet ? palletHasPutaway(pallet) : false;

  function loadCartonIntoForm(c: WarehouseCartonDoc) {
    setPallet(null);
    setCarton(c);
    setLines(cartonToLineDrafts(c));
    setTrackingNumber(c.trackingNumber ?? "");
    setCarrier(c.carrier ?? "");
    setNotes(c.notes ?? "");
    setVoidReason("");
    setCorrectionReason("");
  }

  function loadPalletIntoForm(p: WarehousePalletDoc) {
    setCarton(null);
    setLines([newLine()]);
    setPallet(p);
    setTrackingNumber(p.trackingNumber ?? "");
    setCarrier(p.carrier ?? "");
    setNotes(p.notes ?? "");
    setPalletClientId(p.clientId ?? "");
    setPalletClientLabel(p.receivedForClient ?? "");
    setPalletReceiveLot(p.receiveLot ?? "");
    setVoidReason("");
    setCorrectionReason("");
  }

  async function handleLookup(raw?: string) {
    const code = (raw ?? scan).trim();
    if (!code) return;
    if (raw != null) setScan(raw);
    setResolving(true);
    try {
      const resolved = await resolveScan(warehouse.id, code);
      if (resolved.kind === "carton") {
        const found = resolved.carton;
        if (found.status === "voided") {
          toast({
            title: "Carton voided",
            description: `${found.cartonCode} was voided and cannot be edited.`,
            variant: "destructive",
          });
          setCarton(null);
          setPallet(null);
          return;
        }
        loadCartonIntoForm(found);
        return;
      }
      if (resolved.kind === "pallet") {
        const found = await findPalletByCode(warehouse.id, resolved.palletCode);
        if (!found) {
          toast({
            title: "Not found",
            description: `No pallet ${resolved.palletCode} in this warehouse.`,
            variant: "destructive",
          });
          setCarton(null);
          setPallet(null);
          return;
        }
        loadPalletIntoForm(found);
        return;
      }
      toast({
        title: "Not found",
        description: "No carton (CTN), package (PKG), or pallet (PAL) matches that code in this warehouse.",
        variant: "destructive",
      });
      setCarton(null);
      setPallet(null);
    } catch (e) {
      toast({
        title: "Lookup failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setResolving(false);
    }
  }

  function updateLine(lineId: string, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  }

  async function handleSave() {
    if (!carton) return;
    for (const l of lines) {
      if (!l.sku.trim()) {
        toast({ title: "Missing SKU", variant: "destructive" });
        return;
      }
      const good = Math.max(0, parseInt(l.goodQty, 10) || 0);
      const dmg = Math.max(0, parseInt(l.damagedQty, 10) || 0);
      if (good + dmg < 1) {
        toast({
          title: "Quantity required",
          description: `SKU ${l.sku} needs at least 1 unit.`,
          variant: "destructive",
        });
        return;
      }
    }
    if (hasPutaway && supervisor && !correctionReason.trim()) {
      toast({
        title: "Reason required",
        description: "Supervisors must enter a correction reason after putaway.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const updated = await correctReceivedCarton({
        warehouseId: warehouse.id,
        cartonId: carton.id,
        lines: lineDraftsToReceiveInput(lines),
        trackingNumber: trackingNumber.trim() || null,
        carrier: carrier.trim() || null,
        notes: notes.trim() || null,
        operatorId,
        supervisorOverride: supervisor,
        correctionReason: correctionReason.trim() || null,
      });
      loadCartonIntoForm(updated);
      toast({
        title: "Carton updated",
        description: hasPutaway && supervisor
          ? `${updated.cartonCode} reset to receiving — re-putaway required.`
          : `${updated.cartonCode} lines saved.`,
      });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleVoid() {
    if (!carton) return;
    setSaving(true);
    try {
      const res = await voidWarehouseCartons({
        warehouseId: warehouse.id,
        cartonIds: [carton.id],
        reason: voidReason.trim() || "Voided at dock",
        operatorId,
        supervisorOverride: supervisor,
      });
      if (res.voidedIds.length === 0) {
        const b = res.blocked[0];
        throw new Error(b?.reason ?? "Could not void carton.");
      }
      toast({
        title: "Carton voided",
        description: `${carton.cartonCode} is no longer on hand.`,
      });
      setCarton(null);
      setScan("");
      setLines([newLine()]);
    } catch (e) {
      toast({
        title: "Void failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleReprint() {
    if (!carton) return;
    setSaving(true);
    try {
      if (carton.isPackage) {
        const pdf = await buildWarehousePackageLabelsPdf({
          title: `${warehouse.code} — ${carton.cartonCode}`,
          packages: [carton],
        });
        downloadUint8ArrayAsFile(pdf, `${carton.cartonCode}-reprint.pdf`);
      } else {
        const pdf = await buildWarehouseCartonLabelsPdf({
          title: `${warehouse.code} — ${carton.cartonCode}`,
          cartons: [carton],
        });
        downloadUint8ArrayAsFile(pdf, `${carton.cartonCode}-reprint.pdf`);
      }
    } catch (e) {
      toast({
        title: "Print failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePalletSave() {
    if (!pallet) return;
    if (palletPutaway && supervisor && !correctionReason.trim()) {
      toast({
        title: "Reason required",
        description: "Supervisors must enter a correction reason after putaway.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const updated = await correctReceivedPallet({
        warehouseId: warehouse.id,
        palletId: pallet.id,
        trackingNumber: trackingNumber.trim() || null,
        carrier: carrier.trim() || null,
        notes: notes.trim() || null,
        clientId: palletClientId.trim() || null,
        receivedForClient: palletClientLabel.trim() || null,
        receiveLot: palletReceiveLot.trim() || null,
        operatorId,
        supervisorOverride: supervisor,
        correctionReason: correctionReason.trim() || null,
      });
      loadPalletIntoForm(updated);
      toast({
        title: "Pallet updated",
        description: `${updated.palletCode} saved.`,
      });
    } catch (e) {
      toast({
        title: "Save failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePalletVoid() {
    if (!pallet) return;
    setSaving(true);
    try {
      const res = await voidWarehousePallet({
        warehouseId: warehouse.id,
        palletId: pallet.id,
        reason: voidReason.trim() || "Voided at dock",
        operatorId,
        supervisorOverride: supervisor,
      });
      if (!res.voided) {
        throw new Error(res.reason ?? "Could not void pallet.");
      }
      toast({
        title: "Pallet removed",
        description: `${pallet.palletCode} was deleted from receiving.`,
      });
      setPallet(null);
      setScan("");
    } catch (e) {
      toast({
        title: "Void failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePalletReprint() {
    if (!pallet) return;
    setSaving(true);
    try {
      const pdf = await buildWarehousePalletLabelsPdf({
        title: `${warehouse.code} — ${pallet.palletCode}`,
        pallets: [pallet],
      });
      downloadUint8ArrayAsFile(pdf, `${pallet.palletCode}-reprint.pdf`);
    } catch (e) {
      toast({
        title: "Print failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-4">
      {supervisor ? (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50/80 px-3 py-2 text-sm text-amber-900">
          <Shield className="h-4 w-4 shrink-0" />
          Supervisor mode — you can void or edit cartons even after putaway (re-putaway may be required).
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Scan a carton (CTN), package (PKG), or cross-dock pallet (PAL) label to fix details or void a mistake.
          Changes are only allowed before putaway unless you have supervisor access.
        </p>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Scan label
          </CardTitle>
          <CardDescription className="text-xs">
            Enter CTN, PKG, or PAL code, or scan the label QR.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            value={scan}
            onChange={(e) => setScan(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void handleLookup()}
            placeholder="CTN-2026-00042, PKG-2026-00001, or PAL-2026-00007"
            className="font-mono"
          />
          <ScanCameraButton onScan={(v) => void handleLookup(v)} />
          <Button type="button" onClick={() => void handleLookup()} disabled={resolving}>
            {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load"}
          </Button>
        </CardContent>
      </Card>

      {carton ? (
        <>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-mono">{carton.cartonCode}</CardTitle>
                <div className="flex gap-2">
                  {carton.isPackage ? (
                    <Badge variant="outline" className="bg-emerald-100 border-emerald-300 text-emerald-800">
                      Package
                    </Badge>
                  ) : null}
                  <Badge variant="outline">{CARTON_STATUS_LABELS[carton.status]}</Badge>
                </div>
              </div>
              {hasPutaway ? (
                <CardDescription className="text-xs flex items-center gap-1 text-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  Putaway started — {supervisor ? "supervisor can still correct" : "editing blocked"}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tracking #</Label>
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    disabled={!editable}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Carrier</Label>
                  <Input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    disabled={!editable}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  disabled={!editable}
                />
              </div>
              {hasPutaway && supervisor ? (
                <div className="space-y-1">
                  <Label className="text-xs">Correction reason (required)</Label>
                  <Input
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="Why are you changing this after putaway?"
                  />
                </div>
              ) : null}

              <p className="text-[10px] text-muted-foreground">
                Lot required — blank lot auto-generates:{" "}
                <span className="font-mono">{describeReceiveLotPattern()}</span>.{" "}
                {describeReceiveLotHint()}
              </p>

              {lines.map((line, idx) => {
                const dmg = Math.max(0, parseInt(line.damagedQty, 10) || 0);
                return (
                  <div
                    key={line.id}
                    className={cn(
                      "rounded-md border p-3 space-y-2",
                      dmg > 0 && "border-red-200 bg-red-50/40"
                    )}
                  >
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-muted-foreground">Line {idx + 1}</span>
                      {lines.length > 1 && editable ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setLines((prev) =>
                              prev.length > 1 ? prev.filter((l) => l.id !== line.id) : prev
                            )
                          }
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">SKU</Label>
                        <div className="flex gap-2">
                          <Input
                            value={line.sku}
                            onChange={(e) => updateLine(line.id, { sku: e.target.value })}
                            disabled={!editable}
                          />
                          {editable ? (
                            <ScanLookupPopover
                              onPick={(m) =>
                                updateLine(line.id, {
                                  sku: m.sku,
                                  productTitle: m.productName,
                                })
                              }
                              onAcceptRaw={(raw) => updateLine(line.id, { sku: raw })}
                            />
                          ) : null}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Title</Label>
                        <Input
                          value={line.productTitle}
                          onChange={(e) =>
                            updateLine(line.id, { productTitle: e.target.value })
                          }
                          disabled={!editable}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Good qty</Label>
                        <Input
                          type="number"
                          min={0}
                          value={line.goodQty}
                          onChange={(e) => updateLine(line.id, { goodQty: e.target.value })}
                          disabled={!editable}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Damaged qty</Label>
                        <Input
                          type="number"
                          min={0}
                          value={line.damagedQty}
                          onChange={(e) => updateLine(line.id, { damagedQty: e.target.value })}
                          disabled={!editable}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Lot (required)</Label>
                        <Input
                          value={line.lot}
                          onChange={(e) => updateLine(line.id, { lot: e.target.value })}
                          disabled={!editable}
                          placeholder="Or blank → auto-generate"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Expiry (optional)</Label>
                        <Input
                          type="date"
                          value={line.expiry}
                          onChange={(e) => updateLine(line.id, { expiry: e.target.value })}
                          disabled={!editable}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {editable ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLines((prev) => [...prev, newLine()])}
                >
                  <Plus className="h-4 w-4 mr-1" />
                  Add line
                </Button>
              ) : null}

              <div className="flex flex-wrap gap-2 pt-2">
                {editable ? (
                  <Button type="button" onClick={() => void handleSave()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Save changes
                  </Button>
                ) : null}
                <Button type="button" variant="outline" onClick={() => void handleReprint()} disabled={saving}>
                  <Printer className="h-4 w-4 mr-1" />
                  Reprint label
                </Button>
              </div>
            </CardContent>
          </Card>

          {voidable ? (
            <Card className="border-red-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-red-800">Void this carton</CardTitle>
                <CardDescription className="text-xs">
                  Removes it from inventory. Use when the label should not be put away.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Reason</Label>
                  <Input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Wrong SKU, duplicate label, etc."
                  />
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" disabled={saving}>
                      Void {carton.cartonCode}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Void carton?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {carton.cartonCode} will be marked voided
                        {hasPutaway && supervisor
                          ? " and cleared from its bin assignments on record"
                          : ""}
                        . This cannot be undone from the dock app.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleVoid()}>
                        Void carton
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {pallet ? (
        <>
          <Card className="border-indigo-200/80">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base font-mono">{pallet.palletCode}</CardTitle>
                <Badge variant="outline" className="border-indigo-300 text-indigo-900">
                  {pallet.isClosedCrossdock ? "Cross-dock · closed" : "Pallet"} · {pallet.status}
                </Badge>
              </div>
              {palletPutaway ? (
                <CardDescription className="text-xs flex items-center gap-1 text-amber-800">
                  <AlertTriangle className="h-3 w-3" />
                  Putaway started — {supervisor ? "supervisor can still correct" : "editing blocked"}
                </CardDescription>
              ) : null}
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs">Tracking #</Label>
                  <Input
                    value={trackingNumber}
                    onChange={(e) => setTrackingNumber(e.target.value)}
                    disabled={!palletEditable}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Carrier</Label>
                  <Input
                    value={carrier}
                    onChange={(e) => setCarrier(e.target.value)}
                    disabled={!palletEditable}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  disabled={!palletEditable}
                />
              </div>
              {pallet.isClosedCrossdock ? (
                <div className="space-y-3 rounded-md border border-dashed border-indigo-200 bg-indigo-50/30 px-3 py-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Client name (optional)</Label>
                    <CrossdockClientCombobox
                      clients={clients}
                      clientId={palletClientId}
                      clientLabel={palletClientLabel}
                      onChange={({ clientId, clientLabel }) => {
                        setPalletClientId(clientId);
                        setPalletClientLabel(clientLabel);
                      }}
                      disabled={!palletEditable}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Receive lot</Label>
                    <div className="flex gap-2">
                      <Input
                        value={palletReceiveLot}
                        onChange={(e) => setPalletReceiveLot(e.target.value)}
                        className="font-mono text-sm flex-1"
                        disabled={!palletEditable}
                      />
                      {palletEditable ? (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="shrink-0"
                          onClick={() => setPalletReceiveLot(generateCrossdockReceiveLot())}
                        >
                          New lot
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              ) : null}
              {palletPutaway && supervisor ? (
                <div className="space-y-1">
                  <Label className="text-xs">Correction reason (required)</Label>
                  <Input
                    value={correctionReason}
                    onChange={(e) => setCorrectionReason(e.target.value)}
                    placeholder="Why are you changing this after putaway?"
                  />
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2 pt-2">
                {palletEditable ? (
                  <Button type="button" onClick={() => void handlePalletSave()} disabled={saving}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Save changes
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handlePalletReprint()}
                  disabled={saving}
                >
                  <Printer className="h-4 w-4 mr-1" />
                  Reprint label
                </Button>
              </div>
            </CardContent>
          </Card>

          {palletVoidable ? (
            <Card className="border-red-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-base text-red-800">Void this pallet</CardTitle>
                <CardDescription className="text-xs">
                  Removes the pallet record (use when the PLT label was created by mistake).
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1">
                  <Label className="text-xs">Reason</Label>
                  <Input
                    value={voidReason}
                    onChange={(e) => setVoidReason(e.target.value)}
                    placeholder="Wrong pallet, duplicate label, etc."
                  />
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button type="button" variant="destructive" disabled={saving}>
                      Void {pallet.palletCode}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Void pallet?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {pallet.palletCode} will be deleted from this warehouse. Cartons linked to
                        this pallet must be voided first.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handlePalletVoid()}>
                        Void pallet
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
