"use client";

import { useMemo, useState, type ChangeEvent } from "react";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, Plus, Trash2, ImagePlus, X, Upload } from "lucide-react";
import type { InventoryItem } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  EMPTY_INBOUND_TRACKING,
  InboundTrackingFields,
  type InboundTrackingInput,
} from "@/components/inventory/inbound-tracking-fields";
import { buildReturnTrackingEntries } from "@/lib/return-tracking-client";
import {
  createEmptyReturnDraft,
  returnDraftLabel,
  returnDraftToFirestore,
  validateReturnDraft,
  type ReturnDraft,
} from "@/lib/product-return-draft";
import {
  uploadProductReturnImage,
  validateProductReturnImageFile,
} from "@/lib/product-return-images";
import { ProductReturnBulkImportDialog } from "@/components/dashboard/product-return-bulk-import-dialog";
import { canUseCsvImportOnBehalf } from "@/lib/csv-import-permissions";

export interface ProductReturnRequestFormProps {
  targetUserId?: string;
  targetUserInventory?: InventoryItem[];
  onSuccess?: () => void;
}

function ReturnDraftEditor({
  draft,
  index,
  inventory,
  showPerItemTracking,
  canRemove,
  onChange,
  onRemove,
}: {
  draft: ReturnDraft;
  index: number;
  inventory: InventoryItem[];
  showPerItemTracking: boolean;
  canRemove: boolean;
  onChange: (next: ReturnDraft) => void;
  onRemove: () => void;
}) {
  const { toast } = useToast();
  const availableInventory = inventory.filter((item) => {
    const inventoryType = (item as InventoryItem & { inventoryType?: string }).inventoryType;
    const isExcludedType =
      inventoryType === "box" || inventoryType === "container" || inventoryType === "pallet";
    return item.status === "In Stock" && (item.quantity || 0) > 0 && !isExcludedType;
  });

  const patch = (partial: Partial<ReturnDraft>) => onChange({ ...draft, ...partial });

  const handleProductSelect = (productId: string) => {
    const product = availableInventory.find((item) => item.id === productId);
    onChange({
      ...draft,
      productId,
      productName: product?.productName || "",
      sku: String(product?.sku ?? "").trim(),
    });
  };

  const handleImageSelect = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const err = validateProductReturnImageFile(file);
    if (err) {
      toast({ variant: "destructive", title: "Invalid image", description: err });
      return;
    }
    if (draft.imagePreviewUrl) URL.revokeObjectURL(draft.imagePreviewUrl);
    patch({
      imageFile: file,
      imagePreviewUrl: URL.createObjectURL(file),
    });
  };

  const clearImage = () => {
    if (draft.imagePreviewUrl) URL.revokeObjectURL(draft.imagePreviewUrl);
    patch({ imageFile: undefined, imagePreviewUrl: undefined });
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-4">
        <div className="space-y-2">
          <Label className="text-base font-medium">Return Type</Label>
          <RadioGroup
            value={draft.type}
            onValueChange={(v) => patch({ type: v as ReturnDraft["type"], productId: "", productName: "", sku: "" })}
            className="flex flex-row gap-6"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="existing" id={`${draft.id}-existing`} />
              <Label htmlFor={`${draft.id}-existing`} className="font-normal cursor-pointer">
                Existing Product
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="new" id={`${draft.id}-new`} />
              <Label htmlFor={`${draft.id}-new`} className="font-normal cursor-pointer">
                New Inventory Product
              </Label>
            </div>
          </RadioGroup>
        </div>

        <div className="space-y-2">
          <Label>How are products coming? *</Label>
          <Select value={draft.returnType} onValueChange={(v) => patch({ returnType: v as ReturnDraft["returnType"] })}>
            <SelectTrigger className="rounded-lg h-11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="combine">Combine — all together</SelectItem>
              <SelectItem value="partial">Partial — separate batches</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-4">
        {draft.type === "existing" ? (
          <>
            <div className="space-y-2">
              <Label>Select Product *</Label>
              <Select value={draft.productId} onValueChange={handleProductSelect}>
                <SelectTrigger className="rounded-lg h-11">
                  <SelectValue placeholder="Select a product" />
                </SelectTrigger>
                <SelectContent>
                  {availableInventory.length === 0 ? (
                    <SelectItem value="_none" disabled>
                      No products available
                    </SelectItem>
                  ) : (
                    availableInventory.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.productName} (Qty: {item.quantity || 0})
                        {item.sku ? ` — SKU: ${item.sku}` : ""}
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
            </div>
            {draft.productId ? (
              <>
                <div className="space-y-2">
                  <Label>Product Name</Label>
                  <Input value={draft.productName} readOnly className="rounded-lg h-11 bg-muted/50" />
                </div>
                <div className="space-y-2">
                  <Label>SKU</Label>
                  <Input value={draft.sku} readOnly className="rounded-lg h-11 bg-muted/50" />
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="space-y-2">
              <Label>Product Name *</Label>
              <Input
                value={draft.newProductName}
                onChange={(e) => patch({ newProductName: e.target.value })}
                placeholder="Enter product name"
                className="rounded-lg h-11"
              />
            </div>
            <div className="space-y-2">
              <Label>SKU (optional)</Label>
              <Input
                value={draft.newProductSku}
                onChange={(e) => patch({ newProductSku: e.target.value })}
                placeholder="Enter SKU"
                className="rounded-lg h-11"
              />
            </div>
          </>
        )}

        <div className="space-y-2">
          <Label>Requested Quantity *</Label>
          <Input
            type="number"
            min={1}
            value={draft.requestedQuantity}
            onChange={(e) =>
              patch({ requestedQuantity: e.target.value === "" ? "" : Number(e.target.value) })
            }
            placeholder="Enter quantity"
            className="rounded-lg h-11"
          />
        </div>

        <div className="space-y-2">
          <Label>Remarks (optional)</Label>
          <Textarea
            value={draft.userRemarks}
            onChange={(e) => patch({ userRemarks: e.target.value })}
            placeholder="Notes for this return"
            rows={2}
            className="rounded-lg resize-y"
          />
        </div>

        <div className="space-y-2">
          <Label>Product image (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Upload a photo of the product or packaging to help warehouse review your return.
          </p>
          {draft.imagePreviewUrl ? (
            <div className="relative inline-block">
              <img
                src={draft.imagePreviewUrl}
                alt="Product return preview"
                className="h-28 w-28 rounded-lg border object-cover"
              />
              <Button
                type="button"
                variant="destructive"
                size="icon"
                className="absolute -right-2 -top-2 h-7 w-7 rounded-full"
                onClick={clearImage}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <div>
              <Input
                id={`return-image-${draft.id}`}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleImageSelect}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => document.getElementById(`return-image-${draft.id}`)?.click()}
              >
                <ImagePlus className="mr-2 h-4 w-4" />
                Upload image
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-border/50 bg-muted/20 p-4">
        <h4 className="text-sm font-semibold">Additional Services (optional)</h4>
        <label className="flex items-start gap-3">
          <Checkbox
            checked={draft.packIntoBoxes}
            onCheckedChange={(c) => patch({ packIntoBoxes: c === true })}
          />
          <span className="text-sm leading-snug">Pack into boxes</span>
        </label>
        <label className="flex items-start gap-3">
          <Checkbox
            checked={draft.placeOnPallet}
            onCheckedChange={(c) => patch({ placeOnPallet: c === true })}
          />
          <span className="text-sm leading-snug">Place on pallet</span>
        </label>
        <label className="flex items-start gap-3">
          <Checkbox
            checked={draft.shipToAddress}
            onCheckedChange={(c) => patch({ shipToAddress: c === true })}
          />
          <span className="text-sm leading-snug">Ship to another address</span>
        </label>

        {draft.shipToAddress ? (
          <div className="space-y-3 pl-2 border-l-2">
            <Input
              value={draft.shippingName}
              onChange={(e) => patch({ shippingName: e.target.value })}
              placeholder="Recipient name"
            />
            <Textarea
              value={draft.shippingAddress}
              onChange={(e) => patch({ shippingAddress: e.target.value })}
              placeholder="Address"
              rows={2}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={draft.shippingCity}
                onChange={(e) => patch({ shippingCity: e.target.value })}
                placeholder="City"
              />
              <Input
                value={draft.shippingState}
                onChange={(e) => patch({ shippingState: e.target.value })}
                placeholder="State"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Input
                value={draft.shippingZipCode}
                onChange={(e) => patch({ shippingZipCode: e.target.value })}
                placeholder="Zip"
              />
              <Input
                value={draft.shippingCountry}
                onChange={(e) => patch({ shippingCountry: e.target.value })}
                placeholder="Country"
              />
            </div>
          </div>
        ) : null}
      </div>

      {showPerItemTracking ? (
        <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-2">
          <Label className="text-sm font-medium">Return tracking (optional)</Label>
          <p className="text-xs text-muted-foreground">
            Carrier label for this return — warehouse uses it to match at the dock.
          </p>
          <InboundTrackingFields
            idPrefix={`return-trk-${draft.id}`}
            value={draft.tracking}
            onChange={(tracking: InboundTrackingInput) => patch({ tracking })}
            compact
          />
        </div>
      ) : null}

      {canRemove ? (
        <Button type="button" variant="outline" size="sm" className="text-destructive" onClick={onRemove}>
          <Trash2 className="h-4 w-4 mr-1" />
          Remove this return
        </Button>
      ) : null}
    </div>
  );
}

export function ProductReturnRequestForm({
  targetUserId,
  targetUserInventory = [],
  onSuccess,
}: ProductReturnRequestFormProps = {}) {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [drafts, setDrafts] = useState<ReturnDraft[]>([createEmptyReturnDraft()]);
  const [trackingMode, setTrackingMode] = useState<"shared" | "per_return">("shared");
  const [sharedTracking, setSharedTracking] = useState<InboundTrackingInput>({ ...EMPTY_INBOUND_TRACKING });
  const [openAccordion, setOpenAccordion] = useState("return-0");
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const isOnBehalfOfUser = !!targetUserId;
  const canImportReturnsOnBehalf = canUseCsvImportOnBehalf(userProfile, "product_returns");

  const { data: currentUserInventory } = useCollection<InventoryItem>(
    !isOnBehalfOfUser && userProfile ? `users/${userProfile.uid}/inventory` : ""
  );
  const inventory = (isOnBehalfOfUser ? targetUserInventory : currentUserInventory) ?? [];

  const multipleReturns = drafts.length > 1;
  const showPerItemTracking = multipleReturns && trackingMode === "per_return";

  const resetForm = () => {
    drafts.forEach((d) => {
      if (d.imagePreviewUrl) URL.revokeObjectURL(d.imagePreviewUrl);
    });
    setDrafts([createEmptyReturnDraft()]);
    setTrackingMode("shared");
    setSharedTracking({ ...EMPTY_INBOUND_TRACKING });
    setOpenAccordion("return-0");
  };

  const updateDraft = (id: string, next: ReturnDraft) => {
    setDrafts((prev) => prev.map((d) => (d.id === id ? next : d)));
  };

  const addDraft = () => {
    const next = createEmptyReturnDraft();
    setDrafts((prev) => {
      const list = [...prev, next];
      setOpenAccordion(`return-${list.length - 1}`);
      return list;
    });
  };

  const removeDraft = (id: string, index: number) => {
    setDrafts((prev) => {
      const removed = prev.find((d) => d.id === id);
      if (removed?.imagePreviewUrl) URL.revokeObjectURL(removed.imagePreviewUrl);
      const next = prev.filter((d) => d.id !== id);
      setOpenAccordion(`return-${Math.max(0, Math.min(index, next.length - 1))}`);
      return next.length > 0 ? next : [createEmptyReturnDraft()];
    });
  };

  const sharedTrackings = useMemo(
    () => buildReturnTrackingEntries(sharedTracking, userProfile?.uid ?? null),
    [sharedTracking, userProfile?.uid]
  );

  const handleSubmit = async () => {
    const userId = targetUserId || userProfile?.uid;
    if (!userId) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "You must be logged in to create a return request",
      });
      return;
    }

    for (let i = 0; i < drafts.length; i++) {
      const err = validateReturnDraft(drafts[i], i);
      if (err) {
        toast({ variant: "destructive", title: "Form incomplete", description: err });
        setOpenAccordion(`return-${i}`);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      const now = Timestamp.now();
      const addedBy = userProfile?.uid ?? null;

      for (const draft of drafts) {
        const returnTrackings = showPerItemTracking
            ? buildReturnTrackingEntries(draft.tracking, addedBy)
            : sharedTrackings;

        let imageUrls: string[] | undefined;
        if (draft.imageFile) {
          const url = await uploadProductReturnImage(userId, draft.imageFile);
          imageUrls = [url];
        }

        const payload = returnDraftToFirestore(draft, {
          userId,
          now,
          returnTrackings,
          addedBy,
          imageUrls,
        });

        await addDoc(collection(db, `users/${userId}/productReturns`), payload);
      }

      toast({
        title: "Success",
        description:
          drafts.length === 1
            ? isOnBehalfOfUser
              ? "Return request created for user."
              : "Product return request created successfully."
            : `${drafts.length} return requests submitted successfully.`,
      });

      resetForm();
      onSuccess?.();
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to create return request",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-semibold">Return requests</h3>
          <p className="text-sm text-muted-foreground">
            Add one or more returns, review each, then submit together.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOnBehalfOfUser && canImportReturnsOnBehalf ? (
            <Button
              type="button"
              variant="outline"
              disabled={!targetUserId}
              onClick={() => setBulkImportOpen(true)}
            >
              <Upload className="h-4 w-4 mr-2" />
              Import CSV
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={addDraft}>
            <Plus className="h-4 w-4 mr-2" />
            Add return
          </Button>
        </div>
      </div>

      {isOnBehalfOfUser && canImportReturnsOnBehalf ? (
        <ProductReturnBulkImportDialog
          open={bulkImportOpen}
          onOpenChange={setBulkImportOpen}
          ownerId={targetUserId || ""}
          inventory={inventory}
          onSuccess={onSuccess}
        />
      ) : null}

      {drafts.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8 border border-dashed rounded-xl">
          Click &quot;Add return&quot; to start.
        </p>
      ) : (
        <Accordion
          type="single"
          collapsible
          value={openAccordion}
          onValueChange={setOpenAccordion}
          className="space-y-3"
        >
          {drafts.map((draft, index) => (
            <AccordionItem
              key={draft.id}
              value={`return-${index}`}
              className="border-2 rounded-lg px-4"
            >
              <div className="relative">
                <AccordionTrigger className="hover:no-underline pr-10">
                  <div className="text-left">
                    <div className="text-sm font-semibold">
                      Return {index + 1}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        {returnDraftLabel(draft)}
                        {draft.requestedQuantity ? ` · Qty ${draft.requestedQuantity}` : ""}
                      </span>
                    </div>
                  </div>
                </AccordionTrigger>
                {drafts.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="absolute right-0 top-3 h-8 w-8 p-0 text-destructive"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeDraft(draft.id, index);
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
              <AccordionContent className="pt-2 pb-4">
                <ReturnDraftEditor
                  draft={draft}
                  index={index}
                  inventory={inventory}
                  showPerItemTracking={showPerItemTracking}
                  canRemove={drafts.length > 1}
                  onChange={(next) => updateDraft(draft.id, next)}
                  onRemove={() => removeDraft(draft.id, index)}
                />
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}

      <div className="rounded-xl border border-border/50 bg-muted/20 p-4 space-y-4">
        <div>
          <h4 className="text-sm font-semibold">Return shipment tracking (optional)</h4>
          <p className="text-xs text-muted-foreground mt-1">
            Add carrier tracking now or later from your return history. You can also add more
            tracking numbers after submit.
          </p>
        </div>

        {multipleReturns ? (
          <RadioGroup
            value={trackingMode}
            onValueChange={(v) => setTrackingMode(v as "shared" | "per_return")}
            className="flex flex-col gap-2 sm:flex-row sm:gap-6"
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="shared" id="return-trk-shared" />
              <Label htmlFor="return-trk-shared" className="font-normal cursor-pointer">
                Same tracking for all returns
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="per_return" id="return-trk-per" />
              <Label htmlFor="return-trk-per" className="font-normal cursor-pointer">
                Different tracking per return
              </Label>
            </div>
          </RadioGroup>
        ) : null}

        {(!multipleReturns || trackingMode === "shared") && (
          <InboundTrackingFields
            idPrefix="return-trk-shared"
            value={sharedTracking}
            onChange={setSharedTracking}
          />
        )}

        {multipleReturns && trackingMode === "per_return" ? (
          <p className="text-xs text-muted-foreground">
            Open each return above to add its own tracking number.
          </p>
        ) : null}
      </div>

      <Button
        type="button"
        disabled={isSubmitting || drafts.length === 0}
        className="w-full rounded-lg h-11 bg-orange-600 hover:bg-orange-700 font-medium"
        onClick={() => void handleSubmit()}
      >
        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        Submit {drafts.length > 1 ? `${drafts.length} return requests` : "return request"}
      </Button>
    </div>
  );
}
