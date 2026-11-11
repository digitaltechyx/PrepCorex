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
  /** Prevents double-append of the same shipped row / service key. */
  sourceKey?: string;
};

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

/** CRM item descriptions embed ship date (CRM has no separate shipDate column). */
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

    for (const line of normalizeShipmentItems(shipped)) {
      const qty = Number(line.shippedQty ?? line.boxesShipped ?? 0);
      const unitPrice = money(line.unitPrice ?? shipped.unitPrice ?? 0);
      const productName = line.productName || shipped.productName || "Product";
      lines.push({
        description: crmLineDescription({ name: productName, shipDate, shipTo }),
        quantity: qty,
        unitPrice,
        amount: money(qty * unitPrice),
        sourceKey: `shipped:${shipped.id}:item:${line.productName || productName}:${qty}`,
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
        description: crmLineDescription({
          name: `Shipping label · ${orderLabel}`,
          shipDate,
          shipTo,
        }),
        quantity: 1,
        unitPrice: labelPrice,
        amount: labelPrice,
        sourceKey: `shipped:${shipped.id}:label`,
      });
    }
  }
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
      sourceKey: `svc:${name}:${quantity}:${unitPrice}`,
    });
  }
  return lines;
}

/**
 * Find or create one open CRM draft for this PrepCorex client and append lines.
 * Dedupes by `sourceKey` stored on each item.
 */
export async function appendLinesToCrmOutboundDraft(input: {
  clientUser: Pick<UserProfile, "uid" | "name" | "email" | "phone">;
  lines: CrmDraftLineInput[];
  shipmentRequestId?: string | null;
  shippedIds?: string[];
  adminUid?: string | null;
}): Promise<{ externalInvoiceId: string; created: boolean; addedCount: number }> {
  const clientUserId = String(input.clientUser.uid || "").trim();
  if (!clientUserId) throw new Error("Missing client user id");
  const consolidationKey = crmOutboundDraftConsolidationKey(clientUserId);
  const incoming = (input.lines || []).filter((l) => String(l.description || "").trim());
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
    return {
      id: line.id || newLineId(),
      description: String(line.description).trim(),
      quantity,
      unitPrice,
      compareUnitPrice: money(line.compareUnitPrice ?? 0),
      amount,
      sourceKey: line.sourceKey || undefined,
    };
  });

  if (existing) {
    const data = existing.data() as Record<string, unknown>;
    const prevItems = Array.isArray(data.items) ? [...(data.items as any[])] : [];
    const existingKeys = new Set(
      prevItems.map((it) => String(it?.sourceKey || "").trim()).filter(Boolean)
    );
    const toAdd = normalizeIncoming.filter((line) => {
      if (!line.sourceKey) return true;
      return !existingKeys.has(line.sourceKey);
    });
    const nextItems = [...prevItems, ...toAdd];
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
    });

    return { externalInvoiceId: existing.id, created: false, addedCount: toAdd.length };
  }

  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const invoiceDate = `${yyyy}-${mm}-${dd}`;
  const subtotal = money(normalizeIncoming.reduce((sum, it) => sum + it.amount, 0));
  const invoiceNumber = `DRAFT-PCX-${Date.now().toString().slice(-8)}`;

  const docRef = await addDoc(collection(db, "external_invoices"), {
    status: "draft",
    invoiceNumber,
    invoiceDate,
    dueDate: invoiceDate,
    companyName: "Prep Services FBA",
    clientName: input.clientUser.name || "Client",
    clientEmail: input.clientUser.email || "",
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
    invoiceNote: "Auto-built from PrepCorex outbound / fulfill (consolidated draft).",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    createdByUid: input.adminUid || null,
  });

  return { externalInvoiceId: docRef.id, created: true, addedCount: normalizeIncoming.length };
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
