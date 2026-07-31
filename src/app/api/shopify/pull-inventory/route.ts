import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getValidShopifyAccessToken, getShopifyAccessTokenForUserShop } from "@/lib/shopify-access-token";
import {
  normalizeShopifyShop,
  pullShopifyVariantQuantities,
} from "@/lib/shopify-inventory-pull";
import { isShopifyStaffCaller } from "@/lib/shopify-inventory-sync";

export const dynamic = "force-dynamic";

/**
 * POST: Pull live Shopify quantities into PrepCorex for linked variants.
 * Body: {
 *   shop?: string,
 *   variantIds?: string[],
 *   userId?: string,      // staff may pull for a client
 *   allShops?: boolean,   // pull every connected shop (selected variants or provided map)
 *   byShop?: Record<string, string[]>  // shop → variantIds
 * }
 * Owner or staff Bearer token required.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let callerUid: string;
  let isStaff = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const callerDoc = await adminDb().collection("users").doc(callerUid).get();
    isStaff = isShopifyStaffCaller(callerDoc.data() as Record<string, unknown> | undefined);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const targetUserId =
    typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : callerUid;
  if (targetUserId !== callerUid && !isStaff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const allShops = body.allShops === true;
  const byShopRaw =
    body.byShop && typeof body.byShop === "object" && !Array.isArray(body.byShop)
      ? (body.byShop as Record<string, unknown>)
      : null;

  try {
    const db = adminDb();
    const jobs: Array<{ shop: string; variantIds: string[] }> = [];

    if (byShopRaw) {
      for (const [shopKey, ids] of Object.entries(byShopRaw)) {
        const shop = normalizeShopifyShop(shopKey);
        const variantIds = Array.isArray(ids)
          ? ids.map((v) => String(v || "").trim()).filter(Boolean)
          : [];
        if (variantIds.length > 0) jobs.push({ shop, variantIds });
      }
    } else if (allShops) {
      const connSnap = await db
        .collection("users")
        .doc(targetUserId)
        .collection("shopifyConnections")
        .get();
      for (const connDoc of connSnap.docs) {
        const connData = connDoc.data() || {};
        const shop = normalizeShopifyShop(String(connData.shop || ""));
        if (!shop) continue;
        const selected = Array.isArray(connData.selectedVariants)
          ? (connData.selectedVariants as Array<{ variantId?: string }>)
          : [];
        const variantIds = selected
          .map((v) => (v.variantId != null ? String(v.variantId).trim() : ""))
          .filter(Boolean);
        if (variantIds.length > 0) jobs.push({ shop, variantIds });
      }
    } else {
      let shop = typeof body.shop === "string" ? body.shop.trim() : "";
      if (!shop) {
        return NextResponse.json({ error: "Missing shop" }, { status: 400 });
      }
      shop = normalizeShopifyShop(shop);
      let variantIds: string[] = Array.isArray(body.variantIds)
        ? body.variantIds.map((v: unknown) => String(v || "").trim()).filter(Boolean)
        : [];
      if (variantIds.length === 0) {
        const connSnap = await db
          .collection("users")
          .doc(targetUserId)
          .collection("shopifyConnections")
          .where("shop", "==", shop)
          .limit(1)
          .get();
        if (connSnap.empty) {
          return NextResponse.json({ error: "Store not connected" }, { status: 404 });
        }
        const selected = Array.isArray(connSnap.docs[0].data()?.selectedVariants)
          ? (connSnap.docs[0].data()!.selectedVariants as Array<{ variantId?: string }>)
          : [];
        variantIds = selected
          .map((v) => (v.variantId != null ? String(v.variantId).trim() : ""))
          .filter(Boolean);
      }
      jobs.push({ shop, variantIds });
    }

    let updated = 0;
    let count = 0;
    for (const job of jobs) {
      count += job.variantIds.length;
      if (job.variantIds.length === 0) continue;
      let accessToken: string;
      try {
        accessToken = await getShopifyAccessTokenForUserShop(db, targetUserId, job.shop);
      } catch {
        const connSnap = await db
          .collection("users")
          .doc(targetUserId)
          .collection("shopifyConnections")
          .where("shop", "==", job.shop)
          .limit(1)
          .get();
        if (connSnap.empty) continue;
        accessToken = await getValidShopifyAccessToken(
          connSnap.docs[0].ref,
          connSnap.docs[0].data(),
          job.shop
        );
      }
      const result = await pullShopifyVariantQuantities({
        db,
        userId: targetUserId,
        shop: job.shop,
        accessToken,
        variantIds: job.variantIds,
      });
      updated += result.updated;
    }

    return NextResponse.json({ success: true, updated, count, shops: jobs.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[shopify/pull-inventory]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
