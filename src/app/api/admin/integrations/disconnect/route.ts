import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { removeShipStationWebhooks } from "@/lib/shipstation-webhooks";
import type { IntegrationPlatformId } from "@/lib/integration-permissions";
import { INTEGRATION_PLATFORMS } from "@/lib/integration-permissions";

export const dynamic = "force-dynamic";

const VALID_PLATFORMS = new Set(INTEGRATION_PLATFORMS.map((p) => p.id));

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
  platform: IntegrationPlatformId;
  targetUid: string;
  connectionId: string;
  removeInventory?: boolean;
};

function collectionForPlatform(platform: IntegrationPlatformId): string {
  return `${platform}Connections`;
}

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
  if (!VALID_PLATFORMS.has(platform)) {
    return NextResponse.json({ error: "Invalid platform" }, { status: 400 });
  }

  const db = adminDb();
  const uid = targetUid.trim();
  const id = connectionId.trim();
  const coll = collectionForPlatform(platform);

  try {
    const ref = db.collection("users").doc(uid).collection(coll).doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;

    if (platform === "ebay") {
      await ref.delete();

      let removedInventoryCount = 0;
      if (removeInventory) {
        const invSnap = await db
          .collection("users")
          .doc(uid)
          .collection("inventory")
          .where("source", "==", "ebay")
          .where("ebayConnectionId", "==", id)
          .get();
        const lookupSnap = await db
          .collection("ebayInventoryLookup")
          .where("userId", "==", uid)
          .where("connectionId", "==", id)
          .get();
        const batch = db.batch();
        for (const d of invSnap.docs) batch.delete(d.ref);
        for (const d of lookupSnap.docs) batch.delete(d.ref);
        if (invSnap.docs.length > 0 || lookupSnap.docs.length > 0) {
          await batch.commit();
          removedInventoryCount = invSnap.docs.length;
        }
      }

      return NextResponse.json({ ok: true, platform, removedInventoryCount });
    }

    if (platform === "shopify") {
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
        for (const d of invSnap.docs) batch.delete(d.ref);
        if (invSnap.docs.length > 0) {
          await batch.commit();
          removedInventoryCount = invSnap.docs.length;
        }
      }

      return NextResponse.json({ ok: true, platform, removedInventoryCount });
    }

    if (platform === "tiktok") {
      const shopId = typeof data.shopId === "string" ? data.shopId : null;
      await ref.delete();

      if (shopId) {
        try {
          await db.collection("tiktokShopToUser").doc(shopId).delete();
        } catch (e) {
          console.warn("[admin disconnect tiktok] shopToUser delete failed", e);
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
        for (const invDoc of invSnap.docs) batch.delete(invDoc.ref);
        if (invSnap.docs.length > 0) {
          await batch.commit();
          removedInventoryCount = invSnap.docs.length;
        }
      }

      return NextResponse.json({ ok: true, platform, removedInventoryCount });
    }

    if (platform === "amazon") {
      await ref.delete();
      return NextResponse.json({ ok: true, platform, removedInventoryCount: 0 });
    }

    if (platform === "woocommerce") {
      const ordersSnap = await db
        .collection("users")
        .doc(uid)
        .collection("woocommerceOrders")
        .where("connectionId", "==", id)
        .get();

      const batchSize = 400;
      let batch = db.batch();
      let count = 0;
      for (const doc of ordersSnap.docs) {
        batch.delete(doc.ref);
        count += 1;
        if (count % batchSize === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      batch.delete(ref);
      await batch.commit();

      return NextResponse.json({ ok: true, platform, removedOrders: ordersSnap.size });
    }

    if (platform === "shipstation") {
      const apiKey = String(data.apiKey || "").trim();
      const apiSecret = String(data.apiSecret || "").trim();
      await removeShipStationWebhooks({
        userId: uid,
        connectionId: id,
        creds: apiKey && apiSecret ? { apiKey, apiSecret } : null,
        webhookToken: data.webhookToken || null,
        webhookIds: Array.isArray(data.webhookIds) ? data.webhookIds : [],
      });

      const ordersSnap = await db
        .collection("users")
        .doc(uid)
        .collection("shipstationOrders")
        .where("connectionId", "==", id)
        .get();

      const batchSize = 400;
      let batch = db.batch();
      let count = 0;
      for (const doc of ordersSnap.docs) {
        batch.delete(doc.ref);
        count += 1;
        if (count % batchSize === 0) {
          await batch.commit();
          batch = db.batch();
        }
      }
      batch.delete(ref);
      await batch.commit();

      return NextResponse.json({ ok: true, platform, removedOrders: ordersSnap.size });
    }

    await ref.delete();
    return NextResponse.json({ ok: true, platform });
  } catch (err: unknown) {
    console.error("[admin/integrations/disconnect POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
