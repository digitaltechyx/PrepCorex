import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getValidShopifyAccessToken } from "@/lib/shopify-access-token";
import {
  normalizeShopifyShop,
  pullShopifyVariantQuantities,
} from "@/lib/shopify-inventory-pull";

export const dynamic = "force-dynamic";

/**
 * POST: Pull live Shopify quantities into PrepCorex for linked variants.
 * Body: { shop, variantIds?: string[] } — if variantIds omitted, uses all selectedVariants.
 * Owner Bearer token required.
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

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  let shop = typeof body.shop === "string" ? body.shop.trim() : "";
  if (!shop) {
    return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  }
  shop = normalizeShopifyShop(shop);

  try {
    const db = adminDb();
    const connSnap = await db
      .collection("users")
      .doc(uid)
      .collection("shopifyConnections")
      .where("shop", "==", shop)
      .limit(1)
      .get();
    if (connSnap.empty) {
      return NextResponse.json({ error: "Store not connected" }, { status: 404 });
    }
    const connDoc = connSnap.docs[0];
    const connData = connDoc.data() || {};
    const accessToken = await getValidShopifyAccessToken(connDoc.ref, connData, shop);

    let variantIds: string[] = Array.isArray(body.variantIds)
      ? body.variantIds.map((v: unknown) => String(v || "").trim()).filter(Boolean)
      : [];
    if (variantIds.length === 0) {
      const selected = Array.isArray(connData.selectedVariants)
        ? (connData.selectedVariants as Array<{ variantId?: string }>)
        : [];
      variantIds = selected
        .map((v) => (v.variantId != null ? String(v.variantId).trim() : ""))
        .filter(Boolean);
    }

    const result = await pullShopifyVariantQuantities({
      db,
      userId: uid,
      shop,
      accessToken,
      variantIds,
    });

    return NextResponse.json({ success: true, updated: result.updated, count: variantIds.length });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[shopify/pull-inventory]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
