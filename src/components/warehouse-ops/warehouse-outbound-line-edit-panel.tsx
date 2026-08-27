"use client";

import { useCallback, useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
import { useToast } from "@/hooks/use-toast";
import {
  buildEditableShipmentLines,
  formatOutboundLineLabel,
  formatOutboundPackLine,
  type EditableOutboundShipmentLine,
} from "@/lib/warehouse-outbound-lines";
import { editOutboundLineAtWarehouse } from "@/lib/warehouse-outbound-ops";
import type { OutboundPickSourceHint } from "@/lib/warehouse-pick";
import { Loader2, Pencil, Trash2 } from "lucide-react";

type Props = {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  operatorId: string | null | undefined;
  onEdited?: () => void;
};

export function WarehouseOutboundLineEditPanel({
  warehouseId,
  clientUserId,
  shipmentRequestId,
  operatorId,
  onEdited,
}: Props) {
  const { toast } = useToast();
  const [lines, setLines] = useState<EditableOutboundShipmentLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newBoxes, setNewBoxes] = useState("");
  const [newPackOf, setNewPackOf] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickHints, setPickHints] = useState<OutboundPickSourceHint[]>([]);

  const loadLines = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDoc(
        doc(db, `users/${clientUserId}/shipmentRequests`, shipmentRequestId)
      );
      if (!snap.exists()) {
        setLines([]);
        return;
      }
      const data = snap.data() as Record<string, unknown>;
      const { loadClientProductMap } = await import("@/lib/warehouse-outbound-lines");
      const products = await loadClientProductMap(clientUserId);
      setLines(buildEditableShipmentLines(data, products));
    } catch (e) {
      toast({
        title: "Could not load lines",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [clientUserId, shipmentRequestId, toast]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  function startEdit(line: EditableOutboundShipmentLine) {
    setEditingIndex(line.lineIndex);
    setNewBoxes(String(line.boxes));
    setNewPackOf(String(line.packOf));
    setPickHints([]);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setNewBoxes("");
    setNewPackOf("");
    setPickHints([]);
  }

  async function submitEdit(line: EditableOutboundShipmentLine, remove: boolean) {
    if (!operatorId) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }

    const reason = window.prompt(
      remove
        ? "Remove this line from the order? Enter reason (required)."
        : "Edit outbound line qty? Enter reason (required).",
      ""
    );
    if (reason == null) return;
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      toast({
        title: "Reason required",
        description: "Enter a reason to continue.",
        variant: "destructive",
      });
      return;
    }

    const boxQty = remove ? 0 : Math.max(0, Math.floor(Number(newBoxes) || 0));
    const packOf = remove
      ? line.packOf
      : Math.max(1, Math.floor(Number(newPackOf) || 0) || line.packOf);
    if (!remove && packOf < 1) {
      toast({
        title: "Invalid pack size",
        description: "Pack of must be at least 1.",
        variant: "destructive",
      });
      return;
    }
    if (!remove && boxQty === line.boxes && packOf === line.packOf) {
      toast({ title: "No change", description: "Quantity and pack size are the same as before." });
      return;
    }
    if (!remove && boxQty < 1) {
      toast({
        title: "Invalid quantity",
        description: "Use Remove line to drop this SKU, or enter at least 1 for qty.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const result = await editOutboundLineAtWarehouse({
        clientUserId,
        shipmentRequestId,
        warehouseId,
        lineIndex: line.lineIndex,
        newBoxQuantity: boxQty,
        newPackOf: packOf,
        editedBy: String(operatorId),
        reason: trimmedReason,
      });

      toast({
        title: remove ? "Line removed" : "Line updated",
        description: remove
          ? "Stock restored where applicable."
          : result.pickSourceHints.length > 0
            ? "Pick the extra units from the locations shown below."
            : "Order line and inventory updated.",
      });

      if (result.pickSourceHints.length > 0) {
        setPickHints(result.pickSourceHints);
      } else {
        cancelEdit();
      }

      await loadLines();
      onEdited?.();
    } catch (e) {
      toast({
        title: "Edit failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const activeLines = lines.filter((l) => !l.removedAtWarehouse && !l.isPrepOnly);

  if (loading) {
    return (
      <Card>
        <CardContent className="py-4 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading order lines…
        </CardContent>
      </Card>
    );
  }

  if (activeLines.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Pencil className="h-4 w-4" />
          Edit order lines
        </CardTitle>
        <CardDescription className="text-xs">
          Reduce qty, remove a SKU, or change qty / pack size before dispatch. Client inventory
          updates when total units change.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {activeLines.map((line) => {
          const editing = editingIndex === line.lineIndex;
          return (
            <div
              key={line.lineIndex}
              className="rounded-md border p-3 space-y-2 text-xs"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">
                    Line {line.lineIndex + 1}: {formatOutboundLineLabel(line)}
                  </p>
                  <p className="text-muted-foreground">
                    {formatOutboundPackLine(line.boxes, line.packOf)}
                    {line.quantityUnits !== line.boxes ? (
                      <span> · {line.quantityUnits} units</span>
                    ) : null}
                  </p>
                </div>
                {!editing ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving}
                      onClick={() => startEdit(line)}
                    >
                      Edit qty
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={saving}
                      onClick={() => void submitEdit(line, true)}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      Remove
                    </Button>
                  </div>
                ) : null}
              </div>

              {editing ? (
                <div className="flex flex-wrap items-end gap-2 pt-1">
                  <div className="space-y-1">
                    <Label htmlFor={`boxes-${line.lineIndex}`} className="text-xs">
                      Qty
                    </Label>
                    <Input
                      id={`boxes-${line.lineIndex}`}
                      type="number"
                      min={1}
                      className="h-8 w-24 text-xs"
                      value={newBoxes}
                      onChange={(e) => setNewBoxes(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`pack-${line.lineIndex}`} className="text-xs">
                      Pack of
                    </Label>
                    <Input
                      id={`pack-${line.lineIndex}`}
                      type="number"
                      min={1}
                      className="h-8 w-24 text-xs"
                      value={newPackOf}
                      onChange={(e) => setNewPackOf(e.target.value)}
                      disabled={saving}
                    />
                  </div>
                  <p className="pb-1 text-muted-foreground">
                    ={" "}
                    {Math.max(0, Math.floor(Number(newBoxes) || 0)) *
                      Math.max(1, Math.floor(Number(newPackOf) || 0) || 1)}{" "}
                    units
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    disabled={saving}
                    onClick={() => void submitEdit(line, false)}
                  >
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={saving}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}

        {pickHints.length > 0 ? (
          <div className="rounded-md bg-sky-50 border border-sky-200 p-3 space-y-1 text-xs text-sky-950">
            <p className="font-medium">Pick extra units from:</p>
            {pickHints.map((hint) => (
              <p key={`${hint.binPath}-${hint.cartonCode}`}>
                {hint.binPath} · carton {hint.cartonCode} ({hint.quantity} units picked here
                before)
              </p>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
