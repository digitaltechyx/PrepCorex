import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { shipstationValidateCredentials } from "@/lib/shipstation-api";
import { syncShipStationOrdersForConnection } from "@/lib/shipstation-sync";
import { ensureShipStationWebhooks } from "@/lib/shipstation-webhooks";

export const dynamic = "force-dynamic";

async function requireUid(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const decoded = await adminAuth().verifyIdToken(token);
  if (!decoded.uid) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return decoded.uid;
}

/** POST: connect ShipStation with API Key + Secret, then sync orders + register webhooks. */
export async function POST(request: NextRequest) {
  try {
    const uid = await requireUid(request);
    const body = await request.json();
    const apiKey = String(body.apiKey || "").trim();
    const apiSecret = String(body.apiSecret || "").trim();
    const accountLabel = String(body.accountLabel || "").trim() || "ShipStation";

    if (!apiKey || !apiSecret) {
      return NextResponse.json(
        { error: "API Key and API Secret are required" },
        { status: 400 }
      );
    }

    await shipstationValidateCredentials({ apiKey, apiSecret });

    const col = adminDb().collection("users").doc(uid).collection("shipstationConnections");
    const existing = await col.where("apiKey", "==", apiKey).limit(1).get();

    let connectionId: string;
    if (!existing.empty) {
      connectionId = existing.docs[0].id;
      await col.doc(connectionId).set(
        {
          apiKey,
          apiSecret,
          accountLabel,
          updatedAt: adminFieldValue().serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const docRef = await col.add({
        apiKey,
        apiSecret,
        accountLabel,
        connectedAt: adminFieldValue().serverTimestamp(),
        updatedAt: adminFieldValue().serverTimestamp(),
      });
      connectionId = docRef.id;
    }

    const creds = { apiKey, apiSecret };
    const sync = await syncShipStationOrdersForConnection({
      userId: uid,
      connectionId,
      creds,
    });

    const webhooks = await ensureShipStationWebhooks({
      userId: uid,
      connectionId,
      creds,
      accountLabel,
    });

    return NextResponse.json({
      ok: true,
      connectionId,
      synced: sync.synced,
      withLabels: sync.withLabels,
      webhooksRegistered: webhooks.ok,
      webhookSkippedReason: webhooks.skippedReason || null,
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    console.error("[shipstation connect]", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to connect ShipStation",
      },
      { status: status === 401 ? 401 : 500 }
    );
  }
}
