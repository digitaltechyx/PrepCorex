import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { wooUpdateProductStock } from "@/lib/woocommerce-api";

export const dynamic = "force-dynamic";

/**
 * POST: Set stock qty on WooCommerce (PrepCorex → Woo).
 * Body: { userId?, connectionId, productId, variationId?, newQuantity }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let callerUid: string;
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    const data = userDoc.data();
    const role = data?.role as string;
    const roles = data?.roles as string[] | undefined;
    isAdmin =
      role === "admin" ||
      role === "sub_admin" ||
      (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || callerUid).trim();
  const connectionId = String(body.connectionId || "").trim();
  const productId = Number(body.productId);
  const variationIdRaw = body.variationId;
  const variationId =
    variationIdRaw != null && String(variationIdRaw).trim() !== ""
      ? Number(variationIdRaw)
      : undefined;
  const newQuantity =
    typeof body.newQuantity === "number" ? Math.max(0, Math.floor(body.newQuantity)) : undefined;

  if (!connectionId || !Number.isFinite(productId) || productId <= 0 || newQuantity === undefined) {
    return NextResponse.json(
      { error: "Missing connectionId, productId, or newQuantity" },
      { status: 400 }
    );
  }
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const connSnap = await adminDb()
      .collection("users")
      .doc(userId)
      .collection("woocommerceConnections")
      .doc(connectionId)
      .get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = connSnap.data() || {};
    const storeUrl = String(data.storeUrl || "").trim();
    const consumerKey = String(data.consumerKey || "").trim();
    const consumerSecret = String(data.consumerSecret || "").trim();
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return NextResponse.json({ error: "Credentials missing" }, { status: 400 });
    }

    const useVariation =
      variationId != null &&
      Number.isFinite(variationId) &&
      variationId > 0 &&
      variationId !== productId;

    await wooUpdateProductStock(
      { storeUrl, consumerKey, consumerSecret },
      productId,
      newQuantity,
      useVariation ? variationId : undefined
    );

    return NextResponse.json({
      ok: true,
      productId,
      variationId: useVariation ? variationId : null,
      newQuantity,
    });
  } catch (error: unknown) {
    console.error("[woocommerce sync-inventory]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync inventory to WooCommerce",
      },
      { status: 500 }
    );
  }
}
