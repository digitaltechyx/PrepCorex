"use client";

import { doc, getDoc, Timestamp } from "firebase/firestore";
import { createOutboundRequestWithClientReserve } from "@/lib/client-inventory-outbound-sync";
import { db } from "@/lib/firebase";
import type { LexiOutboundCreatePayload } from "@/lib/lexi/types";
import type { InventoryItem } from "@/types";

export async function lexiCreateOutboundOnClient(
  payload: LexiOutboundCreatePayload,
  adminUid: string
): Promise<{ requestId: string; message: string }> {
  const productRef = doc(db, `users/${payload.clientUserId}/inventory`, payload.productId);
  const productSnap = await getDoc(productRef);
  if (!productSnap.exists()) {
    throw new Error("Product not found on this client's inventory.");
  }

  const product = { id: productSnap.id, ...productSnap.data() } as InventoryItem & {
    unitPrice?: number;
  };
  const packOf = Math.max(1, Math.floor(payload.packOf ?? 1));
  const quantity = Math.floor(payload.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("Quantity must be greater than zero.");
  }

  const totalUnits = quantity * packOf;
  const available = Math.max(0, Number(product.quantity) || 0);
  if (totalUnits > available) {
    throw new Error(
      `Not enough stock for ${product.productName}. Available: ${available}, requested: ${totalUnits}.`
    );
  }

  const now = Timestamp.now();
  const shipment: Record<string, unknown> = {
    productId: product.id,
    productName: product.productName || payload.productName,
    quantity,
    packOf,
    unitPrice: Number(product.unitPrice) || 0,
  };
  if (product.sku) shipment.sku = product.sku;
  if (product.retailIdentifier) shipment.retailIdentifier = product.retailIdentifier;

  const requestData: Record<string, unknown> = {
    userId: payload.clientUserId,
    userName: payload.clientUserName,
    shipments: [shipment],
    date: now,
    requestedAt: now,
    requestedBy: adminUid,
    status: "pending",
    shipmentType: "product",
    productType: "Standard",
    service: payload.service?.trim() || "FBA/WFS/TFS",
    labelUrl: "",
    lexiCreatedBy: adminUid,
    approvalSource: null,
  };
  if (payload.shipTo?.trim()) requestData.shipTo = payload.shipTo.trim();
  if (payload.remarks?.trim()) requestData.remarks = payload.remarks.trim();
  if (payload.sku?.trim() && !shipment.sku) shipment.sku = payload.sku.trim();

  const { requestId } = await createOutboundRequestWithClientReserve({
    clientUserId: payload.clientUserId,
    requestData,
  });

  return {
    requestId,
    message: `Outbound request created for ${payload.clientUserName} (#${requestId}). ${totalUnits} units reserved. Status: pending approval.`,
  };
}
