import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  EtsyReconnectRequired,
  getValidEtsyAccessToken,
} from "@/lib/etsy-access-token";
import { etsyApiRequest, type EtsyReceipt } from "@/lib/etsy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EtsyWebhookEvent = {
  event_type?: string;
  resource_url?: string;
  shop_id?: number | string;
};

function verifyEtsyWebhookSignature(input: {
  rawBody: string;
  webhookId: string | null;
  webhookTimestamp: string | null;
  webhookSignature: string | null;
  secret: string;
}): boolean {
  const { rawBody, webhookId, webhookTimestamp, webhookSignature, secret } = input;
  if (!webhookId || !webhookTimestamp || !webhookSignature || !secret) return false;

  const ts = Number(webhookTimestamp);
  if (!Number.isFinite(ts)) return false;
  // Reject stale deliveries (>5 min)
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 300) return false;

  const signedContent = `${webhookId}.${webhookTimestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedContent).digest("base64");

  // Etsy may send "v1,<sig>" or space/comma-separated variants
  const candidates = webhookSignature
    .split(/[\s,]+/)
    .map((p) => p.replace(/^v1[=,]?/i, "").trim())
    .filter(Boolean);

  const expectedBuf = Buffer.from(expected);
  for (const cand of candidates) {
    try {
      const candBuf = Buffer.from(cand);
      if (candBuf.length === expectedBuf.length && timingSafeEqual(candBuf, expectedBuf)) {
        return true;
      }
    } catch {
      // continue
    }
  }
  return false;
}

/** GET: health check for Etsy Webhook portal URL validation. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message:
      "Etsy webhook endpoint. Register https://prepcorex.com/api/etsy/webhooks in the Etsy Webhook portal (order.paid, order.canceled, order.shipped, order.delivered).",
  });
}

/**
 * POST: Receive Etsy Open API webhooks.
 * Portal events: order.paid | order.canceled | order.shipped | order.delivered
 * Payload: { event_type, resource_url, shop_id }
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  let event: EtsyWebhookEvent;
  try {
    event = JSON.parse(rawBody) as EtsyWebhookEvent;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const secret =
    process.env.ETSY_WEBHOOK_SECRET?.trim() ||
    process.env.ETSY_WEBHOOK_SIGNING_SECRET?.trim() ||
    "";
  if (secret) {
    const ok = verifyEtsyWebhookSignature({
      rawBody,
      webhookId: request.headers.get("webhook-id"),
      webhookTimestamp: request.headers.get("webhook-timestamp"),
      webhookSignature: request.headers.get("webhook-signature"),
      secret,
    });
    if (!ok) {
      console.warn("[etsy/webhooks] signature verification failed");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const eventType = String(event.event_type || "").toLowerCase().replace(/_/g, ".");
  const shopId = String(event.shop_id ?? "").trim();
  const resourceUrl = String(event.resource_url || "").trim();

  console.log("[etsy/webhooks] received", { eventType, shopId, resourceUrl: !!resourceUrl });

  if (!shopId) {
    return NextResponse.json({ ok: true, skipped: "missing shop_id" });
  }

  try {
    const db = adminDb();
    const mapSnap = await db.collection("etsyShopToUser").doc(shopId).get();
    if (!mapSnap.exists) {
      console.warn("[etsy/webhooks] no etsyShopToUser for shop", shopId);
      return NextResponse.json({ ok: true, skipped: "unknown shop" });
    }
    const userId = String(mapSnap.data()?.userId || "").trim();
    const connectionId = String(mapSnap.data()?.connectionId || "").trim();
    if (!userId) {
      return NextResponse.json({ ok: true, skipped: "no userId" });
    }

    // Persist a lightweight event log for ops / debugging
    await db
      .collection("users")
      .doc(userId)
      .collection("etsyWebhookEvents")
      .add({
        eventType,
        shopId,
        resourceUrl: resourceUrl || null,
        connectionId: connectionId || null,
        receivedAt: adminFieldValue().serverTimestamp(),
      });

    // For paid orders, refresh the receipt into a small cache when we have a connection
    if (
      (eventType === "order.paid" || eventType === "order.shipped") &&
      resourceUrl &&
      connectionId
    ) {
      const connRef = db
        .collection("users")
        .doc(userId)
        .collection("etsyConnections")
        .doc(connectionId);
      const connSnap = await connRef.get();
      if (connSnap.exists) {
        try {
          const accessToken = await getValidEtsyAccessToken(connRef, connSnap.data()!);
          const path = resourceUrl.includes("/application/")
            ? resourceUrl.split("/application")[1] || resourceUrl
            : resourceUrl;
          const receipt = await etsyApiRequest<EtsyReceipt>({
            path: path.startsWith("http") ? path : path.startsWith("/") ? path : `/${path}`,
            accessToken,
            query: { includes: "Transactions" },
          });
          const receiptId = String(receipt.receipt_id ?? "");
          if (receiptId) {
            await db
              .collection("users")
              .doc(userId)
              .collection("etsyOrders")
              .doc(receiptId)
              .set(
                {
                  receiptId,
                  shopId,
                  connectionId,
                  status: receipt.status ?? null,
                  isPaid: Boolean(receipt.is_paid),
                  isShipped: Boolean(receipt.is_shipped),
                  buyerName: receipt.name ?? null,
                  updatedAt: adminFieldValue().serverTimestamp(),
                  lastWebhookEvent: eventType,
                },
                { merge: true }
              );
          }
        } catch (e) {
          if (!(e instanceof EtsyReconnectRequired)) {
            console.warn("[etsy/webhooks] receipt fetch failed", e);
          }
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[etsy/webhooks]", err);
    // Still 200 so Etsy does not endlessly retry on our internal errors after accept
    return NextResponse.json({ ok: true, warning: "processed with errors" });
  }
}
