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
import { Badge } from "@/components/ui/badge";
import { Loader2, Layers, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  CARTONS_PER_STORAGE_PALLET,
  estimateNewPalletsNeeded,
  listActivePalletStoragePositions,
  placeReceiveCartonsOnClientPallets,
  positionCartonCapacity,
  positionCartonCount,
  positionRemainingCartonSlots,
} from "@/lib/pallet-storage-positions";
import type { PalletStoragePosition } from "@/types";
import { cn } from "@/lib/utils";

export type ReceiveStorageAssignContext = {
  clientUserId: string;
  clientDisplayName?: string;
  warehouseId: string;
  receiveBatchId?: string;
  receiveReference?: string;
  assignedBy?: string | null;
  contents?: Array<{ sku?: string; productName?: string; quantity?: number }>;
  /** Physical CTN/PKG labels created in this receive. */
  receivedCartonCount?: number;
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
  const [cartonCount, setCartonCount] = useState("1");
  const [preferredId, setPreferredId] = useState<string>("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!open || !context?.clientUserId) return;
    let cancelled = false;
    setLoading(true);
    const defaultCartons = Math.max(1, Math.floor(context.receivedCartonCount ?? 1));
    setCartonCount(String(defaultCartons));
    setNotes("");
    listActivePalletStoragePositions(context.clientUserId)
      .then((rows) => {
        if (cancelled) return;
        setPositions(rows);
        const openSlot = rows.find((p) => positionRemainingCartonSlots(p) > 0);
        setPreferredId(openSlot?.id || "");
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
  }, [open, context?.clientUserId, context?.receivedCartonCount]);

  const cartonsNum = Math.max(0, parseInt(cartonCount, 10) || 0);
  const estimate = useMemo(
    () => estimateNewPalletsNeeded(positions, cartonsNum),
    [positions, cartonsNum]
  );

  const preferred = positions.find((p) => p.id === preferredId) ?? null;
  const preferredRemaining = preferred ? positionRemainingCartonSlots(preferred) : 0;

  async function handlePlace() {
    if (!context) return;
    if (cartonsNum < 1) {
      toast({
        variant: "destructive",
        title: "Carton count required",
        description: "Enter how many cartons from this receive go on storage pallets.",
      });
      return;
    }

    setSaving(true);
    try {
      const result = await placeReceiveCartonsOnClientPallets({
        userId: context.clientUserId,
        cartonCount: cartonsNum,
        preferredPositionId: preferredId || null,
        warehouseId: context.warehouseId,
        receiveBatchId: context.receiveBatchId ?? null,
        receiveReference: context.receiveReference ?? null,
        assignedBy: context.assignedBy ?? null,
        notes: notes.trim() || null,
        contents: context.contents,
      });

      const fullHits = result.placed.filter((p) => p.cartonCount >= p.capacity);
      const createdLabels = result.placed.filter((p) => p.created).map((p) => p.label);
      const summary = result.placed
        .map((p) => `${p.label}: +${p.added} → ${p.cartonCount}/${p.capacity}`)
        .join(" · ");

      toast({
        title:
          result.palletsCreated > 0
            ? `Placed on pallets — created ${createdLabels.join(", ")}`
            : "Cartons placed on existing pallets",
        description:
          summary +
          (fullHits.length
            ? ` · ${fullHits.map((p) => p.label).join(", ")} full (${CARTONS_PER_STORAGE_PALLET} cartons) — use a new pallet next time.`
            : ""),
      });

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

  function handleSkip() {
    onComplete?.();
    onClose();
  }

  const clientLabel = context?.clientDisplayName || context?.clientUserId || "Client";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-orange-600" />
            Client pallet storage
          </DialogTitle>
          <DialogDescription>
            After receive — assign cartons to this client&apos;s storage pallets.{" "}
            <strong>1 pallet = {CARTONS_PER_STORAGE_PALLET} cartons max</strong>. When a pallet
            hits the limit, create a new one for the rest.
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

            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">
                  Pallets assigned ({positions.length})
                </p>
                <Badge variant="outline" className="text-[10px]">
                  Limit {CARTONS_PER_STORAGE_PALLET} CTN / pallet
                </Badge>
              </div>
              {positions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No pallets yet — placing cartons will create the first one (P1).
                </p>
              ) : (
                <div className="space-y-1.5">
                  {positions.map((p) => {
                    const count = positionCartonCount(p);
                    const capacity = positionCartonCapacity(p);
                    const remaining = positionRemainingCartonSlots(p);
                    const full = remaining <= 0;
                    const selected = preferredId === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        disabled={full}
                        onClick={() => setPreferredId(p.id)}
                        className={cn(
                          "w-full flex items-center justify-between gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors",
                          full
                            ? "opacity-60 cursor-not-allowed bg-muted"
                            : selected
                              ? "border-orange-400 bg-orange-50"
                              : "hover:bg-muted/50"
                        )}
                      >
                        <span className="font-mono font-semibold">{p.label}</span>
                        <span className="flex items-center gap-2">
                          <span className="text-xs tabular-nums">
                            {count}/{capacity} cartons
                          </span>
                          {full ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Full — create new
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-emerald-800 border-emerald-300">
                              {remaining} free
                            </Badge>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Cartons from this receive to place</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={cartonCount}
                onChange={(e) => setCartonCount(e.target.value)}
                className="w-28"
              />
              <p className="text-[11px] text-muted-foreground">
                Defaults to labels printed on this receive. Adjust if only some cartons need
                storage billing.
              </p>
            </div>

            {cartonsNum > 0 && (
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-xs space-y-1",
                  estimate.newPalletsNeeded > 0
                    ? "border-amber-300 bg-amber-50 text-amber-950"
                    : "border-emerald-200 bg-emerald-50 text-emerald-950"
                )}
              >
                {estimate.newPalletsNeeded > 0 ? (
                  <p className="flex items-start gap-1.5">
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      Open slots: {estimate.freeSlots}. After filling them,{" "}
                      <strong>
                        {estimate.newPalletsNeeded} new pallet
                        {estimate.newPalletsNeeded === 1 ? "" : "s"}
                      </strong>{" "}
                      will be created (because each holds max {CARTONS_PER_STORAGE_PALLET}{" "}
                      cartons).
                    </span>
                  </p>
                ) : (
                  <p>
                    Fits on existing pallets ({estimate.freeSlots} free slot
                    {estimate.freeSlots === 1 ? "" : "s"}).
                    {preferred && preferredRemaining > 0
                      ? ` Prefer starting with ${preferred.label} (${preferredRemaining} free).`
                      : ""}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="e.g. mixed SKUs / overflow from P2"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 flex-col sm:flex-row">
          <Button type="button" variant="outline" onClick={handleSkip} disabled={saving}>
            Skip for now
          </Button>
          <Button type="button" onClick={() => void handlePlace()} disabled={saving || loading}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Place on pallets
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
