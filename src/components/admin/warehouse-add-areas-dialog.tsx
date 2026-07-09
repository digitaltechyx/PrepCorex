"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2 } from "lucide-react";
import type { WarehouseAreaDoc, WarehouseDoc } from "@/types";
import { suggestNextAreaCodes } from "@/lib/warehouse-area-code-generator";
import {
  DEFAULT_WAREHOUSE_PURPOSE_SUGGESTIONS,
  mergePurposeOptions,
  normalizePurposeLabel,
} from "@/lib/warehouse-area-purposes";
import {
  countBinSlotsInFlexibleLayout,
  sampleFlexibleBinPath,
  type FlexibleShelvingConfig,
} from "@/lib/warehouse-storage-layout";
import { isValidPathSegment } from "@/lib/warehouse-bin-path";
import {
  createWarehouseArea,
  generateWarehouseBinsFromFlexibleLayout,
} from "@/lib/warehouse-firestore";

export type AreaDraftRow = {
  key: string;
  code: string;
  codeTouched: boolean;
  name: string;
  purpose: string;
  addShelving: boolean;
  useRows: boolean;
  rowCount: string;
  useBays: boolean;
  bayCount: string;
  useLevels: boolean;
  levelCount: string;
  binCount: string;
};

function newDraftRow(partial?: Partial<AreaDraftRow>): AreaDraftRow {
  return {
    key: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `row-${Date.now()}-${Math.random()}`,
    code: "",
    codeTouched: false,
    name: "",
    purpose: "Storage",
    addShelving: false,
    useRows: false,
    rowCount: "1",
    useBays: false,
    bayCount: "3",
    useLevels: false,
    levelCount: "4",
    binCount: "3",
    ...partial,
  };
}

