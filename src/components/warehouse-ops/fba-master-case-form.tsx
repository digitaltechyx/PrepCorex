"use client";

import { useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2 } from "lucide-react";
import type {
  FbaDimensionUnit,
  FbaMasterCase,
  FbaPalletPack,
  FbaShipMode,
  FbaWeightUnit,
} from "@/types";
import { cn } from "@/lib/utils";

type LtlPalletDims = {
  id: string;
  palletNumber: number;
  weight: number;
  weightUnit: FbaWeightUnit;
  length: number;
  width: number;
  height: number;
  dimensionUnit: FbaDimensionUnit;
  notes?: string;
};

function emptyCase(caseNumber: number): FbaMasterCase {
  return {
    id: crypto.randomUUID(),
    caseNumber,
    weight: 0,
    weightUnit: "lb",
    length: 0,
    width: 0,
    height: 0,
    dimensionUnit: "in",
    notes: "",
  };
}

function emptyLtlPalletDims(palletNumber: number): LtlPalletDims {
  return {
    id: crypto.randomUUID(),
    palletNumber,
    weight: 0,
    weightUnit: "lb",
    length: 0,
    width: 0,
    height: 0,
    dimensionUnit: "in",
    notes: "",
  };
}

function buildFbaPalletsFromLtl(input: {
  count: number;
  allSameSize: boolean;
  shared: LtlPalletDims;
  individual: LtlPalletDims[];
}): FbaPalletPack[] {
  const count = Math.max(1, Math.floor(input.count) || 1);
  const sources: LtlPalletDims[] = input.allSameSize
    ? Array.from({ length: count }, (_, index) => ({
        ...input.shared,
        id: crypto.randomUUID(),
        palletNumber: index + 1,
      }))
    : input.individual.slice(0, count).map((pallet, index) => ({
        ...pallet,
        palletNumber: index + 1,
      }));

  return sources.map((pallet, index) => {
    const weight = Number(pallet.weight) || 0;
    return {
      id: crypto.randomUUID(),
      palletNumber: index + 1,
      boxCount: 1,
      allBoxesSameSize: true,
      boxGroups: [
        {
          id: crypto.randomUUID(),
          boxCount: 1,
          weight,
          weightUnit: pallet.weightUnit,
          length: Number(pallet.length) || 0,
          width: Number(pallet.width) || 0,
          height: Number(pallet.height) || 0,
          dimensionUnit: pallet.dimensionUnit,
        },
      ],
      palletTareWeight: 0,
      weightUnit: pallet.weightUnit,
      boxesWeight: weight,
      totalWeight: weight,
      ...(pallet.notes?.trim() ? { notes: pallet.notes.trim() } : {}),
    };
  });
}

function syncLtlPalletList(prev: LtlPalletDims[], count: number): LtlPalletDims[] {
  const n = Math.max(1, Math.floor(count) || 1);
  if (prev.length === n) {
    return prev.map((pallet, index) => ({ ...pallet, palletNumber: index + 1 }));
  }
  if (prev.length < n) {
    const extra = Array.from({ length: n - prev.length }, (_, offset) =>
      emptyLtlPalletDims(prev.length + offset + 1)
    );
    return [...prev, ...extra].map((pallet, index) => ({ ...pallet, palletNumber: index + 1 }));
  }
  return prev.slice(0, n).map((pallet, index) => ({ ...pallet, palletNumber: index + 1 }));
}

