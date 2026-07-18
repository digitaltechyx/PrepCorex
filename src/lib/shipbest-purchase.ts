import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  shipbestCreateOrder,
  shipbestWaitForLabel,
} from "@/lib/shipbest-api";
import type { ParcelDetails, ShippingAddress } from "@/types";

export function buildShipBestCustomNo(userId: string, labelPurchaseId: string): string {
  return `PCX-${userId.slice(0, 6)}-${labelPurchaseId}`.slice(0, 50);
}

export async function purchaseLabelFromShipBest({
  labelPurchaseId,
  userId,
  customNo,
  logisticsProductCode,
  logisticsProductId,
  fromAddress,
  toAddress,
  parcel,
}: {
  labelPurchaseId: string;
  userId: string;
  customNo: string;
  logisticsProductCode: string;
  logisticsProductId?: number;
  fromAddress: ShippingAddress;
  toAddress: ShippingAddress;
  parcel: Pick<ParcelDetails, "length" | "width" | "height"> & { weight: number };
}) {
  const labelPurchaseRef = adminDb()
    .collection(`users/${userId}/labelPurchases`)
    .doc(labelPurchaseId);

  try {
    await shipbestCreateOrder({
      customNo,
      logisticsProductCode,
      logisticsProductId,
      fromAddress,
      toAddress,
      parcel,
    });

    const detail = await shipbestWaitForLabel(customNo);

    await labelPurchaseRef.update({
      status: "label_purchased",
      labelProvider: "shipbest",
      shipbestOrderNo: detail.orderNo || null,
      shipbestCustomNo: customNo,
      trackingNumber: detail.trackingNo || null,
      labelUrl: detail.labelUrl || null,
      labelPurchasedAt: adminFieldValue().serverTimestamp(),
      ...(detail.status === 3
        ? { errorMessage: detail.errorMsg || "ShipBest reported an error" }
        : {}),
    });

    return {
      success: true,
      orderNo: detail.orderNo,
      tracking_number: detail.trackingNo,
      label_url: detail.labelUrl,
      status: detail.status,
    };
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Failed to purchase ShipBest label";
    await labelPurchaseRef.update({
      status: "label_failed",
      labelProvider: "shipbest",
      shipbestCustomNo: customNo,
      errorMessage: message,
    });
    throw error;
  }
}
