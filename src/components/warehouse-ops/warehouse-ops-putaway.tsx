"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
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
import type {
  WarehouseAreaDoc,
  WarehouseBinDoc,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseDoc,
  WarehousePalletDoc,
  WarehousePutawayDisposition,
} from "@/types";
import {
  findPalletByCode,
  listCartonsByPalletId,
} from "@/lib/warehouse-carton-firestore";
import {
  manifestDamagedQty,
  manifestSkuCount,
  resolveManifestLotLabel,
} from "@/lib/warehouse-label-manifest";
import { isLinePutawayPlaced } from "@/lib/warehouse-carton-line-utils";
import {
  applyPutawayAssignments,
  findBinByPath,
  findCartonByCode,
  inspectBinContents,
  lineEligibleAreasHaveBins,
  resolveScan,
  validateLineToBin,
  type PutawayLineAssignment,
} from "@/lib/warehouse-putaway";
import {
  applyCrossdockAreaPutaway,
  areasForDisposition,
  DISPOSITION_LABELS,
  fallbackAreas,
  isCrossdockAreaPlaced,
  listWarehouseAreas,
  needsCrossdockPutawayChoice,
  markCrossdockOpenForStorage,
  openCrossdockCartonForStorage,
  type OpenCrossdockLineInput,
} from "@/lib/warehouse-putaway-disposition";
import { isCrossdockClosedCarton } from "@/lib/warehouse-crossdock";
import { listActiveWarehouseBins } from "@/lib/warehouse-cycle-count";
import {
  applyPalletCrossdockAreaPutaway,
  isClosedCrossdockPallet,
  isPalletAreaPlaced,
  markPalletStowedIfComplete,
  needsPalletPutawayChoice,
  openCrossdockPalletForStorage,
} from "@/lib/warehouse-pallet-putaway";
import {
  Loader2,
  Scan,
  Package,
  PackageOpen,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ArrowLeft,
  Layers,
  Boxes,
  Trash2,
  Truck,
  Box,
  Plus,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  PutawayDestinationFields,
  PutawayLineDestinationCard,
  BinSummary,
  emptyPutawayLineSlot,
  isPutawayLineSlotReady,
  type PutawayDestinationContext,
  type PutawayLineSlot,
  type ResolvedBin,
} from "@/components/warehouse-ops/putaway-destination-fields";

function initPerLineFromCarton(
  carton: WarehouseCartonDoc,
  ctx?: PutawayDestinationContext
): Record<string, PutawayLineSlot> {
  const map: Record<string, PutawayLineSlot> = {};
  for (const line of carton.lines ?? []) {
    if (!line.binId && !line.stagingArea?.trim()) {
      map[line.lineId] = emptyPutawayLineSlot(line, ctx);
    }
  }
  return map;
}

type Mode = "split" | "whole" | "split_qty";

type QtySplitRow = {
  id: string;
  qty: string;
  bin: PutawayLineSlot;
};

type ManifestLine = {
  carton: WarehouseCartonDoc;
  line: WarehouseCartonLine;
};

function manifestLineKey(cartonId: string, lineId: string): string {
  return `${cartonId}::${lineId}`;
}

function skuLabel(line: Pick<WarehouseCartonLine, "sku" | "productTitle">): string {
  const title = line.productTitle?.trim();
  return title ? `${line.sku} — ${title}` : line.sku;
}

function PutawayLineSku({
  line,
  className,
}: {
  line: Pick<WarehouseCartonLine, "sku" | "productTitle">;
  className?: string;
}) {
  const title = line.productTitle?.trim();
  return (
    <span className={className}>
      <span className="font-mono font-semibold">{line.sku}</span>
      {title ? <span className="font-normal text-muted-foreground"> — {title}</span> : null}
    </span>
  );
}

function pendingManifestLines(cartons: WarehouseCartonDoc[]): ManifestLine[] {
  const out: ManifestLine[] = [];
  for (const carton of cartons) {
    if (carton.status === "voided" || carton.status === "closed") continue;
    for (const line of carton.lines ?? []) {
      if (!isLinePutawayPlaced(line)) out.push({ carton, line });
    }
  }
  return out;
}

