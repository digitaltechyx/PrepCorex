import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { syncShipStationOrdersForConnection } from "@/lib/shipstation-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type WebhookBody = {
  resource_url?: string;
  resource_type?: string;
};

/**
 * ShipStation pushes ORDER_NOTIFY / SHIP_NOTIFY here.
 * Payload only includes resource_url — we identify the account via ?token=.
 * Then we run a full sync for that connection (orders + purchased labels).
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "ShipStation webhook endpoint. Expects POST with ?token=…",
  });
}

export async function POST(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token")?.trim() || "";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  let body: WebhookBody = {};
  try {
    body = (await request.json().catch(() => ({}))) as WebhookBody;
  } catch {
    body = {};
  }

  try {
    const lookup = await adminDb().collection("shipstationWebhookTokens").doc(token).get();
    if (!lookup.exists) {
      return NextResponse.json({ error: "Unknown webhook token" }, { status: 404 });
    }
    const { userId, connectionId } = lookup.data() as {
      userId?: string;
      connectionId?: string;
    };
    if (!userId || !connectionId) {
      return NextResponse.json({ error: "Invalid webhook mapping" }, { status: 400 });
    }

    const connSnap = await adminDb()
      .collection("users")
      .doc(userId)
      .collection("shipstationConnections")
      .doc(connectionId)
      .get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const data = connSnap.data() || {};
    const apiKey = String(data.apiKey || "").trim();
    const apiSecret = String(data.apiSecret || "").trim();
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: "Credentials missing" }, { status: 400 });
    }

    // Acknowledge quickly path: sync in this request (ShipStation retries on non-2xx).
    const result = await syncShipStationOrdersForConnection({
      userId,
      connectionId,
      creds: { apiKey, apiSecret },
      lookbackDays: 14,
    });

    return NextResponse.json({
      ok: true,
      resourceType: body.resource_type || null,
      synced: result.synced,
      withLabels: result.withLabels,
    });
  } catch (error: unknown) {
    console.error("[shipstation webhook]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook sync failed" },
      { status: 500 }
    );
  }
}
