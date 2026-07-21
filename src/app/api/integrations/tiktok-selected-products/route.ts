import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import type { TikTokSelectedProduct } from "@/types";

export const dynamic = "force-dynamic";

/** PUT: Save selected TikTok products/SKUs and seed inventory rows. */
export async function PUT(request: NextRequest) {
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
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const raw = body.selectedProducts;
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  const selectedProducts: TikTokSelectedProduct[] = Array.isArray(raw)
    ? raw
        .filter(
          (v: unknown) =>
            v &&
            typeof v === "object" &&
            typeof (v as { productId?: unknown }).productId === "string" &&
            typeof (v as { skuId?: unknown }).skuId === "string" &&
            typeof (v as { title?: unknown }).title === "string"
        )
        .map((v: { productId: string; skuId: string; title: string; sku?: string }) => {
          const item: TikTokSelectedProduct = {
            productId: v.productId,
            skuId: v.skuId,
            title: v.title,
          };
          if (v.sku != null && v.sku !== "") item.sku = v.sku;
          return item;
        })
    : [];

  try {
    const db = adminDb();
    const connRef = db.collection("users").doc(uid).collection("tiktokConnections").doc(connectionId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Store not connected" }, { status: 404 });
    }
    const conn = connSnap.data()!;
    const shopId = String(conn.shopId ?? "");
    const shopName = String(conn.shopName ?? "TikTok Shop");

    await connRef.update({ selectedProducts });

    const selectedSkuIds = new Set(selectedProducts.map((p) => p.skuId));
    const FieldValue = adminFieldValue();
    const invRef = db.collection("users").doc(uid).collection("inventory");

    // Remove deselected TikTok inventory rows for this shop
    const existing = await invRef.where("source", "==", "tiktok").where("tiktokShopId", "==", shopId).get();
    const batch = db.batch();
    let writes = 0;
    for (const d of existing.docs) {
      const skuId = d.data().tiktokSkuId as string | undefined;
      if (skuId && !selectedSkuIds.has(skuId)) {
        batch.delete(d.ref);
        writes++;
      }
    }

    for (const sel of selectedProducts) {
      const existingForSku = existing.docs.find(
        (invDoc: { data: () => { tiktokSkuId?: string } }) => invDoc.data().tiktokSkuId === sel.skuId
      );
      if (existingForSku) {
        batch.update(existingForSku.ref, {
          productName: sel.title,
          sku: sel.sku ?? null,
          tiktokProductId: sel.productId,
          tiktokSkuId: sel.skuId,
          tiktokShopId: shopId,
          shop: shopName,
          source: "tiktok",
          updatedAt: FieldValue.serverTimestamp(),
        });
        writes++;
      } else {
        const newRef = invRef.doc();
        batch.set(newRef, {
          productName: sel.title,
          sku: sel.sku ?? null,
          quantity: 0,
          status: "Out of Stock",
          dateAdded: FieldValue.serverTimestamp(),
          source: "tiktok",
          tiktokProductId: sel.productId,
          tiktokSkuId: sel.skuId,
          tiktokShopId: shopId,
          shop: shopName,
        });
        writes++;
      }
    }

    if (writes > 0) await batch.commit();

    return NextResponse.json({ ok: true, selectedCount: selectedProducts.length });
  } catch (err: unknown) {
    console.error("[tiktok-selected-products]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