function isCrossdockAreaDisposition(
  d: WarehousePutawayDisposition | null
): d is "forward" | "keep_closed" {
  return d === "forward" || d === "keep_closed";
}

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseOpsPutaway({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? null;
  const operatorName = userProfile?.name || userProfile?.email || null;

  const [cartonScan, setCartonScan] = useState("");
  const [resolving, setResolving] = useState(false);
  const [carton, setCarton] = useState<WarehouseCartonDoc | null>(null);
  const [pallet, setPallet] = useState<WarehousePalletDoc | null>(null);
  const [palletCartons, setPalletCartons] = useState<WarehouseCartonDoc[]>([]);

  const [mode, setMode] = useState<Mode>("split");
  const [palletMode, setPalletMode] = useState<Mode>("whole");
  const [palletWholeBin, setPalletWholeBin] = useState<PutawayLineSlot>(emptyPutawayLineSlot());
  const [wholeSlot, setWholeSlot] = useState<PutawayLineSlot>(emptyPutawayLineSlot());
  const [perLine, setPerLine] = useState<Record<string, PutawayLineSlot>>({});
  const [qtySplits, setQtySplits] = useState<QtySplitRow[]>([]);
  const [saving, setSaving] = useState(false);

  const [warehouseAreas, setWarehouseAreas] = useState<WarehouseAreaDoc[]>([]);
  const [warehouseBins, setWarehouseBins] = useState<WarehouseBinDoc[]>([]);
  const [areasLoading, setAreasLoading] = useState(false);
  const [pendingDisposition, setPendingDisposition] =
    useState<WarehousePutawayDisposition | null>(null);
  const [stagingAreaCode, setStagingAreaCode] = useState("");
  const [captureLines, setCaptureLines] = useState<
    Array<{ id: string; sku: string; qty: string; lot: string; expiry: string }>
  >([{ id: "ln1", sku: "", qty: "1", lot: "", expiry: "" }]);

  const cartonInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    cartonInputRef.current?.focus();
  }, []);

  const isMixed =
    !!carton &&
    (carton.isMixed || (carton.lines && carton.lines.length > 1) || false);
  const hasDamaged = !!carton?.lines?.some((l) => l.condition === "damaged");
  const linesPending = useMemo(
    () => (carton?.lines ?? []).filter((l) => !isLinePutawayPlaced(l)),
    [carton]
  );
  const canSplitQty = useMemo(
    () =>
      !!carton &&
      !carton.isMixed &&
      linesPending.length === 1 &&
      (linesPending[0]?.quantity ?? 0) > 1,
    [carton, linesPending]
  );

  const palletManifest = useMemo(
    () => pendingManifestLines(palletCartons),
    [palletCartons]
  );
  const palletSkuCount = useMemo(() => {
    const skus = new Set(palletManifest.map((m) => m.line.sku));
    return skus.size;
  }, [palletManifest]);
  const palletHasDamaged = useMemo(
    () => palletManifest.some((m) => m.line.condition === "damaged"),
    [palletManifest]
  );

  function resetCarton() {
    setCarton(null);
    setPallet(null);
    setPalletCartons([]);
    setCartonScan("");
    setMode("split");
    setPalletMode("whole");
    setPalletWholeBin(emptyPutawayLineSlot());
    setWholeSlot(emptyPutawayLineSlot());
    setPerLine({});
    setQtySplits([]);
    setPendingDisposition(null);
    setStagingAreaCode("");
    setCaptureLines([{ id: "ln1", sku: "", qty: "1", lot: "", expiry: "" }]);
    setTimeout(() => cartonInputRef.current?.focus(), 50);
  }

  const putawayCtx = useMemo<PutawayDestinationContext>(
    () => ({ areas: warehouseAreas, bins: warehouseBins }),
    [warehouseAreas, warehouseBins]
  );

  useEffect(() => {
    if (!carton && !pallet) return;
    let cancelled = false;
    setAreasLoading(true);
    void Promise.all([
      listWarehouseAreas(warehouse.id),
      listActiveWarehouseBins(warehouse.id),
    ])
      .then(([areas, bins]) => {
        if (!cancelled) {
          setWarehouseAreas(areas);
          setWarehouseBins(bins);
        }
      })
      .finally(() => {
        if (!cancelled) setAreasLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [warehouse.id, carton?.id, pallet?.id]);

  async function reloadCarton(code: string) {
    const fresh = await findCartonByCode(warehouse.id, code);
    if (fresh) setCarton(fresh);
    return fresh;
  }

  const crossdockPhase = useMemo(() => {
    if (!carton || carton.receiveMode !== "crossdock") return "bins" as const;
    if (isCrossdockAreaPlaced(carton)) return "area_done" as const;
    if (needsCrossdockPutawayChoice(carton)) {
      if (pendingDisposition === "open_for_storage" && isCrossdockClosedCarton(carton)) {
        return "capture_skus" as const;
      }
      if (
        pendingDisposition === "forward" ||
        pendingDisposition === "keep_closed"
      ) {
        return "pick_area" as const;
      }
      return "choose_disposition" as const;
    }
    return "bins" as const;
  }, [carton, pendingDisposition]);

  const palletPhase = useMemo(() => {
    if (!pallet) return null;
    if (isPalletAreaPlaced(pallet)) return "area_done" as const;
    if (needsPalletPutawayChoice(pallet)) {
      if (pendingDisposition === "open_for_storage") return "capture_skus" as const;
      if (pendingDisposition === "forward" || pendingDisposition === "keep_closed") {
        return "pick_area" as const;
      }
      return "choose_disposition" as const;
    }
    if (palletManifest.length > 0) return "manifest" as const;
    return "empty" as const;
  }, [pallet, pendingDisposition, palletManifest.length]);

  async function reloadPallet(code: string) {
    const fresh = await findPalletByCode(warehouse.id, code);
    if (fresh) setPallet(fresh);
    return fresh;
  }

  async function handleResolveCartonWithValue(raw?: string) {
    const code = (raw ?? cartonScan).trim();
    if (!code) return;
    if (raw != null) setCartonScan(raw);
    setResolving(true);
    try {
      const res = await resolveScan(warehouse.id, code);
      if (res.kind === "none") {
        toast({
          title: "Not found",
          description: "No carton or pallet matches that code in this warehouse.",
          variant: "destructive",
        });
        setCarton(null);
        return;
      }
      if (res.kind === "pallet") {
        const foundPallet = await findPalletByCode(warehouse.id, res.palletCode);
        if (!foundPallet) {
          toast({
            title: "Pallet not found",
            description: `No pallet ${res.palletCode} in this warehouse.`,
            variant: "destructive",
          });
          setCarton(null);
          setPallet(null);
          return;
        }
        const cartons = await listCartonsByPalletId(warehouse.id, foundPallet.id);
        const pending = pendingManifestLines(cartons);
        if (
          pending.length === 0 &&
          cartons.length === 0 &&
          !needsPalletPutawayChoice(foundPallet) &&
          !isPalletAreaPlaced(foundPallet)
        ) {
          toast({
            title: "Empty pallet",
            description:
              "No cartons on this pallet. Receive cartons onto the pallet first, or scan a closed cross-dock PLT label.",
            variant: "destructive",
          });
          setCarton(null);
          setPallet(null);
          return;
        }
        if (pending.length === 0 && cartons.length > 0) {
          if (isPalletAreaPlaced(foundPallet)) {
            setPallet(foundPallet);
            setPalletCartons(cartons);
            setCarton(null);
            setPendingDisposition(null);
            return;
          }
          toast({
            title: "Pallet complete",
            description: "All cartons on this pallet are already stowed.",
          });
          setCarton(null);
          setPallet(null);
          return;
        }
        setPallet(foundPallet);
        setPalletCartons(cartons);
        setCarton(null);
        setPendingDisposition(null);
        setStagingAreaCode("");
        setPalletMode("whole");
        setPalletWholeBin(emptyPutawayLineSlot());
        setPerLine({});
        setWholeSlot(emptyPutawayLineSlot());
        return;
      }
      const c = res.carton;
      if (c.status === "split" || c.status === "closed" || c.status === "voided") {
        toast({
          title: "Not available for putaway",
          description:
            c.status === "voided"
              ? `Carton ${c.cartonCode} was voided. Scan a different label or correct receive.`
              : `Carton ${c.cartonCode} is ${c.status}.`,
          variant: "destructive",
        });
        return;
      }
      if (!c.lines || c.lines.length === 0) {
        toast({
          title: "Legacy carton",
          description:
            "This carton predates line-aware receiving. Open it in admin to migrate, or stow via admin tools.",
          variant: "destructive",
        });
        return;
      }
      setCarton(c);
      setPendingDisposition(null);
      setStagingAreaCode("");
      setMode(c.isMixed || c.lines.length > 1 ? "split" : "whole");
      setQtySplits(
        !c.isMixed && c.lines.length === 1 && c.lines[0].quantity > 1
          ? [
              {
                id: "qs1",
                qty: String(c.lines[0].quantity),
                bin: emptyPutawayLineSlot(c.lines[0], putawayCtx),
              },
            ]
          : []
      );
      setPerLine(initPerLineFromCarton(c, putawayCtx));
      setWholeSlot(emptyPutawayLineSlot(c.lines[0], putawayCtx));
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

  function handleResolveCarton() {
    void handleResolveCartonWithValue();
  }

  async function resolveBin(path: string): Promise<ResolvedBin | null> {
    const bin = await findBinByPath(warehouse.id, path);
    if (!bin) return null;
    const contents = await inspectBinContents(warehouse.id, bin.id);
    return { bin, contents };
  }

  function assignmentFromSlot(
    line: WarehouseCartonLine,
    slot: PutawayLineSlot | undefined,
    ctx: PutawayDestinationContext = putawayCtx
  ): PutawayLineAssignment | null {
    if (!slot || !isPutawayLineSlotReady(line, slot, ctx)) return null;
    if (lineEligibleAreasHaveBins(ctx.areas, ctx.bins, line) && slot.resolved) {
      return {
        lineId: line.lineId,
        binId: slot.resolved.bin.id,
        binPath: slot.resolved.bin.path,
      };
    }
    if (!lineEligibleAreasHaveBins(ctx.areas, ctx.bins, line) && slot.areaCode.trim()) {
      return { lineId: line.lineId, stagingArea: slot.areaCode.trim() };
    }
    return null;
  }

  function updateWholeSlot(patch: Partial<PutawayLineSlot>) {
    setWholeSlot((prev) => ({ ...prev, ...patch }));
  }

  async function handleResolveWholeBin(pathOverride?: string) {
    const v = (pathOverride ?? wholeSlot.binPath).trim();
    if (!v) return;
    updateWholeSlot({ binPath: v, resolved: null, loading: true, error: null });
    try {
      const resolved = await resolveBin(v);
      if (!resolved) {
        updateWholeSlot({ resolved: null, loading: false, error: "Bin not found." });
        return;
      }
      updateWholeSlot({ binPath: v, resolved, loading: false, error: null });
    } catch (e) {
      updateWholeSlot({
        loading: false,
        error: e instanceof Error ? e.message : "Lookup failed",
      });
    }
  }

  function updatePerLineSlot(lineId: string, patch: Partial<PutawayLineSlot>) {
    setPerLine((prev) => ({
      ...prev,
      [lineId]: { ...(prev[lineId] ?? emptyPutawayLineSlot()), ...patch },
    }));
  }

  async function handleResolvePerLineBin(lineId: string, pathOverride?: string) {
    const slot = perLine[lineId] ?? emptyPutawayLineSlot();
    const v = (pathOverride ?? slot.binPath).trim();
    if (!v) return;
    updatePerLineSlot(lineId, { binPath: v, resolved: null, loading: true, error: null });
    try {
      const resolved = await resolveBin(v);
      if (!resolved) {
        updatePerLineSlot(lineId, {
          binPath: v,
          resolved: null,
          loading: false,
          error: "Bin not found.",
        });
        return;
      }
      updatePerLineSlot(lineId, { binPath: v, resolved, loading: false, error: null });
    } catch (e) {
      updatePerLineSlot(lineId, {
        loading: false,
        error: e instanceof Error ? e.message : "Lookup failed",
      });
    }
  }

  function clearLineAssignment(lineId: string) {
    setPerLine((prev) => {
      const { [lineId]: _omit, ...rest } = prev;
      void _omit;
      return rest;
    });
  }

  function addQtySplitRow() {
    setQtySplits((prev) => [
      ...prev,
      {
        id: `qs${Date.now()}`,
        qty: "1",
        bin: emptyPutawayLineSlot(),
      },
    ]);
  }

  function removeQtySplitRow(rowId: string) {
    setQtySplits((prev) => (prev.length <= 1 ? prev : prev.filter((r) => r.id !== rowId)));
  }

  async function handleQtySplitBinChange(rowId: string, value: string) {
    setQtySplits((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              bin: { ...emptyPutawayLineSlot(), binPath: value, resolved: null, loading: false, error: null },
            }
          : r
      )
    );
  }

  async function handleResolveQtySplitBin(rowId: string, pathOverride?: string) {
    const row = qtySplits.find((r) => r.id === rowId);
    const v = (pathOverride ?? row?.bin.binPath ?? "").trim();
    if (!v) return;
    setQtySplits((prev) =>
      prev.map((r) =>
        r.id === rowId
          ? {
              ...r,
              bin: { ...emptyPutawayLineSlot(), binPath: v, resolved: null, loading: true, error: null },
            }
          : r
      )
    );
    try {
      const resolved = await resolveBin(v);
      if (!resolved) {
        setQtySplits((prev) =>
          prev.map((r) =>
            r.id === rowId
              ? {
                  ...r,
                  bin: {
                    ...emptyPutawayLineSlot(),
                    binPath: v,
                    resolved: null,
                    loading: false,
                    error: "Bin not found.",
                  },
                }
              : r
          )
        );
        return;
      }
      setQtySplits((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? { ...r, bin: { ...emptyPutawayLineSlot(), binPath: v, resolved, loading: false, error: null } }
            : r
        )
      );
    } catch (e) {
      setQtySplits((prev) =>
        prev.map((r) =>
          r.id === rowId
            ? {
                ...r,
                bin: {
                  ...r.bin,
                  loading: false,
                  error: e instanceof Error ? e.message : "Lookup failed",
                },
              }
            : r
        )
      );
    }
  }

  function validateWholeAssignment(): Array<{ line: WarehouseCartonLine; error: string | null }> {
    if (!carton?.lines) return [];
    return linesPending.map((l) => {
      if (!isPutawayLineSlotReady(l, wholeSlot, putawayCtx)) {
        return { line: l, error: "Choose a valid bin or area." };
      }
      return { line: l, error: null };
    });
  }

  function validatePerLineAssignment(line: WarehouseCartonLine): string | null {
    const slot = perLine[line.lineId];
    if (!isPutawayLineSlotReady(line, slot, putawayCtx)) {
      return "Choose a valid bin or area.";
    }
    return null;
  }

  async function handleCrossdockAreaConfirm() {
    if (!carton || !pendingDisposition) return;
    if (pendingDisposition !== "forward" && pendingDisposition !== "keep_closed") return;
    const areaList =
      areasForDisposition(warehouseAreas, pendingDisposition).length > 0
        ? areasForDisposition(warehouseAreas, pendingDisposition)
        : fallbackAreas(warehouseAreas);
    const area = areaList.find((a) => a.code === stagingAreaCode);
    if (!area) {
      toast({ title: "Select an area", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await applyCrossdockAreaPutaway({
        warehouseId: warehouse.id,
        cartonId: carton.id,
        carton,
        disposition: pendingDisposition,
        stagingArea: area.code,
        operatorId: operatorId ?? operatorName,
      });
      toast({
        title: "Placed in area",
        description: `${carton.cartonCode} → ${area.code} (${DISPOSITION_LABELS[pendingDisposition]})`,
      });
      await reloadCarton(carton.cartonCode);
      setPendingDisposition(null);
      setStagingAreaCode("");
    } catch (e) {
      toast({
        title: "Putaway failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePalletCrossdockAreaConfirm() {
    if (!pallet || !pendingDisposition) return;
    if (pendingDisposition !== "forward" && pendingDisposition !== "keep_closed") return;
    const areaList =
      areasForDisposition(warehouseAreas, pendingDisposition).length > 0
        ? areasForDisposition(warehouseAreas, pendingDisposition)
        : fallbackAreas(warehouseAreas);
    const area = areaList.find((a) => a.code === stagingAreaCode);
    if (!area) {
      toast({ title: "Select an area", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      await applyPalletCrossdockAreaPutaway({
        warehouseId: warehouse.id,
        palletId: pallet.id,
        pallet,
        disposition: pendingDisposition,
        stagingArea: area.code,
        operatorId: operatorId ?? operatorName,
      });
      toast({
        title: "Placed in area",
        description: `${pallet.palletCode} → ${area.code} (${DISPOSITION_LABELS[pendingDisposition]})`,
      });
      await reloadPallet(pallet.palletCode);
      setPendingDisposition(null);
      setStagingAreaCode("");
    } catch (e) {
      toast({
        title: "Putaway failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handlePalletOpenCaptureConfirm() {
    if (!pallet) return;
    const payload: OpenCrossdockLineInput[] = captureLines.map((l) => ({
      sku: l.sku,
      quantity: parseInt(l.qty, 10) || 0,
      lot: l.lot || null,
      expiry: l.expiry || null,
    }));
    setSaving(true);
    try {
      await openCrossdockPalletForStorage({
        warehouseId: warehouse.id,
        palletId: pallet.id,
        pallet,
        lines: payload,
        operatorId: operatorId ?? operatorName,
      });
      const refreshed = await reloadPallet(pallet.palletCode);
      const cartons = refreshed
        ? await listCartonsByPalletId(warehouse.id, refreshed.id)
        : [];
      setPalletCartons(cartons);
      setPendingDisposition(null);
      setCaptureLines([{ id: "ln1", sku: "", qty: "1", lot: "", expiry: "" }]);
      toast({
        title: "Pallet opened",
        description: "Scan a bin to stow each SKU line.",
      });
    } catch (e) {
      toast({
        title: "Could not open pallet",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleOpenCaptureConfirm() {
    if (!carton) return;
    const payload: OpenCrossdockLineInput[] = captureLines.map((l) => ({
      sku: l.sku,
      quantity: parseInt(l.qty, 10) || 0,
      lot: l.lot || null,
      expiry: l.expiry || null,
    }));
    setSaving(true);
    try {
      await openCrossdockCartonForStorage({
        warehouseId: warehouse.id,
        cartonId: carton.id,
        carton,
        lines: payload,
        operatorId: operatorId ?? operatorName,
      });
      const fresh = await reloadCarton(carton.cartonCode);
      toast({
        title: "Carton opened",
        description: "Scan bins to stow each SKU line.",
      });
      setPendingDisposition(null);
      if (fresh) {
        setMode(fresh.isMixed || (fresh.lines?.length ?? 0) > 1 ? "split" : "whole");
      }
    } catch (e) {
      toast({
        title: "Could not open carton",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  function validateManifestLine(entry: ManifestLine): string | null {
    const key = manifestLineKey(entry.carton.id, entry.line.lineId);
    if (palletMode === "whole") {
      if (!isPutawayLineSlotReady(entry.line, palletWholeBin, putawayCtx)) {
        return "Choose a valid bin or area.";
      }
      return null;
    }
    const slot = perLine[key];
    if (!isPutawayLineSlotReady(entry.line, slot, putawayCtx)) {
      return "Choose a valid bin or area.";
    }
    return null;
  }

  function updatePalletWholeSlot(patch: Partial<PutawayLineSlot>) {
    setPalletWholeBin((prev) => ({ ...prev, ...patch }));
  }

  async function handleResolvePalletWholeBin(pathOverride?: string) {
    const v = (pathOverride ?? palletWholeBin.binPath).trim();
    if (!v) return;
    updatePalletWholeSlot({ binPath: v, resolved: null, loading: true, error: null });
    try {
      const resolved = await resolveBin(v);
      if (!resolved) {
        updatePalletWholeSlot({ resolved: null, loading: false, error: "Bin not found." });
        return;
      }
      updatePalletWholeSlot({ binPath: v, resolved, loading: false, error: null });
    } catch (e) {
      updatePalletWholeSlot({
        loading: false,
        error: e instanceof Error ? e.message : "Lookup failed",
      });
    }
  }

  async function handlePalletConfirm() {
    if (!pallet) return;
    const assignmentsByCarton = new Map<string, PutawayLineAssignment[]>();
    const blocking: string[] = [];

    if (palletMode === "whole") {
      for (const entry of palletManifest) {
        const err = validateManifestLine(entry);
        if (err) {
          blocking.push(`${entry.carton.cartonCode} · ${skuLabel(entry.line)}: ${err}`);
          continue;
        }
        const a = assignmentFromSlot(entry.line, palletWholeBin);
        if (!a) {
          blocking.push(`${entry.carton.cartonCode} · ${skuLabel(entry.line)}: invalid destination`);
          continue;
        }
        const list = assignmentsByCarton.get(entry.carton.id) ?? [];
        list.push(a);
        assignmentsByCarton.set(entry.carton.id, list);
      }
    } else {
      for (const entry of palletManifest) {
        const key = manifestLineKey(entry.carton.id, entry.line.lineId);
        const slot = perLine[key];
        const err = validateManifestLine(entry);
        if (err) {
          blocking.push(`${entry.carton.cartonCode} · ${skuLabel(entry.line)}: ${err}`);
          continue;
        }
        const a = assignmentFromSlot(entry.line, slot);
        if (!a) continue;
        const list = assignmentsByCarton.get(entry.carton.id) ?? [];
        list.push(a);
        assignmentsByCarton.set(entry.carton.id, list);
      }
    }

    if (blocking.length > 0) {
      toast({
        title: "Cannot stow",
        description: blocking.join(" • "),
        variant: "destructive",
      });
      return;
    }

    let totalAssigned = 0;
    for (const list of assignmentsByCarton.values()) totalAssigned += list.length;
    if (totalAssigned === 0) {
      toast({
        title: "Nothing to stow",
        description: "Scan at least one bin for a SKU line.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      for (const [cartonId, assigns] of assignmentsByCarton) {
        const meta = palletCartons.find((c) => c.id === cartonId);
        if (!meta) continue;
        const fresh = await findCartonByCode(warehouse.id, meta.cartonCode);
        if (!fresh?.lines?.length) {
          throw new Error(`Carton ${meta.cartonCode} could not be reloaded.`);
        }
        await applyPutawayAssignments(warehouse.id, cartonId, fresh, assigns, {
          operatorId: operatorId ?? operatorName,
          warehouseAreas,
        });
      }

      const refreshed = await listCartonsByPalletId(warehouse.id, pallet.id);
      const stillPending = pendingManifestLines(refreshed);
      if (stillPending.length === 0) {
        await markPalletStowedIfComplete({
          warehouseId: warehouse.id,
          palletId: pallet.id,
          pallet,
        });
        toast({
          title: "Pallet stowed",
          description: `${pallet.palletCode} — all cartons placed.`,
        });
        resetCarton();
      } else {
        setPalletCartons(refreshed);
        setPerLine({});
        setPalletWholeBin(emptyPutawayLineSlot());
        toast({
          title: "Partially stowed",
          description: `${totalAssigned} line${totalAssigned === 1 ? "" : "s"} placed. ${stillPending.length} still pending on this pallet.`,
        });
      }
    } catch (e) {
      toast({
        title: "Putaway failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleConfirm() {
    if (!carton) return;
    const assignments: PutawayLineAssignment[] = [];
    const blocking: string[] = [];

    if (mode === "split_qty" && linesPending.length === 1) {
      const line = linesPending[0];
      const splits = qtySplits.filter((s) => s.bin.resolved && (parseInt(s.qty, 10) || 0) > 0);
      if (splits.length === 0) {
        toast({ title: "Add at least one bin with quantity", variant: "destructive" });
        return;
      }
      let total = 0;
      for (const sp of splits) {
        const q = parseInt(sp.qty, 10) || 0;
        total += q;
        const probe = { ...line, quantity: q };
        const r = validateLineToBin(
          probe,
          sp.bin.resolved!.bin,
          sp.bin.resolved!.contents,
          warehouseAreas
        );
        if (!r.ok) {
          blocking.push(`${q} × ${skuLabel(line)} → ${sp.bin.resolved!.bin.path}: ${r.reason}`);
        } else {
          assignments.push({
            lineId: line.lineId,
            binId: sp.bin.resolved!.bin.id,
            binPath: sp.bin.resolved!.bin.path,
            quantity: q,
          });
        }
      }
      if (total > line.quantity) {
        toast({
          title: "Too many units",
          description: `Total ${total} exceeds line quantity ${line.quantity}.`,
          variant: "destructive",
        });
        return;
      }
    } else if (mode === "whole") {
      const validations = validateWholeAssignment();
      for (const v of validations) {
        if (v.error) blocking.push(`${skuLabel(v.line)}: ${v.error}`);
      }
      if (blocking.length === 0) {
        for (const l of linesPending) {
          const a = assignmentFromSlot(l, wholeSlot);
          if (a) assignments.push(a);
        }
      }
    } else if (mode === "split") {
      for (const l of linesPending) {
        const slot = perLine[l.lineId];
        const err = validatePerLineAssignment(l);
        if (err) {
          blocking.push(`${skuLabel(l)}: ${err}`);
          continue;
        }
        const a = assignmentFromSlot(l, slot);
        if (a) assignments.push(a);
      }
    }

    if (blocking.length > 0) {
      toast({
        title: "Cannot stow",
        description: blocking.join(" • "),
        variant: "destructive",
      });
      return;
    }
    if (assignments.length === 0) {
      toast({
        title: "Nothing to stow",
        description: "Assign each line to a bin or area.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const result = await applyPutawayAssignments(
        warehouse.id,
        carton.id,
        carton,
        assignments,
        { operatorId: operatorId ?? operatorName, warehouseAreas }
      );
      toast({
        title:
          result.status === "stowed"
            ? "Stowed"
            : result.status === "split"
            ? "Split into multiple bins"
            : result.status === "stowed_partial"
            ? "Partially stowed"
            : "Updated",
        description: `${assignments.length} line${assignments.length > 1 ? "s" : ""} placed.`,
      });
      resetCarton();
    } catch (e) {
      toast({
        title: "Putaway failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-4xl space-y-6">
      <WarehouseOpsHeader title="Putaway" />

      {!carton && !pallet ? (
        <Card className="border-blue-200/60 bg-blue-50/30 dark:bg-blue-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Scan className="h-4 w-4 text-blue-600" />
              Scan label to putaway
            </CardTitle>
            <CardDescription className="text-xs">
              Scan the carton label first (what you are moving), then the bin or area (where it
              goes). The app shows area pick only when that zone has no bins yet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                ref={cartonInputRef}
                value={cartonScan}
                onChange={(e) => setCartonScan(e.target.value)}
                placeholder="Camera or type CTN-… PKG-… or PAL-…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleResolveCarton();
                }}
                autoFocus
                className="flex-1"
              />
              <ScanCameraButton
                onScan={(text) => void handleResolveCartonWithValue(text)}
                scannerTitle="Scan carton label"
                scannerDescription="Scan the QR or barcode on the carton label."
              />
              <Button onClick={() => void handleResolveCarton()} disabled={resolving}>
                {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Find"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              No carton in front of you? Print labels at{" "}
              <Link href="/warehouse-ops/receiving" className="text-blue-600 underline">
                Receiving
              </Link>{" "}
              first.
            </p>
          </CardContent>
        </Card>
      ) : pallet && palletPhase === "choose_disposition" ? (
        <CrossdockDispositionPicker
          carton={null}
          pallet={pallet}
          onPick={(d) => {
            setPendingDisposition(d);
            setStagingAreaCode("");
            if (d === "open_for_storage") {
              setCaptureLines([{ id: "ln1", sku: "", qty: "1", lot: "", expiry: "" }]);
            }
          }}
          onCancel={resetCarton}
        />
      ) : pallet && palletPhase === "pick_area" && isCrossdockAreaDisposition(pendingDisposition) ? (
        <CrossdockAreaPicker
          carton={null}
          pallet={pallet}
          disposition={pendingDisposition}
          areas={
            areasForDisposition(warehouseAreas, pendingDisposition).length > 0
              ? areasForDisposition(warehouseAreas, pendingDisposition)
              : fallbackAreas(warehouseAreas)
          }
          areasLoading={areasLoading}
          stagingAreaCode={stagingAreaCode}
          onStagingAreaChange={setStagingAreaCode}
          onBack={() => {
            setPendingDisposition(null);
            setStagingAreaCode("");
          }}
          onCancel={resetCarton}
          onConfirm={() => void handlePalletCrossdockAreaConfirm()}
          saving={saving}
        />
      ) : pallet && palletPhase === "capture_skus" ? (
        <CrossdockOpenLinesForm
          carton={null}
          pallet={pallet}
          lines={captureLines}
          onLinesChange={setCaptureLines}
          onBack={() => setPendingDisposition(null)}
          onCancel={resetCarton}
          onConfirm={() => void handlePalletOpenCaptureConfirm()}
          saving={saving}
        />
      ) : pallet && palletPhase === "area_done" ? (
        <PalletAreaDonePanel pallet={pallet} onDone={resetCarton} />
      ) : pallet && palletPhase === "manifest" ? (
        <PalletPutawayPanel
          pallet={pallet}
          cartons={palletCartons}
          manifest={palletManifest}
          skuCount={palletSkuCount}
          hasDamaged={palletHasDamaged}
          mode={palletMode}
          setMode={setPalletMode}
          warehouseAreas={warehouseAreas}
          warehouseBins={warehouseBins}
          areasLoading={areasLoading}
          wholeSlot={palletWholeBin}
          onUpdateWholeSlot={updatePalletWholeSlot}
          onResolveWholeBin={handleResolvePalletWholeBin}
          perLine={perLine}
          onUpdatePerLineSlot={updatePerLineSlot}
          onResolvePerLineBin={handleResolvePerLineBin}
          onClearPerLine={clearLineAssignment}
          validateManifestLine={validateManifestLine}
          onCancel={resetCarton}
          onConfirm={() => void handlePalletConfirm()}
          saving={saving}
        />
      ) : carton && crossdockPhase === "choose_disposition" ? (
        <CrossdockDispositionPicker
          carton={carton}
          onPick={(d) => {
            if (d === "open_for_storage" && isCrossdockClosedCarton(carton)) {
              setPendingDisposition(d);
              return;
            }
            if (d === "open_for_storage") {
              void (async () => {
                setSaving(true);
                try {
                  await markCrossdockOpenForStorage({
                    warehouseId: warehouse.id,
                    cartonId: carton.id,
                  });
                  await reloadCarton(carton.cartonCode);
                } catch (e) {
                  toast({
                    title: "Could not continue",
                    description: e instanceof Error ? e.message : "Unknown error",
                    variant: "destructive",
                  });
                } finally {
                  setSaving(false);
                }
              })();
              return;
            }
            setPendingDisposition(d);
            setStagingAreaCode("");
          }}
          onCancel={resetCarton}
        />
      ) : carton && crossdockPhase === "pick_area" && isCrossdockAreaDisposition(pendingDisposition) ? (
        <CrossdockAreaPicker
          carton={carton}
          disposition={pendingDisposition}
          areas={
            areasForDisposition(warehouseAreas, pendingDisposition).length > 0
              ? areasForDisposition(warehouseAreas, pendingDisposition)
              : fallbackAreas(warehouseAreas)
          }
          areasLoading={areasLoading}
          stagingAreaCode={stagingAreaCode}
          onStagingAreaChange={setStagingAreaCode}
          onBack={() => {
            setPendingDisposition(null);
            setStagingAreaCode("");
          }}
          onCancel={resetCarton}
          onConfirm={() => void handleCrossdockAreaConfirm()}
          saving={saving}
        />
      ) : carton && crossdockPhase === "capture_skus" ? (
        <CrossdockOpenLinesForm
          carton={carton}
          lines={captureLines}
          onLinesChange={setCaptureLines}
          onBack={() => setPendingDisposition(null)}
          onCancel={resetCarton}
          onConfirm={() => void handleOpenCaptureConfirm()}
          saving={saving}
        />
      ) : carton && crossdockPhase === "area_done" ? (
        <CrossdockAreaDonePanel carton={carton} onDone={resetCarton} />
      ) : carton && carton.isPackage ? (
        <PackagePutawayPanel
          carton={carton}
          linesPending={linesPending}
          skuCount={manifestSkuCount(carton)}
          lotLabel={resolveManifestLotLabel(carton)}
          damagedQty={manifestDamagedQty(carton)}
          warehouseAreas={warehouseAreas}
          warehouseBins={warehouseBins}
          areasLoading={areasLoading}
          perLine={perLine}
          onUpdatePerLineSlot={updatePerLineSlot}
          onResolvePerLineBin={handleResolvePerLineBin}
          onClearPerLine={clearLineAssignment}
          onCancel={resetCarton}
          onConfirm={handleConfirm}
          saving={saving}
        />
      ) : carton ? (
        <CartonPutawayPanel
          carton={carton}
          isMixed={isMixed}
          hasDamaged={hasDamaged}
          canSplitQty={canSplitQty}
          linesPending={linesPending}
          mode={mode}
          setMode={setMode}
          warehouseAreas={warehouseAreas}
          warehouseBins={warehouseBins}
          areasLoading={areasLoading}
          wholeSlot={wholeSlot}
          onUpdateWholeSlot={updateWholeSlot}
          onResolveWholeBin={handleResolveWholeBin}
          wholeValidations={validateWholeAssignment()}
          qtySplits={qtySplits}
          onQtySplitChange={(rowId, qty) =>
            setQtySplits((prev) => prev.map((r) => (r.id === rowId ? { ...r, qty } : r)))
          }
          onQtySplitBinChange={handleQtySplitBinChange}
          onResolveQtySplitBin={handleResolveQtySplitBin}
          onAddQtySplitRow={addQtySplitRow}
          onRemoveQtySplitRow={removeQtySplitRow}
          perLine={perLine}
          onUpdatePerLineSlot={updatePerLineSlot}
          onResolvePerLineBin={handleResolvePerLineBin}
          onClearPerLine={clearLineAssignment}
          onCancel={resetCarton}
          onConfirm={handleConfirm}
          saving={saving}
        />
      ) : null}
    </div>
  );
}

type PalletPanelProps = {
  pallet: WarehousePalletDoc;
  cartons: WarehouseCartonDoc[];
  manifest: ManifestLine[];
  skuCount: number;
  hasDamaged: boolean;
  mode: Mode;
  setMode: (m: Mode) => void;
  warehouseAreas: WarehouseAreaDoc[];
  warehouseBins: WarehouseBinDoc[];
  areasLoading: boolean;
  wholeSlot: PutawayLineSlot;
  onUpdateWholeSlot: (patch: Partial<PutawayLineSlot>) => void;
  onResolveWholeBin: (path?: string) => void;
  perLine: Record<string, PutawayLineSlot>;
  onUpdatePerLineSlot: (lineId: string, patch: Partial<PutawayLineSlot>) => void;
  onResolvePerLineBin: (lineId: string, path?: string) => void;
  onClearPerLine: (lineId: string) => void;
  validateManifestLine: (entry: ManifestLine) => string | null;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
};

function PalletPutawayPanel({
  pallet,
  cartons,
  manifest,
  skuCount,
  hasDamaged,
  mode,
  setMode,
  warehouseAreas,
  warehouseBins,
  areasLoading,
  wholeSlot,
  onUpdateWholeSlot,
  onResolveWholeBin,
  perLine,
  onUpdatePerLineSlot,
  onResolvePerLineBin,
  onClearPerLine,
  validateManifestLine,
  onCancel,
  onConfirm,
  saving,
}: PalletPanelProps) {
  const byCarton = useMemo(() => {
    const map = new Map<string, ManifestLine[]>();
    for (const entry of manifest) {
      const list = map.get(entry.carton.id) ?? [];
      list.push(entry);
      map.set(entry.carton.id, list);
    }
    return [...map.entries()].sort((a, b) =>
      (a[1][0]?.carton.cartonCode ?? "").localeCompare(b[1][0]?.carton.cartonCode ?? "")
    );
  }, [manifest]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Different scan
        </Button>
      </div>

      <Card className="border-indigo-200/70">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Boxes className="h-4 w-4 text-indigo-600" />
                {pallet.palletCode}
              </CardTitle>
              <CardDescription className="text-xs">
                Pallet manifest — {cartons.length} carton{cartons.length === 1 ? "" : "s"},{" "}
                {skuCount} SKU{skuCount === 1 ? "" : "s"}, {manifest.length} line
                {manifest.length === 1 ? "" : "s"} pending
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="bg-indigo-100 border-indigo-300 text-indigo-800">
                <Layers className="h-3 w-3 mr-1" /> Pallet
              </Badge>
              {hasDamaged ? (
                <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Damaged lines
                </Badge>
              ) : null}
              <Badge variant="outline">{pallet.status}</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Destination</CardTitle>
          <CardDescription className="text-xs">
            One destination for the whole pallet (bin or area), or assign each line separately when
            SKUs or damaged stock need different locations.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant={mode === "whole" ? "default" : "outline"}
              onClick={() => setMode("whole")}
            >
              One bin (whole pallet)
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "split" ? "default" : "outline"}
              onClick={() => setMode("split")}
            >
              Per line / carton
            </Button>
          </div>
          {mode === "whole" ? (
            <div className="space-y-2">
              {manifest[0] ? (
                <PutawayDestinationFields
                  line={manifest[0].line}
                  slot={wholeSlot}
                  warehouseAreas={warehouseAreas}
                  warehouseBins={warehouseBins}
                  areasLoading={areasLoading}
                  onBinPathChange={(value) =>
                    onUpdateWholeSlot({ binPath: value, resolved: null, error: null })
                  }
                  onResolveBin={onResolveWholeBin}
                  onAreaChange={(areaCode) =>
                    onUpdateWholeSlot({ areaCode, resolved: null, error: null })
                  }
                />
              ) : null}
              {manifest.map((entry) => {
                const err = validateManifestLine(entry);
                if (!err) return null;
                return (
                  <div
                    key={manifestLineKey(entry.carton.id, entry.line.lineId)}
                    className="flex items-start gap-1 rounded bg-red-50 text-red-800 border border-red-200 px-2 py-1 text-xs"
                  >
                    <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    <span>
                      {entry.carton.cartonCode} · {entry.line.sku}: {err}
                    </span>
                  </div>
                );
              })}
              {manifest.every((e) => !validateManifestLine(e)) && manifest.length > 0 ? (
                <div className="flex items-start gap-1 rounded bg-green-50 text-green-800 border border-green-200 px-2 py-1 text-xs">
                  <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                  <span>
                    All {manifest.length} line{manifest.length === 1 ? "" : "s"} OK for this
                    destination
                  </span>
                </div>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {mode === "split" ? (
        <div className="space-y-4">
          {byCarton.map(([cartonId, entries]) => {
            const carton = entries[0]?.carton;
            if (!carton) return null;
            return (
              <div key={cartonId} className="space-y-2">
                <div className="flex items-center gap-2 px-1">
                  <Package className="h-3.5 w-3.5 text-orange-600" />
                  <span className="text-sm font-mono font-semibold">{carton.cartonCode}</span>
                  <span className="text-xs text-muted-foreground">
                    {entries.length} line{entries.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="space-y-2 pl-1 border-l-2 border-indigo-100 ml-1">
                  {entries.map((entry) => {
                    const key = manifestLineKey(entry.carton.id, entry.line.lineId);
                    return (
                      <PutawayLineDestinationCard
                        key={key}
                        line={entry.line}
                        slot={perLine[key] ?? emptyPutawayLineSlot(entry.line, { areas: warehouseAreas, bins: warehouseBins })}
                        warehouseAreas={warehouseAreas}
                        warehouseBins={warehouseBins}
                        areasLoading={areasLoading}
                        onUpdateSlot={(patch) => onUpdatePerLineSlot(key, patch)}
                        onResolveBin={(path) => onResolvePerLineBin(key, path)}
                        onClear={() => onClearPerLine(key)}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">
              Manifest preview — {manifest.length} line{manifest.length === 1 ? "" : "s"} across{" "}
              {byCarton.length} carton{byCarton.length === 1 ? "" : "s"}. Scan one bin above to
              stow all lines together.
            </p>
            <ul className="mt-2 space-y-1 text-sm">
              {manifest.map((entry) => (
                <li
                  key={manifestLineKey(entry.carton.id, entry.line.lineId)}
                  className="font-mono text-xs"
                >
                  {entry.carton.cartonCode} · <PutawayLineSku line={entry.line} /> ×{" "}
                  {entry.line.quantity}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="border-indigo-300 sticky bottom-4 bg-background shadow-lg">
        <CardContent className="py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {manifest.length} line{manifest.length === 1 ? "" : "s"} pending across{" "}
            {byCarton.length} carton{byCarton.length === 1 ? "" : "s"}
          </span>
          <Button
            size="lg"
            className="bg-indigo-600 hover:bg-indigo-700"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Confirm pallet putaway
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type PackagePanelProps = {
  carton: WarehouseCartonDoc;
  linesPending: WarehouseCartonLine[];
  skuCount: number;
  lotLabel: string | null;
  damagedQty: number;
  warehouseAreas: WarehouseAreaDoc[];
  warehouseBins: WarehouseBinDoc[];
  areasLoading: boolean;
  perLine: Record<string, PutawayLineSlot>;
  onUpdatePerLineSlot: (lineId: string, patch: Partial<PutawayLineSlot>) => void;
  onResolvePerLineBin: (lineId: string, path?: string) => void;
  onClearPerLine: (lineId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
};

function PackagePutawayPanel({
  carton,
  linesPending,
  skuCount,
  lotLabel,
  damagedQty,
  warehouseAreas,
  warehouseBins,
  areasLoading,
  perLine,
  onUpdatePerLineSlot,
  onResolvePerLineBin,
  onClearPerLine,
  onCancel,
  onConfirm,
  saving,
}: PackagePanelProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Different scan
        </Button>
      </div>

      <Card className="border-emerald-200/70">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <PackageOpen className="h-4 w-4 text-emerald-600" />
                {carton.cartonCode}
              </CardTitle>
              <CardDescription className="text-xs">
                Package manifest — {skuCount} SKU{skuCount === 1 ? "" : "s"},{" "}
                {linesPending.length} line{linesPending.length === 1 ? "" : "s"} pending
                {lotLabel ? ` · Lot ${lotLabel}` : ""}
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Badge variant="outline" className="bg-emerald-100 border-emerald-300 text-emerald-800">
                <PackageOpen className="h-3 w-3 mr-1" /> Package
              </Badge>
              {carton.isLoose ? (
                <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-800">
                  Open receiving
                </Badge>
              ) : null}
              {damagedQty > 0 ? (
                <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                  <AlertTriangle className="h-3 w-3 mr-1" /> DMG {damagedQty}
                </Badge>
              ) : null}
              <Badge variant="outline">{carton.status}</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded border bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">SKUs</span>
              <p className="font-semibold">{skuCount}</p>
            </div>
            <div className="rounded border bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Units</span>
              <p className="font-semibold">{carton.quantity}</p>
            </div>
            <div className="rounded border bg-muted/30 px-2 py-1.5">
              <span className="text-muted-foreground">Damaged</span>
              <p className="font-semibold">{damagedQty}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {linesPending.map((line) => (
          <PutawayLineDestinationCard
            key={line.lineId}
            line={line}
            slot={perLine[line.lineId] ?? emptyPutawayLineSlot(line, { areas: warehouseAreas, bins: warehouseBins })}
            warehouseAreas={warehouseAreas}
            warehouseBins={warehouseBins}
            areasLoading={areasLoading}
            onUpdateSlot={(patch) => onUpdatePerLineSlot(line.lineId, patch)}
            onResolveBin={(path) => onResolvePerLineBin(line.lineId, path)}
            onClear={() => onClearPerLine(line.lineId)}
          />
        ))}
      </div>

      <Card className="border-emerald-300 sticky bottom-4 bg-background shadow-lg">
        <CardContent className="py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {linesPending.length} line{linesPending.length === 1 ? "" : "s"} pending on this package
          </span>
          <Button
            size="lg"
            className="bg-emerald-600 hover:bg-emerald-700"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Confirm package putaway
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

type PanelProps = {
  carton: WarehouseCartonDoc;
  isMixed: boolean;
  hasDamaged: boolean;
  canSplitQty: boolean;
  linesPending: WarehouseCartonLine[];
  mode: Mode;
  setMode: (m: Mode) => void;
  warehouseAreas: WarehouseAreaDoc[];
  warehouseBins: WarehouseBinDoc[];
  areasLoading: boolean;
  wholeSlot: PutawayLineSlot;
  onUpdateWholeSlot: (patch: Partial<PutawayLineSlot>) => void;
  onResolveWholeBin: (path?: string) => void;
  wholeValidations: Array<{ line: WarehouseCartonLine; error: string | null }>;
  qtySplits: QtySplitRow[];
  onQtySplitChange: (rowId: string, qty: string) => void;
  onQtySplitBinChange: (rowId: string, v: string) => void;
  onResolveQtySplitBin: (rowId: string, path?: string) => void;
  onAddQtySplitRow: () => void;
  onRemoveQtySplitRow: (rowId: string) => void;
  perLine: Record<string, PutawayLineSlot>;
  onUpdatePerLineSlot: (lineId: string, patch: Partial<PutawayLineSlot>) => void;
  onResolvePerLineBin: (lineId: string, path?: string) => void;
  onClearPerLine: (lineId: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
};

function CartonPutawayPanel({
  carton,
  isMixed,
  hasDamaged,
  canSplitQty,
  linesPending,
  mode,
  setMode,
  warehouseAreas,
  warehouseBins,
  areasLoading,
  wholeSlot,
  onUpdateWholeSlot,
  onResolveWholeBin,
  wholeValidations,
  qtySplits,
  onQtySplitChange,
  onQtySplitBinChange,
  onResolveQtySplitBin,
  onAddQtySplitRow,
  onRemoveQtySplitRow,
  perLine,
  onUpdatePerLineSlot,
  onResolvePerLineBin,
  onClearPerLine,
  onCancel,
  onConfirm,
  saving,
}: PanelProps) {
  const lineTotal = linesPending[0]?.quantity ?? 0;
  const splitQtyAssigned = qtySplits.reduce((s, r) => s + (parseInt(r.qty, 10) || 0), 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Different carton
        </Button>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                {carton.isPackage ? (
                  <PackageOpen className="h-4 w-4 text-emerald-600" />
                ) : carton.isLoose ? (
                  <PackageOpen className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Package className="h-4 w-4 text-orange-600" />
                )}
                {carton.cartonCode}
              </CardTitle>
              <CardDescription className="text-xs">
                {carton.isPackage
                  ? "Closed cross-dock package · contents counted at putaway"
                  : carton.isLoose
                  ? `Open receiving · ${carton.lines?.length ?? 0} line${(carton.lines?.length ?? 0) === 1 ? "" : "s"} · ${carton.quantity}u`
                  : isMixed
                  ? `Mixed carton · ${carton.lines?.length ?? 0} lines`
                  : `Single SKU · ${skuLabel({
                      sku: carton.sku,
                      productTitle:
                        carton.lines?.[0]?.productTitle ?? carton.productTitle ?? null,
                    })} × ${carton.quantity}`}
                {carton.palletId ? " · on pallet" : ""}
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              {carton.isPackage ? (
                <Badge variant="outline" className="bg-emerald-100 border-emerald-300 text-emerald-800">
                  <PackageOpen className="h-3 w-3 mr-1" /> Package
                </Badge>
              ) : null}
              {carton.isLoose && !carton.isPackage ? (
                <Badge variant="outline" className="bg-emerald-100 border-emerald-300 text-emerald-800">
                  <PackageOpen className="h-3 w-3 mr-1" /> Open
                </Badge>
              ) : null}
              {isMixed ? (
                <Badge variant="outline" className="bg-amber-100 border-amber-300 text-amber-800">
                  <Layers className="h-3 w-3 mr-1" /> Mixed
                </Badge>
              ) : null}
              {hasDamaged ? (
                <Badge variant="outline" className="bg-red-100 border-red-300 text-red-800">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Damaged → Quarantine
                </Badge>
              ) : null}
              <Badge variant="outline">{carton.status}</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {isMixed ? (
        <div className="flex gap-2 text-sm flex-wrap">
          <Button
            type="button"
            variant={mode === "split" ? "default" : "outline"}
            onClick={() => setMode("split")}
            size="sm"
          >
            Split per line (bin or area)
          </Button>
          <Button
            type="button"
            variant={mode === "whole" ? "default" : "outline"}
            onClick={() => setMode("whole")}
            size="sm"
          >
            Stow whole carton in one place
          </Button>
        </div>
      ) : canSplitQty ? (
        <div className="flex gap-2 text-sm flex-wrap">
          <Button
            type="button"
            variant={mode === "whole" ? "default" : "outline"}
            onClick={() => setMode("whole")}
            size="sm"
          >
            All {lineTotal} in one bin
          </Button>
          <Button
            type="button"
            variant={mode === "split_qty" ? "default" : "outline"}
            onClick={() => setMode("split_qty")}
            size="sm"
          >
            Split quantity across bins
          </Button>
        </div>
      ) : null}

      {mode === "split_qty" && canSplitQty ? (
        <Card className="border-blue-200/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Split quantity across bins</CardTitle>
            <CardDescription className="text-xs">
              {splitQtyAssigned} / {lineTotal} units assigned
              {linesPending[0] ? ` · ${skuLabel(linesPending[0])}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {qtySplits.map((row) => (
              <div key={row.id} className="flex flex-col gap-2 sm:flex-row sm:items-end border-b pb-3">
                <div className="w-full sm:w-24">
                  <Label className="text-xs">Qty</Label>
                  <Input
                    type="number"
                    min={1}
                    value={row.qty}
                    onChange={(e) => onQtySplitChange(row.id, e.target.value)}
                  />
                </div>
                <div className="flex-1 flex gap-2">
                  <Input
                    value={row.bin.binPath}
                    onChange={(e) => onQtySplitBinChange(row.id, e.target.value)}
                    placeholder="Scan bin"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") onResolveQtySplitBin(row.id);
                    }}
                  />
                  <ScanCameraButton
                    onScan={(text) => {
                      onQtySplitBinChange(row.id, text);
                      onResolveQtySplitBin(row.id, text);
                    }}
                    scannerTitle="Scan bin"
                    scannerDescription="Scan destination bin for this quantity."
                  />
                  <Button
                    onClick={() => onResolveQtySplitBin(row.id)}
                    disabled={row.bin.loading}
                  >
                    {row.bin.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
                  </Button>
                </div>
                {qtySplits.length > 1 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRemoveQtySplitRow(row.id)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
                {row.bin.error ? <p className="text-xs text-red-600 w-full">{row.bin.error}</p> : null}
                {row.bin.resolved ? (
                  <div className="w-full">
                    <BinSummary resolved={row.bin.resolved} warehouseAreas={warehouseAreas} />
                  </div>
                ) : null}
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={onAddQtySplitRow}>
              <Plus className="h-4 w-4 mr-1" />
              Add another bin
            </Button>
          </CardContent>
        </Card>
      ) : mode === "whole" ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Destination</CardTitle>
            <CardDescription className="text-xs">
              Scan the destination bin for this carton. Area is used only when that zone has no bins
              set up yet (e.g. empty quarantine floor).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {linesPending[0] ? (
              <PutawayDestinationFields
                line={linesPending[0]}
                slot={wholeSlot}
                warehouseAreas={warehouseAreas}
                warehouseBins={warehouseBins}
                areasLoading={areasLoading}
                onBinPathChange={(value) =>
                  onUpdateWholeSlot({ binPath: value, resolved: null, error: null })
                }
                onResolveBin={onResolveWholeBin}
                onAreaChange={(areaCode) =>
                  onUpdateWholeSlot({ areaCode, resolved: null, error: null })
                }
              />
            ) : null}
            {wholeValidations.length > 0 ? (
              <div className="space-y-1">
                {wholeValidations.map((v) => (
                  <div
                    key={v.line.lineId}
                    className={cn(
                      "flex items-start gap-2 rounded px-2 py-1 text-xs",
                      v.error
                        ? "bg-red-50 text-red-800 border border-red-200"
                        : "bg-green-50 text-green-800 border border-green-200"
                    )}
                  >
                    {v.error ? (
                      <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                    ) : (
                      <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                    )}
                    <span>
                      {skuLabel(v.line)} × {v.line.quantity}
                      {v.line.condition === "damaged" ? " (DMG)" : ""}
                      {v.error ? ` — ${v.error}` : " — ok"}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {linesPending.map((line) => (
            <PutawayLineDestinationCard
              key={line.lineId}
              line={line}
              slot={perLine[line.lineId] ?? emptyPutawayLineSlot(line, { areas: warehouseAreas, bins: warehouseBins })}
              warehouseAreas={warehouseAreas}
              warehouseBins={warehouseBins}
              areasLoading={areasLoading}
              damagedBadge="Damaged → Quarantine"
              onUpdateSlot={(patch) => onUpdatePerLineSlot(line.lineId, patch)}
              onResolveBin={(path) => onResolvePerLineBin(line.lineId, path)}
              onClear={() => onClearPerLine(line.lineId)}
            />
          ))}
        </div>
      )}

      <Card className="border-orange-300 sticky bottom-4 bg-background shadow-lg">
        <CardContent className="py-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">
            {linesPending.length} line{linesPending.length === 1 ? "" : "s"} pending
          </span>
          <Button
            size="lg"
            className="bg-orange-600 hover:bg-orange-700"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Confirm putaway
                <ChevronRight className="h-4 w-4 ml-1" />
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CrossdockDispositionPicker({
  carton,
  pallet,
  onPick,
  onCancel,
}: {
  carton: WarehouseCartonDoc | null;
  pallet?: WarehousePalletDoc | null;
  onPick: (d: WarehousePutawayDisposition) => void;
  onCancel: () => void;
}) {
  const code = carton?.cartonCode ?? pallet?.palletCode ?? "Unit";
  const unitLabel = pallet ? "pallet" : "carton";
  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Different scan
      </Button>
      <Card className="border-indigo-200/60 bg-indigo-50/20">
        <CardHeader>
          <CardTitle className="text-base">{code}</CardTitle>
          <CardDescription className="text-xs">
            Cross-dock {unitLabel} — choose what happens next. Area labels can be scanned later;
            pick the zone for now.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col items-start gap-2 p-4 border-indigo-200 hover:bg-indigo-50"
            onClick={() => onPick("forward")}
          >
            <Truck className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-sm">Forward</span>
            <span className="text-xs text-muted-foreground text-left">
              Ship now — direct dispatch, no pick/pack
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col items-start gap-2 p-4 border-indigo-200 hover:bg-indigo-50"
            onClick={() => onPick("keep_closed")}
          >
            <Box className="h-5 w-5 text-indigo-600" />
            <span className="font-semibold text-sm">Keep closed</span>
            <span className="text-xs text-muted-foreground text-left">
              Hold for client outbound — link later on Dispatch
            </span>
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col items-start gap-2 p-4 border-orange-200 hover:bg-orange-50"
            onClick={() => onPick("open_for_storage")}
          >
            <PackageOpen className="h-5 w-5 text-orange-600" />
            <span className="font-semibold text-sm">Open for storage</span>
            <span className="text-xs text-muted-foreground text-left">
              Enter SKUs (if needed), then scan bins
            </span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CrossdockAreaPicker({
  carton,
  pallet,
  disposition,
  areas,
  areasLoading,
  stagingAreaCode,
  onStagingAreaChange,
  onBack,
  onCancel,
  onConfirm,
  saving,
}: {
  carton: WarehouseCartonDoc | null;
  pallet?: WarehousePalletDoc | null;
  disposition: "forward" | "keep_closed";
  areas: WarehouseAreaDoc[];
  areasLoading: boolean;
  stagingAreaCode: string;
  onStagingAreaChange: (code: string) => void;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const code = carton?.cartonCode ?? pallet?.palletCode ?? "Unit";
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Different scan
        </Button>
      </div>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{DISPOSITION_LABELS[disposition]}</CardTitle>
          <CardDescription className="text-xs">
            {code} — select warehouse area (no bin scan).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {areasLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : areas.length === 0 ? (
            <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded px-3 py-2">
              No areas match this purpose. Tag areas in Admin → Warehouses (Dispatch / Receiving),
              or add any active area below.
            </p>
          ) : null}
          <div className="space-y-2">
            <Label className="text-xs">Staging area</Label>
            <Select value={stagingAreaCode} onValueChange={onStagingAreaChange}>
              <SelectTrigger>
                <SelectValue placeholder="Choose area code…" />
              </SelectTrigger>
              <SelectContent>
                {areas.map((a) => (
                  <SelectItem key={a.id} value={a.code}>
                    {a.code}
                    {a.name ? ` — ${a.name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="lg"
            className="w-full bg-indigo-600 hover:bg-indigo-700"
            onClick={onConfirm}
            disabled={saving || !stagingAreaCode}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirm placement"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CrossdockOpenLinesForm({
  carton,
  pallet,
  lines,
  onLinesChange,
  onBack,
  onCancel,
  onConfirm,
  saving,
}: {
  carton: WarehouseCartonDoc | null;
  pallet?: WarehousePalletDoc | null;
  lines: Array<{ id: string; sku: string; qty: string; lot: string; expiry: string }>;
  onLinesChange: (
    next: Array<{ id: string; sku: string; qty: string; lot: string; expiry: string }>
  ) => void;
  onBack: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
}) {
  const code = carton?.cartonCode ?? pallet?.palletCode ?? "Unit";
  const title = pallet ? "Open pallet — enter contents" : "Open carton — enter contents";
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Different scan
        </Button>
      </div>
      <Card className="border-orange-200/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{title}</CardTitle>
          <CardDescription className="text-xs">
            {code} was received closed. Add SKU lines, then scan storage bins.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {lines.map((line, idx) => (
            <div key={line.id} className="grid gap-2 sm:grid-cols-5 border rounded-md p-3">
              <div className="space-y-1 sm:col-span-2">
                <Label className="text-xs">SKU</Label>
                <Input
                  value={line.sku}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, sku: e.target.value };
                    onLinesChange(next);
                  }}
                  placeholder="SKU"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, qty: e.target.value };
                    onLinesChange(next);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Lot</Label>
                <Input
                  value={line.lot}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, lot: e.target.value };
                    onLinesChange(next);
                  }}
                  placeholder="Optional"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Expiry</Label>
                <Input
                  type="date"
                  value={line.expiry}
                  onChange={(e) => {
                    const next = [...lines];
                    next[idx] = { ...line, expiry: e.target.value };
                    onLinesChange(next);
                  }}
                />
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              onLinesChange([
                ...lines,
                { id: `ln${Date.now()}`, sku: "", qty: "1", lot: "", expiry: "" },
              ])
            }
          >
            <Plus className="h-3 w-3 mr-1" />
            Add SKU line
          </Button>
          <Button
            size="lg"
            className="w-full bg-orange-600 hover:bg-orange-700"
            onClick={onConfirm}
            disabled={saving}
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Continue to bin putaway"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function CrossdockAreaDonePanel({
  carton,
  onDone,
}: {
  carton: WarehouseCartonDoc;
  onDone: () => void;
}) {
  const label =
    carton.putawayDisposition && DISPOSITION_LABELS[carton.putawayDisposition]
      ? DISPOSITION_LABELS[carton.putawayDisposition]
      : "Placed";
  const nextStep =
    carton.putawayDisposition === "forward"
      ? "This unit is in the cross-dock dispatch queue — go to Dispatch → Cross-dock."
      : carton.putawayDisposition === "keep_closed"
        ? "Held for client outbound — link on Dispatch → Cross-dock when the order is confirmed."
        : null;
  return (
    <div className="space-y-4">
      <Card className="border-green-200 bg-green-50/40">
        <CardContent className="py-6 space-y-3 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
          <p className="font-semibold">{carton.cartonCode}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
          {nextStep ? <p className="text-xs text-muted-foreground px-4">{nextStep}</p> : null}
          {carton.stagingArea ? (
            <Badge variant="outline" className="font-mono">
              Area {carton.stagingArea}
            </Badge>
          ) : null}
          <Button onClick={onDone} className="mt-2">
            Scan next carton
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function PalletAreaDonePanel({
  pallet,
  onDone,
}: {
  pallet: WarehousePalletDoc;
  onDone: () => void;
}) {
  const label =
    pallet.putawayDisposition && DISPOSITION_LABELS[pallet.putawayDisposition]
      ? DISPOSITION_LABELS[pallet.putawayDisposition]
      : "Placed";
  const nextStep =
    pallet.putawayDisposition === "forward"
      ? "This pallet is in the cross-dock dispatch queue — go to Dispatch → Cross-dock."
      : pallet.putawayDisposition === "keep_closed"
        ? "Held for client outbound — link on Dispatch → Cross-dock when the order is confirmed."
        : null;
  return (
    <div className="space-y-4">
      <Card className="border-green-200 bg-green-50/40">
        <CardContent className="py-6 space-y-3 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto" />
          <p className="font-semibold">{pallet.palletCode}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
          {nextStep ? <p className="text-xs text-muted-foreground px-4">{nextStep}</p> : null}
          {pallet.stagingArea ? (
            <Badge variant="outline" className="font-mono">
              Area {pallet.stagingArea}
            </Badge>
          ) : null}
          <Button onClick={onDone} className="mt-2">
            Scan next label
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
