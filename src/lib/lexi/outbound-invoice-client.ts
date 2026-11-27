"use client";

import { format } from "date-fns";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { DEFAULT_ADDITIONAL_SERVICES, isLegacyAdditionalServiceKey } from "@/lib/additional-services-catalog";
import { applyClientInvoiceLifecycleFields } from "@/lib/client-invoice-lifecycle";
import {
  appendLinesToCrmOutboundDraft,
  buildCrmLinesFromShipments,
  markShipmentsLinkedToCrmDraft,
} from "@/lib/crm-outbound-draft-invoice";
import { db } from "@/lib/firebase";
import { generateInvoiceNumber } from "@/lib/invoice-utils";
import { allowsPrepcorexCreateInvoice } from "@/lib/outbound-billing";
import {
  normalizeShipmentItems,
  resolveOutboundAdditionalServicesPayload,
  type OutboundAdditionalServicesPayload,
} from "@/lib/shipment-utils";
import type { LexiOutboundInvoicePayload } from "@/lib/lexi/types";
import type { ShippedItem, UserProfile } from "@/types";

function serviceLabelForKey(key: string): string {
  return (
    DEFAULT_ADDITIONAL_SERVICES.find((row) => row.key === key)?.name ||
    key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())
  );
}

function resolveShipDate(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return format(d, "dd/MM/yyyy");
    return value;
  }
  if (value && typeof value === "object" && "seconds" in (value as object)) {
    const seconds = Number((value as { seconds?: number }).seconds || 0);
    if (seconds > 0) return format(new Date(seconds * 1000), "dd/MM/yyyy");
  }
  return fallback;
}

function buildServiceLines(shipments: ShippedItem[]): Array<{
  description: string;
  quantity: number;
  unitPrice: number;
}> {
  const lines: Array<{ description: string; quantity: number; unitPrice: number }> = [];
  const mergedQty: Record<string, number> = {};
  const mergedPrice: Record<string, number> = {};

  const absorb = (add: OutboundAdditionalServicesPayload | null | undefined) => {
    if (!add) return;
    const bubble = Number(add.bubbleWrapFeet || 0);
    const sticker = Number(add.stickerRemovalItems || 0);
    const warn = Number(add.warningLabels || 0);
    if (bubble > 0) {
      mergedQty.bubbleWrap = (mergedQty.bubbleWrap || 0) + bubble;
      if (!(mergedPrice.bubbleWrap > 0)) mergedPrice.bubbleWrap = Number(add.pricePerFoot || 0);
    }
    if (sticker > 0) {
      mergedQty.stickerRemoval = (mergedQty.stickerRemoval || 0) + sticker;
      if (!(mergedPrice.stickerRemoval > 0)) {
        mergedPrice.stickerRemoval = Number(add.pricePerItem || 0);
      }
    }
    if (warn > 0) {
      mergedQty.warningLabels = (mergedQty.warningLabels || 0) + warn;
      if (!(mergedPrice.warningLabels > 0)) {
        mergedPrice.warningLabels = Number(add.pricePerLabel || 0);
      }
    }
    const extras = add.extraServiceQuantities || {};
    const extraPrices = add.extraServiceUnitPrices || {};
    Object.entries(extras).forEach(([key, qty]) => {
      if (isLegacyAdditionalServiceKey(key)) return;
      const n = Math.floor(Number(qty) || 0);
      if (!key || n <= 0) return;
      mergedQty[key] = (mergedQty[key] || 0) + n;
      if (!(mergedPrice[key] > 0)) mergedPrice[key] = Number(extraPrices[key] || 0);
    });
  };

  for (const shipped of shipments) {
    absorb(
      resolveOutboundAdditionalServicesPayload(shipped) ||
        (shipped.additionalServices as OutboundAdditionalServicesPayload | undefined)
    );
  }

  const pushOrder = ["bubbleWrap", "stickerRemoval", "warningLabels"];
  const keys = [
    ...pushOrder.filter((k) => (mergedQty[k] || 0) > 0),
    ...Object.keys(mergedQty).filter((k) => !pushOrder.includes(k) && (mergedQty[k] || 0) > 0),
  ];
  for (const key of keys) {
    lines.push({
      description: serviceLabelForKey(key),
      quantity: mergedQty[key],
      unitPrice: Number(mergedPrice[key] || 0),
    });
  }
  return lines;
}

