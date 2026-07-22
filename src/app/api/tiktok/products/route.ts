import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";
import {
  getValidTikTokAccessToken,
  TikTokReconnectRequired,
} from "@/lib/tiktok-access-token";
import { collectTikTokProductImageUrls } from "@/lib/tiktok-product-image";
import {
  fetchTikTokSkuQuantities,
  quantityFromTikTokSkuStockInfos,
} from "@/lib/tiktok-inventory";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TikTokSku = {
  id?: string;
  seller_sku?: string;
  stock_infos?: Array<{ available_stock?: number; available_quantity?: number }>;
  inventory?: Array<{ available_quantity?: number; available_stock?: number; quantity?: number }>;
};

type TikTokProduct = {
  id?: string;
  title?: string;
  status?: string;
  skus?: TikTokSku[];
  main_images?: unknown[];
  images?: unknown[];
  product_images?: unknown[];
};

/**
 * GET /api/tiktok/products?connectionId=...
 * Lists products + SKU qty from Inventory Search (authoritative).
 */
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

  const connectionId = new URL(request.url).searchParams.get("connectionId")?.trim();
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  try {
    const db = adminDb();
    const ref = db.collection("users").doc(uid).collection("tiktokConnections").doc(connectionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const accessToken = await getValidTikTokAccessToken(ref, data);
    const shopCipher = (data.shopCipher as string) || null;

    const products: Array<{
      productId: string;
      productTitle: string;
      status: string | null;
      imageUrl: string | null;
      imageUrls: string[];
      skus: Array<{ skuId: string; sellerSku: string | null; quantity: number | null }>;
    }> = [];

    let pageToken: string | undefined;
    for (let page = 0; page < 10; page++) {
      const res = await tikTokApiRequest<{
        products?: TikTokProduct[];
        next_page_token?: string;
        total_count?: number;
      }>({
        method: "POST",
        path: "/product/202309/products/search",
        accessToken,
        shopCipher,
        query: { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
        body: { status: "ALL" },
      });

      if (res.code !== 0) {
        return NextResponse.json(
          { error: "Failed to load TikTok products", detail: parseTikTokError(res) },
          { status: 502 }
        );
      }

      for (const p of res.data?.products ?? []) {
        const productId = String(p.id ?? "");
        if (!productId) continue;
        const imageUrls = collectTikTokProductImageUrls(
          p as Parameters<typeof collectTikTokProductImageUrls>[0]
        );
        products.push({
          productId,
          productTitle: p.title || productId,
          status: p.status ?? null,
          imageUrl: imageUrls[0] ?? null,
          imageUrls,
          skus: (p.skus ?? []).map((s) => ({
            skuId: String(s.id ?? ""),
            sellerSku: s.seller_sku ?? null,
            quantity: quantityFromTikTokSkuStockInfos(s),
          })),
        });
      }

      pageToken = res.data?.next_page_token;
      if (!pageToken) break;
    }

    // Enrich quantities via Inventory Search (product search often omits stock)
    try {
      const qtyBySku = await fetchTikTokSkuQuantities({
        accessToken,
        shopCipher,
        productIds: products.map((p) => p.productId),
      });
      for (const p of products) {
        for (const s of p.skus) {
          if (s.skuId in qtyBySku) s.quantity = qtyBySku[s.skuId];
        }
      }
    } catch (e) {
      console.warn("[tiktok/products] inventory search enrich failed", e);
    }

    return NextResponse.json({ products, shopId: data.shopId, shopName: data.shopName });
  } catch (err: unknown) {
    if (err instanceof TikTokReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[tiktok/products]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
