import type { Invoice, InvoiceAdditionalCharge } from "@/types";

export type InvoiceTotalsInput = Pick<
  Invoice,
  | "items"
  | "subtotal"
  | "additionalServices"
  | "adminAdditionalCharges"
  | "grossTotal"
  | "discountType"
  | "discountValue"
  | "discountAmount"
  | "lateFeeAmount"
  | "grandTotal"
>;

export function getAdminAdditionalCharges(invoice: InvoiceTotalsInput): InvoiceAdditionalCharge[] {
  const raw = invoice.adminAdditionalCharges;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.name === "string")
    .map((c) => ({
      id: c.id || crypto.randomUUID(),
      name: String(c.name).trim(),
      amount: Math.max(0, Number(c.amount) || 0),
    }));
}

export function getItemsSubtotal(invoice: InvoiceTotalsInput): number {
  return (invoice.items ?? []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
}

export function getShipmentAdditionalTotal(invoice: InvoiceTotalsInput): number {
  return Number(invoice.additionalServices?.total || 0);
}

export function getAdminChargesTotal(charges: InvoiceAdditionalCharge[]): number {
  return charges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
}

export function computeInvoiceTotals(
  invoice: InvoiceTotalsInput,
  overrides?: {
    adminAdditionalCharges?: InvoiceAdditionalCharge[];
    discountType?: "amount" | "percent";
    discountValue?: number;
    lateFeeAmount?: number;
  }
) {
  const itemsSubtotal = getItemsSubtotal(invoice);
  const shipmentAdditionalTotal = getShipmentAdditionalTotal(invoice);
  const adminCharges = overrides?.adminAdditionalCharges ?? getAdminAdditionalCharges(invoice);
  const adminChargesTotal = getAdminChargesTotal(adminCharges);

  const grossTotal = itemsSubtotal + shipmentAdditionalTotal + adminChargesTotal;

  const discountType = overrides?.discountType ?? invoice.discountType;
  const discountValue =
    overrides?.discountValue !== undefined
      ? overrides.discountValue
      : typeof invoice.discountValue === "number"
        ? invoice.discountValue
        : undefined;

  let discountAmount = 0;
  if (typeof invoice.discountAmount === "number" && overrides?.discountType === undefined && overrides?.discountValue === undefined) {
    discountAmount = Math.max(0, Math.min(grossTotal, invoice.discountAmount));
  } else if (discountType === "percent" && typeof discountValue === "number") {
    discountAmount = grossTotal * (Math.max(0, Math.min(100, discountValue)) / 100);
  } else if (discountType === "amount" && typeof discountValue === "number") {
    discountAmount = Math.max(0, discountValue);
  }
  discountAmount = Math.max(0, Math.min(grossTotal, discountAmount));

  const lateFeeAmount = Math.max(
    0,
    overrides?.lateFeeAmount !== undefined ? overrides.lateFeeAmount : Number(invoice.lateFeeAmount || 0)
  );

  const grandTotal = Math.max(0, grossTotal - discountAmount + lateFeeAmount);

  return {
    itemsSubtotal,
    shipmentAdditionalTotal,
    adminCharges,
    adminChargesTotal,
    grossTotal,
    discountAmount,
    lateFeeAmount,
    grandTotal,
  };
}