async function loadShippedRows(
  clientUserId: string,
  requestId: string,
  shippedIds?: string[]
): Promise<ShippedItem[]> {
  if (shippedIds && shippedIds.length > 0) {
    const rows: ShippedItem[] = [];
    for (const id of shippedIds) {
      const snap = await getDoc(doc(db, `users/${clientUserId}/shipped`, id));
      if (snap.exists()) {
        rows.push({ id: snap.id, ...(snap.data() as Omit<ShippedItem, "id">) });
      }
    }
    return rows;
  }
  const snap = await getDocs(
    query(
      collection(db, `users/${clientUserId}/shipped`),
      where("shipmentRequestId", "==", requestId)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ShippedItem, "id">) }));
}

/**
 * Create PrepCorex outbound invoice (billing On) or append CRM consolidated draft (billing Off).
 * Uses shipment lines + additional services already on the shipped/request docs.
 */
export async function lexiCreateOutboundInvoiceOnClient(
  payload: LexiOutboundInvoicePayload,
  operatorId: string
): Promise<string> {
  const clientSnap = await getDoc(doc(db, "users", payload.clientUserId));
  if (!clientSnap.exists()) throw new Error("Client not found.");
  const clientData = clientSnap.data() as UserProfile;
  const clientUser: Pick<UserProfile, "uid" | "name" | "email" | "phone" | "outboundBilling"> = {
    uid: payload.clientUserId,
    name: String(clientData.name || payload.clientUserName || "Client"),
    email: String(clientData.email || ""),
    phone: String(clientData.phone || ""),
    outboundBilling: clientData.outboundBilling,
  };

  const requestRef = doc(db, `users/${payload.clientUserId}/shipmentRequests`, payload.requestId);
  const requestSnap = await getDoc(requestRef);
  if (!requestSnap.exists()) throw new Error("Outbound request not found.");
  const request = requestSnap.data() as Record<string, unknown>;
  const invoiceStatus = String(request.invoiceStatus || "").toLowerCase();
  if (invoiceStatus === "invoiced") {
    throw new Error("This outbound is already invoiced on PrepCorex.");
  }

  const shipments = await loadShippedRows(
    payload.clientUserId,
    payload.requestId,
    payload.shippedIds
  );
  if (shipments.length === 0) {
    throw new Error(
      "No shipped rows found for this request. Dispatch the outbound first, then create the invoice."
    );
  }

  // Prefer services from request if shipped rows lack them.
  if (!shipments.some((s) => resolveOutboundAdditionalServicesPayload(s))) {
    const fromRequest = resolveOutboundAdditionalServicesPayload(request);
    if (fromRequest) {
      shipments[0] = {
        ...shipments[0],
        additionalServices: fromRequest,
      } as ShippedItem;
    }
  }

  const serviceLines = buildServiceLines(shipments);
  const shippedIds = shipments.map((s) => s.id).filter(Boolean);
  const useCrm = !allowsPrepcorexCreateInvoice(clientUser);

  if (useCrm) {
    if (invoiceStatus === "crm_draft") {
      // Still allow append if new lines exist; CRM helper dedupes by sourceKey.
    }
    const lines = buildCrmLinesFromShipments(shipments, serviceLines);
    const result = await appendLinesToCrmOutboundDraft({
      clientUser,
      lines,
      shipmentRequestId: payload.requestId,
      shippedIds,
      adminUid: operatorId,
    });
    await markShipmentsLinkedToCrmDraft({
      clientUserId: payload.clientUserId,
      shippedIds,
      shipmentRequestId: payload.requestId,
      externalInvoiceId: result.externalInvoiceId,
    });
    return result.created
      ? `CRM draft created for ${clientUser.name}. This outbound is one line (order number + total). Open CRM Invoice management to review.`
      : result.updatedCount
        ? `Updated the CRM draft line for this outbound (order number + total) for ${clientUser.name}.`
        : `Added this outbound as one line (order number + total) on the CRM draft for ${clientUser.name}.`;
  }

  const today = new Date();
  const todayLabel = format(today, "dd/MM/yyyy");
  const invoiceNumber = generateInvoiceNumber();
  const productItems: Array<{
    quantity: number;
    productName: string;
    shipDate: string;
    packaging: string;
    sku?: string;
    shipTo: string;
    unitPrice: number;
    amount: number;
    shipmentId?: string;
  }> = [];

  for (const shipped of shipments) {
    const shipDate = resolveShipDate(shipped.date, todayLabel);
    const shipTo = String(shipped.shipTo || "");
    for (const line of normalizeShipmentItems(shipped)) {
      const qty = Number(line.shippedQty ?? line.boxesShipped ?? 0);
      const unitPrice = Number(line.unitPrice ?? shipped.unitPrice ?? 0);
      const sku = String(line.sku || "").trim();
      productItems.push({
        quantity: qty,
        productName: line.productName || shipped.productName || "Unknown Product",
        shipDate,
        packaging: `${line.packOf ?? shipped.packOf ?? 1} Nos.`,
        ...(sku ? { sku } : {}),
        shipTo,
        unitPrice,
        amount: qty * unitPrice,
        shipmentId: shipped.id,
      });
    }
    const labelPrice = Number((shipped as { labelPrice?: number }).labelPrice || 0);
    if (labelPrice > 0.0001) {
      const orderLabel =
        (shipped as { shopifyOrderName?: string }).shopifyOrderName ||
        (shipped as { shopifyOrderId?: string }).shopifyOrderId ||
        "Label";
      productItems.push({
        quantity: 1,
        productName: `Shipping label · ${orderLabel}`,
        shipDate,
        packaging: "Label",
        shipTo,
        unitPrice: labelPrice,
        amount: labelPrice,
        shipmentId: shipped.id,
      });
    }
  }

  const items = [
    ...productItems,
    ...serviceLines.map((line) => ({
      quantity: line.quantity,
      productName: line.description.trim(),
      shipDate: todayLabel,
      packaging: "Additional service",
      shipTo: productItems[0]?.shipTo || "",
      unitPrice: line.unitPrice,
      amount: line.quantity * line.unitPrice,
    })),
  ];
  if (items.length === 0) throw new Error("Nothing to invoice for this outbound.");

  const subtotal = items.reduce((sum, item) => sum + item.amount, 0);
  const invoiceDoc = applyClientInvoiceLifecycleFields({
    invoiceNumber,
    date: todayLabel,
    orderNumber: `ORD-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-4)}`,
    soldTo: {
      name: clientUser.name || "Unknown User",
      email: clientUser.email || "",
      phone: clientUser.phone || "",
      address: "",
    },
    fbm: "Standard Shipping",
    items,
    subtotal,
    grandTotal: subtotal,
    status: "pending" as const,
    createdAt: new Date(),
    userId: clientUser.uid,
    type: "outbound",
    source: "lexi_create_outbound_invoice",
    shipmentRequestId: payload.requestId,
    shippedIds: [...new Set(shippedIds)],
  });

  const invoiceRef = await addDoc(
    collection(db, `users/${clientUser.uid}/invoices`),
    invoiceDoc
  );

  const batch = writeBatch(db);
  for (const shipped of shipments) {
    if (!shipped.id) continue;
    batch.update(doc(db, `users/${clientUser.uid}/shipped`, shipped.id), {
      invoiceStatus: "invoiced",
      invoiceId: invoiceRef.id,
      invoiceNumber,
      invoicedAt: serverTimestamp(),
    });
  }
  batch.update(requestRef, {
    invoiceStatus: "invoiced",
    invoiceId: invoiceRef.id,
    invoiceNumber,
    invoicedAt: serverTimestamp(),
  });
  await batch.commit();

  try {
    const { generateInvoicePDF } = await import("@/lib/invoice-generator");
    await generateInvoicePDF({
      invoiceNumber,
      date: invoiceDoc.date as string,
      orderNumber: invoiceDoc.orderNumber as string,
      soldTo: invoiceDoc.soldTo as {
        name: string;
        email: string;
        phone?: string;
        address?: string;
      },
      fbm: "Standard Shipping",
      items,
      subtotal,
      grandTotal: Number(invoiceDoc.grandTotal || subtotal),
      dueDate: invoiceDoc.dueDate,
    });
  } catch (pdfErr) {
    console.warn("[lexi-outbound-invoice] PDF skipped", pdfErr);
  }

  return `Invoice ${invoiceNumber} created for ${clientUser.name} ($${subtotal.toFixed(2)}).`;
}
