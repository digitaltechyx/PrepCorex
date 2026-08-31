import { NextRequest, NextResponse } from "next/server";
import type { QueryDocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { amazonOrderFromFirestore, type AmazonNormalizedOrder } from "@/lib/amazon-order-normalize";
import { syncAmazonOrdersForUser } from "@/lib/amazon-order-sync";
import { authorizeAmazonUserRoute } from "@/lib/amazon-route-auth";

export const dynamic = "force-dynamic";

/**
 * GET /api/amazon/orders?userId=&connectionId=&source=live|cache
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId")?.trim() || "";
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  const source = searchParams.get("source")?.trim() || "live";

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const auth = await authorizeAmazonUserRoute(request, userId);
  if (auth instanceof NextResponse) return auth;

  try {
    if (source === "cache") {
      const snapshot = await adminDb()
        .collection("users")
        .doc(userId)
        .collection("amazonOrders")
        .orderBy("created_at", "desc")
        .limit(200)
        .get();
      let orders = snapshot.docs.map((d: QueryDocumentSnapshot) =>
        amazonOrderFromFirestore(d.id, d.data() as Record<string, unknown>)
      );
      if (connectionId) {
        orders = orders.filter((o: AmazonNormalizedOrder) => o.connectionId === connectionId);
      }
      return NextResponse.json({ orders, source: "cache" });
    }

    const result = await syncAmazonOrdersForUser(adminDb(), userId, {
      connectionId,
      persist: true,
    });
    let orders = result.orders;
    if (connectionId) {
      orders = orders.filter((o) => o.connectionId === connectionId);
    }
    return NextResponse.json({
      orders,
      connections: result.connections,
      source: "live",
    });
  } catch (err: unknown) {
    console.error("[amazon/orders GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userId =
    String(body.userId || new URL(request.url).searchParams.get("userId") || "").trim();
  const connectionId =
    String(body.connectionId || new URL(request.url).searchParams.get("connectionId") || "").trim() ||
    undefined;

  if (!userId) {
    return NextResponse.json({ error: "Missing userId" }, { status: 400 });
  }

  const auth = await authorizeAmazonUserRoute(request, userId);
  if (auth instanceof NextResponse) return auth;

  try {
    const result = await syncAmazonOrdersForUser(adminDb(), userId, {
      connectionId,
      persist: true,
    });
    return NextResponse.json({
      ok: true,
      synced: result.orders.length,
      orders: result.orders,
      connections: result.connections,
    });
  } catch (err: unknown) {
    console.error("[amazon/orders POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
