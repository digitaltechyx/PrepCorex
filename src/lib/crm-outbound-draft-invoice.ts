import { format } from "date-fns";
import {
  addDoc,
  collection,
  doc,
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
import type { ShippedItem, UserProfile } from "@/types";

export type CrmDraftLineInput = {
  id?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  compareUnitPrice?: number;
  amount?: number;
  shipDate?: string;
  sku?: string;
  packaging?: string;
  /** Outbound request id shown as Order … on the CRM line. */
  orderNumber?: string;
  /** Opens PrepCorex admin Shipped Orders with this order searched. */
  orderUrl?: string;
  /** Prevents double-append of the same shipped row / service key. */
  sourceKey?: string;
};

function createCrmInvoiceNumber(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const randomNum = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `INV-${year}${month}-${randomNum}`;
}

function createCrmDraftReference(): string {
  return `DRAFT-PCX-${Date.now().toString().slice(-8)}`;
}

function buildPrepcorexShippedOrderUrl(clientUserId: string, orderNumber: string): string {
  const base = (
    process.env.NEXT_PUBLIC_APP_URL || "https://prepcorex.com"
  ).replace(/\/$/, "");
  const params = new URLSearchParams({
    userId: clientUserId,
    section: "shipped-orders",
    status: "shipped",
    search: orderNumber,
  });
  return `${base}/admin/dashboard/inventory?${params.toString()}`;
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

/** One CRM row per outbound. Detail stays on the shipment request in the client account. */
export function collapseCrmLinesToOrderLine(
  lines: CrmDraftLineInput[],
  orderNumber: string,
  opts?: { clientUserId?: string | null }
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
  const clientUserId = String(opts?.clientUserId || "").trim();
  const orderUrl = clientUserId
    ? buildPrepcorexShippedOrderUrl(clientUserId, order)
    : "";

  return [
    {
      description: `Order ${order}`,
      quantity: 1,
      unitPrice: amount,
      amount,
      orderNumber: order,
      ...(orderUrl ? { orderUrl } : {}),
      ...(shipDate ? { shipDate } : {}),
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
  const incoming = collapseCrmLinesToOrderLine(
    (input.lines || []).filter((l) => String(l.description || "").trim()),
    orderNumber,
    { clientUserId }
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
      ...(sku ? { sku } : {}),
      ...(packaging ? { packaging } : {}),
      ...(lineOrderNumber ? { orderNumber: lineOrderNumber } : {}),
      ...(orderUrl ? { orderUrl } : {}),
      sourceKey: line.sourceKey || undefined,
    };
  });

  if (existing) {
    const data = existing.data() as Record<string, unknown>;
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
    const existingNumber = String(data.invoiceNumber || "").trim();
    const needsRealNumber = !existingNumber || /^draft(\b|-|_)/i.test(existingNumber);
    const nextInvoiceNumber = needsRealNumber ? createCrmInvoiceNumber() : existingNumber;
    const nextDraftReference =
      String(data.draftReference || "").trim() ||
      (needsRealNumber && existingNumber ? existingNumber : "") ||
      (needsRealNumber ? createCrmDraftReference() : "");
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
      ...(needsRealNumber
        ? {
            invoiceNumber: nextInvoiceNumber,
            ...(nextDraftReference ? { draftReference: nextDraftReference } : {}),
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
  // Client-facing number is INV-…; DRAFT-PCX-… is internal reference only.
  const invoiceNumber = createCrmInvoiceNumber();
  const draftReference = createCrmDraftReference();

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
  const batch = writeBatch(db);
  for (const shippedId of input.shippedIds) {
    if (!shippedId) continue;
    batch.update(doc(db, `users/${input.clientUserId}/shipped`, shippedId), {
      invoiceStatus: "crm_draft",
      crmExternalInvoiceId: input.externalInvoiceId,
      crmDraftSyncedAt: serverTimestamp(),
    });
  }
  if (input.shipmentRequestId) {
    batch.update(
      doc(db, `users/${input.clientUserId}/shipmentRequests`, input.shipmentRequestId),
      {
        invoiceStatus: "crm_draft",
        crmExternalInvoiceId: input.externalInvoiceId,
        crmDraftSyncedAt: serverTimestamp(),
      }
    );
  }
  await batch.commit();
}