function LtlPalletDimsFields({
  dims,
  title,
  disabled,
  saving,
  onChange,
}: {
  dims: LtlPalletDims;
  title?: string;
  disabled?: boolean;
  saving?: boolean;
  onChange: (patch: Partial<LtlPalletDims>) => void;
}) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/20 p-2.5">
      {title ? <p className="text-xs font-semibold">{title}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Weight</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={dims.weight || ""}
            onChange={(e) => onChange({ weight: parseFloat(e.target.value) || 0 })}
            disabled={disabled || saving}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Weight unit</Label>
          <Select
            value={dims.weightUnit}
            onValueChange={(value: FbaWeightUnit) => onChange({ weightUnit: value })}
            disabled={disabled || saving}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="lb">lb</SelectItem>
              <SelectItem value="kg">kg</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {(["length", "width", "height"] as const).map((field) => (
          <div key={field} className="space-y-1.5">
            <Label className="text-xs capitalize">{field}</Label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={dims[field] || ""}
              onChange={(e) => onChange({ [field]: parseFloat(e.target.value) || 0 })}
              disabled={disabled || saving}
            />
          </div>
        ))}
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs">Dimension unit</Label>
        <Select
          value={dims.dimensionUnit}
          onValueChange={(value: FbaDimensionUnit) => onChange({ dimensionUnit: value })}
          disabled={disabled || saving}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="in">in</SelectItem>
            <SelectItem value="cm">cm</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export type FbaPackDimsSubmitPayload = {
  shipMode: FbaShipMode;
  masterCases: FbaMasterCase[];
  pallets: FbaPalletPack[];
};

type Props = {
  disabled?: boolean;
  /** Prefer from outbound shipmentPreference: box → spd, pallet → ltl */
  initialShipMode?: FbaShipMode;
  onSubmit: (payload: FbaPackDimsSubmitPayload) => Promise<void>;
};

export function FbaPackDimsForm({ disabled, initialShipMode = "spd", onSubmit }: Props) {
  const [shipMode, setShipMode] = useState<FbaShipMode>(initialShipMode);
  const [cases, setCases] = useState<FbaMasterCase[]>([emptyCase(1)]);
  const [ltlPalletCount, setLtlPalletCount] = useState(1);
  const [ltlAllSameSize, setLtlAllSameSize] = useState(true);
  const [ltlSharedDims, setLtlSharedDims] = useState<LtlPalletDims>(() => emptyLtlPalletDims(1));
  const [ltlPalletDims, setLtlPalletDims] = useState<LtlPalletDims[]>(() => [emptyLtlPalletDims(1)]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateCase = (id: string, patch: Partial<FbaMasterCase>) => {
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  };

  const addCase = () => {
    setCases((prev) => [...prev, emptyCase(prev.length + 1)]);
  };

  const removeCase = (id: string) => {
    setCases((prev) =>
      prev
        .filter((c) => c.id !== id)
        .map((c, index) => ({ ...c, caseNumber: index + 1 }))
    );
  };

  const changeLtlPalletCount = (count: number) => {
    const n = Math.max(1, Math.floor(count) || 1);
    setLtlPalletCount(n);
    setLtlPalletDims((prev) => syncLtlPalletList(prev, n));
  };

  const updateLtlPallet = (id: string, patch: Partial<LtlPalletDims>) => {
    setLtlPalletDims((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const ltlTotals = useMemo(() => {
    const sources = ltlAllSameSize
      ? Array.from({ length: ltlPalletCount }, () => ltlSharedDims)
      : ltlPalletDims.slice(0, ltlPalletCount);
    const weight = sources.reduce((sum, pallet) => sum + (Number(pallet.weight) || 0), 0);
    return { pallets: ltlPalletCount, weight };
  }, [ltlAllSameSize, ltlPalletCount, ltlSharedDims, ltlPalletDims]);

  const handleSubmit = async () => {
    setError(null);
    try {
      if (shipMode === "spd") {
        const cleaned = cases.map((c, index) => {
          const notes = c.notes?.trim() || "";
          return {
            id: c.id,
            caseNumber: index + 1,
            weight: Number(c.weight) || 0,
            weightUnit: c.weightUnit,
            length: Number(c.length) || 0,
            width: Number(c.width) || 0,
            height: Number(c.height) || 0,
            dimensionUnit: c.dimensionUnit,
            ...(notes ? { notes } : {}),
          };
        });
        for (const c of cleaned) {
          if (c.weight <= 0 || c.length <= 0 || c.width <= 0 || c.height <= 0) {
            throw new Error(`Master case ${c.caseNumber} needs weight and all dimensions.`);
          }
        }
        setSaving(true);
        await onSubmit({ shipMode: "spd", masterCases: cleaned, pallets: [] });
        return;
      }

      const count = Math.max(1, Math.floor(ltlPalletCount) || 1);
      const cleanedPallets = buildFbaPalletsFromLtl({
        count,
        allSameSize: ltlAllSameSize,
        shared: ltlSharedDims,
        individual: ltlPalletDims,
      });

      for (const pallet of cleanedPallets) {
        const group = pallet.boxGroups[0];
        if (
          !group ||
          group.weight <= 0 ||
          group.length <= 0 ||
          group.width <= 0 ||
          group.height <= 0
        ) {
          throw new Error(
            ltlAllSameSize
              ? "Enter weight and all pallet dimensions (L × W × H)."
              : `Pallet ${pallet.palletNumber} needs weight and all dimensions (L × W × H).`
          );
        }
      }

      setSaving(true);
      await onSubmit({ shipMode: "ltl", masterCases: [], pallets: cleanedPallets });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save pack dimensions.");
      throw e;
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label className="text-xs font-semibold">Ship mode</Label>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={shipMode === "spd" ? "default" : "outline"}
            className={cn(shipMode === "spd" && "bg-violet-600 hover:bg-violet-700")}
            disabled={disabled || saving}
            onClick={() => setShipMode("spd")}
          >
            SPD — master cases
          </Button>
          <Button
            type="button"
            variant={shipMode === "ltl" ? "default" : "outline"}
            className={cn(shipMode === "ltl" && "bg-violet-600 hover:bg-violet-700")}
            disabled={disabled || saving}
            onClick={() => setShipMode("ltl")}
          >
            LTL — pallet(s)
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {shipMode === "spd"
            ? "Small parcel: add one or more master cases with dimensions and weight."
            : "Freight pallet: enter number of pallets, then weight and dimensions (L × W × H)."}
        </p>
      </div>

      {shipMode === "spd" ? (
        <>
          {cases.map((masterCase) => (
            <div key={masterCase.id} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold">Master case {masterCase.caseNumber}</p>
                {cases.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeCase(masterCase.id)}
                    disabled={disabled || saving}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Weight</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={masterCase.weight || ""}
                    onChange={(e) =>
                      updateCase(masterCase.id, { weight: parseFloat(e.target.value) || 0 })
                    }
                    disabled={disabled || saving}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Weight unit</Label>
                  <Select
                    value={masterCase.weightUnit}
                    onValueChange={(value: FbaWeightUnit) =>
                      updateCase(masterCase.id, { weightUnit: value })
                    }
                    disabled={disabled || saving}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="lb">lb</SelectItem>
                      <SelectItem value="kg">kg</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                {(["length", "width", "height"] as const).map((field) => (
                  <div key={field} className="space-y-1.5">
                    <Label className="text-xs capitalize">{field}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={masterCase[field] || ""}
                      onChange={(e) =>
                        updateCase(masterCase.id, {
                          [field]: parseFloat(e.target.value) || 0,
                        })
                      }
                      disabled={disabled || saving}
                    />
                  </div>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Dimension unit</Label>
                <Select
                  value={masterCase.dimensionUnit}
                  onValueChange={(value: FbaDimensionUnit) =>
                    updateCase(masterCase.id, { dimensionUnit: value })
                  }
                  disabled={disabled || saving}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="in">in</SelectItem>
                    <SelectItem value="cm">cm</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea
                  rows={2}
                  value={masterCase.notes || ""}
                  onChange={(e) => updateCase(masterCase.id, { notes: e.target.value })}
                  placeholder="Label instructions, fragile, mixed SKU notes…"
                  disabled={disabled || saving}
                />
              </div>
            </div>
          ))}

          <Button type="button" variant="outline" onClick={addCase} disabled={disabled || saving}>
            <Plus className="mr-2 h-4 w-4" />
            Add master case
          </Button>
        </>
      ) : (
        <div className="space-y-3 rounded-lg border border-violet-200 p-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Number of pallets</Label>
            <Input
              type="number"
              min="1"
              step="1"
              value={ltlPalletCount || ""}
              onChange={(e) =>
                changeLtlPalletCount(Math.max(1, parseInt(e.target.value || "1", 10) || 1))
              }
              disabled={disabled || saving}
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs">Do all pallets have the same dimensions?</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant={ltlAllSameSize ? "default" : "outline"}
                disabled={disabled || saving}
                onClick={() => setLtlAllSameSize(true)}
              >
                Yes — same size
              </Button>
              <Button
                type="button"
                size="sm"
                variant={!ltlAllSameSize ? "default" : "outline"}
                disabled={disabled || saving}
                onClick={() => setLtlAllSameSize(false)}
              >
                No — different sizes
              </Button>
            </div>
          </div>

          {ltlAllSameSize ? (
            <LtlPalletDimsFields
              dims={ltlSharedDims}
              title={`Pallet size (all ${ltlPalletCount} pallet${ltlPalletCount === 1 ? "" : "s"})`}
              disabled={disabled}
              saving={saving}
              onChange={(patch) => setLtlSharedDims((prev) => ({ ...prev, ...patch }))}
            />
          ) : (
            ltlPalletDims.slice(0, ltlPalletCount).map((pallet) => (
              <div key={pallet.id} className="space-y-2">
                <LtlPalletDimsFields
                  dims={pallet}
                  title={`Pallet ${pallet.palletNumber}`}
                  disabled={disabled}
                  saving={saving}
                  onChange={(patch) => updateLtlPallet(pallet.id, patch)}
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Textarea
                    rows={2}
                    value={pallet.notes || ""}
                    onChange={(e) => updateLtlPallet(pallet.id, { notes: e.target.value })}
                    disabled={disabled || saving}
                  />
                </div>
              </div>
            ))
          )}

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Shipment totals: {ltlTotals.pallets} pallet{ltlTotals.pallets === 1 ? "" : "s"} ·{" "}
            {ltlTotals.weight.toFixed(2)} {ltlAllSameSize ? ltlSharedDims.weightUnit : "lb"} combined
          </div>
        </div>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <Button
        type="button"
        className="w-full"
        disabled={disabled || saving}
        onClick={() => {
          void handleSubmit().catch(() => {
            /* error state already set */
          });
        }}
      >
        {saving ? "Saving…" : "Send details to client"}
      </Button>
    </div>
  );
}

/** @deprecated Use FbaPackDimsForm — kept for import compatibility. */
export function FbaMasterCaseForm({
  disabled,
  onSubmit,
}: {
  disabled?: boolean;
  onSubmit: (cases: FbaMasterCase[]) => Promise<void>;
}) {
  return (
    <FbaPackDimsForm
      disabled={disabled}
      initialShipMode="spd"
      onSubmit={async (payload) => {
        await onSubmit(payload.masterCases);
      }}
    />
  );
}
