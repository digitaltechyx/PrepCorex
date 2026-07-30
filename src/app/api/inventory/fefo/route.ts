import { NextRequest, NextResponse } from "next/server";

import {
  isAdminLikeToken,
  isAdminLikeUserDoc,
  verifyBearerToken,
} from "@/lib/api-admin-auth";
import {
  buildClientFefoStockRows,
  type RawClientInboundRequestDoc,
  type RawClientInventoryDoc,
} from "@/lib/client-fefo-stock";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const requestedUserId = request.nextUrl.searchParams.get("userId")?.trim();
    const userId = requestedUserId || decoded.uid;
    if (userId !== decoded.uid) {
      let allowed = isAdminLikeToken(decoded as Record<string, unknown>);
      if (!allowed) {
        const caller = await adminDb().collection("users").doc(decoded.uid).get();
        allowed = caller.exists && isAdminLikeUserDoc(caller.data());
      }
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const db = adminDb();
    const userRef = db.collection("users").doc(userId);
    const [inventorySnapshot, requestSnapshot] = await Promise.all([
      userRef.collection("inventory").get(),
      userRef.collection("inventoryRequests").get(),
    ]);
    const inventoryDocs: RawClientInventoryDoc[] = inventorySnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));
    const requestDocs: RawClientInboundRequestDoc[] = requestSnapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data(),
    }));
    const rows = buildClientFefoStockRows(inventoryDocs, requestDocs);
    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[inventory/fefo]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load FEFO inventory" },
      { status: 500 }
    );
  }
}
