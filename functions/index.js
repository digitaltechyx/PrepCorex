const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const cors = require("cors");
const nodemailer = require("nodemailer");

admin.initializeApp();

const allowedOrigins = [
  "https://prepservicesfba.com",
  "https://www.prepservicesfba.com",
  "https://dev.prepservicesfba.com",
];

const corsHandler = cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (origin.includes("prepservicesfba.com")) return callback(null, true);
    return callback(new Error("Not allowed by CORS"));
  },
});

function normalizeRole(v) {
  return String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isAdminLikeToken(claims) {
  if (!claims) return false;
  if (claims.admin === true || claims.isAdmin === true) return true;
  if (claims.sub_admin === true || claims.subAdmin === true || claims.isSubAdmin === true) return true;
  const role = normalizeRole(claims.role);
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;
  const roles = Array.isArray(claims.roles) ? claims.roles.map(normalizeRole) : [];
  if (roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin")) return true;
  return false;
}

function isAdminLikeUserDoc(data) {
  if (!data) return false;
  if (data.isAdmin === true || data.admin === true || data.is_admin === true) return true;
  if (data.isSubAdmin === true || data.is_sub_admin === true) return true;
  const role = normalizeRole(data.role || data.userRole || data.userType);
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;
  const roles = Array.isArray(data.roles) ? data.roles.map(normalizeRole) : [];
  if (roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin")) return true;
  if (Array.isArray(data.features)) {
    if (data.features.includes("admin_dashboard") || data.features.includes("manage_invoices") || data.features.includes("manage_users") || data.features.includes("manage_quotes")) return true;
  } else if (data.features && typeof data.features === "object") {
    if (data.features.admin_dashboard === true || data.features.manage_invoices === true || data.features.manage_users === true || data.features.manage_quotes === true) return true;
  }
  return false;
}

async function requireAdmin(req) {
  const header = req.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized: Missing token" };
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) return { ok: false, status: 401, error: "Unauthorized: Empty token" };

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    if (isAdminLikeToken(decoded)) return { ok: true, uid: decoded.uid };

    const snap = await admin.firestore().collection("users").doc(decoded.uid).get();
    const data = snap.exists ? snap.data() : null;
    if (!isAdminLikeUserDoc(data)) {
      return { ok: false, status: 403, error: "Forbidden: Admin access required" };
    }
    return { ok: true, uid: decoded.uid };
  } catch (error) {
    return { ok: false, status: 401, error: "Unauthorized: Invalid token" };
  }
}

exports.sendQuoteEmail = functions.https.onRequest(async (req, res) => {
  return corsHandler(req, res, async () => {
    if (req.method === "OPTIONS") {
      res.status(204).send("");
      return;
    }
    if (req.method !== "POST") {
      res.status(405).json({ error: "Method not allowed" });
      return;
    }

    const auth = await requireAdmin(req);
    if (!auth.ok) {
      res.status(auth.status).json({ error: auth.error });
      return;
    }

    const { to, subject, message, attachments } = req.body || {};
    if (!to || !subject) {
      res.status(400).json({ error: "Missing required fields." });
      return;
    }

    const smtpHost = process.env.SMTP_HOST;
    const smtpPort = Number(process.env.SMTP_PORT || 587);
    const smtpUser = process.env.SMTP_USER;
    const smtpPassword = process.env.SMTP_PASSWORD;
    const smtpSecure = String(process.env.SMTP_SECURE || "false") === "true";
    const smtpFrom = process.env.SMTP_FROM || smtpUser;
    const smtpFromName = process.env.SMTP_FROM_NAME || "Prep Services FBA";

    if (!smtpHost || !smtpUser || !smtpPassword) {
      res.status(500).json({ error: "SMTP credentials are not configured." });
      return;
    }

    const formattedAttachments = Array.isArray(attachments)
      ? attachments.map((file) => ({
          filename: file.name,
          content: Buffer.from(file.dataBase64 || "", "base64"),
          contentType: file.type || undefined,
        }))
      : [];

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: smtpPort,
        secure: smtpSecure,
        requireTLS: !smtpSecure,
        auth: { user: smtpUser, pass: smtpPassword },
        tls: { rejectUnauthorized: false },
      });

      await transporter.verify();

      await transporter.sendMail({
        from: smtpFromName ? `${smtpFromName} <${smtpFrom}>` : smtpFrom,
        to,
        subject,
        text: message || "",
        attachments: formattedAttachments,
      });

      res.json({ success: true });
    } catch (error) {
      console.error("Email send error:", error);
      res.status(500).json({ error: error?.message || "Failed to send email." });
    }
  });
});

