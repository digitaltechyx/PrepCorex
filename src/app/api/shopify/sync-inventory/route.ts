import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getShopifyAccessTokenForUserShop } from "@/lib/shopify-access-token";
import {
  isShopifyStaffCaller,
  setShopifyInventoryAvailable,
} from "@/lib/shopify-inventory-sync";

export const dynamic = "force-dynamic";

/**
 * POST: Set inventory quantity on Shopify for a variant (PrepCorex → Shopify).
 * Body: { userId, shop, shopifyVariantId, shopifyInventoryItemId?, newQuantity }
 * Requires Bearer token (owner, admin, sub_admin, or warehouse_ops).
 * Shopify app needs write_inventory scope.
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
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    isStaff = isShopifyStaffCaller(userDoc.data() as Record<string, unknown> | undefined);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = (body.userId as string)?.trim() || callerUid;
  const shop = (body.shop as string)?.trim();
  const shopifyVariantId = body.shopifyVariantId as string | undefined;
  const shopifyInventoryItemId = body.shopifyInventoryItemId as string | undefined;
  const newQuantity =
    typeof body.newQuantity === "number" ? Math.max(0, Math.floor(body.newQuantity)) : undefined;

  if (!shop || !shopifyVariantId || newQuantity === undefined) {
    return NextResponse.json(
      { error: "Missing shop, shopifyVariantId, or newQuantity" },
      { status: 400 }
    );
  }
  if (userId !== callerUid && !isStaff) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let shopNorm = shop.toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }

  try {
    const db = adminDb();
    const accessToken = await getShopifyAccessTokenForUserShop(db, userId, shopNorm);
    const result = await setShopifyInventoryAvailable({
      shop: shopNorm,
      accessToken,
      shopifyVariantId: String(shopifyVariantId),
      shopifyInventoryItemId,
      newQuantity,
    });
    return NextResponse.json({ success: true, available: result.available });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[shopify/sync-inventory]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
