"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, ChevronsUpDown, Loader2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) return;
    setProductId("");
    setReason("");
    setPickerOpen(false);
  }, [open]);

  const sortedInventory = useMemo(
    () =>
      [...inventory].sort((a, b) =>
        (a.productName || "").localeCompare(b.productName || "")
      ),
    [inventory]
  );
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
      <DialogContent className="sm:max-w-lg">
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

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Product</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  disabled={sortedInventory.length === 0}
                  className={cn(
                    "w-full justify-between font-normal",
                    !selected && "text-muted-foreground"
                  )}
                >
                  <span className="truncate">
                    {selected
                      ? selected.productName
                      : sortedInventory.length === 0
                        ? "No inventory available"
                        : "Search or select a product…"}
                  </span>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0"
                align="start"
              >
                <Command>
                  <CommandInput placeholder="Search by name or SKU…" />
                  <CommandList>
                    <CommandEmpty>No matching products.</CommandEmpty>
                    <CommandGroup>
                      {sortedInventory.map((item) => {
                        const pending = pendingProductIds?.has(item.id) ?? false;
                        return (
                          <CommandItem
                            key={item.id}
                            value={`${item.productName} ${item.sku ?? ""}`}
                            onSelect={() => {
                              setProductId(item.id);
                              setPickerOpen(false);
                            }}
                            className="gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{item.productName}</p>
                              <p className="text-[11px] text-muted-foreground">
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
                            {productId === item.id ? (
                              <Check className="h-4 w-4 shrink-0 text-primary" />
                            ) : null}
                          </CommandItem>
                        );
                      })}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
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
