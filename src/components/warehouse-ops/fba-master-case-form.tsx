"use client";

import { useState } from "react";
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
import type { FbaDimensionUnit, FbaMasterCase, FbaWeightUnit } from "@/types";

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

type Props = {
  disabled?: boolean;
  onSubmit: (cases: FbaMasterCase[]) => Promise<void>;
};

export function FbaMasterCaseForm({ disabled, onSubmit }: Props) {
  const [cases, setCases] = useState<FbaMasterCase[]>([emptyCase(1)]);
  const [saving, setSaving] = useState(false);

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

  const handleSubmit = async () => {
    const cleaned = cases.map((c, index) => ({
      ...c,
      caseNumber: index + 1,
      weight: Number(c.weight) || 0,
      length: Number(c.length) || 0,
      width: Number(c.width) || 0,
      height: Number(c.height) || 0,
      notes: c.notes?.trim() || undefined,
    }));

    for (const c of cleaned) {
      if (c.weight <= 0 || c.length <= 0 || c.width <= 0 || c.height <= 0) {
        throw new Error(`Master case ${c.caseNumber} needs weight and all dimensions.`);
      }
    }

    setSaving(true);
    try {
      await onSubmit(cleaned);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {cases.map((masterCase) => (
        <div key={masterCase.id} className="rounded-lg border p-3 space-y-3">
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

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={addCase} disabled={disabled || saving}>
          <Plus className="h-4 w-4 mr-2" />
          Add master case
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={disabled || saving}
          onClick={() => {
            void handleSubmit().catch((error) => {
              alert(error instanceof Error ? error.message : "Could not save master cases.");
            });
          }}
        >
          {saving ? "Saving…" : "Send details to client"}
        </Button>
      </div>
    </div>
  );
}
