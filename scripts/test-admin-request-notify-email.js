/**
 * Local smoke test for admin request notify emails (professional HTML).
 *
 * Usage (from repo root):
 *   node scripts/test-admin-request-notify-email.js
 *   node scripts/test-admin-request-notify-email.js --all
 *
 * Default: inbound batch + outbound + return.
 * --all: one sample for every notification type.
 */

const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

const root = path.join(__dirname, "..");
loadEnvFile(path.join(root, ".env"));
loadEnvFile(path.join(root, ".env.local"));
loadEnvFile(path.join(root, "functions", ".env"));

const nodemailer = require(path.join(root, "functions", "node_modules", "nodemailer"));
const { createSmtpTransporter } = require(path.join(
  root,
  "functions",
  "client-invoice-automation"
));
const { sendAdminRequestNotifyEmail } = require(path.join(
  root,
  "functions",
  "admin-request-notify-email"
));

const SAMPLES = [
  {
    title: "Inbound inventory batch",
    data: {
      status: "pending",
      userName: "Local Test Client",
      lineCount: 4,
      remarks: "LOCAL TEST — inbound batch (multi-line)",
    },
  },
  {
    title: "Outbound shipment request",
    data: {
      status: "pending",
      userName: "Local Test Client",
      service: "FBA/WFS/TFS",
      productName: "Chia Seeds 12oz",
      sku: "ch-sed-12",
      remarks: "LOCAL TEST — outbound single request",
    },
  },
  {
    title: "Product return request",
    data: {
      status: "pending",
      userName: "Local Test Client",
      productName: "Moringa Powder 32oz",
      sku: "mor-pwd-32",
      reason: "Damaged on arrival",
      remarks: "LOCAL TEST — product return",
    },
  },
  {
    title: "Dispose batch",
    data: {
      status: "pending",
      userName: "Local Test Client",
      lineCount: 3,
      remarks: "LOCAL TEST — dispose batch",
    },
  },
  {
    title: "Delete product request",
    data: {
      status: "pending",
      userName: "Local Test Client",
      productName: "Organic Beetroot Powder 60oz",
      sku: "org-btr-60",
      reason: "Duplicate SKU",
      remarks: "LOCAL TEST — delete request",
    },
  },
  {
    title: "Quarantine request",
    data: {
      status: "pending",
      userName: "Local Test Client",
      productName: "Beet Root Powder 50oz",
      sku: "ORG-BTRP-0672",
      requestKind: "hold",
      reason: "Quality check",
      remarks: "LOCAL TEST — quarantine",
    },
  },
  {
    title: "Label wallet top-up request",
    data: {
      status: "pending",
      userName: "Local Test Client",
      amount: 100,
      remarks: "LOCAL TEST — wallet top-up",
    },
  },
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendOne(sample, index) {
  const requestId = `local-test-${Date.now()}-${index}`;
  const result = await sendAdminRequestNotifyEmail({
    nodemailer,
    createSmtpTransporter,
    admin: null,
    db: {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false }),
        }),
      }),
    },
    docRef: null,
    userId: "local-test-user",
    requestId,
    requestType: sample.title,
    title: sample.title,
    data: sample.data,
  });
  console.log(`- ${sample.title}:`, result);
  return result;
}

async function main() {
  const sendAll = process.argv.includes("--all");
  const samples = sendAll ? SAMPLES : SAMPLES.slice(0, 3);
  const to = process.env.ADMIN_REQUEST_NOTIFY_EMAIL || "info@prepservicesfba.com";

  console.log("Sending professional HTML admin-request samples…");
  console.log("To:", to);
  console.log("SMTP host:", process.env.SMTP_HOST || "(missing)");
  console.log("Count:", samples.length, sendAll ? "(all types)" : "(batch + outbound + return)");
  console.log("");

  let failed = 0;
  for (let i = 0; i < samples.length; i++) {
    const result = await sendOne(samples[i], i + 1);
    if (!result.sent) failed += 1;
    if (i < samples.length - 1) await sleep(1200);
  }

  console.log("");
  if (failed) {
    console.error(`Done with ${failed} failure(s).`);
    process.exitCode = 1;
  } else {
    console.log("All sample emails sent. Check inbox/spam for PrepCorex Admin Alert.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
