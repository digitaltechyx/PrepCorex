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
import { Loader2 } from "lucide-react";
import type { WarehouseAreaDoc, WarehouseDoc } from "@/types";
import {
  countBinSlotsInFlexibleLayout,
  sampleFlexibleBinPath,
  type FlexibleShelvingConfig,
} from "@/lib/warehouse-storage-layout";
import { generateWarehouseBinsFromFlexibleLayout } from "@/lib/warehouse-firestore";

function ShelvingTierCell({
  label,
  checked,
  onCheckedChange,
  count,
  onCountChange,
  countDisabled,
  checkboxDisabled,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  count: string;
  onCountChange: (v: string) => void;
  countDisabled?: boolean;
  checkboxDisabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-2" title={label}>
      <Checkbox
        checked={checked}
        disabled={checkboxDisabled}
        onCheckedChange={(v) => onCheckedChange(v === true)}
        aria-label={label}
        className="shrink-0"
      />
      <Label className="text-sm font-normal w-14 shrink-0">{label}</Label>
      <Input
        inputMode="numeric"
        className="h-8 w-20"
        disabled={countDisabled || !checked}
        value={count}
        onChange={(e) => onCountChange(e.target.value)}
        aria-label={`${label} count`}
      />
    </div>
  );
}

function parseCount(raw: string, label: string, min: number, max: number): number {
  const n = Number.parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new Error(`${label} must be a whole number between ${min} and ${max}.`);
  }
  return n;
}

function formToShelvingConfig(form: {
  useRows: boolean;
  rowCount: string;
  useBays: boolean;
  bayCount: string;
  useLevels: boolean;
  levelCount: string;
  binCount: string;
}): FlexibleShelvingConfig {
  return {
    useRows: form.useRows,
    rowCount: parseCount(form.rowCount, "Row count", 1, 999),
    useBays: form.useBays,
    bayCount: parseCount(form.bayCount, "Bay count", 1, 99),
    useLevels: form.useLevels,
    levelCount: parseCount(form.levelCount, "Level count", 1, 99),
    binCount: parseCount(form.binCount, "Bin count", 1, 999),
  };
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: WarehouseDoc | null;
  area: WarehouseAreaDoc | null;
  onCreated?: (summary: { binsCreated: number; binsSkipped: number }) => void;
};

export function WarehouseExtendShelvingDialog({
  open,
  onOpenChange,
  warehouse,
  area,
  onCreated,
}: Props) {
  const [useRows, setUseRows] = useState(false);
  const [rowCount, setRowCount] = useState("1");
  const [useBays, setUseBays] = useState(false);
  const [bayCount, setBayCount] = useState("3");
  const [useLevels, setUseLevels] = useState(false);
  const [levelCount, setLevelCount] = useState("4");
  const [binCount, setBinCount] = useState("3");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setUseRows(false);
    setRowCount("1");
    setUseBays(false);
    setBayCount("3");
    setUseLevels(false);
    setLevelCount("4");
    setBinCount("3");
    setError(null);
  }, [open, area?.id]);

  const preview = useMemo(() => {
    if (!warehouse || !area) return { totalBins: 0, sample: null as string | null };
    try {
      const cfg = formToShelvingConfig({
        useRows,
        rowCount,
        useBays,
        bayCount,
        useLevels,
        levelCount,
        binCount,
      });
      return {
        totalBins: countBinSlotsInFlexibleLayout(cfg),
        sample: sampleFlexibleBinPath(warehouse.code, area.code, cfg),
      };
    } catch {
      return { totalBins: 0, sample: null };
    }
  }, [warehouse, area, useRows, rowCount, useBays, bayCount, useLevels, levelCount, binCount]);

  const validate = (): string | null => {
    if (!warehouse || !area) return "Select a warehouse and area first.";
    try {
      formToShelvingConfig({
        useRows,
        rowCount,
        useBays,
        bayCount,
        useLevels,
        levelCount,
        binCount,
      });
    } catch (e: unknown) {
      return e instanceof Error ? e.message : String(e);
    }
    if (preview.totalBins < 1) return "Enter at least one bin slot.";
    if (preview.totalBins > 25_000) {
      return `Too many bins (${preview.totalBins.toLocaleString()}). Maximum is 25,000 per run.`;
    }
    return null;
  };

  const handleCreate = async () => {
    if (!warehouse || !area || saving) return;
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const layoutBlockId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `block-${Date.now()}`;
      const res = await generateWarehouseBinsFromFlexibleLayout({
        warehouseId: warehouse.id,
        warehouseCode: warehouse.code,
        storageAreaId: area.id,
        shelving: formToShelvingConfig({
          useRows,
          rowCount,
          useBays,
          bayCount,
          useLevels,
          levelCount,
          binCount,
        }),
        layoutBlockId,
      });
      onCreated?.({ binsCreated: res.created, binsSkipped: res.skipped });
      onOpenChange(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add shelving — area {area?.code ?? ""}</DialogTitle>
          <DialogDescription>
            Enable only the tiers you need. Bins are always created; rows, bays, and levels are optional. Levels
            require bays.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <ShelvingTierCell
            label="Rows"
            checked={useRows}
            onCheckedChange={setUseRows}
            count={rowCount}
            onCountChange={setRowCount}
          />
          <ShelvingTierCell
            label="Bays"
            checked={useBays}
            onCheckedChange={(v) => {
              setUseBays(v);
              if (!v) setUseLevels(false);
            }}
            count={bayCount}
            onCountChange={setBayCount}
          />
          <ShelvingTierCell
            label="Levels"
            checked={useLevels}
            checkboxDisabled={!useBays}
            countDisabled={!useBays}
            onCheckedChange={setUseLevels}
            count={levelCount}
            onCountChange={setLevelCount}
          />
          <div className="flex items-center gap-2">
            <Label className="text-sm w-[4.5rem] shrink-0 pl-6">Bins</Label>
            <Input
              inputMode="numeric"
              className="h-8 w-20"
              value={binCount}
              onChange={(e) => setBinCount(e.target.value)}
              aria-label="Bin count"
            />
            <span className="text-xs text-muted-foreground">per slot (always required)</span>
          </div>

          {preview.totalBins > 0 || preview.sample ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Estimated new bins:</span>{" "}
                <strong>{preview.totalBins.toLocaleString()}</strong>
              </p>
              {preview.sample ? (
                <p className="text-xs font-mono text-muted-foreground break-all">Sample: {preview.sample}</p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void handleCreate()} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add bins"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
