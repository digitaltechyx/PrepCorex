"use client";

import { Timestamp } from "firebase/firestore";
import { createOutboundRequestWithClientReserve } from "@/lib/client-inventory-outbound-sync";
import type { LexiOutboundCreatePayload } from "@/lib/lexi/types";

export async function lexiCreateOutboundOnClient(
  payload: LexiOutboundCreatePayload,
  adminUid: string
): Promise<{ requestId: string; message: string }> {
  if (!payload.lines?.length) {
    throw new Error("Outbound must include at least one product line.");
  }

  const now = Timestamp.now();
  const shipments = payload.lines.map((line) => {
    const row: Record<string, unknown> = {
      productId: line.productId,
      productName: line.productName,
      quantity: line.quantity,
      packOf: line.packOf,
      unitPrice: line.unitPrice,
      totalPrice: line.totalPrice,
    };
    if (line.sku) row.sku = line.sku;
    return row;
  });

  const totalUnits = payload.lines.reduce(
    (sum, line) => sum + line.quantity * line.packOf,
    0
  );
  const shipmentTotal = payload.lines.reduce((sum, line) => sum + line.totalPrice, 0);

  const requestData: Record<string, unknown> = {
    userId: payload.clientUserId,
    userName: payload.clientUserName,
    shipments,
    date: now,
    requestedAt: now,
    requestedBy: adminUid,
    status: "pending",
    shipmentType: "product",
    productType: payload.productType || "Standard",
    service: payload.service,
    shipmentPreference: payload.shipmentPreference,
    labelUrl: "",
    lexiCreatedBy: adminUid,
    approvalSource: null,
  };

  if (payload.fbaLabelWorkflow) {
    requestData.fbaLabelWorkflow = true;
  }
  if (payload.shipTo?.trim()) requestData.shipTo = payload.shipTo.trim();
  if (payload.remarks?.trim()) requestData.remarks = payload.remarks.trim();

  const { requestId } = await createOutboundRequestWithClientReserve({
    clientUserId: payload.clientUserId,
    requestData,
  });

  const lineSummary = payload.lines
    .map((line) => `${line.quantity}×pack${line.packOf} ${line.productName}`)
    .join("; ");

  return {
    requestId,
    message: `Outbound #${requestId} created for ${payload.clientUserName}. ${lineSummary}. ${totalUnits} units · $${shipmentTotal.toFixed(2)} total · ${payload.service} · ${payload.shipmentPreference}. Status: pending approval.`,
  };
}
