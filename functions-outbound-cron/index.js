const functions = require("firebase-functions/v1");

/**
 * outboundTrackingRefreshCron was removed (2026-11-02).
 * Tracking refresh is page-load only (POST /api/outbound-tracking/refresh-stale).
 * Daily digest lives in the inbound-cron codebase:
 *   functions-inbound-cron → outboundTrackingDigestCron
 * Do not re-add a 1-minute refresh schedule here.
 */

function readConfig() {
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
    process.env.APP_URL || configAppUrl || "https://dev.prepservicesfba.com";
  const secret =
    process.env.CRON_SECRET ||
    process.env.OUTBOUND_TRACKING_CRON_SECRET ||
    configCronSecret;
  return { baseUrl, secret };
}

async function postCron(path, secret) {
  const { baseUrl } = readConfig();
  const url = `${String(baseUrl).replace(/\/$/, "")}${path}?secret=${encodeURIComponent(secret)}`;
  const res = await fetch(url, { method: "POST" });
  const body = await res.text();
  if (!res.ok) {
    console.error(`[outboundTracker] ${path} failed`, res.status, body);
  } else {
    console.log(`[outboundTracker] ${path} ok`, body);
  }
}

/** Daily combined digest at 7:00 AM America/New_York (EDT/EST). */
exports.outboundTrackingDigestCron = functions.pubsub
  .schedule("0 7 * * *")
  .timeZone("America/New_York")
  .onRun(async () => {
    const { secret } = readConfig();
    if (!secret) {
      console.warn("[outboundTrackingDigestCron] Missing CRON_SECRET.");
      return null;
    }
    try {
      await postCron("/api/outbound-tracking/digest", secret);
    } catch (err) {
      console.error("[outboundTrackingDigestCron] error", err);
    }
    return null;
  });