// ---- Server-side invoice automation (works even if no browser is open) ----
const REMINDER_24H_MS = 24 * 60 * 60 * 1000;
const LATE_FEE_AMOUNT = 19;
const PROCESSING_LOCK_MS = 30 * 60 * 1000;

const REMINDER_24H_MESSAGE = (invoiceNumber, dueDateStr) => `Hi,

We sent you an invoice (${invoiceNumber}) 24 hours ago. This is a friendly reminder to complete payment by ${dueDateStr} to avoid a $19 late fee.

If you've already paid, please disregard this message. If you have any questions, we're here to help.

Best regards,
Prep Services FBA Team`;

const OVERDUE_LATE_FEE_MESSAGE = `Hi,

We'd like to inform you that a late fee of $19 has been added to your invoice, as payment was not received by the due date, in accordance with our billing terms.

If payment has already been made, please disregard this message. Otherwise, we kindly request you to complete the payment at your earliest convenience so services can continue without interruption.

If you have any questions or believe this was applied in error, feel free to reach out—we're happy to assist.

Thank you for your understanding.

Best regards,
Prep Services FBA Team`;

const FINAL_REMINDER_MESSAGE = `Hi,

Our records show that your invoice is still unpaid, even after the late fee was applied. As per our terms, services—including receiving, prep, storage, and shipments—may be temporarily paused until payment is completed.

We'd really appreciate it if you could settle the outstanding balance as soon as possible to avoid any disruption. If you've already made the payment, please disregard this message.

And of course, if you have any questions or concerns, we're always here to help.

Thank you for your attention.

Best regards,
Prep Services FBA Team`;

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

/** New Jersey (Eastern Time) - used for invoice due-date and automation schedule */
const TZ_NEW_JERSEY = "America/New_York";

/** Get today's date (midnight) in New Jersey time for overdue/reminder logic */
function getTodayInNJ() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_NEW_JERSEY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const y = parts.find((p) => p.type === "year").value;
  const m = parts.find((p) => p.type === "month").value;
  const d = parts.find((p) => p.type === "day").value;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  date.setUTCHours(0, 0, 0, 0);
  return date;
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

function getDiscountAmount(invoice) {
  if (!invoice || !invoice.discountType || invoice.discountValue == null) return 0;
  const total = Number(invoice.total || 0);
  const lateFee = Number(invoice.lateFee || 0);
  const baseTotal = lateFee > 0 ? total + lateFee : total;
  if (invoice.discountType === "percentage") {
    return Number((baseTotal * (Number(invoice.discountValue) / 100)).toFixed(2));
  }
  return Math.min(Number(invoice.discountValue || 0), baseTotal);
}

function getGrandTotalWithLateFee(invoice) {
  const total = Number(invoice.total || 0);
  const discount = getDiscountAmount(invoice);
  const lateFee = Number(invoice.lateFee || 0);
  return Number((total - discount + lateFee).toFixed(2));
}

function isFullyPaidInvoice(invoice) {
  if (!invoice) return true;
  if (invoice.status === "paid" || invoice.status === "cancelled" || invoice.status === "disputed") return true;
  const paid = Number(invoice.amountPaid || 0);
  const grandTotal = getGrandTotalWithLateFee(invoice);
  return paid >= grandTotal;
}

function isOverdueInvoice(invoice) {
  if (!invoice || isFullyPaidInvoice(invoice)) return false;
  if (!(invoice.status === "sent" || invoice.status === "partially_paid")) return false;
  const due = parseDateOnlyLocal(invoice.dueDate);
  if (!due) return false;
  due.setHours(0, 0, 0, 0);
  const todayNJ = getTodayInNJ();
  // Overdue only after the due date has passed in New Jersey time.
  // Example: due 2026-02-20 becomes overdue on 2026-02-21.
  return due.getTime() < todayNJ.getTime();
}

