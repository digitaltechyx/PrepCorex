"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2, ShieldAlert } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { submitQuarantineRequest } from "@/lib/quarantine-request-ops";
import { cn } from "@/lib/utils";
import type { InventoryItem, QuarantineRequestKind } from "@/types";

const KIND_COPY: Record<
  QuarantineRequestKind,
  { label: string; help: string; qtyLabel: string }
> = {
  quarantine: {
    label: "Move to quarantine",
    help: "Hold sellable stock in the warehouse quarantine area so it cannot be picked for orders.",
    qtyLabel: "Sellable on hand",
  },
  release: {
    label: "Release from quarantine",
    help: "Return quarantined stock to normal storage so it becomes sellable again.",
    qtyLabel: "In quarantine",
  },
  dispose: {
    label: "Dispose from quarantine",
    help: "Scrap quarantined stock. It moves to your disposed inventory with a full audit trail.",
    qtyLabel: "In quarantine",
  },
};

/** Units eligible for the given request kind. */
export function availableQtyForKind(item: InventoryItem, kind: QuarantineRequestKind): number {
  if (kind === "quarantine") return Math.max(0, Number(item.quantity) || 0);
  return Math.max(0, Number(item.damagedQuantity) || 0);
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Inventory owner the request is filed against. */
  userId: string;
  userName: string;
  inventory: InventoryItem[];
  submitterUid: string;
  submitterName: string;
  /** Admin filing the request for a client. */
  onBehalf?: boolean;
  /** Locks the dialog to a single action. */
  fixedKind?: QuarantineRequestKind;
  /** Items that already have a request in flight. */
  openProductIds?: ReadonlySet<string>;
  onSubmitted?: () => void;
};

export function QuarantineRequestDialog({
  open,
  onOpenChange,
  userId,
  userName,
  inventory,
  submitterUid,
  submitterName,
  onBehalf = false,
  fixedKind,
  openProductIds,
  onSubmitted,
}: Props) {
  const { toast } = useToast();
  const [kind, setKind] = useState<QuarantineRequestKind>(fixedKind ?? "quarantine");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) return;
    setKind(fixedKind ?? "quarantine");
    setProductId("");
    setQuantity("1");
    setReason("");
    setPickerOpen(false);
  }, [open, fixedKind]);

  const eligible = useMemo(
    () =>
      [...inventory]
        .filter((item) => availableQtyForKind(item, kind) > 0)
        .sort((a, b) => (a.productName || "").localeCompare(b.productName || "")),
    [inventory, kind]
  );

  const selected = eligible.find((i) => i.id === productId) ?? null;
  const maxQty = selected ? availableQtyForKind(selected, kind) : 0;
  const qtyNum = Math.floor(Number(quantity));
  const qtyError =
    !selected || !quantity.trim()
      ? null
      : !Number.isFinite(qtyNum) || qtyNum < 1
        ? "Enter a quantity of at least 1."
        : qtyNum > maxQty
          ? `Only ${maxQty} unit${maxQty === 1 ? "" : "s"} available.`
          : null;
  const alreadyOpen = productId ? openProductIds?.has(productId) ?? false : false;
  const copy = KIND_COPY[kind];

  // Switching action changes which products (and how many units) are eligible.
  useEffect(() => {
    if (productId && !eligible.some((i) => i.id === productId)) setProductId("");
  }, [eligible, productId]);

  const handleSubmit = async () => {
    if (!selected || !userId || qtyError) return;
    setSubmitting(true);
    try {
      await submitQuarantineRequest({
        userId,
        userName,
        kind,
        item: selected,
        quantity: qtyNum,
        reason,
        requestedBy: submitterUid,
        requestedByName: submitterName,
        onBehalf,
      });
      toast({
        title: "Request submitted",
        description: onBehalf
          ? `${copy.label} for "${selected.productName}" was filed for ${userName || "the client"}.`
          : `"${selected.productName}" is now awaiting approval.`,
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
            <ShieldAlert className="h-5 w-5 text-amber-600" />
            Quarantine request
          </DialogTitle>
          <DialogDescription>
            {onBehalf
              ? `File a quarantine request for ${userName || "this client"}. It still needs an approval before the warehouse moves anything.`
              : "The warehouse moves the stock once this is approved. Nothing changes until then."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {fixedKind ? null : (
            <div className="space-y-1.5">
              <Label>Action</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as QuarantineRequestKind)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(KIND_COPY) as QuarantineRequestKind[]).map((k) => (
                    <SelectItem key={k} value={k}>
                      {KIND_COPY[k].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{copy.help}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Product</Label>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  role="combobox"
                  aria-expanded={pickerOpen}
                  disabled={eligible.length === 0}
                  className={cn(
                    "w-full justify-between font-normal",
                    !selected && "text-muted-foreground"
                  )}
                >
                  <span className="truncate">
                    {selected
                      ? selected.productName
                      : eligible.length === 0
                        ? kind === "quarantine"
                          ? "No sellable stock available"
                          : "Nothing in quarantine"
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
                      {eligible.map((item) => {
                        const pending = openProductIds?.has(item.id) ?? false;
                        return (
                          <CommandItem
                            key={item.id}
                            value={`${item.productName} ${item.sku ?? ""}`}
                            onSelect={() => {
                              setProductId(item.id);
                              setQuantity(String(availableQtyForKind(item, kind)));
                              setPickerOpen(false);
                            }}
                            className="gap-2"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{item.productName}</p>
                              <p className="text-[11px] text-muted-foreground">
                                {copy.qtyLabel}: {availableQtyForKind(item, kind)}
                                {item.sku ? ` · SKU ${item.sku}` : ""}
                              </p>
                            </div>
                            {pending ? (
                              <Badge
                                variant="outline"
                                className="shrink-0 border-amber-300 bg-amber-50 text-[10px] text-amber-900"
                              >
                                In progress
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
            {alreadyOpen ? (
              <p className="text-xs text-amber-700">
                This product already has a request the warehouse has not finished yet.
              </p>
            ) : null}
          </div>

          {selected ? (
            <div className="space-y-1.5">
              <Label htmlFor="quarantine-request-qty">Quantity</Label>
              <div className="flex items-center gap-3">
                <Input
                  id="quarantine-request-qty"
                  type="number"
                  min={1}
                  max={maxQty}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-28"
                />
                <span className="text-sm text-muted-foreground">
                  of {maxQty} · {copy.qtyLabel.toLowerCase()}
                </span>
              </div>
              {qtyError ? <p className="text-xs text-red-600">{qtyError}</p> : null}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="quarantine-request-reason">Reason</Label>
            <Textarea
              id="quarantine-request-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                kind === "quarantine"
                  ? "e.g. suspected damage found by customer, recall, expiry check"
                  : kind === "release"
                    ? "e.g. inspected and confirmed sellable"
                    : "e.g. confirmed unsellable after inspection"
              }
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!selected || !reason.trim() || submitting || alreadyOpen || Boolean(qtyError)}
          >
            {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Submit request
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
