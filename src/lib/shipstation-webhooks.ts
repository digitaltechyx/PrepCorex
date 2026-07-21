import { randomBytes } from "crypto";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  shipstationListWebhooks,
  shipstationSubscribeWebhook,
  shipstationUnsubscribeWebhook,
  type ShipStationCredentials,
} from "@/lib/shipstation-api";

const WEBHOOK_EVENTS = ["ORDER_NOTIFY", "SHIP_NOTIFY"] as const;

export function getShipStationAppBaseUrl(): string | null {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const base = raw.replace(/\/$/, "");
  if (!base || base.includes("localhost") || base.includes("127.0.0.1")) {
    return null;
  }
  return base;
}

function webhookTargetUrl(base: string, token: string): string {
  return `${base}/api/integrations/shipstation/webhook?token=${encodeURIComponent(token)}`;
}

/**
 * Register ORDER_NOTIFY + SHIP_NOTIFY webhooks for near real-time sync.
 * Stores webhook ids + token on the connection doc.
 */
export async function ensureShipStationWebhooks(opts: {
  userId: string;
  connectionId: string;
  creds: ShipStationCredentials;
  accountLabel?: string;
}): Promise<{ ok: boolean; webhookIds: number[]; skippedReason?: string }> {
  const base = getShipStationAppBaseUrl();
  if (!base) {
    return {
      ok: false,
      webhookIds: [],
      skippedReason: "Public NEXT_PUBLIC_APP_URL required for ShipStation webhooks",
    };
  }

  const connRef = adminDb()
    .collection("users")
    .doc(opts.userId)
    .collection("shipstationConnections")
    .doc(opts.connectionId);

  const connSnap = await connRef.get();
  const existing = connSnap.data() || {};
  let token = String(existing.webhookToken || "").trim();
  if (!token) {
    token = randomBytes(24).toString("hex");
  }

  const targetUrl = webhookTargetUrl(base, token);
  const label = opts.accountLabel || existing.accountLabel || "ShipStation";
  const webhookIds: number[] = [];

  // Remove old PrepCorex webhooks pointing at stale tokens for this account
  try {
    const listed = await shipstationListWebhooks(opts.creds);
    for (const hook of listed) {
      const url = String(hook.Url || "");
      const id = Number(hook.WebHookID);
      if (!id || !url.includes("/api/integrations/shipstation/webhook")) continue;
      if (url.includes(`token=${token}`)) continue;
      try {
        await shipstationUnsubscribeWebhook(opts.creds, id);
      } catch {
        /* ignore unsubscribe failures */
      }
    }
  } catch {
    /* list may fail on some plans; continue to subscribe */
  }

  for (const event of WEBHOOK_EVENTS) {
    try {
      const sub = await shipstationSubscribeWebhook(opts.creds, {
        targetUrl,
        event,
        friendlyName: `PrepCorex ${label} ${event}`,
      });
      const id = Number(sub.WebHookID);
      if (Number.isFinite(id) && id > 0) webhookIds.push(id);
    } catch (e) {
      console.warn("[shipstation webhooks] subscribe failed", event, e);
    }
  }

  await connRef.set(
    {
      webhookToken: token,
      webhookIds,
      webhookTargetUrl: targetUrl,
      webhooksUpdatedAt: adminFieldValue().serverTimestamp(),
    },
    { merge: true }
  );

  await adminDb()
    .collection("shipstationWebhookTokens")
    .doc(token)
    .set(
      {
        userId: opts.userId,
        connectionId: opts.connectionId,
        updatedAt: adminFieldValue().serverTimestamp(),
      },
      { merge: true }
    );

  return { ok: webhookIds.length > 0, webhookIds };
}

export async function removeShipStationWebhooks(opts: {
  userId: string;
  connectionId: string;
  creds?: ShipStationCredentials | null;
  webhookToken?: string | null;
  webhookIds?: number[] | null;
}): Promise<void> {
  const creds = opts.creds;
  const ids = Array.isArray(opts.webhookIds) ? opts.webhookIds : [];
  if (creds && ids.length > 0) {
    for (const id of ids) {
      try {
        await shipstationUnsubscribeWebhook(creds, Number(id));
      } catch {
        /* ignore */
      }
    }
  }

  const token = String(opts.webhookToken || "").trim();
  if (token) {
    try {
      await adminDb().collection("shipstationWebhookTokens").doc(token).delete();
    } catch {
      /* ignore */
    }
  }
}
