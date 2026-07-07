const admin = require("firebase-admin");
const nodemailer = require("nodemailer");

const LOCK_DAYS = 30;
const DISABLE_DAYS = 60;

function normalizeRoles(data) {
  const normalize = (v) =>
    String(v || "")
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, "_");
  if (Array.isArray(data.roles)) {
    return data.roles.map(normalize).filter(Boolean);
  }
  return data.role ? [normalize(data.role)] : ["user"];
}

function isClientPortalUser(data) {
  const roles = normalizeRoles(data);
  if (!roles.includes("user")) return false;
  const staff = new Set(["admin", "sub_admin", "subadmin", "commission_agent", "commissionagent", "warehouse_operator", "warehouseoperator"]);
  return !roles.some((role) => staff.has(role));
}

function asDate(value) {
  if (!value) return null;
  if (value.toDate && typeof value.toDate === "function") return value.toDate();
  if (typeof value === "string" || typeof value === "number") {
    const d = new Date(value);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  if (typeof value === "object" && typeof value.seconds === "number") {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function getInactivityAnchorDate(data) {
  return asDate(data.lastLoginAt) || asDate(data.approvedAt) || asDate(data.createdAt) || null;
}

function getDaysSince(date, now = new Date()) {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
}

function createSmtpTransporter() {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpUser = process.env.SMTP_USER;
  const smtpPassword = process.env.SMTP_PASSWORD;
  const smtpSecure = String(process.env.SMTP_SECURE || "false") === "true";
  const smtpFrom = process.env.SMTP_FROM || smtpUser;
  const smtpFromName = process.env.SMTP_FROM_NAME || "PrepCorex";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://dev.psfstockflow.com";

  if (!smtpHost || !smtpUser || !smtpPassword) return null;

  return {
    transporter: nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      requireTLS: !smtpSecure,
      auth: { user: smtpUser, pass: smtpPassword },
      tls: { rejectUnauthorized: false },
    }),
    from: smtpFrom,
    fromName: smtpFromName,
    loginUrl: `${String(appUrl).replace(/\/$/, "")}/login`,
  };
}

function buildEmail(action, contactName, loginUrl) {
  const name = String(contactName || "there").trim() || "there";
  const templates = {
    lock: {
      subject: "Your PrepCorex account has been locked",
      message: `Hello ${name},

Your PrepCorex client account has been locked because there has been no login activity for 30 days.

You can still sign in to view this notice, but dashboard access is paused until an administrator unlocks your account.

Sign in: ${loginUrl}

PrepCorex Team`,
    },
    disable: {
      subject: "Your PrepCorex account has been disabled",
      message: `Hello ${name},

Your PrepCorex client account has been disabled because there has been no login activity for 60 days.

You can still sign in to view this notice, but dashboard access remains unavailable until an administrator re-enables your account.

Sign in: ${loginUrl}

PrepCorex Team`,
    },
  };
  return templates[action];
}

async function sendStatusEmail(smtp, to, action, contactName) {
  const mail = buildEmail(action, contactName, smtp.loginUrl);
  await smtp.transporter.sendMail({
    from: smtp.fromName ? `${smtp.fromName} <${smtp.from}>` : smtp.from,
    to,
    subject: mail.subject,
    text: mail.message,
  });
}

async function applyInactivityAction(db, ref, data, action) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const update =
    action === "lock"
      ? {
          status: "locked",
          lockedAt: now,
          disabledAt: admin.firestore.FieldValue.delete(),
          accountStatusReason: "inactivity",
          updatedAt: now,
        }
      : {
          status: "disabled",
          disabledAt: now,
          lockedAt: admin.firestore.FieldValue.delete(),
          accountStatusReason: "inactivity",
          updatedAt: now,
        };

  await ref.update(update);

  const to = String(data.email || "").trim();
  if (!to) return { emailSent: false };

  const smtp = createSmtpTransporter();
  if (!smtp) return { emailSent: false };

  await smtp.transporter.verify();
  await sendStatusEmail(smtp, to, action, data.name);
  return { emailSent: true };
}

async function runClientAccountInactivity(db) {
  const metrics = { scanned: 0, locked: 0, disabled: 0, skipped: 0, errors: 0 };
  const usersSnap = await db.collection("users").get();

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data() || {};
    if (!isClientPortalUser(data)) continue;

    const status = String(data.status || "approved");
    if (status === "pending" || status === "deleted" || status === "disabled") {
      metrics.skipped += 1;
      continue;
    }

    const anchor = getInactivityAnchorDate(data);
    if (!anchor) {
      metrics.skipped += 1;
      continue;
    }

    metrics.scanned += 1;
    const inactiveDays = getDaysSince(anchor);

    try {
      if (inactiveDays >= DISABLE_DAYS && (status === "approved" || status === "locked")) {
        await applyInactivityAction(db, userDoc.ref, data, "disable");
        metrics.disabled += 1;
        continue;
      }

      if (inactiveDays >= LOCK_DAYS && status === "approved") {
        await applyInactivityAction(db, userDoc.ref, data, "lock");
        metrics.locked += 1;
      }
    } catch (error) {
      metrics.errors += 1;
      console.error("Client inactivity action failed:", userDoc.id, error);
    }
  }

  return metrics;
}

module.exports = {
  runClientAccountInactivity,
};
