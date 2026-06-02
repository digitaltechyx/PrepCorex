const functions = require("firebase-functions/v1");

/**
 * Refresh inbound Shippo tracking every 6 hours via Next.js API.
 * Config: firebase functions:config:set app.url="..." cron.secret="..."
 */
exports.inboundTrackingRefreshCron = functions.pubsub
  .schedule("every 6 hours")
  .onRun(async () => {
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
      process.env.APP_URL ||
      configAppUrl ||
      "https://dev.prepservicesfba.com";
    const secret =
      process.env.CRON_SECRET ||
      process.env.INBOUND_TRACKING_CRON_SECRET ||
      configCronSecret;
    if (!secret) {
      console.warn(
        "[inboundTrackingRefreshCron] Missing secret. Set cron.secret or CRON_SECRET."
      );
      return null;
    }
    const url = `${String(baseUrl).replace(/\/$/, "")}/api/inbound-tracking/cron?secret=${encodeURIComponent(secret)}`;
    try {
      const res = await fetch(url, { method: "POST" });
      const body = await res.text();
      if (!res.ok) {
        console.error("[inboundTrackingRefreshCron] failed", res.status, body);
      } else {
        console.log("[inboundTrackingRefreshCron] ok", body);
      }
    } catch (err) {
      console.error("[inboundTrackingRefreshCron] error", err);
    }
    return null;
  });
