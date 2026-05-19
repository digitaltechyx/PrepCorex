import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { parseShopifyErrorBody, shopifyAdminRestUrl } from "@/lib/shopify-api";
import {
  getValidShopifyAccessToken,
  ShopifyReconnectRequired,
} from "@/lib/shopify-access-token";

export const dynamic = "force-dynamic";

/** Shopify product variant from REST API (includes inventory when available). */
type ShopifyVariant = {
  id: number;
  product_id: number;
  title: string;
  sku?: string | null;
  inventory_quantity?: number;
  inventory_management?: string | null;
  inventory_item_id?: number;
};

/** Shopify product from REST API */
type ShopifyProduct = {
  id: number;
  title: string;
  variants: ShopifyVariant[];
};

/** GET: Fetch products (with variants) from user's connected Shopify store. Query: shop= (store domain or name). */
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

  const { searchParams } = new URL(request.url);
  let shop = (searchParams.get("shop") ?? "").trim().toLowerCase();
  if (!shop) {
    return NextResponse.json({ error: "Missing shop" }, { status: 400 });
  }
  if (!shop.includes(".myshopify.com")) {
    shop = `${shop}.myshopify.com`;
  }

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
  let accessToken: string;
  try {
    accessToken = await getValidShopifyAccessToken(connDoc.ref, connDoc.data(), shop);
  } catch (e) {
    if (e instanceof ShopifyReconnectRequired) {
      return NextResponse.json({ error: e.message, detail: e.message }, { status: 401 });
    }
    throw e;
  }

  const url = `${shopifyAdminRestUrl(shop, "/products.json")}?limit=250`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    const detail = parseShopifyErrorBody(text);
    console.error("[Shopify products]", res.status, detail, text.slice(0, 500));
    const nonExpiring =
      detail.toLowerCase().includes("non-expiring") ||
      detail.toLowerCase().includes("expiring offline");
    const needsReconnect = res.status === 401 || res.status === 403 || nonExpiring;
    return NextResponse.json(
      {
        error: needsReconnect
          ? "Shopify connection must be renewed. Disconnect and reconnect the store from Integrations."
          : "Failed to fetch products from Shopify",
        detail,
        shopifyStatus: res.status,
      },
      { status: needsReconnect ? 401 : 502 }
    );
  }
  const data = (await res.json()) as { products?: ShopifyProduct[] };
  const products = data.products ?? [];
  const allProducts = products.map((p) => ({
    productId: String(p.id),
    productTitle: p.title,
    variants: (p.variants ?? []).map((v) => ({
      variantId: String(v.id),
      title: v.title || "Default",
      sku: v.sku ?? null,
      inventoryQuantity: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
      inventoryManagement: v.inventory_management ?? null,
      inventoryItemId: v.inventory_item_id != null ? String(v.inventory_item_id) : null,
    })),
  }));

  return NextResponse.json({ products: allProducts, shop });
}
