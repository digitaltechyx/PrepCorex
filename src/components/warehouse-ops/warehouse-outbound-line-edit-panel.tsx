"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  buildEditableShipmentLines,
  formatOutboundLineLabel,
  formatOutboundPackLine,
  type EditableOutboundShipmentLine,
} from "@/lib/warehouse-outbound-lines";
import {
  addOutboundLineAtWarehouse,
  editOutboundLineAtWarehouse,
} from "@/lib/warehouse-outbound-ops";
import type { OutboundPickSourceHint } from "@/lib/warehouse-pick";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

type InventoryOption = {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
};

type Props = {
  warehouseId: string;
  clientUserId: string;
  shipmentRequestId: string;
  operatorId: string | null | undefined;
  onEdited?: () => void;
  /** Admin: inline reason (optional), unit price, add product. Warehouse keeps reason required. */
  mode?: "warehouse" | "admin";
};

export function WarehouseOutboundLineEditPanel({
  warehouseId,
  clientUserId,
  shipmentRequestId,
  operatorId,
  onEdited,
  mode = "warehouse",
}: Props) {
  const isAdmin = mode === "admin";
  const { toast } = useToast();
  const [lines, setLines] = useState<EditableOutboundShipmentLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [newBoxes, setNewBoxes] = useState("");
  const [newPackOf, setNewPackOf] = useState("");
  const [newUnitPrice, setNewUnitPrice] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [pickHints, setPickHints] = useState<OutboundPickSourceHint[]>([]);
  const [inventoryOptions, setInventoryOptions] = useState<InventoryOption[]>([]);
  const [addProductId, setAddProductId] = useState("");
  const [addBoxes, setAddBoxes] = useState("1");
  const [addPackOf, setAddPackOf] = useState("1");
  const [addUnitPrice, setAddUnitPrice] = useState("0");
  const [adding, setAdding] = useState(false);

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

  const loadInventoryOptions = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const snap = await getDocs(collection(db, `users/${clientUserId}/inventory`));
      const rows: InventoryOption[] = [];
      for (const d of snap.docs) {
        const data = d.data() as Record<string, unknown>;
        const qty = Math.max(0, Math.floor(Number(data.quantity) || 0));
        const sku = String(data.sku ?? "").trim();
        const productName = String(data.productName ?? sku).trim() || sku || d.id;
        rows.push({
          id: d.id,
          productName,
          sku: sku || productName,
          quantity: qty,
        });
      }
      rows.sort((a, b) => a.productName.localeCompare(b.productName));
      setInventoryOptions(rows);
    } catch {
      setInventoryOptions([]);
    }
  }, [clientUserId, isAdmin]);

  useEffect(() => {
    void loadLines();
  }, [loadLines]);

  useEffect(() => {
    void loadInventoryOptions();
  }, [loadInventoryOptions]);

  const activeLines = useMemo(
    () => lines.filter((l) => !l.removedAtWarehouse && !l.isPrepOnly),
    [lines]
  );

  const addableProducts = useMemo(() => {
    const onOrder = new Set(
      activeLines.map((l) => String(l.productId ?? "").trim()).filter(Boolean)
    );
    return inventoryOptions.filter((p) => p.quantity > 0 && !onOrder.has(p.id));
  }, [inventoryOptions, activeLines]);

  function startEdit(line: EditableOutboundShipmentLine) {
    setEditingIndex(line.lineIndex);
    setNewBoxes(String(line.boxes));
    setNewPackOf(String(line.packOf));
    setNewUnitPrice(String(line.unitPrice ?? 0));
    setPickHints([]);
  }

  function cancelEdit() {
    setEditingIndex(null);
    setNewBoxes("");
    setNewPackOf("");
    setNewUnitPrice("");
    setPickHints([]);
  }

  function resolveReason(forRemove: boolean): string | null {
    const trimmed = reason.trim();
    if (isAdmin) {
      return (
        trimmed ||
        (forRemove ? "Admin correction — remove line" : "Admin correction")
      );
    }
    if (trimmed) return trimmed;
    const prompted = window.prompt(
      forRemove
        ? "Remove this line from the order? Enter reason (required)."
        : "Edit outbound line qty? Enter reason (required).",
      ""
    );
    if (prompted == null) return null;
    const fromPrompt = prompted.trim();
    if (!fromPrompt) {
      toast({
        title: "Reason required",
        description: "Enter a reason to continue.",
        variant: "destructive",
      });
      return null;
    }
    return fromPrompt;
  }

  async function submitEdit(line: EditableOutboundShipmentLine, remove: boolean) {
    if (!operatorId) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }

    const trimmedReason = resolveReason(remove);
    if (trimmedReason == null) return;

    const boxQty = remove ? 0 : Math.max(0, Math.floor(Number(newBoxes) || 0));
    const packOf = remove
      ? line.packOf
      : Math.max(1, Math.floor(Number(newPackOf) || 0) || line.packOf);
    const priceNum = Number(newUnitPrice);
    const unitPrice =
      isAdmin && Number.isFinite(priceNum) ? Math.max(0, priceNum) : undefined;

    if (!remove && packOf < 1) {
      toast({
        title: "Invalid pack size",
        description: "Pack of must be at least 1.",
        variant: "destructive",
      });
      return;
    }
    const priceSame =
      unitPrice == null || Math.abs(unitPrice - (line.unitPrice ?? 0)) < 0.0001;
    if (!remove && boxQty === line.boxes && packOf === line.packOf && priceSame) {
      toast({
        title: "No change",
        description: isAdmin
          ? "Quantity, pack size, and price are the same as before."
          : "Quantity and pack size are the same as before.",
      });
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
        ...(unitPrice != null ? { newUnitPrice: unitPrice } : {}),
        editedBy: String(operatorId),
        reason: trimmedReason,
        requireReason: !isAdmin,
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

  async function submitAddProduct() {
    if (!operatorId) {
      toast({ title: "Sign in required", variant: "destructive" });
      return;
    }
    if (!addProductId) {
      toast({
        title: "Select a product",
        description: "Choose a product from inventory to add.",
        variant: "destructive",
      });
      return;
    }
    const boxQty = Math.max(0, Math.floor(Number(addBoxes) || 0));
    const packOf = Math.max(1, Math.floor(Number(addPackOf) || 0) || 1);
    const priceNum = Number(addUnitPrice);
    const unitPrice = Number.isFinite(priceNum) ? Math.max(0, priceNum) : 0;
    if (boxQty < 1) {
      toast({
        title: "Invalid quantity",
        description: "Qty must be at least 1.",
        variant: "destructive",
      });
      return;
    }

    setAdding(true);
    try {
      const result = await addOutboundLineAtWarehouse({
        clientUserId,
        shipmentRequestId,
        warehouseId,
        productId: addProductId,
        boxQuantity: boxQty,
        packOf,
        unitPrice,
        editedBy: String(operatorId),
        reason: reason.trim() || "Admin correction — add product",
      });

      toast({
        title: "Product added",
        description:
          result.pickSourceHints.length > 0
            ? "Line added. Pick locations shown below if this order is already in pick."
            : "Line added to the outbound request.",
      });
      if (result.pickSourceHints.length > 0) {
        setPickHints(result.pickSourceHints);
      }
      setAddProductId("");
      setAddBoxes("1");
      setAddPackOf("1");
      setAddUnitPrice("0");
      await loadLines();
      onEdited?.();
    } catch (e) {
      toast({
        title: "Could not add product",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setAdding(false);
    }
  }

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

  if (activeLines.length === 0 && !isAdmin) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Pencil className="h-4 w-4" />
          Correct order lines
        </CardTitle>
        <CardDescription className="text-xs">
          {isAdmin
            ? "Edit qty / pack of / unit price, remove a line, or add another product. Reserved stock updates when units change."
            : "Reduce qty, remove a SKU, or change qty / pack size before dispatch. Client inventory updates when total units change. Reason required."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isAdmin ? (
          <div className="space-y-1">
            <Label htmlFor="correct-reason" className="text-xs">
              Reason (optional)
            </Label>
            <Textarea
              id="correct-reason"
              placeholder="Optional note — defaults to “Admin correction”"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="min-h-[60px] text-xs"
              disabled={saving || adding}
            />
          </div>
        ) : null}

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
                    {isAdmin ? (
                      <span>
                        {" "}
                        · ${Number(line.unitPrice ?? 0).toFixed(2)} / unit
                      </span>
                    ) : null}
                  </p>
                </div>
                {!editing ? (
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={saving || adding}
                      onClick={() => startEdit(line)}
                    >
                      {isAdmin ? "Edit" : "Edit qty"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="text-destructive"
                      disabled={saving || adding}
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
                  {isAdmin ? (
                    <div className="space-y-1">
                      <Label htmlFor={`price-${line.lineIndex}`} className="text-xs">
                        Unit price ($)
                      </Label>
                      <Input
                        id={`price-${line.lineIndex}`}
                        type="number"
                        min={0}
                        step="0.01"
                        className="h-8 w-28 text-xs"
                        value={newUnitPrice}
                        onChange={(e) => setNewUnitPrice(e.target.value)}
                        disabled={saving}
                      />
                    </div>
                  ) : null}
                  <p className="pb-1 text-muted-foreground">
                    ={" "}
                    {Math.max(0, Math.floor(Number(newBoxes) || 0)) *
                      Math.max(1, Math.floor(Number(newPackOf) || 0) || 1)}{" "}
                    units
                    {isAdmin
                      ? ` · line $${(
                          Math.max(0, Math.floor(Number(newBoxes) || 0)) *
                          (Number.isFinite(Number(newUnitPrice))
                            ? Math.max(0, Number(newUnitPrice))
                            : 0)
                        ).toFixed(2)}`
                      : ""}
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

        {isAdmin ? (
          <div className="rounded-md border border-dashed p-3 space-y-2 text-xs">
            <p className="font-medium flex items-center gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add product
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Product</Label>
              <Select
                value={addProductId || undefined}
                onValueChange={setAddProductId}
                disabled={adding || saving}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select from client inventory" />
                </SelectTrigger>
                <SelectContent>
                  {addableProducts.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.productName}
                      {p.sku && p.sku !== p.productName ? ` (${p.sku})` : ""} — {p.quantity} avail
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Qty</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 w-24 text-xs"
                  value={addBoxes}
                  onChange={(e) => setAddBoxes(e.target.value)}
                  disabled={adding || saving}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Pack of</Label>
                <Input
                  type="number"
                  min={1}
                  className="h-8 w-24 text-xs"
                  value={addPackOf}
                  onChange={(e) => setAddPackOf(e.target.value)}
                  disabled={adding || saving}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Unit price ($)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  className="h-8 w-28 text-xs"
                  value={addUnitPrice}
                  onChange={(e) => setAddUnitPrice(e.target.value)}
                  disabled={adding || saving}
                />
              </div>
              <Button
                type="button"
                size="sm"
                disabled={adding || saving || !addProductId}
                onClick={() => void submitAddProduct()}
              >
                {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add to order"}
              </Button>
            </div>
          </div>
        ) : null}

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
