const functions = require("firebase-functions/v1");

function readCronConfig() {
  let configAppUrl = "";
  let configCronSecret = "";
  try {
    const cfg = functions.config();
    configAppUrl = (cfg.app && cfg.app.url) || "";
    configCronSecret = (cfg.cron && cfg.cron.secret) || "";
  } catch (_) {
    /* no runtime config */
  }
  const baseUrl =
    process.env.APP_URL || configAppUrl || "https://prepcorex.com";
  const secret =
    process.env.CRON_SECRET ||
    process.env.INBOUND_TRACKING_CRON_SECRET ||
    process.env.INBOUND_TRACKER_CRON_SECRET ||
    process.env.OUTBOUND_TRACKING_CRON_SECRET ||
    configCronSecret;
  return { baseUrl, secret };
}

async function postCronPath(path, logPrefix) {
  const { baseUrl, secret } = readCronConfig();
  if (!secret) {
    console.warn(`[${logPrefix}] Missing secret. Set cron.secret or CRON_SECRET.`);
    return null;
  }
  const url = `${String(baseUrl).replace(/\/$/, "")}${path}?secret=${encodeURIComponent(secret)}`;
  try {
    const res = await fetch(url, { method: "POST" });
    const body = await res.text();
    if (!res.ok) {
      console.error(`[${logPrefix}] failed`, res.status, body);
    } else {
      console.log(`[${logPrefix}] ok`, body);
    }
  } catch (err) {
    console.error(`[${logPrefix}] error`, err);
  }
  return null;
}

/**
 * Tracking refresh crons were removed (2026-11-02).
 * inboundTrackingRefreshCron / outboundTrackingRefreshCron / inboundTrackerRefreshCron
 * ran every 1 minute in testing and drove massive Firestore read + egress cost.
 * Carrier status now refreshes only on page load via:
 *   POST /api/inbound-tracking/refresh-stale
 *   POST /api/outbound-tracking/refresh-stale
 *   POST /api/inbound-tracker/refresh-stale
 * Do not re-add scheduled refresh scanners.
 */

/** Daily outbound digest at 7:00 AM America/New_York (EDT/EST). */
exports.outboundTrackingDigestCron = functions.pubsub
  .schedule("0 7 * * *")
  .timeZone("America/New_York")
  .onRun(async () => postCronPath("/api/outbound-tracking/digest", "outboundTrackingDigestCron"));
