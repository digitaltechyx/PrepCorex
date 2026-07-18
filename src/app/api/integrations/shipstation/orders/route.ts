import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { syncShipStationOrdersForConnection } from "@/lib/shipstation-sync";

export const dynamic = "force-dynamic";

async function requireUid(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  const decoded = await adminAuth().verifyIdToken(token);
  if (!decoded.uid) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return decoded.uid;
}

/** GET: list synced ShipStation orders from Firestore. */
export async function GET(request: NextRequest) {
  try {
    const uid = await requireUid(request);
    const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
    const labeledOnly = request.nextUrl.searchParams.get("labeledOnly") === "1";

    const snapshot = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("shipstationOrders")
      .limit(300)
      .get();

    let orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (connectionId) {
      orders = orders.filter((o) => (o as { connectionId?: string }).connectionId === connectionId);
    }
    if (labeledOnly) {
      orders = orders.filter((o) => Boolean((o as { hasPurchasedLabel?: boolean }).hasPurchasedLabel));
    }

    orders.sort((a, b) => {
      const aDate = String((a as { modifyDate?: string; syncedAt?: string }).modifyDate || (a as { syncedAt?: string }).syncedAt || "");
      const bDate = String((b as { modifyDate?: string; syncedAt?: string }).modifyDate || (b as { syncedAt?: string }).syncedAt || "");
      return bDate.localeCompare(aDate);
    });

    return NextResponse.json({ orders: orders.slice(0, 200) });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load orders" },
      { status: status === 401 ? 401 : 500 }
    );
  }
}

/** POST: sync orders (+ purchased labels/shipments) from ShipStation. */
export async function POST(request: NextRequest) {
  try {
    const uid = await requireUid(request);
    const body = await request.json().catch(() => ({}));
    const connectionId =
      String(body.connectionId || request.nextUrl.searchParams.get("connectionId") || "").trim();

    const col = adminDb().collection("users").doc(uid).collection("shipstationConnections");
    let connDoc;
    if (connectionId) {
      connDoc = await col.doc(connectionId).get();
      if (!connDoc.exists) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }
    } else {
      const snap = await col.limit(1).get();
      if (snap.empty) {
        return NextResponse.json({ error: "No ShipStation connection" }, { status: 400 });
      }
      connDoc = snap.docs[0];
    }

    const data = connDoc.data() || {};
    const apiKey = String(data.apiKey || "").trim();
    const apiSecret = String(data.apiSecret || "").trim();
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: "ShipStation credentials missing" }, { status: 400 });
    }

    const result = await syncShipStationOrdersForConnection({
      userId: uid,
      connectionId: connDoc.id,
      creds: { apiKey, apiSecret },
    });

    return NextResponse.json({ ok: true, ...result, connectionId: connDoc.id });
  } catch (error: unknown) {
    console.error("[shipstation orders sync]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync ShipStation orders",
      },
      { status: 500 }
    );
  }
}
