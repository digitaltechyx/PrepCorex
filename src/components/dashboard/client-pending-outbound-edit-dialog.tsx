"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { InventoryItem, ShipmentRequest } from "@/types";
import { updatePendingOutboundByClient } from "@/lib/client-outbound-pending-edit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

type ExistingLineDraft = {
  key: string;
  lineIndex: number;
  productId: string;
  productLabel: string;
  boxQuantity: string;
  packOf: string;
  removed: boolean;
};

type NewLineDraft = {
  key: string;
  productId: string;
  boxQuantity: string;
  packOf: string;
};

function productLabelForLine(
  shipment: Record<string, unknown>,
  inventory: InventoryItem[]
): string {
  const name = String(shipment.productName || "").trim();
  const sku = String(shipment.sku || "").trim();
  if (name && sku) return `${name} (${sku})`;
  if (name) return name;
  const productId = String(shipment.productId || "").trim();
  const inv = inventory.find((item) => item.id === productId);
  if (inv?.productName && inv?.sku) return `${inv.productName} (${inv.sku})`;
  if (inv?.productName) return inv.productName;
  return productId || "Line";
}

function inventoryOptionLabel(item: InventoryItem): string {
  const name = String(item.productName || "").trim() || "Product";
  const sku = String(item.sku || "").trim();
  const qty = Math.max(0, Math.floor(Number(item.quantity) || 0));
  return sku ? `${name} (${sku}) · avail ${qty}` : `${name} · avail ${qty}`;
}

