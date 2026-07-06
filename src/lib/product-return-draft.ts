import { Timestamp } from "firebase/firestore";
import { stripUndefined } from "@/lib/utils";
import { buildReturnTrackingEntries } from "@/lib/return-tracking-client";
import type { InboundTrackingInput } from "@/components/inventory/inbound-tracking-fields";
import { EMPTY_INBOUND_TRACKING } from "@/components/inventory/inbound-tracking-fields";
import type { InboundTrackingEntry } from "@/types";

export type ReturnDraft = {
  id: string;
  type: "existing" | "new";
  returnType: "combine" | "partial";
  productId: string;
  productName: string;
  sku: string;
  newProductName: string;
  newProductSku: string;
  requestedQuantity: number | "";
  userRemarks: string;
  /** Client-only until submit; uploaded to Storage on create. */
  imageFile?: File;
  imagePreviewUrl?: string;
  packIntoBoxes: boolean;
  placeOnPallet: boolean;
  shipToAddress: boolean;
  shippingName: string;
  shippingAddress: string;
  shippingCity: string;
  shippingState: string;
  shippingZipCode: string;
  shippingCountry: string;
  tracking: InboundTrackingInput;
};

export function createEmptyReturnDraft(): ReturnDraft {
  const id =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `rd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    type: "existing",
    returnType: "combine",
    productId: "",
    productName: "",
    sku: "",
    newProductName: "",
    newProductSku: "",
    requestedQuantity: "",
    userRemarks: "",
    packIntoBoxes: false,
    placeOnPallet: false,
    shipToAddress: false,
    shippingName: "",
    shippingAddress: "",
    shippingCity: "",
    shippingState: "",
    shippingZipCode: "",
    shippingCountry: "",
    tracking: { ...EMPTY_INBOUND_TRACKING },
  };
}

export function validateReturnDraft(
  draft: ReturnDraft,
  index: number
): string | null {
  const label = `Return ${index + 1}`;
  if (draft.type === "existing" && !draft.productId) {
    return `${label}: select a product.`;
  }
  if (draft.type === "new" && !draft.newProductName.trim()) {
    return `${label}: enter product name.`;
  }
  const qty = Number(draft.requestedQuantity);
  if (!Number.isFinite(qty) || qty <= 0) {
    return `${label}: enter a positive quantity.`;
  }
  if (draft.shipToAddress) {
    if (
      !draft.shippingName.trim() ||
      !draft.shippingAddress.trim() ||
      !draft.shippingCity.trim() ||
      !draft.shippingState.trim() ||
      !draft.shippingZipCode.trim() ||
      !draft.shippingCountry.trim()
    ) {
      return `${label}: complete all shipping address fields.`;
    }
  }
  return null;
}

export function returnDraftLabel(draft: ReturnDraft): string {
  if (draft.type === "existing") {
    return draft.productName.trim() || "Existing product return";
  }
  return draft.newProductName.trim() || "New product return";
}

export function returnDraftToFirestore(
  draft: ReturnDraft,
  context: {
    userId: string;
    now: Timestamp;
    returnTrackings?: InboundTrackingEntry[];
    addedBy?: string | null;
    imageUrls?: string[];
  }
): Record<string, unknown> {
  const additionalServices: Record<string, unknown> = {
    packIntoBoxes: draft.packIntoBoxes,
    placeOnPallet: draft.placeOnPallet,
    shipToAddress: draft.shipToAddress,
  };

  if (draft.shipToAddress) {
    additionalServices.shippingAddress = stripUndefined({
      name: draft.shippingName.trim(),
      address: draft.shippingAddress.trim(),
      city: draft.shippingCity.trim(),
      state: draft.shippingState.trim(),
      zipCode: draft.shippingZipCode.trim(),
      country: draft.shippingCountry.trim(),
    });
  }

  const hasAdditionalServices =
    draft.packIntoBoxes || draft.placeOnPallet || draft.shipToAddress;

  const returnData: Record<string, unknown> = {
    userId: context.userId,
    type: draft.type,
    returnType: draft.returnType,
    requestedQuantity: Number(draft.requestedQuantity),
    receivedQuantity: 0,
    status: "pending",
    createdAt: context.now,
    updatedAt: context.now,
    userRemarks: draft.userRemarks.trim() || "",
  };

  if (hasAdditionalServices) {
    returnData.additionalServices = additionalServices;
  }

  if (draft.type === "existing") {
    returnData.productId = draft.productId;
    returnData.productName = draft.productName.trim();
    const sku = draft.sku.trim();
    if (sku) returnData.sku = sku;
  } else {
    returnData.newProductName = draft.newProductName.trim();
    returnData.productName = draft.newProductName.trim();
    const newSku = draft.newProductSku.trim();
    if (newSku) returnData.newProductSku = newSku;
  }

  const trackings =
    context.returnTrackings ??
    buildReturnTrackingEntries(draft.tracking, context.addedBy);
  if (trackings.length > 0) {
    returnData.returnTrackings = trackings;
  }

  const images = (context.imageUrls ?? []).filter(Boolean);
  if (images.length > 0) {
    returnData.imageUrls = images;
    returnData.imageUrl = images[0];
  }

  return stripUndefined(returnData);
}
