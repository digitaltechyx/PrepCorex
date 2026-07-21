import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/** GET: list current user's TikTok connections (no tokens). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const snapshot = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("tiktokConnections")
      .get();
    const list = snapshot.docs.map((d: { id: string; data: () => Record<string, unknown> }) => {
      const data = d.data();
      return {
        id: d.id,
        shopId: data.shopId,
        shopName: (data.shopName as string | undefined) ?? (data.sellerName as string | undefined) ?? "TikTok Shop",
        region: (data.region as string | null | undefined) ?? (data.sellerBaseRegion as string | null | undefined) ?? null,
        connectedAt: data.connectedAt,
        selectedProducts: data.selectedProducts ?? [],
      };
    });
    return NextResponse.json({ connections: list });
  } catch (err: unknown) {
    console.error("[tiktok-connections GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** DELETE: remove one connection. Query param id = doc id. */
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const removeInventory = searchParams.get("removeInventory") === "true";
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const db = adminDb();
    const ref = db.collection("users").doc(uid).collection("tiktokConnections").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = doc.data()!;
    const shopId = typeof data.shopId === "string" ? data.shopId : null;

    await ref.delete();

    if (shopId) {
      try {
        await db.collection("tiktokShopToUser").doc(shopId).delete();
      } catch (e) {
        console.warn("[tiktok-connections DELETE] shopToUser delete failed", e);
      }
    }

    let removedInventoryCount = 0;
    if (removeInventory && shopId) {
      const invSnap = await db
        .collection("users")
        .doc(uid)
        .collection("inventory")
        .where("source", "==", "tiktok")
        .where("tiktokShopId", "==", shopId)
        .get();
      const batch = db.batch();
      for (const invDoc of invSnap.docs) {
        batch.delete(invDoc.ref);
      }
      if (invSnap.docs.length > 0) {
        await batch.commit();
        removedInventoryCount = invSnap.docs.length;
      }
    }

    return NextResponse.json({ ok: true, removedInventoryCount });
  } catch (err: unknown) {
    console.error("[tiktok-connections DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