export function ClientPendingOutboundEditDialog({
  open,
  onOpenChange,
  request,
  clientUserId,
  editedBy,
  inventory,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  request: ShipmentRequest | null;
  clientUserId: string;
  editedBy: string;
  inventory: InventoryItem[];
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [remarks, setRemarks] = useState("");
  const [existingLines, setExistingLines] = useState<ExistingLineDraft[]>([]);
  const [newLines, setNewLines] = useState<NewLineDraft[]>([]);
  /** Prevent live inventory/request snapshots from wiping in-progress removals. */
  const hydratedSessionRef = useRef<string | null>(null);

  const sellableInventory = useMemo(
    () =>
      inventory
        .filter((item) => {
          const id = String(item.id || "").trim();
          if (!id || id.startsWith("prep:")) return false;
          return Math.max(0, Math.floor(Number(item.quantity) || 0)) > 0;
        })
        .slice()
        .sort((a, b) =>
          String(a.productName || a.sku || a.id).localeCompare(
            String(b.productName || b.sku || b.id)
          )
        ),
    [inventory]
  );

  useEffect(() => {
    if (!open) {
      hydratedSessionRef.current = null;
      return;
    }
    if (!request?.id) return;
    const sessionKey = request.id;
    if (hydratedSessionRef.current === sessionKey) return;
    hydratedSessionRef.current = sessionKey;

    setRemarks(String(request.remarks || ""));
    setNewLines([]);
    const shipments = Array.isArray(request.shipments) ? request.shipments : [];
    setExistingLines(
      shipments.map((shipment, lineIndex) => {
        const row = shipment as Record<string, unknown>;
        const removed =
          Boolean(row.warehouseLineRemoved) ||
          Math.floor(Number(row.quantity) || 0) <= 0;
        return {
          key: `existing-${lineIndex}`,
          lineIndex,
          productId: String(row.productId || "").trim(),
          productLabel: productLabelForLine(row, inventory),
          boxQuantity: String(Math.max(0, Math.floor(Number(row.quantity) || 0))),
          packOf: String(Math.max(1, Math.floor(Number(row.packOf) || 1))),
          removed,
        };
      })
    );
  }, [open, request, inventory]);

  const activeExistingCount = useMemo(
    () =>
      existingLines.filter((line) => !line.removed && Number(line.boxQuantity) > 0).length,
    [existingLines]
  );
  const activeNewCount = useMemo(
    () =>
      newLines.filter((line) => line.productId && Number(line.boxQuantity) > 0).length,
    [newLines]
  );
  const activeLineCount = activeExistingCount + activeNewCount;

  const addNewProductRow = () => {
    setNewLines((prev) => [
      ...prev,
      {
        key: `new-${crypto.randomUUID()}`,
        productId: "",
        boxQuantity: "1",
        packOf: "1",
      },
    ]);
  };

  const handleSave = async () => {
    if (!request?.id || !clientUserId) return;
    if (String(request.status || "").toLowerCase() !== "pending") {
      toast({
        variant: "destructive",
        title: "Cannot edit",
        description: "Only Pending requests can be edited before admin approval.",
      });
      return;
    }
    if (activeLineCount === 0) {
      toast({
        variant: "destructive",
        title: "Keep at least one line",
        description: "Leave or add one product on the order, or cancel the request instead.",
      });
      return;
    }
    for (const line of newLines) {
      if (!line.productId && Number(line.boxQuantity) > 0) {
        toast({
          variant: "destructive",
          title: "Select a product",
          description: "Each new line needs a product before saving.",
        });
        return;
      }
      if (line.productId && Number(line.boxQuantity) <= 0) {
        toast({
          variant: "destructive",
          title: "Invalid qty",
          description: "New product lines need a quantity of at least 1.",
        });
        return;
      }
    }

    setSaving(true);
    try {
      await updatePendingOutboundByClient({
        clientUserId,
        shipmentRequestId: request.id,
        editedBy,
        remarks,
        lines: existingLines.map((line) => ({
          lineIndex: line.lineIndex,
          boxQuantity: line.removed
            ? 0
            : Math.max(0, Math.floor(Number(line.boxQuantity) || 0)),
          packOf: Math.max(1, Math.floor(Number(line.packOf) || 1)),
        })),
        newLines: newLines
          .filter((line) => line.productId && Number(line.boxQuantity) > 0)
          .map((line) => ({
            productId: line.productId,
            boxQuantity: Math.max(1, Math.floor(Number(line.boxQuantity) || 1)),
            packOf: Math.max(1, Math.floor(Number(line.packOf) || 1)),
          })),
      });
      toast({
        title: "Request updated",
        description:
          "Your pending outbound was saved. You can still edit until an admin approves it.",
      });
      onOpenChange(false);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Failed to update outbound request.";
      toast({
        variant: "destructive",
        title: "Update failed",
        description: message,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Edit pending outbound
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                You can change this order only while status is <strong>Pending</strong> — before an
                admin approves it. After approval, editing is locked.
              </p>
              <p>
                Add or remove products, change <strong>quantity</strong> / <strong>pack size</strong>
                , and update <strong>remarks</strong>. You can add multiple product lines. Service
                type stays the same — cancel and recreate if you need a different service.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 text-xs text-amber-950">
            Reserved sellable stock updates when you save. Keep at least one product line, or cancel
            the whole request.
          </div>

          <div className="space-y-3">
            <p className="text-sm font-medium">Current products</p>
            {existingLines.map((line) =>
              line.removed ? null : (
                <div
                  key={line.key}
                  className="rounded-md border border-border/70 p-3 space-y-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium break-words min-w-0">{line.productLabel}</p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 shrink-0 text-destructive hover:text-destructive"
                      disabled={saving}
                      title="Remove product"
                      onClick={() => {
                        setExistingLines((prev) =>
                          prev.map((row) =>
                            row.key === line.key
                              ? { ...row, removed: true, boxQuantity: "0" }
                              : row
                          )
                        );
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label htmlFor={`edit-qty-${line.key}`}>Qty (boxes)</Label>
                      <Input
                        id={`edit-qty-${line.key}`}
                        type="number"
                        min={1}
                        step={1}
                        value={line.boxQuantity}
                        disabled={saving}
                        onChange={(event) => {
                          const value = event.target.value;
                          setExistingLines((prev) =>
                            prev.map((row) =>
                              row.key === line.key ? { ...row, boxQuantity: value } : row
                            )
                          );
                        }}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`edit-pack-${line.key}`}>Pack of</Label>
                      <Input
                        id={`edit-pack-${line.key}`}
                        type="number"
                        min={1}
                        step={1}
                        value={line.packOf}
                        disabled={saving}
                        onChange={(event) => {
                          const value = event.target.value;
                          setExistingLines((prev) =>
                            prev.map((row) =>
                              row.key === line.key ? { ...row, packOf: value } : row
                            )
                          );
                        }}
                      />
                    </div>
                  </div>
                </div>
              )
            )}
            {activeExistingCount === 0 ? (
              <p className="text-xs text-muted-foreground">
                All current products removed — add at least one product below before saving.
              </p>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Add products</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8"
                disabled={saving || sellableInventory.length === 0}
                onClick={addNewProductRow}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add line
              </Button>
            </div>
            {sellableInventory.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No sellable inventory available to add.
              </p>
            ) : null}
            {newLines.map((line) => (
              <div
                key={line.key}
                className="rounded-md border border-dashed border-amber-200/80 bg-amber-50/20 p-3 space-y-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1 flex-1 min-w-0">
                    <Label>Product</Label>
                    <Select
                      value={line.productId || undefined}
                      onValueChange={(value) => {
                        setNewLines((prev) =>
                          prev.map((row) =>
                            row.key === line.key ? { ...row, productId: value } : row
                          )
                        );
                      }}
                      disabled={saving}
                    >
                      <SelectTrigger className="h-9">
                        <SelectValue placeholder="Select product" />
                      </SelectTrigger>
                      <SelectContent>
                        {sellableInventory.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {inventoryOptionLabel(item)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 shrink-0 mt-6 text-destructive hover:text-destructive"
                    disabled={saving}
                    title="Remove this new line"
                    onClick={() =>
                      setNewLines((prev) => prev.filter((row) => row.key !== line.key))
                    }
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor={`new-qty-${line.key}`}>Qty (boxes)</Label>
                    <Input
                      id={`new-qty-${line.key}`}
                      type="number"
                      min={1}
                      step={1}
                      value={line.boxQuantity}
                      disabled={saving}
                      onChange={(event) => {
                        const value = event.target.value;
                        setNewLines((prev) =>
                          prev.map((row) =>
                            row.key === line.key ? { ...row, boxQuantity: value } : row
                          )
                        );
                      }}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor={`new-pack-${line.key}`}>Pack of</Label>
                    <Input
                      id={`new-pack-${line.key}`}
                      type="number"
                      min={1}
                      step={1}
                      value={line.packOf}
                      disabled={saving}
                      onChange={(event) => {
                        const value = event.target.value;
                        setNewLines((prev) =>
                          prev.map((row) =>
                            row.key === line.key ? { ...row, packOf: value } : row
                          )
                        );
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <Label htmlFor="client-outbound-edit-remarks">Remarks</Label>
            <Textarea
              id="client-outbound-edit-remarks"
              value={remarks}
              onChange={(event) => setRemarks(event.target.value)}
              rows={3}
              maxLength={1000}
              disabled={saving}
              placeholder="Notes for warehouse / admin (optional)"
            />
            <p className="text-xs text-muted-foreground">{remarks.length}/1000</p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={saving || activeLineCount === 0} onClick={() => void handleSave()}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