async function writeEmailLog(db, payload) {
  await db.collection("external_invoice_email_logs").add({
    to: payload.to || "",
    subject: payload.subject || "",
    type: payload.type || "",
    invoiceNumber: payload.invoiceNumber || "",
    clientName: payload.clientName || "",
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    sentBy: "system:invoice_automation",
  });
}

async function sendPlainEmail(transporter, smtpFromName, smtpFrom, to, subject, message) {
  await transporter.sendMail({
    from: smtpFromName ? `${smtpFromName} <${smtpFrom}>` : smtpFrom,
    to,
    subject,
    text: message || "",
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

// Run every 1 hour on the hour in New Jersey (America/New_York) time.
exports.sendInvoiceReminders = functions.pubsub
  .schedule("every 1 hours")
  .timeZone(TZ_NEW_JERSEY)
  .onRun(async () => {
  const db = admin.firestore();
  const now = Date.now();
  const runMetrics = {
    scannedInvoices: 0,
    reminder24hEligible: 0,
    reminder24hNoEmail: 0,
    reminder24hSent: 0,
    reminder24hFailed: 0,
    overdueEligible: 0,
    overdueNoEmail: 0,
    overdueSent: 0,
    overdueFailed: 0,
    finalEligible: 0,
    finalNoEmail: 0,
    finalSent: 0,
    finalFailed: 0,
  };

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpSecure = String(process.env.SMTP_SECURE || "false") === "true";
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  const smtpFromName = process.env.SMTP_FROM_NAME || "Prep Services FBA";

  if (!smtpHost || !smtpUser || !smtpPassword) {
    console.warn("Invoice reminders: SMTP not configured, skipping.");
    return null;
  }

  let transporter;
  try {
    transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      requireTLS: !smtpSecure,
      auth: { user: smtpUser, pass: smtpPassword },
      tls: { rejectUnauthorized: false },
    });
    await transporter.verify();
  } catch (err) {
    console.error("Invoice reminders: SMTP verify failed", err);
    return null;
  }

  const candidates = [];
  const sentSnap = await db.collection("external_invoices").where("status", "==", "sent").get();
  sentSnap.docs.forEach((doc) => candidates.push({ id: doc.id, ...doc.data() }));
  const partiallyPaidSnap = await db.collection("external_invoices").where("status", "==", "partially_paid").get();
  partiallyPaidSnap.docs.forEach((doc) => candidates.push({ id: doc.id, ...doc.data() }));
  const dedupedById = new Map();
  for (const inv of candidates) dedupedById.set(inv.id, inv);
  const invoices = Array.from(dedupedById.values()).filter((inv) => !isFullyPaidInvoice(inv));
  runMetrics.scannedInvoices = invoices.length;

  // 1) 24h reminder (once)
  for (const inv of invoices) {
    const sentAt = asDate(inv.sentAt);
    if (inv.reminderSentAt) continue;
    if (!sentAt || !Number.isFinite(sentAt.getTime()) || now - sentAt.getTime() < REMINDER_24H_MS) continue;
    runMetrics.reminder24hEligible += 1;
    const to = String(inv.clientEmail || "").trim();
    if (!to) {
      runMetrics.reminder24hNoEmail += 1;
      continue;
    }
    const docRef = db.collection("external_invoices").doc(inv.id);

    try {
      const lockedInv = await tryAcquireInvoiceLock(db, docRef, "reminderProcessingUntil", "reminderSentAt");
      if (!lockedInv) continue;
      const dueDate = parseDateOnlyLocal(lockedInv.dueDate) || new Date();
      const dueDateStr = dueDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      const subject = `Reminder: Invoice ${lockedInv.invoiceNumber || lockedInv.id} - payment due`;
      const message = REMINDER_24H_MESSAGE(lockedInv.invoiceNumber || lockedInv.id, dueDateStr);
      await sendPlainEmail(transporter, smtpFromName, smtpFrom, to, subject, message);
      await docRef.update({
        reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        reminderProcessingUntil: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await writeEmailLog(db, {
        to,
        subject,
        type: "reminder_24h",
        invoiceNumber: lockedInv.invoiceNumber || "",
        clientName: lockedInv.clientName || "",
      });
      runMetrics.reminder24hSent += 1;
      console.log("24h reminder sent:", lockedInv.id, lockedInv.invoiceNumber, to);
    } catch (err) {
      runMetrics.reminder24hFailed += 1;
      console.error("24h reminder send failed:", inv.id, err);
      try {
        await clearInvoiceLock(docRef, "reminderProcessingUntil");
      } catch (_) {}
    }
  }

  // Refresh invoice snapshots after reminder updates.
  const sentSnap2 = await db.collection("external_invoices").where("status", "==", "sent").get();
  const partiallyPaidSnap2 = await db.collection("external_invoices").where("status", "==", "partially_paid").get();
  const currentById = new Map();
  sentSnap2.docs.forEach((doc) => currentById.set(doc.id, { id: doc.id, ...doc.data() }));
  partiallyPaidSnap2.docs.forEach((doc) => currentById.set(doc.id, { id: doc.id, ...doc.data() }));
  const currentInvoices = Array.from(currentById.values()).filter((inv) => !isFullyPaidInvoice(inv));

  // 2) First overdue: apply late fee + overdue email (once)
  for (const inv of currentInvoices) {
    if (!isOverdueInvoice(inv)) continue;
    if ((Number(inv.lateFee || 0) > 0) || inv.lateFeeEmailSentAt) continue;
    runMetrics.overdueEligible += 1;
    const to = String(inv.clientEmail || "").trim();
    if (!to) {
      runMetrics.overdueNoEmail += 1;
      continue;
    }
    const docRef = db.collection("external_invoices").doc(inv.id);
    try {
      const lockedInv = await tryAcquireInvoiceLock(db, docRef, "overdueProcessingUntil", "lateFeeEmailSentAt");
      if (!lockedInv) continue;
      const todayNJ = getTodayInNJ();
      const tomorrowNJ = new Date(todayNJ);
      tomorrowNJ.setUTCDate(tomorrowNJ.getUTCDate() + 1);
      const invoiceDateStr = formatDateInputLocal(todayNJ);
      const dueDateStr = formatDateInputLocal(tomorrowNJ);
      const updatedInv = { ...lockedInv, lateFee: LATE_FEE_AMOUNT, invoiceDate: invoiceDateStr, dueDate: dueDateStr };
      const amountPaid = Number(lockedInv.amountPaid || 0);
      const newOutstanding = Math.max(0, Number((getGrandTotalWithLateFee(updatedInv) - amountPaid).toFixed(2)));
      const subject = `Late Fee Added - Invoice ${lockedInv.invoiceNumber || lockedInv.id}`;
      await sendPlainEmail(transporter, smtpFromName, smtpFrom, to, subject, OVERDUE_LATE_FEE_MESSAGE);
      await docRef.update({
        lateFee: LATE_FEE_AMOUNT,
        invoiceDate: invoiceDateStr,
        dueDate: dueDateStr,
        outstandingBalance: newOutstanding,
        lateFeeEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        overdueProcessingUntil: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await writeEmailLog(db, {
        to,
        subject,
        type: "overdue",
        invoiceNumber: lockedInv.invoiceNumber || "",
        clientName: lockedInv.clientName || "",
      });
      runMetrics.overdueSent += 1;
      console.log("Overdue late-fee email sent:", lockedInv.id, lockedInv.invoiceNumber, to);
    } catch (err) {
      runMetrics.overdueFailed += 1;
      console.error("Overdue late-fee email failed:", inv.id, err);
      try {
        await clearInvoiceLock(docRef, "overdueProcessingUntil");
      } catch (_) {}
    }
  }

  // Refresh invoice snapshots after overdue updates.
  const sentSnap3 = await db.collection("external_invoices").where("status", "==", "sent").get();
  const partiallyPaidSnap3 = await db.collection("external_invoices").where("status", "==", "partially_paid").get();
  const currentById2 = new Map();
  sentSnap3.docs.forEach((doc) => currentById2.set(doc.id, { id: doc.id, ...doc.data() }));
  partiallyPaidSnap3.docs.forEach((doc) => currentById2.set(doc.id, { id: doc.id, ...doc.data() }));
  const currentInvoices2 = Array.from(currentById2.values()).filter((inv) => !isFullyPaidInvoice(inv));

  // 3) Second overdue: final reminder (once, even if late fee was later removed)
  for (const inv of currentInvoices2) {
    if (!isOverdueInvoice(inv)) continue;
    if (!inv.lateFeeEmailSentAt || inv.secondOverdueReminderSentAt) continue;
    runMetrics.finalEligible += 1;
    const to = String(inv.clientEmail || "").trim();
    if (!to) {
      runMetrics.finalNoEmail += 1;
      continue;
    }
    const docRef = db.collection("external_invoices").doc(inv.id);
    try {
      const lockedInv = await tryAcquireInvoiceLock(db, docRef, "finalReminderProcessingUntil", "secondOverdueReminderSentAt");
      if (!lockedInv) continue;
      const subject = `Final Reminder: Unpaid Invoice ${lockedInv.invoiceNumber || lockedInv.id}`;
      await sendPlainEmail(transporter, smtpFromName, smtpFrom, to, subject, FINAL_REMINDER_MESSAGE);
      await docRef.update({
        secondOverdueReminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        finalReminderProcessingUntil: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      await writeEmailLog(db, {
        to,
        subject,
        type: "second_reminder",
        invoiceNumber: lockedInv.invoiceNumber || "",
        clientName: lockedInv.clientName || "",
      });
      runMetrics.finalSent += 1;
      console.log("Final reminder sent:", lockedInv.id, lockedInv.invoiceNumber, to);
    } catch (err) {
      runMetrics.finalFailed += 1;
      console.error("Final reminder send failed:", inv.id, err);
      try {
        await clearInvoiceLock(docRef, "finalReminderProcessingUntil");
      } catch (_) {}
    }
  }

  console.log("[Invoice automation metrics]", JSON.stringify(runMetrics));

  return null;
});

// ---- Client invoices (users/{uid}/invoices): creation email + due-date reminders ----
const {
  createSmtpTransporter,
  sendClientInvoiceCreatedEmail,
  runClientInvoiceReminders,
} = require("./client-invoice-automation");

exports.onClientInvoiceCreated = functions.firestore
  .document("users/{userId}/invoices/{invoiceId}")
  .onCreate(async (snap, context) => {
    const { userId, invoiceId } = context.params;
    const invoice = snap.data() || {};
    if (invoice.status !== "pending") return null;
    if (invoice.invoiceCreatedEmailSentAt) return null;

    const smtp = createSmtpTransporter(nodemailer);
    if (!smtp) {
      console.warn("Client invoice created: SMTP not configured, skipping email.");
      return null;
    }

    try {
      await smtp.transporter.verify();
      const result = await sendClientInvoiceCreatedEmail(
        admin.firestore(),
        smtp.transporter,
        smtp.config,
        userId,
        invoiceId
      );
      if (result.sent) {
        console.log("Client invoice created email sent:", userId, invoiceId);
      }
    } catch (err) {
      console.error("Client invoice created email failed:", userId, invoiceId, err);
    }
    return null;
  });

exports.sendClientInvoiceReminders = functions.pubsub
  .schedule("every 1 hours")
  .timeZone(TZ_NEW_JERSEY)
  .onRun(async () => {
    const smtp = createSmtpTransporter(nodemailer);
    if (!smtp) {
      console.warn("Client invoice reminders: SMTP not configured, skipping.");
      return null;
    }

    try {
      await smtp.transporter.verify();
      const metrics = await runClientInvoiceReminders(admin.firestore(), smtp.transporter, smtp.config);
      console.log("[Client invoice automation metrics]", JSON.stringify(metrics));
    } catch (err) {
      console.error("Client invoice reminders failed:", err);
    }
    return null;
  });

// ---- Client account inactivity (lock 30d / disable 60d) ----
const { runClientAccountInactivity } = require("./client-account-inactivity");

exports.processClientAccountInactivity = functions.pubsub
  .schedule("every 24 hours")
  .timeZone(TZ_NEW_JERSEY)
  .onRun(async () => {
    try {
      const metrics = await runClientAccountInactivity(admin.firestore());
      console.log("[Client account inactivity metrics]", JSON.stringify(metrics));
    } catch (err) {
      console.error("Client account inactivity failed:", err);
    }
    return null;
  });

// Inbound tracking 6h cron lives in functions-inbound-cron/ (separate codebase for faster deploy).
