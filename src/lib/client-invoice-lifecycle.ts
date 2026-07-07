import type { Invoice } from "@/types";
import { computeInvoiceTotals } from "@/lib/invoice-totals";
import {
  addDaysToDateInput,
  compareDateInputs,
  formatDateInputForDisplay,
  getTodayDateInputInNJ,
} from "@/lib/nj-date";

export const CLIENT_INVOICE_DUE_DAYS = 5;
export const CLIENT_INVOICE_LATE_FEE_AMOUNT = 19;

export const CLIENT_INVOICE_TERMS = [
  "Invoices must be paid in full before work begins unless written credit terms are approved by management.",
  `Unpaid invoices after the due date may incur a $${CLIENT_INVOICE_LATE_FEE_AMOUNT} late fee per invoice.`,
  "Prep Services FBA may pause receiving, prep, storage, and shipments until payment is completed.",
  "All completed labor services are non-refundable.",
  "Client is responsible for product compliance, labeling accuracy, and marketplace requirements.",
  "Any billing concern must be reported within 48 hours of invoice receipt. Unauthorized chargebacks may result in service suspension.",
].join("\n");

export type ClientInvoiceEmailKind =
  | "created"
  | "reminder_penultimate"
  | "reminder_due_day"
  | "late_fee";

export function applyClientInvoiceLifecycleFields<T extends Record<string, unknown>>(
  invoice: T
): T & {
  dueDate: string;
  grossTotal: number;
  grandTotal: number;
  lateFeeAmount: number;
} {
  const todayNJ = getTodayDateInputInNJ();
  const dueDate = addDaysToDateInput(todayNJ, CLIENT_INVOICE_DUE_DAYS);
  const totals = computeInvoiceTotals(invoice as Parameters<typeof computeInvoiceTotals>[0], {
    lateFeeAmount: 0,
  });

  return {
    ...invoice,
    dueDate,
    grossTotal: totals.grossTotal,
    grandTotal: totals.grandTotal,
    lateFeeAmount: 0,
  };
}

function formatTermsBlock(): string {
  return `\n\nPayment terms:\n${CLIENT_INVOICE_TERMS.split("\n").map((line) => `• ${line}`).join("\n")}`;
}

export function buildClientInvoiceEmail(input: {
  kind: ClientInvoiceEmailKind;
  invoiceNumber: string;
  dueDate?: string;
  grandTotal?: number;
  clientName?: string;
}): { subject: string; message: string } {
  const name = input.clientName?.trim() || "there";
  const dueStr = formatDateInputForDisplay(input.dueDate);
  const totalStr =
    typeof input.grandTotal === "number" && Number.isFinite(input.grandTotal)
      ? `$${input.grandTotal.toFixed(2)}`
      : "the amount shown on your invoice";

  switch (input.kind) {
    case "created":
      return {
        subject: `Invoice ${input.invoiceNumber} generated`,
        message: `Hi ${name},

Your invoice ${input.invoiceNumber} has been generated. The total due is ${totalStr} and payment is due by ${dueStr} (${CLIENT_INVOICE_DUE_DAYS} days from invoice date).

Please log in to your Prep Services FBA dashboard to view invoice details and arrange payment.${formatTermsBlock()}

Best regards,
Prep Services FBA Team`,
      };
    case "reminder_penultimate":
      return {
        subject: `Reminder: Invoice ${input.invoiceNumber} due soon`,
        message: `Hi ${name},

This is a friendly reminder that invoice ${input.invoiceNumber} is due on ${dueStr} (1 day remaining).

Please complete payment by the due date to avoid a $${CLIENT_INVOICE_LATE_FEE_AMOUNT} late fee.

If you have already paid, please disregard this message.

Best regards,
Prep Services FBA Team`,
      };
    case "reminder_due_day":
      return {
        subject: `Final reminder: Invoice ${input.invoiceNumber} due today`,
        message: `Hi ${name},

Today is the due date for invoice ${input.invoiceNumber} (${dueStr}). Please submit payment today to avoid a $${CLIENT_INVOICE_LATE_FEE_AMOUNT} late fee.

If you have already paid, please disregard this message.

Best regards,
Prep Services FBA Team`,
      };
    case "late_fee":
      return {
        subject: `Late fee applied – Invoice ${input.invoiceNumber}`,
        message: `Hi ${name},

Invoice ${input.invoiceNumber} is now past due. A $${CLIENT_INVOICE_LATE_FEE_AMOUNT} late fee has been added to your invoice.

Your updated balance is ${totalStr}. Please log in to your dashboard to review the invoice and complete payment as soon as possible.

Best regards,
Prep Services FBA Team`,
      };
    default:
      return { subject: `Invoice ${input.invoiceNumber}`, message: "" };
  }
}

export function getClientInvoiceReminderTargets(invoice: Pick<Invoice, "dueDate" | "status"> & {
  reminderPenultimateEmailSentAt?: unknown;
  reminderDueDayEmailSentAt?: unknown;
  lateFeeEmailSentAt?: unknown;
  lateFeeAmount?: number;
}): {
  sendPenultimate: boolean;
  sendDueDay: boolean;
  applyLateFee: boolean;
} {
  if (invoice.status !== "pending") {
    return { sendPenultimate: false, sendDueDay: false, applyLateFee: false };
  }

  const dueDate = String(invoice.dueDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return { sendPenultimate: false, sendDueDay: false, applyLateFee: false };
  }

  const today = getTodayDateInputInNJ();
  const penultimate = addDaysToDateInput(dueDate, -1);
  const lateFeeAmount = Number(invoice.lateFeeAmount || 0);

  return {
    sendPenultimate: today === penultimate && !invoice.reminderPenultimateEmailSentAt,
    sendDueDay: today === dueDate && !invoice.reminderDueDayEmailSentAt,
    applyLateFee: today > dueDate && lateFeeAmount < 0.01 && !invoice.lateFeeEmailSentAt,
  };
}

export function buildLateFeeInvoiceUpdate(invoice: Invoice) {
  const totals = computeInvoiceTotals(invoice, {
    lateFeeAmount: CLIENT_INVOICE_LATE_FEE_AMOUNT,
  });

  return {
    lateFeeAmount: CLIENT_INVOICE_LATE_FEE_AMOUNT,
    lateFeeReason: "Past due",
    grossTotal: totals.grossTotal,
    grandTotal: totals.grandTotal,
  };
}

/** Fields to apply when admin changes due date — resets unsent reminder schedule. */
export function getDueDateChangeFieldResets(
  invoice: Pick<Invoice, "dueDate" | "lateFeeAmount">,
  newDueDate: string
): {
  resetPenultimate: boolean;
  resetDueDay: boolean;
  resetLateFeeEmail: boolean;
} {
  const oldDue = String(invoice.dueDate || "").trim();
  if (oldDue === newDueDate) {
    return { resetPenultimate: false, resetDueDay: false, resetLateFeeEmail: false };
  }

  const today = getTodayDateInputInNJ();
  const lateFeeAmount = Number(invoice.lateFeeAmount || 0);
  const newDueStillFutureOrToday = compareDateInputs(newDueDate, today) >= 0;

  return {
    resetPenultimate: true,
    resetDueDay: true,
    resetLateFeeEmail: newDueStillFutureOrToday && lateFeeAmount < 0.01,
  };
}
