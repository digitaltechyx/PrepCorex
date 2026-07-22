import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import type { TikTokSelectedProduct } from "@/types";
import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";
import {
  getValidTikTokAccessToken,
  TikTokReconnectRequired,
} from "@/lib/tiktok-access-token";
import { collectTikTokProductImageUrls } from "@/lib/tiktok-product-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TikTokSku = {
  id?: string;
  seller_sku?: string;
  stock_infos?: Array<{ available_stock?: number }>;
};

type TikTokProduct = {
  id?: string;
  title?: string;
  skus?: TikTokSku[];
  main_images?: unknown[];
  images?: unknown[];
  product_images?: unknown[];
};

function safeShopKey(shopId: string): string {
  return shopId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "shop";
}

type SelectedPayload = TikTokSelectedProduct & {
  quantity?: number;
  imageUrl?: string;
  imageUrls?: string[];
};

/** PUT: Save selected TikTok products/SKUs and seed inventory rows (Shopify-style). */
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
            if (typeof v.quantity === "number" && Number.isFinite(v.quantity)) {
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
    const connRef = db.collection("users").doc(uid).collection("tiktokConnections").doc(connectionId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Store not connected" }, { status: 404 });
    }
    const conn = connSnap.data()!;
    const shopId = String(conn.shopId ?? connectionId);
    const shopName = String(conn.shopName ?? "TikTok Shop");
    const shopKey = safeShopKey(shopId);

    await connRef.update({
      selectedProducts: selectedProducts.map(({ productId, skuId, title, sku }) => {
        const row: TikTokSelectedProduct = { productId, skuId, title };
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
      if (fromClient.length) {
        const existing = imageByProduct[sel.productId] ?? [];
        const merged = [...existing];
        for (const u of fromClient) {
          if (!merged.includes(u)) merged.push(u);
        }
        imageByProduct[sel.productId] = merged;
      }
    }

    let accessToken: string | null = null;
    let shopCipher: string | null = null;
    const ensureToken = async () => {
      if (accessToken) return;
      accessToken = await getValidTikTokAccessToken(connRef, conn);
      shopCipher = (conn.shopCipher as string) || null;
    };

    const needsLiveQty = selectedProducts.some((p) => typeof p.quantity !== "number");
    const needsImages = selectedProducts.some((p) => !(imageByProduct[p.productId]?.length));

    if (needsLiveQty || needsImages) {
      try {
        await ensureToken();
        let pageToken: string | undefined;
        for (let page = 0; page < 5; page++) {
          const res = await tikTokApiRequest<{
            products?: TikTokProduct[];
            next_page_token?: string;
          }>({
            method: "POST",
            path: "/product/202309/products/search",
            accessToken: accessToken!,
            shopCipher,
            query: { page_size: 50, ...(pageToken ? { page_token: pageToken } : {}) },
            body: { status: "ALL" },
          });
          if (res.code !== 0) {
            console.warn("[tiktok-selected-products] product search", parseTikTokError(res));
            break;
          }
          for (const p of res.data?.products ?? []) {
            const pid = String(p.id ?? "");
            if (needsLiveQty) {
              for (const s of p.skus ?? []) {
                const id = String(s.id ?? "");
                if (!id || id in qtyBySku) continue;
                const qty =
                  s.stock_infos?.reduce((sum, si) => sum + (si.available_stock ?? 0), 0) ?? 0;
                qtyBySku[id] = qty;
              }
            }
            if (pid && !(imageByProduct[pid]?.length)) {
              const urls = collectTikTokProductImageUrls(
                p as Parameters<typeof collectTikTokProductImageUrls>[0]
              );
              if (urls.length) imageByProduct[pid] = urls;
            }
          }
          pageToken = res.data?.next_page_token;
          if (!pageToken) break;
        }
      } catch (e) {
        if (e instanceof TikTokReconnectRequired) {
          console.warn("[tiktok-selected-products] token refresh needed");
        } else {
          console.warn("[tiktok-selected-products] catalog fetch failed", e);
        }
      }
    }

    // Fill missing images via Get Product detail (search often omits main_images)
    const missingImageProductIds = [
      ...new Set(
        selectedProducts
          .map((p) => p.productId)
          .filter((pid) => !(imageByProduct[pid]?.length))
      ),
    ];
    for (const productId of missingImageProductIds) {
      try {
        await ensureToken();
        const detail = await tikTokApiRequest<TikTokProduct>({
          method: "GET",
          path: `/product/202309/products/${encodeURIComponent(productId)}`,
          accessToken: accessToken!,
          shopCipher,
        });
        if (detail.code !== 0 || !detail.data) {
          console.warn(
            "[tiktok-selected-products] product detail",
            productId,
            parseTikTokError(detail)
          );
          continue;
        }
        const urls = collectTikTokProductImageUrls(
          detail.data as Parameters<typeof collectTikTokProductImageUrls>[0]
        );
        if (urls.length) imageByProduct[productId] = urls;
      } catch (e) {
        console.warn("[tiktok-selected-products] detail image failed", productId, e);
      }
    }

    for (const sel of selectedProducts) {
      const quantity = qtyBySku[sel.skuId] ?? 0;
      const status = "In Stock";
      const docId = `tiktok_${shopKey}_${sel.skuId}`;
      const existingSnap = await invRef.doc(docId).get();
      const imageUrls = imageByProduct[sel.productId] ?? [];
      const payload: Record<string, unknown> = {
        productName: sel.title,
        quantity,
        status,
        source: "tiktok",
        tiktokProductId: sel.productId,
        tiktokSkuId: sel.skuId,
        tiktokShopId: shopId,
        tiktokConnectionId: connectionId,
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

    const existing = await invRef.where("source", "==", "tiktok").get();
    for (const d of existing.docs) {
      const data = d.data();
      const rowShop = String(data.tiktokShopId ?? "");
      const skuId = data.tiktokSkuId as string | undefined;
      const belongs =
        rowShop === shopId ||
        d.id.startsWith(`tiktok_${shopKey}_`) ||
        data.tiktokConnectionId === connectionId;
      if (belongs && skuId && !selectedSkuIds.has(skuId)) {
        await d.ref.delete();
      }
    }

    return NextResponse.json({ ok: true, selectedCount: selectedProducts.length });
  } catch (err: unknown) {
    console.error("[tiktok-selected-products]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
