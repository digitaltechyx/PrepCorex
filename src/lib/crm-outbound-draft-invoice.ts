import { format } from "date-fns";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  getClientInvoiceTemplate,
  isAutoBuiltCrmDraftNote,
} from "@/lib/crm-client-invoice-template";
import { normalizeShipmentItems } from "@/lib/shipment-utils";
import {
  CRM_OUTBOUND_DRAFT_BILLING_SOURCE,
  crmOutboundDraftConsolidationKey,
} from "@/lib/outbound-billing";
import { buildPrepcorexOrderOpenUrl } from "@/lib/prepcorex-order-open";
import type { ShippedItem, UserProfile } from "@/types";

export type CrmDraftLineInput = {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  compareUnitPrice?: number;
  amount?: number;
  shipDate?: string;
  /** Outbound request created/requested date (dd/MM/yyyy), shown with Order … */
  requestedDate?: string;
  sku?: string;
  packaging?: string;
  /** Outbound request id shown as Order … on the CRM line. */
  orderNumber?: string;
  /** Opens PrepCorex order bridge (client or admin Shipped Orders after login). */
  orderUrl?: string;
  /** Prevents double-append of the same shipped row / service key. */
  sourceKey?: string;
};

function createCrmDraftReference(): string {
  return `DRAFT-PCX-${Date.now().toString().slice(-8)}`;
}

function buildPrepcorexShippedOrderUrl(clientUserId: string, orderNumber: string): string {
  return buildPrepcorexOrderOpenUrl(clientUserId, orderNumber);
}

function money(n: unknown): number {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v * 100) / 100 : 0;
}

function newLineId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Format shipped.date (Timestamp / Date / string) as dd/MM/yyyy for CRM descriptions. */
export function formatShipDateForCrmDescription(value: unknown, fallback?: string): string {
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return format(d, "dd/MM/yyyy");
    // Already a display label (e.g. from the invoice dialog).
    return value.trim();
  }
  if (value && typeof value === "object") {
    if (typeof (value as { toDate?: () => Date }).toDate === "function") {
      const d = (value as { toDate: () => Date }).toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return format(d, "dd/MM/yyyy");
    }
    const seconds = Number((value as { seconds?: number }).seconds || 0);
    if (seconds > 0) return format(new Date(seconds * 1000), "dd/MM/yyyy");
  }
  return (fallback || "").trim();
}

