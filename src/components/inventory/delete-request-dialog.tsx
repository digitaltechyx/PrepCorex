"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";
import { submitDeleteRequest } from "@/lib/delete-request-ops";
import { cn } from "@/lib/utils";
import type { InventoryItem } from "@/types";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inventory owner the request is filed against. */
  userId: string;
  inventory: InventoryItem[];
  submitterUid: string;
  submitterName: string;
  /** Admin filing the request for a client. */
  onBehalf?: boolean;
  ownerName?: string;
  /** Items that already have a request awaiting a decision. */
  pendingProductIds?: ReadonlySet<string>;
  onSubmitted?: () => void;
};

export function DeleteRequestDialog({
  open,
  onOpenChange,
  userId,
  inventory,
  submitterUid,
  submitterName,
  onBehalf = false,
  ownerName,
  pendingProductIds,
  onSubmitted,
}: Props) {
  const { toast } = useToast();
  const [productId, setProductId] = useState("");
  const [reason, setReason] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) return;
    setProductId("");
    setReason("");
    setProductSearch("");
  }, [open]);

  const sortedInventory = useMemo(
    () =>
      [...inventory].sort((a, b) =>
        (a.productName || "").localeCompare(b.productName || "")
      ),
    [inventory]
  );
  const filteredInventory = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return sortedInventory;
    return sortedInventory.filter((item) =>
      `${item.productName} ${item.sku ?? ""}`.toLowerCase().includes(q)
    );
  }, [sortedInventory, productSearch]);
  const selected = sortedInventory.find((i) => i.id === productId) ?? null;
  const alreadyRequested = productId ? pendingProductIds?.has(productId) ?? false : false;

  const handleSubmit = async () => {
    if (!selected || !userId) return;
    if (!reason.trim()) {
      toast({
        variant: "destructive",
        title: "Reason required",
        description: "Tell the admin why this entry should be deleted.",
      });
      return;
    }
    setSubmitting(true);
    try {
      await submitDeleteRequest({
        userId,
        item: selected,
        reason,
        requestedBy: submitterUid,
        requestedByName: submitterName,
        onBehalf,
      });
      toast({
        title: "Delete request submitted",
        description: onBehalf
          ? `Request for "${selected.productName}" was filed for ${ownerName || "the client"}.`
          : `"${selected.productName}" is now awaiting admin approval.`,
      });
      onOpenChange(false);
      onSubmitted?.();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not submit request",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] min-w-0 max-w-lg overflow-x-hidden overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5 text-red-600" />
            Request deletion
          </DialogTitle>
          <DialogDescription>
            {onBehalf
              ? `File a delete request for ${ownerName || "this client"}. It still needs an approval before the entry is removed.`
              : "Pick the inventory entry you want removed. An admin reviews it before anything is deleted."}
          </DialogDescription>
        </DialogHeader>

        <div className="min-w-0 space-y-4">
          <div className="min-w-0 space-y-1.5">
            <Label>Product</Label>
            {sortedInventory.length === 0 ? (
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                No inventory available
              </div>
            ) : (
              <div className="min-w-0 overflow-hidden rounded-md border">
                <div className="relative border-b">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search by name or SKU…"
                    className="border-0 pl-9 focus-visible:ring-0 focus-visible:ring-offset-0"
                  />
                </div>
                <div className="max-h-56 overflow-y-auto p-1">
                  {filteredInventory.length === 0 ? (
                    <p className="px-2 py-6 text-center text-sm text-muted-foreground">
                      No matching products.
                    </p>
                  ) : (
                    filteredInventory.map((item) => {
                      const pending = pendingProductIds?.has(item.id) ?? false;
                      const active = productId === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setProductId(item.id)}
                          className={cn(
                            "flex min-w-0 w-full items-center gap-2 overflow-hidden rounded-sm px-2 py-1.5 text-left hover:bg-accent",
                            active && "bg-accent"
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.productName}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {item.quantity} units
                              {item.sku ? ` · SKU ${item.sku}` : ""}
                            </p>
                          </div>
                          {pending ? (
                            <Badge
                              variant="outline"
                              className="shrink-0 border-amber-300 bg-amber-50 text-[10px] text-amber-900"
                            >
                              Requested
                            </Badge>
                          ) : null}
                          {active ? (
                            <Check className="h-4 w-4 shrink-0 text-primary" />
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
            {alreadyRequested ? (
              <p className="text-xs text-amber-700">
                This product already has a request awaiting review.
              </p>
            ) : null}
          </div>

          {selected ? (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
              <p>
                <span className="text-muted-foreground">Quantity:</span> {selected.quantity} units
              </p>
              <p>
                <span className="text-muted-foreground">Status:</span> {selected.status}
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="delete-request-reason">Reason</Label>
            <Textarea
              id="delete-request-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why should this entry be deleted?"
              rows={3}
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Approving this request permanently removes the entry from inventory. It stays
              visible in the deleted logs.
            </span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selected || !reason.trim() || submitting || alreadyRequested}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
