import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import type { EtsySelectedProduct } from "@/types";
import {
  EtsyReconnectRequired,
  getValidEtsyAccessToken,
} from "@/lib/etsy-access-token";
import { etsyApiRequest, type EtsyListing } from "@/lib/etsy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function safeShopKey(shopId: string): string {
  return shopId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "shop";
}

type SelectedPayload = EtsySelectedProduct & {
  quantity?: number;
  imageUrl?: string;
  imageUrls?: string[];
};

/** PUT: Save selected Etsy listings and seed inventory rows. */
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

  const selectedProducts: SelectedPayload[] = Array.isArray(raw)
    ? raw
        .filter(
          (v: unknown) =>
            v &&
            typeof v === "object" &&
            typeof (v as { productId?: unknown }).productId === "string" &&
            typeof (v as { skuId?: unknown }).skuId === "string" &&
            typeof (v as { title?: unknown }).title === "string"
        )
        .map(
          (v: {
            productId: string;
            skuId: string;
            title: string;
            sku?: string;
            quantity?: number;
            imageUrl?: string;
            imageUrls?: string[];
          }) => {
            const item: SelectedPayload = {
              productId: v.productId,
              skuId: v.skuId,
              title: v.title,
            };
            if (v.sku != null && v.sku !== "") item.sku = v.sku;
            if (typeof v.quantity === "number" && Number.isFinite(v.quantity) && v.quantity >= 0) {
              item.quantity = Math.max(0, Math.floor(v.quantity));
            }
            if (typeof v.imageUrl === "string" && v.imageUrl.trim().startsWith("http")) {
              item.imageUrl = v.imageUrl.trim();
            }
            if (Array.isArray(v.imageUrls)) {
              const urls = v.imageUrls.filter(
                (u): u is string => typeof u === "string" && u.trim().startsWith("http")
              );
              if (urls.length) item.imageUrls = urls;
            }
            return item;
          }
        )
    : [];

  try {
    const db = adminDb();
    const connRef = db
      .collection("users")
      .doc(uid)
      .collection("etsyConnections")
      .doc(connectionId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Shop not connected" }, { status: 404 });
    }
    const conn = connSnap.data()!;
    const shopId = String(conn.shopId ?? connectionId);
    const shopName = String(conn.shopName ?? "Etsy Shop");
    const shopKey = safeShopKey(shopId);

    await connRef.update({
      selectedProducts: selectedProducts.map(({ productId, skuId, title, sku }) => {
        const row: EtsySelectedProduct = { productId, skuId, title };
        if (sku) row.sku = sku;
        return row;
      }),
    });

    const FieldValue = adminFieldValue();
    const invRef = db.collection("users").doc(uid).collection("inventory");
    const selectedSkuIds = new Set(selectedProducts.map((p) => p.skuId));

    const qtyBySku: Record<string, number> = {};
    const imageByProduct: Record<string, string[]> = {};
    for (const sel of selectedProducts) {
      if (typeof sel.quantity === "number") qtyBySku[sel.skuId] = sel.quantity;
      const fromClient = [
        ...(sel.imageUrls ?? []),
        ...(sel.imageUrl ? [sel.imageUrl] : []),
      ].filter((u) => u.startsWith("http"));
      if (fromClient.length) imageByProduct[sel.productId] = fromClient;
    }

    // Refresh qty/images from Etsy when possible
    try {
      const accessToken = await getValidEtsyAccessToken(connRef, conn);
      for (const sel of selectedProducts) {
        try {
          const listing = await etsyApiRequest<EtsyListing>({
            path: `/listings/${encodeURIComponent(sel.productId)}`,
            accessToken,
            query: { includes: "Images" },
          });
          if (typeof listing.quantity === "number") {
            qtyBySku[sel.skuId] = listing.quantity;
          }
          const urls = (listing.images ?? [])
            .map((img) => img.url_570xN || img.url_fullxfull || "")
            .filter((u) => u.startsWith("http"));
          if (urls.length) imageByProduct[sel.productId] = urls;
        } catch (e) {
          console.warn("[etsy-selected-products] listing fetch", sel.productId, e);
        }
      }
    } catch (e) {
      if (!(e instanceof EtsyReconnectRequired)) {
        console.warn("[etsy-selected-products] token/listings refresh failed", e);
      }
    }

    for (const sel of selectedProducts) {
      const quantity = qtyBySku[sel.skuId] ?? 0;
      const status = quantity > 0 ? "In Stock" : "Out of Stock";
      const docId = `etsy_${shopKey}_${sel.skuId}`;
      const existingSnap = await invRef.doc(docId).get();
      const imageUrls = imageByProduct[sel.productId] ?? [];
      const payload: Record<string, unknown> = {
        productName: sel.title,
        quantity,
        status,
        source: "etsy",
        etsyListingId: sel.productId,
        etsySkuId: sel.skuId,
        etsyShopId: shopId,
        etsyConnectionId: connectionId,
        shop: shopName,
        ...(sel.sku ? { sku: sel.sku } : {}),
      };
      if (imageUrls.length) {
        payload.imageUrl = imageUrls[0];
        payload.imageUrls = imageUrls;
      }
      if (!existingSnap.exists) {
        payload.dateAdded = FieldValue.serverTimestamp();
      }
      await invRef.doc(docId).set(payload, { merge: true });
    }

    const existing = await invRef.where("source", "==", "etsy").get();
    for (const d of existing.docs) {
      const data = d.data();
      const rowShop = String(data.etsyShopId ?? "");
      const skuId = data.etsySkuId as string | undefined;
      const belongs =
        rowShop === shopId ||
        d.id.startsWith(`etsy_${shopKey}_`) ||
        data.etsyConnectionId === connectionId;
      if (belongs && skuId && !selectedSkuIds.has(skuId)) {
        await d.ref.delete();
      }
    }

    return NextResponse.json({ ok: true, selectedCount: selectedProducts.length });
  } catch (err: unknown) {
    console.error("[etsy-selected-products]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