function parseCount(raw: string, label: string, min: number, max: number): number {
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

function rowToShelvingConfig(row: AreaDraftRow): FlexibleShelvingConfig {
  return {
    useRows: row.useRows,
    rowCount: parseCount(row.rowCount, "Row count", 1, 999),
    useBays: row.useBays,
    bayCount: parseCount(row.bayCount, "Bay count", 1, 99),
    useLevels: row.useLevels,
    levelCount: parseCount(row.levelCount, "Level count", 1, 99),
    binCount: parseCount(row.binCount, "Bin count", 1, 999),
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: WarehouseDoc | null;
  existingAreas: WarehouseAreaDoc[];
  onAddCustomPurpose?: (label: string) => Promise<void>;
  onCreated?: (summary: { areasCreated: number; binsCreated: number; binsSkipped: number }) => void;
};

export function WarehouseAddAreasDialog({
  open,
  onOpenChange,
  warehouse,
  existingAreas,
  onAddCustomPurpose,
  onCreated,
}: Props) {
  const [areaCountStr, setAreaCountStr] = useState("1");
  const [rows, setRows] = useState<AreaDraftRow[]>([newDraftRow()]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const purposeOptions = useMemo(
    () =>
      mergePurposeOptions(
        warehouse?.customPurposes,
        existingAreas.map((a) => (Array.isArray(a.purposes) ? a.purposes : []))
      ),
    [warehouse?.customPurposes, existingAreas]
  );

  const existingCodes = useMemo(
    () => existingAreas.map((a) => a.code).filter(Boolean),
    [existingAreas]
  );

  const reservedCodesInForm = useMemo(
    () => rows.map((r) => r.code.trim().toUpperCase()).filter(Boolean),
    [rows]
  );

  useEffect(() => {
    if (!open) return;
    setAreaCountStr("1");
    setRows([newDraftRow()]);
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const count = Number.parseInt(areaCountStr, 10);
    if (!Number.isFinite(count) || count < 1 || count > 99) return;

    setRows((prev) => {
      const next = [...prev];
      while (next.length < count) next.push(newDraftRow());
      while (next.length > count) next.pop();

      const used = new Set([
        ...existingCodes.map((c) => c.trim().toUpperCase()),
        ...next.filter((r) => r.codeTouched && r.code.trim()).map((r) => r.code.trim().toUpperCase()),
      ]);
      const untouchedCount = next.filter((r) => !r.codeTouched || !r.code.trim()).length;
      const autoCodes = suggestNextAreaCodes([...used], untouchedCount || count);
      let autoIdx = 0;
      return next.map((row) => {
        if (row.codeTouched && row.code.trim()) return row;
        const code = autoCodes[autoIdx++] ?? row.code;
        return { ...row, code };
      });
    });
  }, [open, areaCountStr, existingCodes]);

  const preview = useMemo(() => {
    if (!warehouse) return { totalBins: 0, samples: [] as string[] };
    let totalBins = 0;
    const samples: string[] = [];
    for (const row of rows) {
      if (!row.addShelving) continue;
      try {
        const cfg = rowToShelvingConfig(row);
        totalBins += countBinSlotsInFlexibleLayout(cfg);
        if (samples.length < 3 && row.code.trim()) {
          const sample = sampleFlexibleBinPath(warehouse.code, row.code.trim(), cfg);
          if (sample) samples.push(sample);
        }
      } catch {
        // invalid partial input
      }
    }
    return { totalBins, samples };
  }, [rows, warehouse]);

  const updateRow = (key: string, patch: Partial<AreaDraftRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const validate = (): string | null => {
    if (!warehouse) return "Select a warehouse first.";
    const codes = new Set<string>();
    for (const row of rows) {
      const code = row.code.trim().toUpperCase();
      if (!code || !isValidPathSegment(code)) {
        return `Area code "${row.code || "?"}" is invalid — use letters and numbers only.`;
      }
      if (codes.has(code)) return `Duplicate area code "${code}".`;
      codes.add(code);
      if (existingCodes.some((c) => c.trim().toUpperCase() === code)) {
        return `Area code "${code}" already exists in this warehouse.`;
      }
      const purpose = normalizePurposeLabel(row.purpose);
      if (!purpose) return `Select a purpose for area ${code}.`;
      if (row.addShelving) {
        try {
          rowToShelvingConfig(row);
        } catch (e: unknown) {
          return e instanceof Error ? e.message : String(e);
        }
      }
    }
    if (preview.totalBins > 25_000) {
      return `Too many bins (${preview.totalBins.toLocaleString()}). Maximum is 25,000 per run.`;
    }
    return null;
  };

  const handleCreate = async () => {
    if (!warehouse || saving) return;
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      let areasCreated = 0;
      let binsCreated = 0;
      let binsSkipped = 0;

      for (const row of rows) {
        const code = row.code.trim().toUpperCase();
        const purpose = normalizePurposeLabel(row.purpose);
        const areaId = await createWarehouseArea(warehouse.id, {
          code,
          name: row.name.trim(),
          purposes: [purpose],
        });
        areasCreated += 1;

        if (row.addShelving) {
          const layoutBlockId =
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `block-${Date.now()}`;
          const res = await generateWarehouseBinsFromFlexibleLayout({
            warehouseId: warehouse.id,
            warehouseCode: warehouse.code,
            storageAreaId: areaId,
            shelving: rowToShelvingConfig(row),
            layoutBlockId,
          });
          binsCreated += res.created;
          binsSkipped += res.skipped;
        }
      }

      onCreated?.({ areasCreated, binsCreated, binsSkipped });
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[92vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Add areas</DialogTitle>
          <DialogDescription>
            Set up one or more areas on a single page. Codes are assigned A, B, C… automatically. Enable only the
            shelving tiers you need — bins can exist without rows, bays, or levels.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 overflow-y-auto min-h-0 flex-1">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="area-count">How many areas?</Label>
              <Input
                id="area-count"
                inputMode="numeric"
                className="w-24"
                value={areaCountStr}
                onChange={(e) => setAreaCountStr(e.target.value.replace(/[^\d]/g, "").slice(0, 2))}
              />
            </div>
            <p className="text-xs text-muted-foreground pb-2">
              Next codes:{" "}
              <span className="font-mono">
                {suggestNextAreaCodes([...existingCodes, ...reservedCodesInForm], Math.min(rows.length || 1, 5)).join(", ")}
                {rows.length > 5 ? "…" : ""}
              </span>
            </p>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead className="w-20">Code</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="min-w-[140px]">Purpose</TableHead>
                  <TableHead className="w-24 text-center">Shelving</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row, index) => (
                  <TableRow key={row.key}>
                    <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                    <TableCell>
                      <Input
                        className="font-mono h-8"
                        value={row.code}
                        onChange={(e) =>
                          updateRow(row.key, {
                            code: e.target.value.toUpperCase(),
                            codeTouched: true,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Input
                        className="h-8"
                        value={row.name}
                        onChange={(e) => updateRow(row.key, { name: e.target.value })}
                        placeholder="Optional label"
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={row.purpose}
                        onValueChange={(v) => updateRow(row.key, { purpose: v })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue placeholder="Purpose" />
                        </SelectTrigger>
                        <SelectContent>
                          {purposeOptions.map((p) => (
                            <SelectItem key={p} value={p}>
                              {p}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={row.addShelving}
                        onCheckedChange={(v) => updateRow(row.key, { addShelving: v === true })}
                        aria-label={`Add shelving for area ${row.code}`}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {rows.some((r) => r.addShelving) ? (
            <div className="space-y-4">
              <h4 className="text-sm font-medium">Shelving layout</h4>
              {rows
                .filter((r) => r.addShelving)
                .map((row) => (
                  <div key={`shelf-${row.key}`} className="rounded-lg border bg-muted/20 p-4 space-y-3">
                    <p className="text-sm font-medium">
                      Area <span className="font-mono">{row.code || "—"}</span>
                      {row.name.trim() ? ` — ${row.name.trim()}` : ""}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                      <div className="space-y-2 rounded-md border bg-background p-3">
                        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                          <Checkbox
                            checked={row.useRows}
                            onCheckedChange={(v) => updateRow(row.key, { useRows: v === true })}
                          />
                          Rows
                        </label>
                        <Input
                          inputMode="numeric"
                          disabled={!row.useRows}
                          value={row.rowCount}
                          onChange={(e) => updateRow(row.key, { rowCount: e.target.value })}
                          placeholder="Count"
                        />
                      </div>
                      <div className="space-y-2 rounded-md border bg-background p-3">
                        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                          <Checkbox
                            checked={row.useBays}
                            onCheckedChange={(v) =>
                              updateRow(row.key, {
                                useBays: v === true,
                                useLevels: v === true ? row.useLevels : false,
                              })
                            }
                          />
                          Bays
                        </label>
                        <Input
                          inputMode="numeric"
                          disabled={!row.useBays}
                          value={row.bayCount}
                          onChange={(e) => updateRow(row.key, { bayCount: e.target.value })}
                          placeholder="Count"
                        />
                      </div>
                      <div className="space-y-2 rounded-md border bg-background p-3">
                        <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                          <Checkbox
                            checked={row.useLevels}
                            disabled={!row.useBays}
                            onCheckedChange={(v) => updateRow(row.key, { useLevels: v === true })}
                          />
                          Levels
                        </label>
                        <Input
                          inputMode="numeric"
                          disabled={!row.useBays || !row.useLevels}
                          value={row.levelCount}
                          onChange={(e) => updateRow(row.key, { levelCount: e.target.value })}
                          placeholder="Count"
                        />
                        {!row.useBays ? (
                          <p className="text-xs text-muted-foreground">Requires bays</p>
                        ) : null}
                      </div>
                      <div className="space-y-2 rounded-md border bg-background p-3">
                        <Label className="text-sm font-medium">Bins</Label>
                        <Input
                          inputMode="numeric"
                          value={row.binCount}
                          onChange={(e) => updateRow(row.key, { binCount: e.target.value })}
                          placeholder="Per slot group"
                        />
                        <p className="text-xs text-muted-foreground">Always available — can stand alone</p>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ) : null}

          {(preview.totalBins > 0 || preview.samples.length > 0) && (
            <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Estimated new bins:</span>{" "}
                <strong>{preview.totalBins.toLocaleString()}</strong>
              </p>
              {preview.samples.map((s) => (
                <p key={s} className="text-xs font-mono text-muted-foreground break-all">
                  Sample: {s}
                </p>
              ))}
              {preview.totalBins > 25_000 ? (
                <p className="text-amber-800 dark:text-amber-200 text-xs">
                  Over the 25,000 limit — reduce counts before creating.
                </p>
              ) : null}
            </div>
          )}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !warehouse || preview.totalBins > 25_000}
            onClick={() => void handleCreate()}
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              `Create ${rows.length} area${rows.length === 1 ? "" : "s"}${preview.totalBins ? " & bins" : ""}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { DEFAULT_WAREHOUSE_PURPOSE_SUGGESTIONS };