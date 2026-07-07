import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import {
  buildClientInvoiceEmail,
  buildLateFeeInvoiceUpdate,
  getClientInvoiceReminderTargets,
  type ClientInvoiceEmailKind,
} from "@/lib/client-invoice-lifecycle";
import { sendServerEmail } from "@/lib/server-smtp";
import { computeInvoiceTotals } from "@/lib/invoice-totals";
import type { Invoice } from "@/types";

type InvoiceDoc = Invoice & {
  invoiceCreatedEmailSentAt?: FirebaseFirestore.Timestamp | Date | string;
  reminderPenultimateEmailSentAt?: FirebaseFirestore.Timestamp | Date | string;
  reminderDueDayEmailSentAt?: FirebaseFirestore.Timestamp | Date | string;
  lateFeeEmailSentAt?: FirebaseFirestore.Timestamp | Date | string;
};

function resolveClientEmail(invoice: InvoiceDoc): string {
  return String(invoice.soldTo?.email || "").trim();
}

function resolveClientName(invoice: InvoiceDoc): string {
  return String(invoice.soldTo?.name || "").trim();
}

export async function sendClientInvoiceEmail(input: {
  userId: string;
  invoiceId: string;
  kind: ClientInvoiceEmailKind;
  grandTotalOverride?: number;
}): Promise<{ sent: boolean; reason?: string }> {
  const db = adminDb();
  const ref = db.collection("users").doc(input.userId).collection("invoices").doc(input.invoiceId);
  const snap = await ref.get();
  if (!snap.exists) return { sent: false, reason: "invoice_not_found" };

  const invoice = { id: snap.id, ...(snap.data() as InvoiceDoc) };
  const to = resolveClientEmail(invoice);
  if (!to) return { sent: false, reason: "missing_client_email" };

  const totals = computeInvoiceTotals(invoice);
  const { subject, message } = buildClientInvoiceEmail({
    kind: input.kind,
    invoiceNumber: invoice.invoiceNumber,
    dueDate: invoice.dueDate,
    grandTotal: input.grandTotalOverride ?? totals.grandTotal,
    clientName: resolveClientName(invoice),
  });

  await sendServerEmail({ to, subject, message });
  return { sent: true };
}

export async function notifyClientInvoiceCreated(input: {
  userId: string;
  invoiceId: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const db = adminDb();
  const ref = db.collection("users").doc(input.userId).collection("invoices").doc(input.invoiceId);
  const snap = await ref.get();
  if (!snap.exists) return { sent: false, reason: "invoice_not_found" };

  const invoice = snap.data() as InvoiceDoc;
  if (invoice.status !== "pending") return { sent: false, reason: "not_pending" };
  if (invoice.invoiceCreatedEmailSentAt) return { sent: false, reason: "already_sent" };

  const result = await sendClientInvoiceEmail({
    userId: input.userId,
    invoiceId: input.invoiceId,
    kind: "created",
  });
  if (!result.sent) return result;

  await ref.update({
    invoiceCreatedEmailSentAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { sent: true };
}

export async function processClientInvoiceRemindersForUser(userId: string): Promise<Record<string, unknown>[]> {
  const db = adminDb();
  const results: Record<string, unknown>[] = [];
  const snap = await db.collection(`users/${userId}/invoices`).where("status", "==", "pending").get();

  for (const docSnap of snap.docs) {
    const invoice = { id: docSnap.id, ...(docSnap.data() as InvoiceDoc) };
    const ref = docSnap.ref;
    const targets = getClientInvoiceReminderTargets(invoice);

    if (targets.sendPenultimate) {
      try {
        const sent = await sendClientInvoiceEmail({
          userId,
          invoiceId: invoice.id!,
          kind: "reminder_penultimate",
        });
        if (sent.sent) {
          await ref.update({
            reminderPenultimateEmailSentAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          results.push({ userId, invoiceId: invoice.id, action: "reminder_penultimate" });
        }
      } catch (error) {
        results.push({
          userId,
          invoiceId: invoice.id,
          action: "reminder_penultimate_error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (targets.sendDueDay) {
      try {
        const sent = await sendClientInvoiceEmail({
          userId,
          invoiceId: invoice.id!,
          kind: "reminder_due_day",
        });
        if (sent.sent) {
          await ref.update({
            reminderDueDayEmailSentAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
          results.push({ userId, invoiceId: invoice.id, action: "reminder_due_day" });
        }
      } catch (error) {
        results.push({
          userId,
          invoiceId: invoice.id,
          action: "reminder_due_day_error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (targets.applyLateFee) {
      try {
        const update = buildLateFeeInvoiceUpdate(invoice);
        await ref.update({
          ...update,
          updatedAt: FieldValue.serverTimestamp(),
        });
        const sent = await sendClientInvoiceEmail({
          userId,
          invoiceId: invoice.id!,
          kind: "late_fee",
          grandTotalOverride: update.grandTotal,
        });
        if (sent.sent) {
          await ref.update({
            lateFeeEmailSentAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }
        results.push({
          userId,
          invoiceId: invoice.id,
          action: "late_fee_applied",
          grandTotal: update.grandTotal,
        });
      } catch (error) {
        results.push({
          userId,
          invoiceId: invoice.id,
          action: "late_fee_error",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return results;
}
