import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * eBay Marketplace Account Deletion/Closure notifications.
 * Required for Production keyset / OAuth unlock.
 *
 * Portal fields:
 * - Endpoint: https://prepcorex.com/api/integrations/ebay/marketplace-deletion
 * - Verification token: EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN
 *   (falls back to EBAY_WEBHOOK_VERIFICATION_TOKEN)
 *
 * Optional exact URL override for challenge hash (must match portal exactly):
 * EBAY_MARKETPLACE_DELETION_ENDPOINT
 */

function getVerificationToken(): string | undefined {
  return (
    process.env.EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN?.trim() ||
    process.env.EBAY_WEBHOOK_VERIFICATION_TOKEN?.trim() ||
    undefined
  );
}

function getConfiguredEndpoint(request: NextRequest): string {
  const configured = process.env.EBAY_MARKETPLACE_DELETION_ENDPOINT?.trim();
  if (configured) return configured.replace(/\/$/, "");

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
  if (appUrl) {
    return `${appUrl}/api/integrations/ebay/marketplace-deletion`;
  }

  return `${request.nextUrl.origin}${request.nextUrl.pathname}`.replace(/\/$/, "");
}

function getChallengeResponse(challengeCode: string, verificationToken: string, endpoint: string): string {
  return crypto
    .createHash("sha256")
    .update(`${challengeCode}${verificationToken}${endpoint}`)
    .digest("hex");
}

function extractDeletionData(payload: Record<string, unknown>): {
  username?: string;
  userId?: string;
  eiasToken?: string;
  notificationId?: string;
} {
  const notification =
    payload.notification && typeof payload.notification === "object"
      ? (payload.notification as Record<string, unknown>)
      : undefined;
  const data =
    notification?.data && typeof notification.data === "object"
      ? (notification.data as Record<string, unknown>)
      : payload.data && typeof payload.data === "object"
        ? (payload.data as Record<string, unknown>)
        : undefined;

  return {
    username: typeof data?.username === "string" ? data.username : undefined,
    userId: typeof data?.userId === "string" ? data.userId : undefined,
    eiasToken: typeof data?.eiasToken === "string" ? data.eiasToken : undefined,
    notificationId:
      (typeof notification?.notificationId === "string" && notification.notificationId) ||
      (typeof payload.notificationId === "string" && payload.notificationId) ||
      undefined,
  };
}

/** GET: eBay challenge verification (and health check). */
export async function GET(request: NextRequest) {
  const challengeCode = request.nextUrl.searchParams.get("challenge_code");
  if (!challengeCode) {
    return NextResponse.json({
      ok: true,
      message: "eBay marketplace account deletion endpoint is live",
    });
  }

  const verificationToken = getVerificationToken();
  if (!verificationToken) {
    return NextResponse.json(
      {
        error:
          "Missing EBAY_MARKETPLACE_DELETION_VERIFICATION_TOKEN (or EBAY_WEBHOOK_VERIFICATION_TOKEN)",
      },
      { status: 500 }
    );
  }

  const endpoint = getConfiguredEndpoint(request);
  const challengeResponse = getChallengeResponse(challengeCode, verificationToken, endpoint);
  return NextResponse.json({ challengeResponse });
}

/**
 * POST: account deletion/closure notice from eBay.
 * Acknowledge immediately (2xx). Persist audit record and best-effort cleanup.
 */
export async function POST(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const deletion = extractDeletionData(payload);
  const eventId =
    deletion.notificationId ||
    request.headers.get("x-ebay-delivery-id") ||
    `deletion_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;

  const db = adminDb();
  const eventRef = db.collection("ebayMarketplaceDeletionEvents").doc(eventId);
  const existing = await eventRef.get();
  if (existing.exists) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  await eventRef.set({
    createdAt: new Date().toISOString(),
    username: deletion.username ?? null,
    userId: deletion.userId ?? null,
    eiasToken: deletion.eiasToken ?? null,
    headers: {
      topic: request.headers.get("x-ebay-topic"),
      deliveryId: request.headers.get("x-ebay-delivery-id"),
      signature: request.headers.get("x-ebay-signature") ? "present" : null,
    },
    payload,
    processed: false,
  });

  // Best-effort: remove stored eBay connections that record matching marketplace user id.
  let connectionsRemoved = 0;
  try {
    if (deletion.userId) {
      const snap = await db
        .collectionGroup("ebayConnections")
        .where("sellingPartnerId", "==", deletion.userId)
        .limit(25)
        .get()
        .catch(() => null);

      // sellingPartnerId may not exist on eBay docs; also try ebayUserId if present.
      const byUserId =
        snap && !snap.empty
          ? snap
          : await db
              .collectionGroup("ebayConnections")
              .where("ebayUserId", "==", deletion.userId)
              .limit(25)
              .get()
              .catch(() => null);

      if (byUserId && !byUserId.empty) {
        const batch = db.batch();
        for (const doc of byUserId.docs) {
          batch.delete(doc.ref);
          connectionsRemoved++;
        }
        await batch.commit();
      }
    }
  } catch (err) {
    console.warn("[ebay marketplace-deletion] cleanup failed", err);
  }

  await eventRef.set(
    {
      processed: true,
      processedAt: new Date().toISOString(),
      connectionsRemoved,
    },
    { merge: true }
  );

  return NextResponse.json({ ok: true, eventId, connectionsRemoved });
}
