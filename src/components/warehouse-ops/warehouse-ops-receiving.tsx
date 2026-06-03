"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
  ArrowLeft,
  PackageOpen,
  Boxes,
  ScanLine,
  RotateCcw,
  ArrowRightLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { detectCarrier } from "@/lib/carrier-detect";
import {
  describeReceiveLotHint,
  describeReceiveLotPattern,
} from "@/lib/warehouse-receive-lot";
import { ScanLookupPopover } from "@/components/warehouse-ops/scan-lookup-popover";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  QuickScanDialog,
  type QuickScanLine,
} from "@/components/warehouse-ops/quick-scan-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WarehouseOpsReceiveCorrection } from "@/components/warehouse-ops/warehouse-ops-receive-correction";
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
import { isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import {
  batchHasPutaway,
  clearStoredLastBatch,
  readStoredLastBatch,
  voidWarehouseCartons,
  writeStoredLastBatch,
  type StoredReceiveFormSnapshot,
} from "@/lib/warehouse-receive-corrections";

type ReceiveType = "carton" | "pallet" | "loose";
type ReceivePhase = "hub" | "pick-package" | "form";

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
  return { id: uid("ctn"), copies: "1", lines: [newLine()] };
}

export function WarehouseOpsReceiving({ warehouse }: Props) {
  const [tab, setTab] = useState<"receive" | "correct">("receive");
  const [phase, setPhase] = useState<ReceivePhase>("hub");
  const [type, setType] = useState<ReceiveType | null>(null);
  const [formRestore, setFormRestore] = useState<StoredReceiveFormSnapshot | null>(null);
  const [restoreKey, setRestoreKey] = useState(0);

  function startPackagePick() {
    setPhase("pick-package");
    setType(null);
  }

  function pickPackage(t: "carton" | "pallet") {
    setType(t);
    setPhase("form");
  }

  function backFromForm() {
    if (type === "loose") {
      setPhase("hub");
      setType(null);
    } else {
      setPhase("pick-package");
      setType(null);
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <WarehouseOpsHeader title="Receiving" />
      <Tabs value={tab} onValueChange={(v) => setTab(v as "receive" | "correct")}>
        <TabsList>
          <TabsTrigger value="receive">Receive</TabsTrigger>
          <TabsTrigger value="correct">Correct receive</TabsTrigger>
        </TabsList>
        <TabsContent value="receive" className="mt-4 space-y-4">
          {phase === "hub" ? (
            <>
              <p className="text-sm text-muted-foreground">
                Receive closed cartons or pallets for cross-dock. Print CTN/PLT labels only — match
                SKUs to clients in Allocate, then Putaway decides forward, hold, or bins.
              </p>
              <TypePickerCard
                color="indigo"
                icon={<ArrowRightLeft className="h-8 w-8" />}
                title="Cross-dock receiving"
                description="Cartons and pallets. One mixed carton can hold many SKUs — allocate each line to the right client request."
                onClick={startPackagePick}
              />
              <p className="text-xs text-muted-foreground">
                Unpackaged unit receiving will be a separate module later.
              </p>
            </>
          ) : phase === "pick-package" ? (
            <>
              <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setPhase("hub")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <p className="text-sm text-muted-foreground">What are you receiving?</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <TypePickerCard
                  color="orange"
                  icon={<Package className="h-8 w-8" />}
                  title="Carton"
                  description="One or more cartons. Each carton can hold one SKU or many."
                  onClick={() => pickPackage("carton")}
                />
                <TypePickerCard
                  color="indigo"
                  icon={<Boxes className="h-8 w-8" />}
                  title="Pallet"
                  description="A pallet with cartons on it. Pallet label + carton labels."
                  onClick={() => pickPackage("pallet")}
                />
              </div>
            </>
          ) : type ? (
            <ReceiveForm
              key={`receive-${type}-${restoreKey}`}
              warehouse={warehouse}
              type={type}
              receiveMode={type === "loose" ? "unpackaged" : "crossdock"}
              onBack={backFromForm}
              initialSnapshot={formRestore}
              onSnapshotConsumed={() => setFormRestore(null)}
              onRestoreForm={(snap) => {
                setFormRestore(snap);
                setType(snap.type);
                setPhase("form");
                setRestoreKey((k) => k + 1);
              }}
            />
          ) : null}
        </TabsContent>
        <TabsContent value="correct" className="mt-4">
          <WarehouseOpsReceiveCorrection warehouse={warehouse} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function TypePickerCard({
  color,
  icon,
  title,
  description,
  onClick,
}: {
  color: "orange" | "indigo" | "emerald";
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  const colorMap = {
    orange: "border-orange-200 hover:border-orange-400 hover:bg-orange-50/40 text-orange-600",
    indigo: "border-indigo-200 hover:border-indigo-400 hover:bg-indigo-50/40 text-indigo-600",
    emerald: "border-emerald-200 hover:border-emerald-400 hover:bg-emerald-50/40 text-emerald-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-xl border-2 p-5 text-left transition-colors flex flex-col items-start gap-3 h-full",
        colorMap[color]
      )}
    >
      <div className={cn(colorMap[color].split(" ").pop())}>{icon}</div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </div>
    </button>
  );
}

function ReceiveForm({
  warehouse,
  type,
  receiveMode,
  onBack,
  initialSnapshot,
  onSnapshotConsumed,
  onRestoreForm,
}: {
  warehouse: WarehouseDoc;
  type: ReceiveType;
  receiveMode: "crossdock" | "unpackaged";
  onBack: () => void;
  initialSnapshot?: StoredReceiveFormSnapshot | null;
  onSnapshotConsumed?: () => void;
  onRestoreForm?: (snap: StoredReceiveFormSnapshot) => void;
}) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const supervisor = isOpsSupervisor(userProfile);
  const operatorName = userProfile?.name || userProfile?.email || user?.uid || null;
  const operatorId = user?.uid ?? null;

  const [trackingNumber, setTrackingNumber] = useState(initialSnapshot?.trackingNumber ?? "");
  const [carrier, setCarrier] = useState<string>(initialSnapshot?.carrier ?? "");
  const [carrierAutoDetected, setCarrierAutoDetected] = useState(
    initialSnapshot?.carrierAutoDetected ?? false
  );
  const [notes, setNotes] = useState(initialSnapshot?.notes ?? "");
  const [cartons, setCartons] = useState<CartonDraft[]>(
    initialSnapshot?.cartons?.length ? initialSnapshot.cartons : [newCarton()]
  );
  const [saving, setSaving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [quickScanCartonId, setQuickScanCartonId] = useState<string | null>(null);

  useEffect(() => {
    if (initialSnapshot) onSnapshotConsumed?.();
  }, [initialSnapshot, onSnapshotConsumed]);

  function handleTrackingChange(value: string) {
    setTrackingNumber(value);
    const detected = detectCarrier(value);
    if (detected && (!carrier || carrierAutoDetected)) {
      setCarrier(detected);
      setCarrierAutoDetected(true);
    } else if (!detected && carrierAutoDetected) {
      setCarrier("");
      setCarrierAutoDetected(false);
    }
  }
  const [lastBatch, setLastBatch] = useState<{
    palletCode: string | null;
    cartonIds: string[];
    cartons: WarehouseCartonDoc[];
  } | null>(null);

  useEffect(() => {
    const stored = readStoredLastBatch(warehouse.id);
    if (!stored?.cartonIds?.length) return;
    void listWarehouseCartons(warehouse.id).then((all) => {
      const cartons = stored.cartonIds
        .map((id) => all.find((c) => c.id === id))
        .filter((c): c is WarehouseCartonDoc => !!c && c.status !== "voided");
      if (cartons.length === 0) {
        clearStoredLastBatch(warehouse.id);
        return;
      }
      setLastBatch({
        palletCode: stored.palletCode,
        cartonIds: stored.cartonIds,
        cartons,
      });
    });
  }, [warehouse.id]);

  // Loose mode only ever has a single "carton" (a virtual container for the loose lines).
  // Copies are not shown for loose. Hide copies for pallet too — keep it simple.
  const showCopies = type === "carton";
  const showMultipleCartons = type === "carton" || type === "pallet";
  const showShipmentDetails = true; // visible for all 3, but compact

  const totalLineCount = cartons.reduce((s, c) => s + c.lines.length, 0);
  const totalCartonCount = cartons.reduce(
    (s, c) => s + Math.max(1, parseInt(c.copies, 10) || 1),
    0
  );
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
      };
      return [...prev.slice(0, idx + 1), copy, ...prev.slice(idx + 1)];
    });
  }
  function removeCarton(cartonId: string) {
    setCartons((prev) => (prev.length > 1 ? prev.filter((c) => c.id !== cartonId) : prev));
  }

  function applyQuickScanLines(cartonId: string, scanned: QuickScanLine[]) {
    setCartons((prev) =>
      prev.map((c) => {
        if (c.id !== cartonId) return c;
        // Replace the carton's lines wholesale, ignoring the default empty line.
        const hasOnlyEmptyDefault =
          c.lines.length === 1 && !c.lines[0].sku.trim() && c.lines[0].goodQty === "1";
        const base = hasOnlyEmptyDefault ? [] : c.lines;
        const newLines: LineDraft[] = scanned.map((s) => ({
          id: uid("ln"),
          sku: s.sku,
          productTitle: s.productTitle,
          goodQty: s.goodQty,
          damagedQty: s.damagedQty,
          lot: s.lot,
          expiry: s.expiry,
        }));
        return { ...c, lines: [...base, ...newLines] };
      })
    );
  }

  function resetForm() {
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
            description: "Every line needs a SKU.",
            variant: "destructive",
          });
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
    }

    setSaving(true);
    try {
      const payloadCartons = cartons.map((c) => {
        const copies = showCopies ? Math.max(1, parseInt(c.copies, 10) || 1) : 1;
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

      const useShipmentOnPallet = type === "pallet";
      const { palletId, cartonIds } = await createReceiveBatch({
        warehouseId: warehouse.id,
        receivedBy: operatorName,
        stagingArea: "RCV-STAGE",
        receiveMode,
        isLoose: type === "loose",
        pallet: useShipmentOnPallet
          ? {
              trackingNumber: trackingNumber.trim() || null,
              carrier: carrier || null,
              notes: notes.trim() || null,
              photoUrl: null,
            }
          : undefined,
        cartons: payloadCartons.map((c) => ({
          ...c,
          trackingNumber: !useShipmentOnPallet ? trackingNumber.trim() || null : null,
          carrier: !useShipmentOnPallet ? carrier || null : null,
          notes: !useShipmentOnPallet ? notes.trim() || null : null,
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
          title: `${warehouse.code} — ${created.length} label${created.length > 1 ? "s" : ""}`,
          cartons: created,
        });
        downloadUint8ArrayAsFile(
          cartonPdf,
          `${type}-labels-${created[0].cartonCode}-${created.length}.pdf`
        );
      }
      if (createdPallet) {
        const palletPdf = await buildWarehousePalletLabelsPdf({
          title: `${warehouse.code} — ${createdPallet.palletCode}`,
          pallets: [createdPallet],
        });
        downloadUint8ArrayAsFile(palletPdf, `${createdPallet.palletCode}.pdf`);
      }

      const formSnapshot: StoredReceiveFormSnapshot = {
        type,
        trackingNumber,
        carrier,
        carrierAutoDetected,
        notes,
        cartons,
      };
      writeStoredLastBatch(warehouse.id, {
        cartonIds,
        palletId: palletId ?? null,
        palletCode: createdPallet?.palletCode ?? null,
        formSnapshot,
        savedAt: Date.now(),
      });
      setLastBatch({
        palletCode: createdPallet?.palletCode ?? null,
        cartonIds,
        cartons: created,
      });

      toast({
        title: type === "loose" ? "Unpackaged stock received" : "Cross-dock received",
        description:
          type === "loose"
            ? `${created.length} label${created.length > 1 ? "s" : ""} printed.`
            : `${created.length} CTN/PLT label${created.length > 1 ? "s" : ""} printed. Next: Allocate (per SKU line), then Putaway.`,
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

  async function handleUndoLastBatch() {
    if (!lastBatch) return;
    const stored = readStoredLastBatch(warehouse.id);
    if (batchHasPutaway(lastBatch.cartons) && !supervisor) {
      toast({
        title: "Cannot undo",
        description: "One or more cartons were already put away. Use Correct receive or ask a supervisor.",
        variant: "destructive",
      });
      return;
    }
    setUndoing(true);
    try {
      const res = await voidWarehouseCartons({
        warehouseId: warehouse.id,
        cartonIds: lastBatch.cartonIds,
        reason: "Undo last receive batch",
        operatorId,
        supervisorOverride: supervisor,
      });
      if (res.voidedIds.length === 0) {
        const msg = res.blocked.map((b) => b.reason).join(" ") || "Could not void batch.";
        throw new Error(msg);
      }
      clearStoredLastBatch(warehouse.id);
      setLastBatch(null);
      if (stored?.formSnapshot && onRestoreForm) {
        onRestoreForm(stored.formSnapshot);
        toast({
          title: "Batch undone",
          description: "Labels voided. Your form was restored — fix and receive again.",
        });
      } else {
        toast({
          title: "Batch undone",
          description: `${res.voidedIds.length} carton(s) voided.`,
        });
      }
    } catch (e) {
      toast({
        title: "Undo failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setUndoing(false);
    }
  }

  const canUndoLastBatch =
    lastBatch &&
    lastBatch.cartons.length > 0 &&
    lastBatch.cartons.every((c) => c.status !== "voided") &&
    (!batchHasPutaway(lastBatch.cartons) || supervisor);

  const titleByType: Record<ReceiveType, string> = {
    carton: "Cross-dock — cartons",
    pallet: "Cross-dock — pallet",
    loose: "Unpackaged receiving",
  };
  const subtitleByType: Record<ReceiveType, string> = {
    carton:
      "Add one line per SKU in the carton. Product labels are scanned later at putaway — only carton labels print now.",
    pallet: "All cartons below share one pallet label plus carton labels.",
    loose: "No master carton — unpackaged module (legacy path).",
  };
  const accentByType: Record<ReceiveType, string> = {
    carton: "border-orange-300 bg-orange-600 hover:bg-orange-700",
    pallet: "border-indigo-300 bg-indigo-600 hover:bg-indigo-700",
    loose: "border-emerald-300 bg-emerald-600 hover:bg-emerald-700",
  };

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          {type === "loose" ? "Back" : "Change carton / pallet"}
        </Button>
        <Badge variant="outline" className="capitalize">
          {receiveMode === "crossdock" ? "Cross-dock" : "Unpackaged"} · {type}
        </Badge>
      </div>
      <WarehouseOpsHeader title={titleByType[type]} />
      <p className="text-sm text-muted-foreground -mt-2">{subtitleByType[type]}</p>

      {showShipmentDetails ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">
              {type === "pallet" ? "Pallet details (optional)" : "Inbound details (optional)"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-2">
                  <ScanLine className="h-3 w-3" />
                  Tracking #
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={trackingNumber}
                    onChange={(e) => handleTrackingChange(e.target.value)}
                    placeholder="Camera or type tracking #"
                    autoComplete="off"
                    className="flex-1"
                  />
                  <ScanCameraButton
                    onScan={handleTrackingChange}
                    scannerTitle="Scan tracking barcode"
                    scannerDescription="Scan the carrier label on the box or pallet."
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs flex items-center gap-2">
                  Carrier
                  {carrierAutoDetected ? (
                    <Badge variant="outline" className="bg-emerald-50 border-emerald-300 text-emerald-800 text-[10px] px-1 py-0">
                      auto
                    </Badge>
                  ) : null}
                </Label>
                <Select
                  value={carrier || "__none__"}
                  onValueChange={(v) => {
                    setCarrier(v === "__none__" ? "" : v);
                    setCarrierAutoDetected(false);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="—" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">—</SelectItem>
                    {CARRIERS.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder='e.g. "Outer box crushed, contents OK"'
              />
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-3">
        {showMultipleCartons ? (
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {type === "pallet" ? "Cartons on this pallet" : "Cartons"} ({cartons.length})
            </h2>
            <Button type="button" variant="outline" size="sm" onClick={addCarton}>
              <Plus className="h-4 w-4 mr-1" />
              Add another carton
            </Button>
          </div>
        ) : null}

        {cartons.map((c, idx) => {
          const distinctSkus = new Set(c.lines.map((l) => l.sku.trim()).filter(Boolean));
          const isMixed = distinctSkus.size > 1;
          const totalCopies = showCopies ? Math.max(1, parseInt(c.copies, 10) || 1) : 1;
          const cartonUnits = c.lines.reduce((u, l) => {
            return u + Math.max(0, parseInt(l.goodQty, 10) || 0) + Math.max(0, parseInt(l.damagedQty, 10) || 0);
          }, 0);
          const hasDamaged = c.lines.some((l) => (parseInt(l.damagedQty, 10) || 0) > 0);
          const headerLabel =
            type === "loose"
              ? "Loose lines"
              : showMultipleCartons
              ? `Carton #${idx + 1}`
              : "Items";
          return (
            <Card key={c.id} className="border-slate-200">
              {showMultipleCartons ? (
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <CardTitle className="text-sm">{headerLabel}</CardTitle>
                      {isMixed ? (
                        <Badge variant="outline" className="bg-amber-100 border-amber-300 text-amber-800">
                          Mixed · {distinctSkus.size} SKUs
                        </Badge>
                      ) : null}
                      {hasDamaged ? (
                        <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Has damaged
                        </Badge>
                      ) : null}
                      {showCopies && totalCopies > 1 ? (
                        <Badge variant="outline" className="bg-blue-50 border-blue-300 text-blue-800">
                          × {totalCopies} copies
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {type === "carton" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => duplicateCarton(c.id)}
                          title="Duplicate this carton"
                        >
                          <Copy className="h-4 w-4" />
                        </Button>
                      ) : null}
                      {cartons.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCarton(c.id)}
                        >
                          <Trash2 className="h-4 w-4 text-red-600" />
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </CardHeader>
              ) : null}
              <CardContent className={cn("space-y-3", !showMultipleCartons && "pt-6")}>
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
                        <div className="space-y-1">
                          <Label className="text-xs">SKU</Label>
                          <div className="flex gap-2">
                            <Input
                              value={line.sku}
                              onChange={(e) => updateLine(c.id, line.id, { sku: e.target.value })}
                              placeholder="Required"
                            />
                            <ScanLookupPopover
                              onPick={(m) =>
                                updateLine(c.id, line.id, {
                                  sku: m.sku,
                                  productTitle: m.productName,
                                })
                              }
                              onAcceptRaw={(raw) => updateLine(c.id, line.id, { sku: raw })}
                            />
                          </div>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Product name (optional)</Label>
                          <Input
                            value={line.productTitle}
                            onChange={(e) =>
                              updateLine(c.id, line.id, { productTitle: e.target.value })
                            }
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
                          <Label className="text-xs">Lot (required)</Label>
                          <Input
                            value={line.lot}
                            onChange={(e) => updateLine(c.id, line.id, { lot: e.target.value })}
                            placeholder="Or leave blank to auto-generate"
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
                      <p className="text-[10px] text-muted-foreground">
                        Lot: enter your own, or leave blank —{" "}
                        <span className="font-mono">{describeReceiveLotPattern()}</span>.{" "}
                        {describeReceiveLotHint()}
                      </p>
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
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={() => addLine(c.id)}>
                      <Plus className="h-3 w-3 mr-1" />
                      Add another SKU in this {type === "loose" ? "batch" : "carton"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setQuickScanCartonId(c.id)}
                    >
                      <ScanLine className="h-3 w-3 mr-1" />
                      Quick scan items
                    </Button>
                  </div>
                  {showCopies ? (
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
                        = {totalCopies * cartonUnits} units
                      </span>
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className={cn("sticky bottom-4 bg-background shadow-lg", accentByType[type].split(" ")[0])}>
        <CardContent className="py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm flex flex-wrap items-center gap-2">
            {type === "pallet" ? <Badge className="bg-indigo-600">+ 1 pallet label</Badge> : null}
            {type !== "loose" ? (
              <Badge variant="outline">
                {totalCartonCount} label{totalCartonCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
            <Badge variant="outline">{totalLineCount} line{totalLineCount === 1 ? "" : "s"}</Badge>
            <Badge variant="outline">{totalUnitCount} units</Badge>
            {hasAnyDamaged ? (
              <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                Includes damaged → quarantine
              </Badge>
            ) : null}
          </div>
          <Button
            size="lg"
            className={accentByType[type].split(" ").slice(1).join(" ")}
            onClick={() => void handleReceive()}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Printer className="h-4 w-4 mr-2" />
                Receive &amp; print
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <QuickScanDialog
        open={!!quickScanCartonId}
        onOpenChange={(o) => !o && setQuickScanCartonId(null)}
        onApply={(scanned) => {
          if (quickScanCartonId) applyQuickScanLines(quickScanCartonId, scanned);
          setQuickScanCartonId(null);
        }}
        title={type === "loose" ? "Quick scan loose items" : "Quick scan items in this carton"}
      />

      {lastBatch ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Last batch ({lastBatch.cartons.length} label{lastBatch.cartons.length === 1 ? "" : "s"})
            </CardTitle>
            <CardDescription className="text-xs">
              Labels downloaded — stick them now. Stock parked in Receiving Staging.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {lastBatch.palletCode ? (
              <div className="flex items-center justify-between rounded-md border bg-indigo-50/60 px-3 py-2 text-sm">
                <span className="font-mono">{lastBatch.palletCode}</span>
                <Badge className="bg-indigo-600">
                  <Layers className="h-3 w-3 mr-1" />
                  Pallet
                </Badge>
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
                    {c.isLoose
                      ? `Loose · ${c.lines?.length ?? 0} line${(c.lines?.length ?? 0) === 1 ? "" : "s"} · ${c.quantity}u`
                      : c.isMixed
                      ? `Mixed · ${c.lines?.length ?? 0} SKUs · ${c.quantity}u`
                      : `${c.sku} × ${c.quantity}`}
                  </span>
                </div>
              ))}
            </div>
            {batchHasPutaway(lastBatch.cartons) && !supervisor ? (
              <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
                Putaway started on this batch — undo is disabled. Use Correct receive or a supervisor.
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2 pt-2">
              {canUndoLastBatch ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" disabled={undoing}>
                      {undoing ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <RotateCcw className="h-4 w-4 mr-1" />
                      )}
                      Undo last batch
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Undo this receive batch?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Voids {lastBatch.cartons.length} carton label
                        {lastBatch.cartons.length === 1 ? "" : "s"} and restores your last form so you can fix and receive again.
                        {supervisor && batchHasPutaway(lastBatch.cartons)
                          ? " Supervisor override: putaway assignments on these records will be cleared."
                          : ""}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={() => void handleUndoLastBatch()}>
                        Undo batch
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : null}
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
