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
import {
  DEFAULT_FBA_PALLET_TARE_LB,
  computePalletWeights,
} from "@/lib/fba-shipment-workflow";
import type {
  FbaBoxSizeGroup,
  FbaDimensionUnit,
  FbaMasterCase,
  FbaPalletPack,
  FbaShipMode,
  FbaWeightUnit,
} from "@/types";
import { cn } from "@/lib/utils";

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

function emptyBoxGroup(): FbaBoxSizeGroup {
  return {
    id: crypto.randomUUID(),
    boxCount: 1,
    weight: 0,
    weightUnit: "lb",
    length: 0,
    width: 0,
    height: 0,
    dimensionUnit: "in",
  };
}

function emptyPallet(palletNumber: number): FbaPalletPack {
  return {
    id: crypto.randomUUID(),
    palletNumber,
    boxCount: 1,
    allBoxesSameSize: true,
    boxGroups: [emptyBoxGroup()],
    palletTareWeight: DEFAULT_FBA_PALLET_TARE_LB,
    weightUnit: "lb",
    boxesWeight: 0,
    totalWeight: DEFAULT_FBA_PALLET_TARE_LB,
    notes: "",
  };
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
  const [pallets, setPallets] = useState<FbaPalletPack[]>([emptyPallet(1)]);
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

  const recomputePallet = (pallet: FbaPalletPack): FbaPalletPack => {
    const boxGroups =
      pallet.allBoxesSameSize && pallet.boxGroups[0]
        ? [{ ...pallet.boxGroups[0], boxCount: pallet.boxCount || pallet.boxGroups[0].boxCount || 1 }]
        : pallet.boxGroups;
    const weights = computePalletWeights({
      palletTareWeight: pallet.palletTareWeight,
      boxGroups,
    });
    return { ...pallet, boxGroups, ...weights };
  };

  const updatePallet = (id: string, patch: Partial<FbaPalletPack>) => {
    setPallets((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;
        let next = { ...p, ...patch };
        if (patch.allBoxesSameSize === true && next.boxGroups.length > 1) {
          const first = next.boxGroups[0] ?? emptyBoxGroup();
          next = {
            ...next,
            boxGroups: [{ ...first, boxCount: next.boxCount || first.boxCount || 1 }],
          };
        }
        if (patch.boxCount != null && next.allBoxesSameSize && next.boxGroups[0]) {
          next = {
            ...next,
            boxGroups: [{ ...next.boxGroups[0], boxCount: patch.boxCount }],
          };
        }
        return recomputePallet(next);
      })
    );
  };

  const updatePalletGroup = (
    palletId: string,
    groupId: string,
    patch: Partial<FbaBoxSizeGroup>
  ) => {
    setPallets((prev) =>
      prev.map((p) => {
        if (p.id !== palletId) return p;
        const boxGroups = p.boxGroups.map((g) => (g.id === groupId ? { ...g, ...patch } : g));
        return recomputePallet({ ...p, boxGroups });
      })
    );
  };

  const addPallet = () => {
    setPallets((prev) => [...prev, emptyPallet(prev.length + 1)]);
  };

  const removePallet = (id: string) => {
    setPallets((prev) =>
      prev
        .filter((p) => p.id !== id)
        .map((p, index) => ({ ...p, palletNumber: index + 1 }))
    );
  };

  const addBoxGroup = (palletId: string) => {
    setPallets((prev) =>
      prev.map((p) => {
        if (p.id !== palletId) return p;
        return recomputePallet({
          ...p,
          allBoxesSameSize: false,
          boxGroups: [...p.boxGroups, emptyBoxGroup()],
        });
      })
    );
  };

  const removeBoxGroup = (palletId: string, groupId: string) => {
    setPallets((prev) =>
      prev.map((p) => {
        if (p.id !== palletId) return p;
        const boxGroups = p.boxGroups.filter((g) => g.id !== groupId);
        return recomputePallet({
          ...p,
          boxGroups: boxGroups.length > 0 ? boxGroups : [emptyBoxGroup()],
        });
      })
    );
  };

  const ltlTotals = useMemo(() => {
    const boxes = pallets.reduce((s, p) => s + (Number(p.boxCount) || 0), 0);
    const weight = pallets.reduce((s, p) => s + (Number(p.totalWeight) || 0), 0);
    return { boxes, weight };
  }, [pallets]);

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

      const cleanedPallets = pallets.map((p, index) => {
        const boxCount = Math.max(0, Math.floor(Number(p.boxCount) || 0));
        const boxGroups = p.boxGroups.map((g) => ({
          id: g.id,
          // Keep same-size group count in sync with pallet box count for Firestore + totals.
          boxCount: p.allBoxesSameSize
            ? boxCount
            : Math.max(0, Math.floor(Number(g.boxCount) || 0)),
          weight: Number(g.weight) || 0,
          weightUnit: g.weightUnit,
          length: Number(g.length) || 0,
          width: Number(g.width) || 0,
          height: Number(g.height) || 0,
          dimensionUnit: g.dimensionUnit,
        }));
        const palletTareWeight = Number(p.palletTareWeight);
        const tare =
          Number.isFinite(palletTareWeight) && palletTareWeight >= 0
            ? palletTareWeight
            : DEFAULT_FBA_PALLET_TARE_LB;
        const weights = computePalletWeights({ palletTareWeight: tare, boxGroups });
        const notes = p.notes?.trim() || "";
        return {
          id: p.id,
          palletNumber: index + 1,
          boxCount,
          allBoxesSameSize: p.allBoxesSameSize,
          boxGroups,
          palletTareWeight: tare,
          weightUnit: p.weightUnit,
          ...weights,
          ...(notes ? { notes } : {}),
        };
      });

      for (const pallet of cleanedPallets) {
        if (pallet.boxCount <= 0) {
          throw new Error(`Pallet ${pallet.palletNumber}: enter how many boxes are on the pallet.`);
        }
        const groupSum = pallet.boxGroups.reduce((s, g) => s + g.boxCount, 0);
        if (groupSum !== pallet.boxCount) {
          throw new Error(
            `Pallet ${pallet.palletNumber}: size groups add to ${groupSum} boxes, but pallet has ${pallet.boxCount}.`
          );
        }
        for (const [gi, group] of pallet.boxGroups.entries()) {
          if (
            group.boxCount <= 0 ||
            group.weight <= 0 ||
            group.length <= 0 ||
            group.width <= 0 ||
            group.height <= 0
          ) {
            throw new Error(
              `Pallet ${pallet.palletNumber}, group ${gi + 1}: needs box count, weight, and all dimensions.`
            );
          }
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
            : "Freight pallet: enter pallets, box counts, and size groups. Default pallet tare is 50 lb."}
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
        <>
          {pallets.map((pallet) => {
            const groupSum = pallet.boxGroups.reduce((s, g) => s + (Number(g.boxCount) || 0), 0);
            const groupsMatch = groupSum === pallet.boxCount;
            return (
              <div key={pallet.id} className="space-y-3 rounded-lg border border-violet-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold">Pallet {pallet.palletNumber}</p>
                  {pallets.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-destructive"
                      onClick={() => removePallet(pallet.id)}
                      disabled={disabled || saving}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Boxes on this pallet</Label>
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={pallet.boxCount || ""}
                      onChange={(e) =>
                        updatePallet(pallet.id, {
                          boxCount: Math.max(0, parseInt(e.target.value || "0", 10) || 0),
                        })
                      }
                      disabled={disabled || saving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Pallet tare weight (default 50)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="0.01"
                      value={pallet.palletTareWeight || ""}
                      onChange={(e) =>
                        updatePallet(pallet.id, {
                          palletTareWeight: parseFloat(e.target.value) || 0,
                        })
                      }
                      disabled={disabled || saving}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-xs">Do all boxes have the same dimensions?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={pallet.allBoxesSameSize ? "default" : "outline"}
                      disabled={disabled || saving}
                      onClick={() => updatePallet(pallet.id, { allBoxesSameSize: true })}
                    >
                      Yes — same size
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={!pallet.allBoxesSameSize ? "default" : "outline"}
                      disabled={disabled || saving}
                      onClick={() => updatePallet(pallet.id, { allBoxesSameSize: false })}
                    >
                      No — size groups
                    </Button>
                  </div>
                </div>

                {pallet.boxGroups.map((group, groupIndex) => (
                  <div key={group.id} className="space-y-2 rounded-md border bg-muted/20 p-2.5">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold">
                        {pallet.allBoxesSameSize
                          ? "Box size (all boxes)"
                          : `Size group ${groupIndex + 1}`}
                      </p>
                      {!pallet.allBoxesSameSize && pallet.boxGroups.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive"
                          onClick={() => removeBoxGroup(pallet.id, group.id)}
                          disabled={disabled || saving}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : null}
                    </div>

                    {!pallet.allBoxesSameSize ? (
                      <div className="space-y-1.5">
                        <Label className="text-xs">How many boxes in this group?</Label>
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={group.boxCount || ""}
                          onChange={(e) =>
                            updatePalletGroup(pallet.id, group.id, {
                              boxCount: Math.max(0, parseInt(e.target.value || "0", 10) || 0),
                            })
                          }
                          disabled={disabled || saving}
                        />
                      </div>
                    ) : null}

                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Weight per box</Label>
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={group.weight || ""}
                          onChange={(e) =>
                            updatePalletGroup(pallet.id, group.id, {
                              weight: parseFloat(e.target.value) || 0,
                            })
                          }
                          disabled={disabled || saving}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Weight unit</Label>
                        <Select
                          value={group.weightUnit}
                          onValueChange={(value: FbaWeightUnit) =>
                            updatePalletGroup(pallet.id, group.id, { weightUnit: value })
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

                    <div className="grid grid-cols-3 gap-2">
                      {(["length", "width", "height"] as const).map((field) => (
                        <div key={field} className="space-y-1.5">
                          <Label className="text-xs capitalize">{field}</Label>
                          <Input
                            type="number"
                            min="0"
                            step="0.01"
                            value={group[field] || ""}
                            onChange={(e) =>
                              updatePalletGroup(pallet.id, group.id, {
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
                        value={group.dimensionUnit}
                        onValueChange={(value: FbaDimensionUnit) =>
                          updatePalletGroup(pallet.id, group.id, { dimensionUnit: value })
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
                  </div>
                ))}

                {!pallet.allBoxesSameSize ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => addBoxGroup(pallet.id)}
                    disabled={disabled || saving}
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" />
                    Add size group (e.g. 5 same, then 3 same)
                  </Button>
                ) : null}

                <div
                  className={cn(
                    "rounded-md border px-3 py-2 text-xs",
                    groupsMatch
                      ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                      : "border-amber-200 bg-amber-50 text-amber-900"
                  )}
                >
                  <p>
                    Groups total <strong>{groupSum}</strong> / pallet boxes{" "}
                    <strong>{pallet.boxCount}</strong>
                    {!groupsMatch ? " — must match before send" : ""}
                  </p>
                  <p className="mt-1">
                    Weight: tare {pallet.palletTareWeight} + boxes {pallet.boxesWeight} ={" "}
                    <strong>
                      {pallet.totalWeight} {pallet.weightUnit}
                    </strong>
                  </p>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Textarea
                    rows={2}
                    value={pallet.notes || ""}
                    onChange={(e) => updatePallet(pallet.id, { notes: e.target.value })}
                    disabled={disabled || saving}
                  />
                </div>
              </div>
            );
          })}

          <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            Shipment totals: {pallets.length} pallet{pallets.length === 1 ? "" : "s"} ·{" "}
            {ltlTotals.boxes} boxes · {ltlTotals.weight.toFixed(2)} lb combined
          </div>

          <Button type="button" variant="outline" onClick={addPallet} disabled={disabled || saving}>
            <Plus className="mr-2 h-4 w-4" />
            Add pallet
          </Button>
        </>
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
