"use client";

import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import type { WarehouseAreaDoc, WarehouseBinDoc } from "@/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bin: WarehouseBinDoc | null;
  areas: WarehouseAreaDoc[];
  saving: boolean;
  onSave: (input: {
    area: string;
    row: string;
    bay: string;
    level: string;
    binCode: string;
    barcode: string;
    active: boolean;
    temporary: boolean;
  }) => void | Promise<void>;
};

export function WarehouseBinEditDialog({
  open,
  onOpenChange,
  bin,
  areas,
  saving,
  onSave,
}: Props) {
  const [area, setArea] = useState("");
  const [row, setRow] = useState("");
  const [bay, setBay] = useState("");
  const [level, setLevel] = useState("");
  const [binCode, setBinCode] = useState("");
  const [barcode, setBarcode] = useState("");
  const [active, setActive] = useState(true);
  const [temporary, setTemporary] = useState(false);

  useEffect(() => {
    if (!bin) return;
    setArea(bin.area || "");
    setRow(bin.row || "");
    setBay(bin.bay || "");
    setLevel(bin.level || "");
    setBinCode(bin.binCode || "");
    setBarcode(bin.barcode || bin.path || "");
    setActive(bin.active !== false);
    setTemporary(Boolean(bin.temporary));
  }, [bin]);

  const areaCodes = areas.map((a) => a.code).filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit bin</DialogTitle>
          <DialogDescription>
            Change path segments, barcode, or status. Path is rebuilt from warehouse code and these fields.
          </DialogDescription>
        </DialogHeader>
        {bin ? (
          <div className="space-y-3 py-1">
            <p className="text-xs font-mono text-muted-foreground break-all">Current: {bin.path}</p>
            <div className="space-y-2">
              <Label>Area</Label>
              {areaCodes.length > 0 ? (
                <Select value={area} onValueChange={setArea}>
                  <SelectTrigger>
                    <SelectValue placeholder="Area code" />
                  </SelectTrigger>
                  <SelectContent>
                    {areaCodes.map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input value={area} onChange={(e) => setArea(e.target.value)} />
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Row</Label>
                <Input value={row} onChange={(e) => setRow(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Bay</Label>
                <Input value={bay} onChange={(e) => setBay(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Level</Label>
                <Input value={level} onChange={(e) => setLevel(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Bin slot</Label>
                <Input value={binCode} onChange={(e) => setBinCode(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Barcode (label payload)</Label>
              <Input value={barcode} onChange={(e) => setBarcode(e.target.value)} />
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div className="flex items-center gap-2">
                <Switch id="bin-edit-active" checked={active} onCheckedChange={setActive} />
                <Label htmlFor="bin-edit-active">Active</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="bin-edit-temp" checked={temporary} onCheckedChange={setTemporary} />
                <Label htmlFor="bin-edit-temp">Temporary shelf</Label>
              </div>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={saving || !bin}
            onClick={() =>
              void onSave({
                area: area.trim(),
                row: row.trim(),
                bay: bay.trim(),
                level: level.trim(),
                binCode: binCode.trim(),
                barcode: barcode.trim(),
                active,
                temporary,
              })
            }
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save bin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
