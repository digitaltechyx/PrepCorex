import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";
import { getShopifyAccessTokenForUserShop } from "@/lib/shopify-access-token";

export const dynamic = "force-dynamic";

/**
 * POST: Update product title on Shopify (PrepCorex → Shopify when admin edits product name).
 * Body: { userId, shop, shopifyProductId, title }
 * Requires Bearer token (admin or the user). Shopify app needs write_products scope.
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
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    isAdmin = (userDoc.data()?.role as string) === "admin";
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = (body.userId as string)?.trim() || callerUid;
  const shop = (body.shop as string)?.trim();
  const shopifyProductId = body.shopifyProductId != null ? String(body.shopifyProductId) : undefined;
  const title = typeof body.title === "string" ? body.title.trim() : undefined;

  if (!shop || !shopifyProductId || title === undefined) {
    return NextResponse.json(
      { error: "Missing shop, shopifyProductId, or title" },
      { status: 400 }
    );
  }
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let shopNorm = shop.toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }

  try {
    const db = adminDb();
    const accessToken = await getShopifyAccessTokenForUserShop(db, userId, shopNorm);

    const productId = Number(shopifyProductId);
    if (!Number.isFinite(productId)) {
      return NextResponse.json({ error: "Invalid shopifyProductId" }, { status: 400 });
    }

    const res = await fetch(
      shopifyAdminRestUrl(shopNorm, `/products/${productId}.json`),
      {
        method: "PUT",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ product: { id: productId, title } }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("[Shopify update-product]", res.status, errText);
      return NextResponse.json(
        { error: "Shopify rejected product update. Ensure app has write_products scope." },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, title });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[shopify/update-product]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