/** Legacy helper — prefer dedicated shipDate / sku / packaging fields on CRM lines. */
export function crmLineDescription(parts: {
  name: string;
  shipDate?: string | null;
  shipTo?: string | null;
}): string {
  const name = String(parts.name || "").trim() || "Line item";
  const shipDate = String(parts.shipDate || "").trim();
  const shipTo = String(parts.shipTo || "").trim();
  return [
    name,
    shipDate ? `Ship date: ${shipDate}` : "",
    shipTo ? `Ship to: ${shipTo}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

export function buildCrmLinesFromShipments(
  shipments: ShippedItem[],
  serviceLines: Array<{ description: string; quantity: number; unitPrice: number }> = []
): CrmDraftLineInput[] {
  const todayLabel = format(new Date(), "dd/MM/yyyy");
  const lines: CrmDraftLineInput[] = [];
  let primaryShipDate = "";

  for (const shipped of shipments) {
    const shipDate = formatShipDateForCrmDescription(shipped.date, todayLabel);
    if (!primaryShipDate && shipDate) primaryShipDate = shipDate;
    const shipTo = String(shipped.shipTo || "").trim();
    const lineScope =
      String(
        (shipped as { shipmentRequestId?: string }).shipmentRequestId || shipped.id || ""
      ).trim() || "noscope";

    for (const line of normalizeShipmentItems(shipped)) {
      const qty = Number(line.shippedQty ?? line.boxesShipped ?? 0);
      const unitPrice = money(line.unitPrice ?? shipped.unitPrice ?? 0);
      const productName = line.productName || shipped.productName || "Product";
      const sku = String(line.sku || "").trim();
      const packaging = `${line.packOf ?? shipped.packOf ?? 1} Nos.`;
      lines.push({
        description: productName,
        quantity: qty,
        unitPrice,
        amount: money(qty * unitPrice),
        shipDate,
        packaging,
        ...(sku ? { sku } : {}),
        sourceKey: `request:${lineScope}:item:${line.productName || productName}:${qty}`,
      });
    }
    const labelPrice = money((shipped as { labelPrice?: number }).labelPrice);
    if (labelPrice > 0) {
      const orderLabel =
        (shipped as { shopifyOrderName?: string }).shopifyOrderName ||
        (shipped as { shopifyOrderId?: string }).shopifyOrderId ||
        shipped.id ||
        "Label";
      lines.push({
        description: `Shipping label · ${orderLabel}`,
        quantity: 1,
        unitPrice: labelPrice,
        amount: labelPrice,
        shipDate,
        packaging: "Label",
        sourceKey: `request:${lineScope}:label`,
      });
    }
  }
  const scopeId =
    String(
      (shipments[0] as { shipmentRequestId?: string } | undefined)?.shipmentRequestId ||
        shipments[0]?.id ||
        ""
    ).trim() || "noscope";
  for (const svc of serviceLines) {
    const name = String(svc.description || "").trim();
    if (!name) continue;
    const quantity = Number(svc.quantity) || 0;
    const unitPrice = money(svc.unitPrice);
    if (quantity <= 0) continue;
    // Avoid double-prefix if admin already typed "Ship date:" into the service description.
    const alreadyHasDate = /ship\s*date\s*:/i.test(name);
    const description = alreadyHasDate
      ? name
      : crmLineDescription({ name, shipDate: primaryShipDate });
    lines.push({
      description,
      quantity,
      unitPrice,
      amount: money(quantity * unitPrice),
      shipDate: alreadyHasDate ? undefined : primaryShipDate || undefined,
      packaging: "Additional service",
      // Scope by outbound so the same service on a later order still appends.
      sourceKey: `request:${scopeId}:svc:${name}:${quantity}:${unitPrice}`,
    });
  }
  return lines;
}

/** Build CRM Item Description: order id + optional requested date. */
export function formatCrmOrderLineDescription(
  orderNumber: string,
  requestedDate?: string | null
): string {
  const order = String(orderNumber || "").trim();
  if (!order) return "";
  const requested = String(requestedDate || "").trim();
  return requested ? `Order ${order} · Requested ${requested}` : `Order ${order}`;
}

async function resolveShipmentRequestedDateLabel(
  clientUserId: string,
  shipmentRequestId?: string | null
): Promise<string> {
  const uid = String(clientUserId || "").trim();
  const requestId = String(shipmentRequestId || "").trim();
  if (!uid || !requestId) return "";
  try {
    const snap = await getDoc(doc(db, `users/${uid}/shipmentRequests`, requestId));
    if (!snap.exists()) return "";
    const data = snap.data() || {};
    return formatShipDateForCrmDescription(
      data.requestedAt ?? data.date ?? data.createdAt,
      ""
    );
  } catch {
    return "";
  }
}

/** One CRM row per outbound. Detail stays on the shipment request in the client account. */
export function collapseCrmLinesToOrderLine(
  lines: CrmDraftLineInput[],
  orderNumber: string,
  opts?: { clientUserId?: string | null; requestedDate?: string | null }
): CrmDraftLineInput[] {
  const order = String(orderNumber || "").trim();
  const usable = (lines || []).filter((line) => String(line.description || "").trim());
  if (!order || usable.length === 0) return usable;

  const amount = money(
    usable.reduce((sum, line) => {
      const quantity = Number(line.quantity) || 0;
      const unitPrice = money(line.unitPrice);
      return sum + money(line.amount ?? quantity * unitPrice);
    }, 0)
  );
  const shipDate = usable
    .map((line) => String(line.shipDate || "").trim())
    .find(Boolean);
  const requestedDate =
    String(opts?.requestedDate || "").trim() ||
    usable.map((line) => String((line as { requestedDate?: string }).requestedDate || "").trim()).find(Boolean) ||
    "";
  const clientUserId = String(opts?.clientUserId || "").trim();
  const orderUrl = clientUserId
    ? buildPrepcorexShippedOrderUrl(clientUserId, order)
    : "";

  return [
    {
      description: formatCrmOrderLineDescription(order, requestedDate),
      quantity: 1,
      unitPrice: amount,
      amount,
      orderNumber: order,
      ...(orderUrl ? { orderUrl } : {}),
      ...(shipDate ? { shipDate } : {}),
      ...(requestedDate ? { requestedDate } : {}),
      packaging: "Outbound",
      sourceKey: crmOrderLineSourceKey(order),
    },
  ];
}

export function crmOrderLineSourceKey(orderNumber: string): string {
  return `request:${String(orderNumber || "").trim()}:order`;
}

function isLegacyOrderDetailKey(sourceKey: string, orderNumber: string): boolean {
  const key = String(sourceKey || "").trim();
  const order = String(orderNumber || "").trim();
  if (!key || !order) return false;
  return key.startsWith(`request:${order}:`) && key !== crmOrderLineSourceKey(order);
}

function isCrmOrderDescription(description: unknown): boolean {
  return /^Order\s+[A-Za-z0-9_-]+/i.test(String(description || "").trim());
}

/**
 * Convert old per-SKU / per-service CRM draft lines into one Order … line per
 * shipment request. Safe to run on draft or finalized invoices.
 */
export async function collapseLegacyCrmInvoiceItemsToOrderLines(
  externalInvoiceId: string
): Promise<{ repaired: boolean; orderCount: number }> {
  const invoiceId = String(externalInvoiceId || "").trim();
  if (!invoiceId) return { repaired: false, orderCount: 0 };

  const ref = doc(db, "external_invoices", invoiceId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { repaired: false, orderCount: 0 };

  const data = snap.data() || {};
  const clientUserId = String(data.prepcorexClientUserId || "").trim();
  let nextItems: any[] = Array.isArray(data.items) ? [...(data.items as any[])] : [];
  if (nextItems.length === 0) return { repaired: false, orderCount: 0 };

  const orderIds = new Set<string>();
  for (const id of Array.isArray(data.prepcorexShipmentRequestIds)
    ? (data.prepcorexShipmentRequestIds as unknown[])
    : []) {
    const v = String(id || "").trim();
    if (v) orderIds.add(v);
  }
  for (const it of nextItems) {
    const key = String(it?.sourceKey || "").trim();
    const keyMatch = /^request:([^:]+):/.exec(key);
    if (keyMatch?.[1]) orderIds.add(keyMatch[1]);
    const on = String(it?.orderNumber || "").trim();
    if (on) orderIds.add(on);
  }

  let changed = false;
  let orderCount = 0;

  const rebuildOrderLine = async (orderId: string, linesForOrder: any[]) => {
    const requestedDate = clientUserId
      ? await resolveShipmentRequestedDateLabel(clientUserId, orderId)
      : "";
    const shipDate =
      linesForOrder.map((it) => String(it?.shipDate || "").trim()).find(Boolean) || "";
    const totalForOrder = money(
      linesForOrder.reduce((sum, it) => sum + money(it?.amount), 0)
    );
    const existingId =
      linesForOrder.find(
        (it) => String(it?.sourceKey || "").trim() === crmOrderLineSourceKey(orderId)
      )?.id ||
      linesForOrder.find((it) => isCrmOrderDescription(it?.description))?.id ||
      newLineId();
    const orderUrl = clientUserId
      ? buildPrepcorexShippedOrderUrl(clientUserId, orderId)
      : "";
    return {
      id: existingId,
      description: formatCrmOrderLineDescription(orderId, requestedDate),
      quantity: 1,
      unitPrice: totalForOrder,
      compareUnitPrice: 0,
      amount: totalForOrder,
      orderNumber: orderId,
      packaging: "Outbound",
      sourceKey: crmOrderLineSourceKey(orderId),
      ...(orderUrl ? { orderUrl } : {}),
      ...(shipDate ? { shipDate } : {}),
      ...(requestedDate ? { requestedDate } : {}),
    };
  };

  for (const orderId of orderIds) {
    if (!orderId) continue;
    const legacy = nextItems.filter((it) =>
      isLegacyOrderDetailKey(String(it?.sourceKey || ""), orderId)
    );
    const orderKey = crmOrderLineSourceKey(orderId);
    const existingOrderLines = nextItems.filter(
      (it) =>
        String(it?.sourceKey || "").trim() === orderKey ||
        (String(it?.orderNumber || "").trim() === orderId &&
          isCrmOrderDescription(it?.description))
    );

    // Nothing to collapse for this order.
    if (legacy.length === 0) {
      // Still refresh description with requested date when an order line exists.
      if (existingOrderLines.length === 1) {
        const refreshed = await rebuildOrderLine(orderId, existingOrderLines);
        const prev = existingOrderLines[0];
        if (
          String(prev?.description || "") !== refreshed.description ||
          money(prev?.amount) !== refreshed.amount
        ) {
          nextItems = nextItems.map((it) => (it === prev ? refreshed : it));
          changed = true;
          orderCount += 1;
        }
      }
      continue;
    }

    const linesForOrder = [...legacy, ...existingOrderLines];
    const collapsed = await rebuildOrderLine(orderId, linesForOrder);
    nextItems = [
      ...nextItems.filter(
        (it) =>
          !isLegacyOrderDetailKey(String(it?.sourceKey || ""), orderId) &&
          String(it?.sourceKey || "").trim() !== orderKey &&
          !(
            String(it?.orderNumber || "").trim() === orderId &&
            isCrmOrderDescription(it?.description)
          )
      ),
      collapsed,
    ];
    changed = true;
    orderCount += 1;
  }

  // Fallback: one linked request, lines still look like old product/service breakdown.
  if (!changed && orderIds.size === 1) {
    const orderId = [...orderIds][0];
    const hasBreakdown = nextItems.some((it) => !isCrmOrderDescription(it?.description));
    const hasOrderLine = nextItems.some((it) => isCrmOrderDescription(it?.description));
    if (hasBreakdown && (!hasOrderLine || nextItems.length > 1)) {
      const collapsed = await rebuildOrderLine(orderId, nextItems);
      nextItems = [collapsed];
      changed = true;
      orderCount = 1;
    }
  }

  if (!changed) {
    // Still re-link PrepCorex docs so Update CRM buttons show for older syncs.
    if (clientUserId && orderIds.size > 0) {
      try {
        await markShipmentsLinkedToCrmDraft({
          clientUserId,
          shippedIds: Array.isArray(data.prepcorexShippedIds)
            ? (data.prepcorexShippedIds as unknown[]).map((id) => String(id || "").trim()).filter(Boolean)
            : [],
          shipmentRequestId: [...orderIds][0] || null,
          externalInvoiceId: invoiceId,
        });
        for (const orderId of orderIds) {
          if (!orderId || orderId === [...orderIds][0]) continue;
          await markShipmentsLinkedToCrmDraft({
            clientUserId,
            shippedIds: [],
            shipmentRequestId: orderId,
            externalInvoiceId: invoiceId,
          });
        }
      } catch (linkErr) {
        console.warn("[crm-draft] could not re-link shipments after no-op repair", linkErr);
      }
    }
    return { repaired: false, orderCount: 0 };
  }

  const subtotal = money(nextItems.reduce((sum, it) => sum + money(it?.amount), 0));
  const salesTax = money(data.salesTax);
  const shippingCost = money(data.shippingCost);
  const lateFee = money(data.lateFee);
  const amountPaid = money(data.amountPaid);
  const total = money(subtotal + salesTax + shippingCost);

  await updateDoc(ref, {
    items: nextItems,
    subtotal,
    total,
    outstandingBalance: money(total + lateFee - amountPaid),
    updatedAt: serverTimestamp(),
    lastPrepcorexOrderLineRepairAt: serverTimestamp(),
  });

  // Ensure linked outbounds keep Update CRM draft (older syncs may lack these fields).
  if (clientUserId && orderIds.size > 0) {
    try {
      await markShipmentsLinkedToCrmDraft({
        clientUserId,
        shippedIds: Array.isArray(data.prepcorexShippedIds)
          ? (data.prepcorexShippedIds as unknown[]).map((id) => String(id || "").trim()).filter(Boolean)
          : [],
        shipmentRequestId: [...orderIds][0] || null,
        externalInvoiceId: invoiceId,
      });
      for (const orderId of orderIds) {
        if (!orderId || orderId === [...orderIds][0]) continue;
        await markShipmentsLinkedToCrmDraft({
          clientUserId,
          shippedIds: [],
          shipmentRequestId: orderId,
          externalInvoiceId: invoiceId,
        });
      }
    } catch (linkErr) {
      console.warn("[crm-draft] could not re-link shipments after order-line repair", linkErr);
    }
  }

  return { repaired: true, orderCount };
}

/**
 * Find or create one open CRM draft for this PrepCorex client and append lines.
 * Each outbound becomes one line (order number + total). Re-saving the same
 * order updates that line instead of adding another row.
 */
export async function appendLinesToCrmOutboundDraft(input: {
  clientUser: Pick<UserProfile, "uid" | "name" | "email" | "phone">;
  lines: CrmDraftLineInput[];
  shipmentRequestId?: string | null;
  shippedIds?: string[];
  adminUid?: string | null;
}): Promise<{ externalInvoiceId: string; created: boolean; addedCount: number; updatedCount: number }> {
  const clientUserId = String(input.clientUser.uid || "").trim();
  if (!clientUserId) throw new Error("Missing client user id");
  const consolidationKey = crmOutboundDraftConsolidationKey(clientUserId);
  const orderNumber = String(
    input.shipmentRequestId || input.shippedIds?.find((id) => Boolean(id)) || ""
  ).trim();
  const requestedDate = await resolveShipmentRequestedDateLabel(
    clientUserId,
    input.shipmentRequestId || orderNumber
  );
  const incoming = collapseCrmLinesToOrderLine(
    (input.lines || []).filter((l) => String(l.description || "").trim()),
    orderNumber,
    { clientUserId, requestedDate }
  );
  if (incoming.length === 0) {
    throw new Error("Nothing to add to the CRM draft");
  }

  const q = query(
    collection(db, "external_invoices"),
    where("consolidationKey", "==", consolidationKey),
    where("status", "==", "draft"),
    limit(1)
  );
  const existingSnap = await getDocs(q);
  const existing = existingSnap.docs[0];

  const normalizeIncoming = incoming.map((line) => {
    const quantity = Number(line.quantity) || 0;
    const unitPrice = money(line.unitPrice);
    const amount = money(line.amount ?? quantity * unitPrice);
    const shipDate = String(line.shipDate || "").trim();
    const requestedDate = String(line.requestedDate || "").trim();
    const sku = String(line.sku || "").trim();
    const packaging = String(line.packaging || "").trim();
    const lineOrderNumber = String(line.orderNumber || "").trim();
    const orderUrl = String(line.orderUrl || "").trim();
    return {
      id: line.id || newLineId(),
      description: String(line.description).trim(),
      quantity,
      unitPrice,
      compareUnitPrice: money(line.compareUnitPrice ?? 0),
      amount,
      ...(shipDate ? { shipDate } : {}),
      ...(requestedDate ? { requestedDate } : {}),
      ...(sku ? { sku } : {}),
      ...(packaging ? { packaging } : {}),
      ...(lineOrderNumber ? { orderNumber: lineOrderNumber } : {}),
      ...(orderUrl ? { orderUrl } : {}),
      sourceKey: line.sourceKey || undefined,
    };
  });

  if (existing) {
    // Upgrade any leftover per-SKU / service rows for this (and other) orders.
    try {
      await collapseLegacyCrmInvoiceItemsToOrderLines(existing.id);
    } catch (repairErr) {
      console.warn("[crm-draft] legacy order-line repair failed", repairErr);
    }
    const refreshed = await getDoc(doc(db, "external_invoices", existing.id));
    const data = (refreshed.exists() ? refreshed.data() : existing.data()) as Record<
      string,
      unknown
    >;
    const prevItems = (Array.isArray(data.items) ? [...(data.items as any[])] : []).filter(
      (it) => !isLegacyOrderDetailKey(String(it?.sourceKey || ""), orderNumber)
    );
    const nextItems = [...prevItems];
    let addedCount = 0;
    let updatedCount = 0;
    for (const line of normalizeIncoming) {
      const key = String(line.sourceKey || "").trim();
      const idx = key
        ? nextItems.findIndex((it) => String(it?.sourceKey || "").trim() === key)
        : -1;
      if (idx >= 0) {
        nextItems[idx] = {
          ...nextItems[idx],
          ...line,
          id: nextItems[idx].id || line.id,
        };
        updatedCount += 1;
      } else {
        nextItems.push(line);
        addedCount += 1;
      }
    }
    const subtotal = money(nextItems.reduce((sum, it) => sum + money(it.amount), 0));
    const salesTax = money(data.salesTax);
    const shippingCost = money(data.shippingCost);
    const total = money(subtotal + salesTax + shippingCost);
    const amountPaid = money(data.amountPaid);
    const shippedIds = Array.from(
      new Set([
        ...((Array.isArray(data.prepcorexShippedIds) ? data.prepcorexShippedIds : []) as string[]),
        ...(input.shippedIds || []),
      ].filter(Boolean))
    );
    const requestIds = Array.from(
      new Set([
        ...((Array.isArray(data.prepcorexShipmentRequestIds)
          ? data.prepcorexShipmentRequestIds
          : []) as string[]),
        ...(input.shipmentRequestId ? [input.shipmentRequestId] : []),
      ].filter(Boolean))
    );

    const existingNote = String(data.invoiceNote || "").trim();
    // Keep DRAFT-PCX-… as invoiceNumber until CRM View / Download / Send / Sync.
    const existingNumber = String(data.invoiceNumber || "").trim();
    const missingNumber = !existingNumber;
    const draftNumber = missingNumber ? createCrmDraftReference() : "";
    await updateDoc(doc(db, "external_invoices", existing.id), {
      items: nextItems,
      subtotal,
      total,
      outstandingBalance: money(total + money(data.lateFee) - amountPaid),
      prepcorexShippedIds: shippedIds,
      prepcorexShipmentRequestIds: requestIds,
      updatedAt: serverTimestamp(),
      lastPrepcorexAppendAt: serverTimestamp(),
      lastPrepcorexAppendBy: input.adminUid || null,
      // Drop the old auto-built note if it is still on this draft.
      ...(isAutoBuiltCrmDraftNote(existingNote) ? { invoiceNote: "" } : {}),
      ...(missingNumber
        ? {
            invoiceNumber: draftNumber,
            draftReference: draftNumber,
          }
        : {}),
    });

    return { externalInvoiceId: existing.id, created: false, addedCount, updatedCount };
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const invoiceDate = `${yyyy}-${mm}-${dd}`;
  const subtotal = money(normalizeIncoming.reduce((sum, it) => sum + it.amount, 0));
  // Stay as DRAFT-PCX-… in the CRM list until View / Download / Send / Sync assigns INV-….
  const draftReference = createCrmDraftReference();
  const invoiceNumber = draftReference;

  // Use this client's saved CRM invoice template when admin has saved one.
  const template = await getClientInvoiceTemplate({
    email: input.clientUser.email,
    prepcorexClientUserId: clientUserId,
  });

  const docRef = await addDoc(collection(db, "external_invoices"), {
    status: "draft",
    invoiceNumber,
    draftReference,
    invoiceDate,
    dueDate: invoiceDate,
    companyName: template?.companyName || "Prep Services FBA",
    companyAddress: template?.companyAddress || "",
    companyCityStateZip: template?.companyCityStateZip || "",
    companyCountry: template?.companyCountry || "",
    companyPhone: template?.companyPhone || "",
    companyEmail: template?.companyEmail || "",
    clientName: input.clientUser.name || template?.clientName || "Client",
    clientEmail: input.clientUser.email || template?.clientEmail || "",
    clientPhone: input.clientUser.phone || "",
    clientAddress: "",
    items: normalizeIncoming,
    shippingLabelItems: [],
    subtotal,
    salesTax: 0,
    shippingCost: 0,
    total: subtotal,
    amountPaid: 0,
    outstandingBalance: subtotal,
    payments: [],
    billingSource: CRM_OUTBOUND_DRAFT_BILLING_SOURCE,
    consolidationKey,
    prepcorexClientUserId: clientUserId,
    prepcorexShippedIds: [...new Set((input.shippedIds || []).filter(Boolean))],
    prepcorexShipmentRequestIds: input.shipmentRequestId ? [input.shipmentRequestId] : [],
    invoiceNote: template?.invoiceNote || "",
    fobPoint: template?.fobPoint || "",
    shippingTerms: template?.shippingTerms || "",
    shippedVia: template?.shippedVia || "",
    terms: template?.terms || "",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: input.adminUid || null,
  });

  return {
    externalInvoiceId: docRef.id,
    created: true,
    addedCount: normalizeIncoming.length,
    updatedCount: 0,
  };
}

/** Mark shipped (+ optional request) as linked to the CRM draft. */
export async function markShipmentsLinkedToCrmDraft(input: {
  clientUserId: string;
  shippedIds: string[];
  shipmentRequestId?: string | null;
  externalInvoiceId: string;
}): Promise<void> {
  const linkFields = {
    invoiceStatus: "crm_draft" as const,
    crmExternalInvoiceId: input.externalInvoiceId,
    crmDraftSyncedAt: serverTimestamp(),
  };
  const batch = writeBatch(db);
  let ops = 0;
  for (const shippedId of input.shippedIds) {
    if (!shippedId) continue;
    const shippedRef = doc(db, `users/${input.clientUserId}/shipped`, shippedId);
    try {
      const snap = await getDoc(shippedRef);
      if (!snap.exists()) continue;
      batch.update(shippedRef, linkFields);
      ops += 1;
    } catch {
      /* skip missing / unreadable */
    }
  }
  if (input.shipmentRequestId) {
    const reqRef = doc(
      db,
      `users/${input.clientUserId}/shipmentRequests`,
      input.shipmentRequestId
    );
    try {
      const snap = await getDoc(reqRef);
      if (snap.exists()) {
        batch.update(reqRef, linkFields);
        ops += 1;
      }
    } catch {
      /* skip missing / unreadable */
    }
  }
  if (ops > 0) await batch.commit();
}
