import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return (
    role === "admin" ||
    role === "sub_admin" ||
    (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")))
  );
}

type Body = {
  platform: "shopify" | "ebay";
  targetUid: string;
  connectionId: string;
  removeInventory?: boolean;
};

/** POST: disconnect another user's integration (admin / sub_admin only). */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const callerDoc = await adminDb().collection("users").doc(callerUid).get();
    if (!isAdminOrSubAdmin(callerDoc.data() as Record<string, unknown> | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { platform, targetUid, connectionId, removeInventory } = body;
  if (!targetUid?.trim() || !connectionId?.trim()) {
    return NextResponse.json({ error: "Missing targetUid or connectionId" }, { status: 400 });
  }
  if (platform !== "shopify" && platform !== "ebay") {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const db = adminDb();
  const uid = targetUid.trim();
  const id = connectionId.trim();

  try {
    if (platform === "ebay") {
      const ref = db.collection("users").doc(uid).collection("ebayConnections").doc(id);
      const snap = await ref.get();
      if (!snap.exists) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }
      await ref.delete();
      return NextResponse.json({ ok: true, platform: "ebay" });
    }

    const ref = db.collection("users").doc(uid).collection("shopifyConnections").doc(id);
    const doc = await ref.get();
    if (!doc.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = doc.data()!;
    let shopNorm: string | null = (data.shop as string)?.trim() || null;
    if (shopNorm && !shopNorm.includes(".myshopify.com")) {
      shopNorm = `${shopNorm}.myshopify.com`;
    }

    await ref.delete();

    if (shopNorm) {
      const shopKey = shopNorm.replace(/\./g, "_");
      try {
        await db.collection("shopifyShopToUser").doc(shopKey).delete();
      } catch (e) {
        console.warn("[admin disconnect shopify] shopToUser delete failed", e);
      }
    }

    let removedInventoryCount = 0;
    if (removeInventory && shopNorm) {
      const invSnap = await db
        .collection("users")
        .doc(uid)
        .collection("inventory")
        .where("source", "==", "shopify")
        .where("shop", "==", shopNorm)
        .get();
      const batch = db.batch();
      invSnap.docs.forEach((d) => batch.delete(d.ref));
      if (invSnap.docs.length > 0) {
        await batch.commit();
        removedInventoryCount = invSnap.docs.length;
      }
    }

    return NextResponse.json({ ok: true, platform: "shopify", removedInventoryCount });
  } catch (err: unknown) {
    console.error("[admin/integrations/disconnect POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
