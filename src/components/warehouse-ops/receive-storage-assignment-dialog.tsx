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
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  addToExistingPalletPosition,
  assignNewPalletStoragePositions,
  listActivePalletStoragePositions,
} from "@/lib/pallet-storage-positions";
import type { PalletStoragePosition } from "@/types";

export type ReceiveStorageAssignContext = {
  clientUserId: string;
  clientDisplayName?: string;
  warehouseId: string;
  receiveBatchId?: string;
  receiveReference?: string;
  assignedBy?: string | null;
  contents?: Array<{ sku?: string; productName?: string; quantity?: number }>;
};

type Props = {
  open: boolean;
  context: ReceiveStorageAssignContext | null;
  onClose: () => void;
  onComplete?: () => void;
};

export function ReceiveStorageAssignmentDialog({
  open,
  context,
  onClose,
  onComplete,
}: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [positions, setPositions] = useState<PalletStoragePosition[]>([]);
  const [mode, setMode] = useState<"new" | "existing" | "skip">("new");
  const [newCount, setNewCount] = useState("1");
  const [existingId, setExistingId] = useState("");
  const [markHasSpace, setMarkHasSpace] = useState(true);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !context?.clientUserId) return;
    let cancelled = false;
    setLoading(true);
    listActivePalletStoragePositions(context.clientUserId)
      .then((rows) => {
        if (!cancelled) {
          setPositions(rows);
          const withSpace = rows.filter((p) => p.hasSpace !== false);
          setExistingId(withSpace[0]?.id || rows[0]?.id || "");
          setMode(withSpace.length > 0 ? "existing" : "new");
        }
      })
      .catch(() => {
        if (!cancelled) setPositions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, context?.clientUserId]);

  const positionsWithSpace = useMemo(
    () => positions.filter((p) => p.hasSpace !== false),
    [positions]
  );

  async function handleSave() {
    if (!context) return;
    if (mode === "skip") {
      onComplete?.();
      onClose();
      return;
    }

    setSaving(true);
    try {
      const base = {
        userId: context.clientUserId,
        warehouseId: context.warehouseId,
        receiveBatchId: context.receiveBatchId ?? null,
        receiveReference: context.receiveReference ?? null,
        assignedBy: context.assignedBy ?? null,
        notes: notes.trim() || null,
        contents: context.contents,
      };

      if (mode === "existing") {
        if (!existingId) {
          toast({
            variant: "destructive",
            title: "Select a pallet",
            description: "Choose an existing pallet position or create new ones.",
          });
          return;
        }
        await addToExistingPalletPosition({
          ...base,
          positionId: existingId,
          markHasSpace,
        });
        toast({
          title: "Storage updated",
          description: "Added to existing pallet position (billing unchanged).",
        });
      } else {
        const count = Math.max(1, parseInt(newCount, 10) || 1);
        const created = await assignNewPalletStoragePositions({ ...base, count });
        toast({
          title: "Storage assigned",
          description: `Created ${created.length} billable pallet position${created.length === 1 ? "" : "s"} (7 days free).`,
        });
      }
      onComplete?.();
      onClose();
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Storage assignment failed",
        description: e instanceof Error ? e.message : "Unknown error",
      });
    } finally {
      setSaving(false);
    }
  }

  const clientLabel = context?.clientDisplayName || context?.clientUserId || "Client";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Assign pallet storage (optional)</DialogTitle>
          <DialogDescription>
            Billing only — does not affect putaway. First 7 days free for new pallet positions.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm">
              Client: <span className="font-medium">{clientLabel}</span>
            </p>

            {positions.length > 0 && (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Active pallet positions
                </p>
                <div className="flex flex-wrap gap-2">
                  {positions.map((p) => (
                    <Badge
                      key={p.id}
                      variant={p.hasSpace === false ? "secondary" : "outline"}
                      className="text-xs"
                    >
                      {p.label}
                      {p.hasSpace === false ? " · full" : " · space"}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <RadioGroup value={mode} onValueChange={(v) => setMode(v as typeof mode)} className="space-y-3">
              {positionsWithSpace.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border p-3">
                  <RadioGroupItem value="existing" id="mode-existing" className="mt-1" />
                  <div className="flex-1 space-y-2">
                    <Label htmlFor="mode-existing" className="font-medium cursor-pointer">
                      Add to existing pallet (no new billing position)
                    </Label>
                    {mode === "existing" && (
                      <>
                        <Select value={existingId} onValueChange={setExistingId}>
                          <SelectTrigger>
                            <SelectValue placeholder="Select pallet" />
                          </SelectTrigger>
                          <SelectContent>
                            {positionsWithSpace.map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.label} — has space
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={markHasSpace}
                            onChange={(e) => setMarkHasSpace(e.target.checked)}
                          />
                          Pallet still has space after this receive
                        </label>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="flex items-start gap-2 rounded-md border p-3">
                <RadioGroupItem value="new" id="mode-new" className="mt-1" />
                <div className="flex-1 space-y-2">
                  <Label htmlFor="mode-new" className="font-medium cursor-pointer">
                    Create new pallet position(s)
                  </Label>
                  {mode === "new" && (
                    <Input
                      type="number"
                      min={1}
                      max={50}
                      value={newCount}
                      onChange={(e) => setNewCount(e.target.value)}
                      className="w-24"
                    />
                  )}
                </div>
              </div>

              <div className="flex items-start gap-2 rounded-md border p-3">
                <RadioGroupItem value="skip" id="mode-skip" className="mt-1" />
                <Label htmlFor="mode-skip" className="font-medium cursor-pointer">
                  Skip — assign storage later
                </Label>
              </div>
            </RadioGroup>

            {mode !== "skip" && (
              <div className="space-y-1">
                <Label className="text-xs">Notes (optional)</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={2}
                  placeholder="e.g. mixed SKUs on P2"
                />
              </div>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Close
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {mode === "skip" ? "Continue without storage" : "Save storage"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
