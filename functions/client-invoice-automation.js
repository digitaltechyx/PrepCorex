const admin = require("firebase-admin");

const CLIENT_INVOICE_DUE_DAYS = 5;
const CLIENT_INVOICE_LATE_FEE_AMOUNT = 19;
const PROCESSING_LOCK_MS = 30 * 60 * 1000;

const CLIENT_INVOICE_TERMS = [
  "Invoices must be paid in full before work begins unless written credit terms are approved by management.",
  `Unpaid invoices after the due date may incur a $${CLIENT_INVOICE_LATE_FEE_AMOUNT} late fee per invoice.`,
  "Prep Services FBA may pause receiving, prep, storage, and shipments until payment is completed.",
  "All completed labor services are non-refundable.",
  "Client is responsible for product compliance, labeling accuracy, and marketplace requirements.",
  "Any billing concern must be reported within 48 hours of invoice receipt. Unauthorized chargebacks may result in service suspension.",
].join("\n");

function asDate(value) {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    const d = new Date(value.seconds * 1000);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

function parseDateOnlyLocal(value) {
  if (!value || typeof value !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatDateInputLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getTodayDateInputInNJ() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  return `${y}-${m}-${d}`;
}

function addDaysToDateInput(value, days) {
  const base = parseDateOnlyLocal(value);
  if (!base) return value;
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return formatDateInputLocal(next);
}

function formatDateInputForDisplay(value) {
  if (!value) return "the due date";
  const d = parseDateOnlyLocal(value);
  if (!d) return value;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function getAdminAdditionalCharges(invoice) {
  const raw = invoice.adminAdditionalCharges;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.name === "string")
    .map((c) => ({
      id: c.id || "",
      name: String(c.name).trim(),
      amount: Math.max(0, Number(c.amount) || 0),
    }));
}

function computeClientInvoiceTotals(invoice, overrides = {}) {
  const itemsSubtotal = (invoice.items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const shipmentAdditionalTotal = Number(invoice.additionalServices?.total || 0);
  const adminCharges = overrides.adminAdditionalCharges || getAdminAdditionalCharges(invoice);
  const adminChargesTotal = adminCharges.reduce((sum, c) => sum + (Number(c.amount) || 0), 0);
  const grossTotal = itemsSubtotal + shipmentAdditionalTotal + adminChargesTotal;

  const discountType = overrides.discountType !== undefined ? overrides.discountType : invoice.discountType;
  const discountValue =
    overrides.discountValue !== undefined
      ? overrides.discountValue
      : typeof invoice.discountValue === "number"
        ? invoice.discountValue
        : undefined;

  let discountAmount = 0;
  if (
    typeof invoice.discountAmount === "number" &&
    overrides.discountType === undefined &&
    overrides.discountValue === undefined
  ) {
    discountAmount = Math.max(0, Math.min(grossTotal, invoice.discountAmount));
  } else if (discountType === "percent" && typeof discountValue === "number") {
    discountAmount = grossTotal * (Math.max(0, Math.min(100, discountValue)) / 100);
  } else if (discountType === "amount" && typeof discountValue === "number") {
    discountAmount = Math.max(0, discountValue);
  }
  discountAmount = Math.max(0, Math.min(grossTotal, discountAmount));

  const lateFeeAmount = Math.max(
    0,
    overrides.lateFeeAmount !== undefined ? overrides.lateFeeAmount : Number(invoice.lateFeeAmount || 0)
  );

  const grandTotal = Math.max(0, grossTotal - discountAmount + lateFeeAmount);
  return { grossTotal, grandTotal, lateFeeAmount };
}

function formatTermsBlock() {
  return `\n\nPayment terms:\n${CLIENT_INVOICE_TERMS.split("\n")
    .map((line) => `• ${line}`)
    .join("\n")}`;
}

function buildClientInvoiceEmail(input) {
  const name = String(input.clientName || "").trim() || "there";
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

function getClientInvoiceReminderTargets(invoice) {
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

function buildLateFeeInvoiceUpdate(invoice) {
  const totals = computeClientInvoiceTotals(invoice, { lateFeeAmount: CLIENT_INVOICE_LATE_FEE_AMOUNT });
  return {
    lateFeeAmount: CLIENT_INVOICE_LATE_FEE_AMOUNT,
    lateFeeReason: "Past due",
    grossTotal: totals.grossTotal,
    grandTotal: totals.grandTotal,
  };
}

function resolveClientEmail(invoice) {
  return String(invoice.soldTo?.email || "").trim();
}

function resolveClientName(invoice) {
  return String(invoice.soldTo?.name || "").trim();
}

async function writeClientEmailLog(db, payload) {
  await db.collection("client_invoice_email_logs").add({
    to: payload.to || "",
    subject: payload.subject || "",
    type: payload.type || "",
    invoiceNumber: payload.invoiceNumber || "",
    clientName: payload.clientName || "",
    userId: payload.userId || "",
    invoiceId: payload.invoiceId || "",
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    sentBy: "system:client_invoice_automation",
  });
}

async function tryAcquireInvoiceLock(db, docRef, lockField, sentField) {
  const now = Date.now();
  const lockUntil = new Date(now + PROCESSING_LOCK_MS);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    if (!snap.exists) return null;
    const data = snap.data() || {};
    if (data[sentField]) return null;
    const lockedUntilDate = asDate(data[lockField]);
    if (lockedUntilDate && lockedUntilDate.getTime() > now) return null;
    tx.update(docRef, { [lockField]: lockUntil });
    return { id: snap.id, ...data };
  });
}

async function clearInvoiceLock(docRef, lockField) {
  await docRef.update({
    [lockField]: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function sendClientInvoiceEmail(transporter, smtpFromName, smtpFrom, input) {
  const { subject, message } = buildClientInvoiceEmail(input);
  await transporter.sendMail({
    from: smtpFromName ? `${smtpFromName} <${smtpFrom}>` : smtpFrom,
    to: input.to,
    subject,
    text: message || "",
  });
  return { subject, message };
}

async function sendClientInvoiceCreatedEmail(db, transporter, smtpConfig, userId, invoiceId) {
  const docRef = db.collection("users").doc(userId).collection("invoices").doc(invoiceId);
  const lockedInv = await tryAcquireInvoiceLock(
    db,
    docRef,
    "invoiceCreatedProcessingUntil",
    "invoiceCreatedEmailSentAt"
  );
  if (!lockedInv) return { sent: false, reason: "locked_or_already_sent" };
  if (lockedInv.status !== "pending") {
    await clearInvoiceLock(docRef, "invoiceCreatedProcessingUntil");
    return { sent: false, reason: "not_pending" };
  }

  const to = resolveClientEmail(lockedInv);
  if (!to) {
    await clearInvoiceLock(docRef, "invoiceCreatedProcessingUntil");
    return { sent: false, reason: "missing_client_email" };
  }

  const totals = computeClientInvoiceTotals(lockedInv);
  try {
    const { subject } = await sendClientInvoiceEmail(transporter, smtpConfig.fromName, smtpConfig.from, {
      kind: "created",
      to,
      invoiceNumber: lockedInv.invoiceNumber || invoiceId,
      dueDate: lockedInv.dueDate,
      grandTotal: totals.grandTotal,
      clientName: resolveClientName(lockedInv),
    });
    await docRef.update({
      invoiceCreatedEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      invoiceCreatedProcessingUntil: admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await writeClientEmailLog(db, {
      to,
      subject,
      type: "created",
      invoiceNumber: lockedInv.invoiceNumber || "",
      clientName: resolveClientName(lockedInv),
      userId,
      invoiceId,
    });
    return { sent: true };
  } catch (error) {
    await clearInvoiceLock(docRef, "invoiceCreatedProcessingUntil");
    throw error;
  }
}

async function runClientInvoiceReminders(db, transporter, smtpConfig) {
  const runMetrics = {
    scannedUsers: 0,
    scannedInvoices: 0,
    penultimateSent: 0,
    dueDaySent: 0,
    lateFeeApplied: 0,
    errors: 0,
  };

  const usersSnap = await db.collection("users").get();
  runMetrics.scannedUsers = usersSnap.size;

  for (const userDoc of usersSnap.docs) {
    const userId = userDoc.id;
    const pendingSnap = await db.collection(`users/${userId}/invoices`).where("status", "==", "pending").get();

    for (const docSnap of pendingSnap.docs) {
      runMetrics.scannedInvoices += 1;
      const invoice = { id: docSnap.id, ...docSnap.data() };
      const ref = docSnap.ref;
      const targets = getClientInvoiceReminderTargets(invoice);
      const to = resolveClientEmail(invoice);
      if (!to) continue;

      if (targets.sendPenultimate) {
        try {
          const lockedInv = await tryAcquireInvoiceLock(
            db,
            ref,
            "reminderPenultimateProcessingUntil",
            "reminderPenultimateEmailSentAt"
          );
          if (!lockedInv) continue;
          const totals = computeClientInvoiceTotals(lockedInv);
          const { subject } = await sendClientInvoiceEmail(transporter, smtpConfig.fromName, smtpConfig.from, {
            kind: "reminder_penultimate",
            to,
            invoiceNumber: lockedInv.invoiceNumber || lockedInv.id,
            dueDate: lockedInv.dueDate,
            grandTotal: totals.grandTotal,
            clientName: resolveClientName(lockedInv),
          });
          await ref.update({
            reminderPenultimateEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            reminderPenultimateProcessingUntil: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await writeClientEmailLog(db, {
            to,
            subject,
            type: "reminder_penultimate",
            invoiceNumber: lockedInv.invoiceNumber || "",
            clientName: resolveClientName(lockedInv),
            userId,
            invoiceId: lockedInv.id,
          });
          runMetrics.penultimateSent += 1;
        } catch (err) {
          runMetrics.errors += 1;
          console.error("Client penultimate reminder failed:", userId, invoice.id, err);
          try {
            await clearInvoiceLock(ref, "reminderPenultimateProcessingUntil");
          } catch (_) {}
        }
      }

      if (targets.sendDueDay) {
        try {
          const lockedInv = await tryAcquireInvoiceLock(
            db,
            ref,
            "reminderDueDayProcessingUntil",
            "reminderDueDayEmailSentAt"
          );
          if (!lockedInv) continue;
          const totals = computeClientInvoiceTotals(lockedInv);
          const { subject } = await sendClientInvoiceEmail(transporter, smtpConfig.fromName, smtpConfig.from, {
            kind: "reminder_due_day",
            to,
            invoiceNumber: lockedInv.invoiceNumber || lockedInv.id,
            dueDate: lockedInv.dueDate,
            grandTotal: totals.grandTotal,
            clientName: resolveClientName(lockedInv),
          });
          await ref.update({
            reminderDueDayEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            reminderDueDayProcessingUntil: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await writeClientEmailLog(db, {
            to,
            subject,
            type: "reminder_due_day",
            invoiceNumber: lockedInv.invoiceNumber || "",
            clientName: resolveClientName(lockedInv),
            userId,
            invoiceId: lockedInv.id,
          });
          runMetrics.dueDaySent += 1;
        } catch (err) {
          runMetrics.errors += 1;
          console.error("Client due-day reminder failed:", userId, invoice.id, err);
          try {
            await clearInvoiceLock(ref, "reminderDueDayProcessingUntil");
          } catch (_) {}
        }
      }

      if (targets.applyLateFee) {
        try {
          const lockedInv = await tryAcquireInvoiceLock(db, ref, "lateFeeProcessingUntil", "lateFeeEmailSentAt");
          if (!lockedInv) continue;
          const update = buildLateFeeInvoiceUpdate(lockedInv);
          await ref.update({
            ...update,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          const { subject } = await sendClientInvoiceEmail(transporter, smtpConfig.fromName, smtpConfig.from, {
            kind: "late_fee",
            to,
            invoiceNumber: lockedInv.invoiceNumber || lockedInv.id,
            dueDate: lockedInv.dueDate,
            grandTotal: update.grandTotal,
            clientName: resolveClientName(lockedInv),
          });
          await ref.update({
            lateFeeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
            lateFeeProcessingUntil: admin.firestore.FieldValue.delete(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          await writeClientEmailLog(db, {
            to,
            subject,
            type: "late_fee",
            invoiceNumber: lockedInv.invoiceNumber || "",
            clientName: resolveClientName(lockedInv),
            userId,
            invoiceId: lockedInv.id,
          });
          runMetrics.lateFeeApplied += 1;
        } catch (err) {
          runMetrics.errors += 1;
          console.error("Client late fee failed:", userId, invoice.id, err);
          try {
            await clearInvoiceLock(ref, "lateFeeProcessingUntil");
          } catch (_) {}
        }
      }
    }
  }

  return runMetrics;
}

function createSmtpTransporter(nodemailer) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpSecure = String(process.env.SMTP_SECURE || "false") === "true";
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  const smtpFromName = process.env.SMTP_FROM_NAME || "Prep Services FBA";

  if (!smtpHost || !smtpUser || !smtpPassword) {
    return null;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    requireTLS: !smtpSecure,
    auth: { user: smtpUser, pass: smtpPassword },
    tls: { rejectUnauthorized: false },
  });

  return {
    transporter,
    config: { from: smtpFrom, fromName: smtpFromName },
  };
}

module.exports = {
  CLIENT_INVOICE_DUE_DAYS,
  CLIENT_INVOICE_LATE_FEE_AMOUNT,
  createSmtpTransporter,
  sendClientInvoiceCreatedEmail,
  runClientInvoiceReminders,
};
