/**
 * Email info@ when a new Admin Notifications request is created.
 * One onCreate → one email. No cron / collectionGroup scans.
 */

const DEFAULT_TO = "info@prepservicesfba.com";
const DEFAULT_APP_URL = "https://www.prepservicesfba.com";

function notifyTo() {
  return String(process.env.ADMIN_REQUEST_NOTIFY_EMAIL || DEFAULT_TO).trim() || DEFAULT_TO;
}

function appBaseUrl() {
  return String(process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || DEFAULT_APP_URL)
    .trim()
    .replace(/\/$/, "");
}

function str(value, fallback = "") {
  const v = String(value ?? "").trim();
  return v || fallback;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Accent chip colors by request family (email-safe solid colors). */
function typeTheme(title) {
  const t = String(title || "").toLowerCase();
  if (t.includes("outbound") || t.includes("shipment")) {
    return { accent: "#1d4ed8", soft: "#eff6ff", label: "Outbound" };
  }
  if (t.includes("inbound") || t.includes("inventory")) {
    return { accent: "#047857", soft: "#ecfdf5", label: "Inbound" };
  }
  if (t.includes("return")) {
    return { accent: "#b45309", soft: "#fffbeb", label: "Return" };
  }
  if (t.includes("dispose")) {
    return { accent: "#b91c1c", soft: "#fef2f2", label: "Dispose" };
  }
  if (t.includes("delete")) {
    return { accent: "#9f1239", soft: "#fff1f2", label: "Delete" };
  }
  if (t.includes("quarantine")) {
    return { accent: "#a16207", soft: "#fefce8", label: "Quarantine" };
  }
  if (t.includes("refund") || t.includes("wallet") || t.includes("api fee") || t.includes("label")) {
    return { accent: "#6d28d9", soft: "#f5f3ff", label: "Labels" };
  }
  return { accent: "#0f172a", soft: "#f8fafc", label: "Request" };
}

function buildDetailRows(clientLabel, userId, requestId, data) {
  const rows = [
    ["Type", str(data.__title)],
    ["Client", clientLabel],
    userId ? ["Client UID", userId] : null,
    ["Request ID", requestId],
    str(data.service) ? ["Service", str(data.service)] : null,
    str(data.productName) ? ["Product", str(data.productName)] : null,
    str(data.sku) ? ["SKU", str(data.sku)] : null,
    data.lineCount != null || data.itemCount != null || data.totalLines != null
      ? ["Lines", String(data.lineCount ?? data.itemCount ?? data.totalLines)]
      : null,
    str(data.trackingNumber) ? ["Tracking", str(data.trackingNumber)] : null,
    str(data.amount) || data.amount === 0 ? ["Amount", `$${Number(data.amount).toFixed(2)}`] : null,
    str(data.reason) ? ["Reason", str(data.reason)] : null,
    str(data.remarks) ? ["Remarks", str(data.remarks)] : null,
    str(data.requestKind) ? ["Kind", str(data.requestKind)] : null,
    str(data.type) ? ["Subtype", str(data.type)] : null,
    str(data.status) ? ["Status", str(data.status)] : null,
  ].filter(Boolean);

  return rows;
}

function buildAdminRequestEmailContent(input) {
  const { title, clientLabel, userId, requestId, data } = input;
  const theme = typeTheme(title);
  const notificationsUrl = `${appBaseUrl()}/admin/dashboard/notifications`;
  const detailData = { ...data, __title: title };
  const rows = buildDetailRows(clientLabel, userId, requestId, detailData);

  const textLines = [
    `New ${title} submitted in PrepCorex.`,
    "",
    ...rows.map(([k, v]) => `${k}: ${v}`),
    "",
    "Open Admin Notifications:",
    notificationsUrl,
    "",
    "— PrepCorex",
  ];

  const detailHtml = rows
    .map(
      ([label, value], index) => `
      <tr>
        <td style="padding:10px 0;border-top:${index === 0 ? "0" : "1px solid #e5e7eb"};width:34%;font-size:12px;font-weight:600;color:#64748b;vertical-align:top;">${escapeHtml(label)}</td>
        <td style="padding:10px 0;border-top:${index === 0 ? "0" : "1px solid #e5e7eb"};font-size:14px;color:#0f172a;vertical-align:top;word-break:break-word;">${escapeHtml(value)}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e2e8f0;">
          <tr>
            <td style="background:#0f172a;padding:22px 28px;">
              <p style="margin:0;font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">PrepCorex Admin Alert</p>
              <h1 style="margin:8px 0 0;font-size:22px;line-height:1.35;color:#ffffff;font-weight:700;">New request received</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 8px;background:${theme.soft};">
              <span style="display:inline-block;background:${theme.accent};color:#ffffff;font-size:12px;font-weight:700;letter-spacing:0.04em;text-transform:uppercase;padding:6px 10px;border-radius:999px;">${escapeHtml(theme.label)}</span>
              <p style="margin:12px 0 0;font-size:16px;line-height:1.5;color:#0f172a;">
                <strong>${escapeHtml(title)}</strong> from <strong>${escapeHtml(clientLabel)}</strong>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 24px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:8px;">
                ${detailHtml}
              </table>
              <p style="margin:24px 0 0;">
                <a href="${escapeHtml(notificationsUrl)}" style="display:inline-block;background:${theme.accent};color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;font-size:14px;">Open Admin Notifications</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px 24px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#64748b;">
              Prep Services FBA · PrepCorex<br />
              Automated notice — one email per new request. Do not reply unless you need support.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: `[PrepCorex] New ${title}: ${clientLabel}`,
    text: textLines.join("\n"),
    html,
  };
}

async function resolveClientLabel(db, userId, data) {
  const fromDoc =
    str(data.userName) ||
    str(data.clientName) ||
    str(data.clientEmail) ||
    str(data.email);
  if (fromDoc) return fromDoc;
  if (!userId) return "Unknown client";
  try {
    const snap = await db.collection("users").doc(userId).get();
    if (!snap.exists) return userId;
    const u = snap.data() || {};
    return str(u.name) || str(u.displayName) || str(u.email) || userId;
  } catch (_) {
    return userId;
  }
}

function shouldSkipChildMirror(data) {
  return Boolean(str(data.batchId));
}

function isActionablePending(data) {
  const status = str(data.status || "pending").toLowerCase();
  return status === "pending" || status === "partial";
}

async function sendAdminRequestNotifyEmail(input) {
  const {
    nodemailer,
    createSmtpTransporter,
    admin,
    db,
    userId,
    requestId,
    requestType,
    title,
    data,
  } = input;

  if (!isActionablePending(data)) return { sent: false, reason: "not_pending" };
  if (data.adminNotifyEmailSentAt) return { sent: false, reason: "already_sent" };

  const smtp = createSmtpTransporter(nodemailer);
  if (!smtp) {
    console.warn(`[admin-request-notify] SMTP not configured, skip ${requestType} ${requestId}`);
    return { sent: false, reason: "no_smtp" };
  }

  const clientLabel = await resolveClientLabel(db, userId, data);
  const to = notifyTo();
  const content = buildAdminRequestEmailContent({
    title,
    clientLabel,
    userId,
    requestId,
    data,
  });

  await smtp.transporter.sendMail({
    from: `"${smtp.config.fromName}" <${smtp.config.from}>`,
    to,
    subject: content.subject,
    text: content.text,
    html: content.html,
  });

  try {
    const ref = input.docRef;
    if (ref && admin) {
      await ref.update({
        adminNotifyEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  } catch (err) {
    console.warn(
      `[admin-request-notify] marked sent failed (email already delivered): ${requestType} ${requestId}`,
      err?.message || err
    );
  }

  return { sent: true };
}

function makeOnCreateHandler(functions, deps, config) {
  const { nodemailer, createSmtpTransporter, admin } = deps;
  const { title, skipBatchChildren = false, userIdFromData = false } = config;

  return async (snap, context) => {
    const data = snap.data() || {};
    if (skipBatchChildren && shouldSkipChildMirror(data)) {
      return null;
    }

    const requestId = context.params.requestId || context.params.batchId || snap.id;
    const userId = userIdFromData
      ? str(data.userId) || str(context.params.userId)
      : str(context.params.userId);

    try {
      const result = await sendAdminRequestNotifyEmail({
        nodemailer,
        createSmtpTransporter,
        admin,
        db: admin.firestore(),
        docRef: snap.ref,
        userId,
        requestId,
        requestType: title,
        title,
        data,
      });
      if (result.sent) {
        console.log(`[admin-request-notify] sent ${title}:`, userId, requestId);
      }
    } catch (err) {
      console.error(`[admin-request-notify] failed ${title}:`, userId, requestId, err);
    }
    return null;
  };
}

/**
 * Register all Admin Notifications create → email triggers on exports.
 */
function registerAdminRequestNotifyTriggers(exportsObj, functions, deps) {
  const handler = (cfg) => makeOnCreateHandler(functions, deps, cfg);

  exportsObj.onAdminNotifyShipmentRequestCreated = functions.firestore
    .document("users/{userId}/shipmentRequests/{requestId}")
    .onCreate(handler({ title: "Outbound shipment request" }));

  exportsObj.onAdminNotifyInventoryRequestCreated = functions.firestore
    .document("users/{userId}/inventoryRequests/{requestId}")
    .onCreate(handler({ title: "Inbound inventory request", skipBatchChildren: true }));

  exportsObj.onAdminNotifyInboundBatchCreated = functions.firestore
    .document("users/{userId}/inboundBatches/{batchId}")
    .onCreate(handler({ title: "Inbound inventory batch" }));

  exportsObj.onAdminNotifyProductReturnCreated = functions.firestore
    .document("users/{userId}/productReturns/{requestId}")
    .onCreate(handler({ title: "Product return request" }));

  exportsObj.onAdminNotifyDisposeRequestCreated = functions.firestore
    .document("users/{userId}/disposeRequests/{requestId}")
    .onCreate(handler({ title: "Dispose request", skipBatchChildren: true }));

  exportsObj.onAdminNotifyDisposeBatchCreated = functions.firestore
    .document("users/{userId}/disposeBatches/{batchId}")
    .onCreate(handler({ title: "Dispose batch" }));

  exportsObj.onAdminNotifyDeleteRequestCreated = functions.firestore
    .document("users/{userId}/deleteRequests/{requestId}")
    .onCreate(handler({ title: "Delete product request" }));

  exportsObj.onAdminNotifyQuarantineRequestCreated = functions.firestore
    .document("quarantineRequests/{requestId}")
    .onCreate(handler({ title: "Quarantine request", userIdFromData: true }));

  exportsObj.onAdminNotifyLabelRefundCreated = functions.firestore
    .document("users/{userId}/labelRefundRequests/{requestId}")
    .onCreate(handler({ title: "Label refund request" }));

  exportsObj.onAdminNotifyLabelWalletTopupCreated = functions.firestore
    .document("users/{userId}/labelWalletTopupRequests/{requestId}")
    .onCreate(handler({ title: "Label wallet top-up request" }));

  exportsObj.onAdminNotifyLabelApiFeeCreated = functions.firestore
    .document("users/{userId}/labelApiFeePaymentRequests/{requestId}")
    .onCreate(handler({ title: "Label API fee payment request" }));
}

module.exports = {
  registerAdminRequestNotifyTriggers,
  sendAdminRequestNotifyEmail,
  buildAdminRequestEmailContent,
};
