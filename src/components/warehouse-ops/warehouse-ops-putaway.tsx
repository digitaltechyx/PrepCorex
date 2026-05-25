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
  WarehouseBinDoc,
  WarehouseCartonDoc,
  WarehouseCartonLine,
  WarehouseDoc,
} from "@/types";
import {
  applyPutawayAssignments,
  classifyBin,
  findBinByPath,
  inspectBinContents,
  resolveScan,
  validateLineToBin,
} from "@/lib/warehouse-putaway";
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
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

type ResolvedBin = {
  bin: WarehouseBinDoc;
  contents: { skus: string[]; hasDamaged: boolean; cartonCount: number };
};

type LineAssignment = {
  binPath: string;
  resolved: ResolvedBin | null;
  loading: boolean;
  error: string | null;
};

type Mode = "split" | "whole";

export function WarehouseOpsPutaway({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? null;
  const operatorName = userProfile?.name || userProfile?.email || null;

  const [cartonScan, setCartonScan] = useState("");
  const [resolving, setResolving] = useState(false);
  const [carton, setCarton] = useState<WarehouseCartonDoc | null>(null);

  const [mode, setMode] = useState<Mode>("split");
  const [wholeBin, setWholeBin] = useState<LineAssignment>({
    binPath: "",
    resolved: null,
    loading: false,
    error: null,
  });
  const [perLine, setPerLine] = useState<Record<string, LineAssignment>>({});
  const [saving, setSaving] = useState(false);

  const cartonInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    cartonInputRef.current?.focus();
  }, []);

  const isMixed =
    !!carton &&
    (carton.isMixed || (carton.lines && carton.lines.length > 1) || false);
  const hasDamaged = !!carton?.lines?.some((l) => l.condition === "damaged");
  const linesPending = useMemo(
    () => (carton?.lines ?? []).filter((l) => !l.binId),
    [carton]
  );

  function resetCarton() {
    setCarton(null);
    setCartonScan("");
    setMode("split");
    setWholeBin({ binPath: "", resolved: null, loading: false, error: null });
    setPerLine({});
    setTimeout(() => cartonInputRef.current?.focus(), 50);
  }

  async function handleResolveCarton() {
    if (!cartonScan.trim()) return;
    setResolving(true);
    try {
      const res = await resolveScan(warehouse.id, cartonScan);
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
        toast({
          title: "Pallet scanned",
          description:
            "Putaway works on individual cartons. Scan each carton on the pallet, or break the pallet down.",
        });
        setCarton(null);
        return;
      }
      const c = res.carton;
      if (c.status === "split" || c.status === "closed") {
        toast({
          title: "Already finalized",
          description: `Carton ${c.cartonCode} is ${c.status}.`,
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
      // Default mode based on shape
      setMode(c.isMixed || c.lines.length > 1 ? "split" : "whole");
      setPerLine({});
      setWholeBin({ binPath: "", resolved: null, loading: false, error: null });
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

  async function resolveBin(path: string): Promise<ResolvedBin | null> {
    const bin = await findBinByPath(warehouse.id, path);
    if (!bin) return null;
    const contents = await inspectBinContents(warehouse.id, bin.id);
    return { bin, contents };
  }

  async function handleWholeBinChange(value: string) {
    setWholeBin({ binPath: value, resolved: null, loading: false, error: null });
  }

  async function handleResolveWholeBin() {
    const v = wholeBin.binPath.trim();
    if (!v) return;
    setWholeBin((s) => ({ ...s, loading: true, error: null }));
    try {
      const resolved = await resolveBin(v);
      if (!resolved) {
        setWholeBin((s) => ({ ...s, resolved: null, loading: false, error: "Bin not found." }));
        return;
      }
      setWholeBin({ binPath: v, resolved, loading: false, error: null });
    } catch (e) {
      setWholeBin((s) => ({
        ...s,
        loading: false,
        error: e instanceof Error ? e.message : "Lookup failed",
      }));
    }
  }

  async function handlePerLineBinChange(lineId: string, value: string) {
    setPerLine((prev) => ({
      ...prev,
      [lineId]: { binPath: value, resolved: null, loading: false, error: null },
    }));
  }

  async function handleResolvePerLineBin(lineId: string) {
    const slot = perLine[lineId];
    const v = slot?.binPath.trim() ?? "";
    if (!v) return;
    setPerLine((prev) => ({
      ...prev,
      [lineId]: { ...slot, loading: true, error: null },
    }));
    try {
      const resolved = await resolveBin(v);
      if (!resolved) {
        setPerLine((prev) => ({
          ...prev,
          [lineId]: { binPath: v, resolved: null, loading: false, error: "Bin not found." },
        }));
        return;
      }
      setPerLine((prev) => ({
        ...prev,
        [lineId]: { binPath: v, resolved, loading: false, error: null },
      }));
    } catch (e) {
      setPerLine((prev) => ({
        ...prev,
        [lineId]: {
          ...slot,
          loading: false,
          error: e instanceof Error ? e.message : "Lookup failed",
        },
      }));
    }
  }

  function clearLineAssignment(lineId: string) {
    setPerLine((prev) => {
      const { [lineId]: _omit, ...rest } = prev;
      void _omit;
      return rest;
    });
  }

  function validateWholeAssignment(): Array<{ line: WarehouseCartonLine; error: string | null }> {
    if (!carton?.lines || !wholeBin.resolved) return [];
    return linesPending.map((l) => {
      const r = validateLineToBin(l, wholeBin.resolved!.bin, wholeBin.resolved!.contents);
      return { line: l, error: r.ok ? null : r.reason };
    });
  }

  function validatePerLineAssignment(line: WarehouseCartonLine): string | null {
    const slot = perLine[line.lineId];
    if (!slot?.resolved) return null;
    const r = validateLineToBin(line, slot.resolved.bin, slot.resolved.contents);
    return r.ok ? null : r.reason;
  }

  async function handleConfirm() {
    if (!carton) return;
    const assignments: Array<{ lineId: string; binId: string; binPath: string }> = [];
    const blocking: string[] = [];

    if (mode === "whole") {
      if (!wholeBin.resolved) {
        toast({ title: "Scan a bin first", variant: "destructive" });
        return;
      }
      const validations = validateWholeAssignment();
      for (const v of validations) {
        if (v.error) blocking.push(`${v.line.sku}: ${v.error}`);
      }
      if (blocking.length === 0) {
        for (const l of linesPending) {
          assignments.push({
            lineId: l.lineId,
            binId: wholeBin.resolved.bin.id,
            binPath: wholeBin.resolved.bin.path,
          });
        }
      }
    } else {
      for (const l of linesPending) {
        const slot = perLine[l.lineId];
        if (!slot?.resolved) continue;
        const err = validatePerLineAssignment(l);
        if (err) {
          blocking.push(`${l.sku}: ${err}`);
          continue;
        }
        assignments.push({
          lineId: l.lineId,
          binId: slot.resolved.bin.id,
          binPath: slot.resolved.bin.path,
        });
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
        description: "Scan at least one bin to stow a line.",
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
        { operatorId: operatorId ?? operatorName }
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

      {!carton ? (
        <Card className="border-blue-200/60 bg-blue-50/30 dark:bg-blue-950/20">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Scan className="h-4 w-4 text-blue-600" />
              Scan carton to putaway
            </CardTitle>
            <CardDescription className="text-xs">
              Pick a carton from receiving staging and scan its code (CTN-…). Single-SKU
              cartons go to one bin. Mixed cartons can be split across bins, or stowed
              whole in one bin if it’s empty.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                ref={cartonInputRef}
                value={cartonScan}
                onChange={(e) => setCartonScan(e.target.value)}
                placeholder="Scan or type carton code (CTN-…)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleResolveCarton();
                }}
                autoFocus
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
      ) : (
        <CartonPutawayPanel
          carton={carton}
          isMixed={isMixed}
          hasDamaged={hasDamaged}
          linesPending={linesPending}
          mode={mode}
          setMode={setMode}
          wholeBin={wholeBin}
          onWholeBinChange={handleWholeBinChange}
          onResolveWholeBin={handleResolveWholeBin}
          wholeValidations={validateWholeAssignment()}
          perLine={perLine}
          onPerLineBinChange={handlePerLineBinChange}
          onResolvePerLineBin={handleResolvePerLineBin}
          onClearPerLine={clearLineAssignment}
          validatePerLine={validatePerLineAssignment}
          onCancel={resetCarton}
          onConfirm={handleConfirm}
          saving={saving}
        />
      )}
    </div>
  );
}

type PanelProps = {
  carton: WarehouseCartonDoc;
  isMixed: boolean;
  hasDamaged: boolean;
  linesPending: WarehouseCartonLine[];
  mode: Mode;
  setMode: (m: Mode) => void;
  wholeBin: LineAssignment;
  onWholeBinChange: (v: string) => void;
  onResolveWholeBin: () => void;
  wholeValidations: Array<{ line: WarehouseCartonLine; error: string | null }>;
  perLine: Record<string, LineAssignment>;
  onPerLineBinChange: (lineId: string, v: string) => void;
  onResolvePerLineBin: (lineId: string) => void;
  onClearPerLine: (lineId: string) => void;
  validatePerLine: (line: WarehouseCartonLine) => string | null;
  onCancel: () => void;
  onConfirm: () => void;
  saving: boolean;
};

function CartonPutawayPanel({
  carton,
  isMixed,
  hasDamaged,
  linesPending,
  mode,
  setMode,
  wholeBin,
  onWholeBinChange,
  onResolveWholeBin,
  wholeValidations,
  perLine,
  onPerLineBinChange,
  onResolvePerLineBin,
  onClearPerLine,
  validatePerLine,
  onCancel,
  onConfirm,
  saving,
}: PanelProps) {
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
                {carton.isLoose ? (
                  <PackageOpen className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Package className="h-4 w-4 text-orange-600" />
                )}
                {carton.cartonCode}
              </CardTitle>
              <CardDescription className="text-xs">
                {carton.isLoose
                  ? `Loose stock · ${carton.lines?.length ?? 0} line${(carton.lines?.length ?? 0) === 1 ? "" : "s"} · ${carton.quantity}u`
                  : isMixed
                  ? `Mixed carton · ${carton.lines?.length ?? 0} lines`
                  : `Single SKU · ${carton.sku} × ${carton.quantity}`}
                {carton.palletId ? " · on pallet" : ""}
              </CardDescription>
            </div>
            <div className="flex gap-2 flex-wrap">
              {carton.isLoose ? (
                <Badge variant="outline" className="bg-emerald-100 border-emerald-300 text-emerald-800">
                  <PackageOpen className="h-3 w-3 mr-1" /> Loose
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
        <div className="flex gap-2 text-sm">
          <Button
            type="button"
            variant={mode === "split" ? "default" : "outline"}
            onClick={() => setMode("split")}
            size="sm"
          >
            Split across bins (recommended)
          </Button>
          <Button
            type="button"
            variant={mode === "whole" ? "default" : "outline"}
            onClick={() => setMode("whole")}
            size="sm"
          >
            Stow whole carton in 1 bin
          </Button>
        </div>
      ) : null}

      {mode === "whole" || !isMixed ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Scan destination bin</CardTitle>
            <CardDescription className="text-xs">
              {isMixed
                ? "All lines of this carton will be placed in the same bin (bin must be empty)."
                : "Single-SKU bin — must be empty or already hold the same SKU."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input
                value={wholeBin.binPath}
                onChange={(e) => onWholeBinChange(e.target.value)}
                placeholder="Scan or type bin path (e.g. NJ02-A-1-A-1-A1)"
                onKeyDown={(e) => {
                  if (e.key === "Enter") onResolveWholeBin();
                }}
                autoFocus
              />
              <Button onClick={onResolveWholeBin} disabled={wholeBin.loading}>
                {wholeBin.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
              </Button>
            </div>
            {wholeBin.error ? (
              <p className="text-xs text-red-600">{wholeBin.error}</p>
            ) : null}
            {wholeBin.resolved ? (
              <BinSummary resolved={wholeBin.resolved} />
            ) : null}
            {wholeBin.resolved && wholeValidations.length > 0 ? (
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
                      <span className="font-mono">{v.line.sku}</span> × {v.line.quantity}
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
          {linesPending.map((line) => {
            const slot = perLine[line.lineId];
            const err = slot?.resolved ? validatePerLine(line) : null;
            return (
              <Card
                key={line.lineId}
                className={cn(
                  line.condition === "damaged" && "border-red-200 bg-red-50/30"
                )}
              >
                <CardContent className="py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="text-sm">
                      <span className="font-mono font-semibold">{line.sku}</span> ×{" "}
                      {line.quantity}
                      {line.condition === "damaged" ? (
                        <Badge variant="outline" className="ml-2 bg-red-100 border-red-300 text-red-800">
                          Damaged → Quarantine
                        </Badge>
                      ) : null}
                      {line.lot ? (
                        <span className="text-xs text-muted-foreground ml-2">
                          Lot {line.lot}
                        </span>
                      ) : null}
                    </div>
                    {slot?.resolved ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => onClearPerLine(line.lineId)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    ) : null}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={slot?.binPath ?? ""}
                      onChange={(e) => onPerLineBinChange(line.lineId, e.target.value)}
                      placeholder="Scan or type bin path"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") onResolvePerLineBin(line.lineId);
                      }}
                    />
                    <Button
                      onClick={() => onResolvePerLineBin(line.lineId)}
                      disabled={slot?.loading}
                    >
                      {slot?.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Check"}
                    </Button>
                  </div>
                  {slot?.error ? (
                    <p className="text-xs text-red-600">{slot.error}</p>
                  ) : null}
                  {slot?.resolved ? (
                    <div className="space-y-1">
                      <BinSummary resolved={slot.resolved} />
                      {err ? (
                        <div className="flex items-start gap-1 rounded bg-red-50 text-red-800 border border-red-200 px-2 py-1 text-xs">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>{err}</span>
                        </div>
                      ) : (
                        <div className="flex items-start gap-1 rounded bg-green-50 text-green-800 border border-green-200 px-2 py-1 text-xs">
                          <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>OK — line will land in {slot.resolved.bin.path}</span>
                        </div>
                      )}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
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

function BinSummary({ resolved }: { resolved: ResolvedBin }) {
  const kind = classifyBin(resolved.bin);
  return (
    <div className="rounded border bg-muted/40 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center justify-between">
        <span className="font-mono font-medium">{resolved.bin.path}</span>
        <Badge
          variant="outline"
          className={cn(
            kind === "quarantine" && "bg-red-100 border-red-300 text-red-800",
            kind === "receiving_staging" && "bg-orange-100 border-orange-300 text-orange-800",
            kind === "normal" && "bg-blue-50 border-blue-300 text-blue-800"
          )}
        >
          {kind === "quarantine"
            ? "Quarantine"
            : kind === "receiving_staging"
            ? "Receiving staging"
            : "Storage"}
        </Badge>
      </div>
      {resolved.contents.cartonCount > 0 ? (
        <p className="text-muted-foreground">
          Currently holds {resolved.contents.cartonCount} carton
          {resolved.contents.cartonCount === 1 ? "" : "s"}
          {resolved.contents.skus.length > 0
            ? ` · SKUs: ${resolved.contents.skus.join(", ")}`
            : ""}
        </p>
      ) : (
        <p className="text-muted-foreground">Empty bin</p>
      )}
    </div>
  );
}
