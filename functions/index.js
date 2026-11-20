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

// sendInvoiceReminders (hourly) removed 2026-11-06 — do not re-add without agreement.
// Delete from GCP: firebase functions:delete sendInvoiceReminders --force

// ---- Client invoices (users/{uid}/invoices): creation email + due-date reminders ----
const {
  createSmtpTransporter,
  sendClientInvoiceCreatedEmail,
  runClientInvoiceReminders,
} = require("./client-invoice-automation");

const { upsertPrepcorexInvoiceSync } = require("./prepcorex-invoice-crm-sync");

exports.onClientInvoiceCreated = functions.firestore
  .document("users/{userId}/invoices/{invoiceId}")
  .onCreate(async (snap, context) => {
    const { userId, invoiceId } = context.params;
    const invoice = snap.data() || {};

    // Always mirror into CRM Invoice Sync queue (idempotent).
    try {
      await upsertPrepcorexInvoiceSync(admin.firestore(), userId, invoiceId, invoice);
    } catch (err) {
      console.error("CRM invoice sync mirror failed:", userId, invoiceId, err);
    }

    // Notify client when a new pending invoice appears (one email per invoice).
    try {
      const smtp = createSmtpTransporter(nodemailer);
      if (!smtp) {
        console.warn(
          "[Invoice automation] SMTP not configured — skipped created email:",
          userId,
          invoiceId
        );
        return null;
      }
      const result = await sendClientInvoiceCreatedEmail(
        admin.firestore(),
        smtp.transporter,
        smtp.config,
        userId,
        invoiceId
      );
      console.log("[Invoice automation] created email:", userId, invoiceId, result);
    } catch (err) {
      console.error("[Invoice automation] created email failed:", userId, invoiceId, err);
    }
    return null;
  });

/** Keep CRM sync mirror totals/status fresh when a client invoice is updated. */
exports.onClientInvoiceUpdated = functions.firestore
  .document("users/{userId}/invoices/{invoiceId}")
  .onUpdate(async (change, context) => {
    const { userId, invoiceId } = context.params;
    const invoice = change.after.data() || {};
    try {
      await upsertPrepcorexInvoiceSync(admin.firestore(), userId, invoiceId, invoice);
    } catch (err) {
      console.error("CRM invoice sync mirror update failed:", userId, invoiceId, err);
    }
    return null;
  });

/**
 * Daily (not hourly) client invoice reminders + late fee.
 * Cost note: scans each user’s pending invoices once per day (~9:00 America/New_York).
 * Do not change to every-minute / every-hour without agreement.
 */
exports.sendClientInvoiceReminders = functions
  .runWith({ timeoutSeconds: 540, memory: "512MB" })
  .pubsub.schedule("0 9 * * *")
  .timeZone("America/New_York")
  .onRun(async () => {
    const smtp = createSmtpTransporter(nodemailer);
    if (!smtp) {
      console.warn("[Invoice automation] SMTP not configured — skipped reminders");
      return null;
    }
    const metrics = await runClientInvoiceReminders(
      admin.firestore(),
      smtp.transporter,
      smtp.config
    );
    console.log("[Invoice automation] daily reminders:", metrics);
    return null;
  });

// ---- Client account inactivity (lock 30d / disable 60d) ----
// processClientAccountInactivity not exported (daily full users scan). Delete from GCP if present:
//   firebase functions:delete processClientAccountInactivity --force

// ---- Admin Notifications: email info@ on each new request create (no cron) ----
const { registerAdminRequestNotifyTriggers } = require("./admin-request-notify-email");
registerAdminRequestNotifyTriggers(exports, functions, {
  nodemailer,
  createSmtpTransporter,
  admin,
});

// Inbound tracking 6h cron lives in functions-inbound-cron/ (separate codebase for faster deploy).
// CRM Lexi cron lives in CRM-PrepCorex/functions (not here).

