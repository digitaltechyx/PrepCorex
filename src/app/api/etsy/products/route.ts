import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  EtsyReconnectRequired,
  getValidEtsyAccessToken,
} from "@/lib/etsy-access-token";
import { etsyApiRequest, type EtsyListing } from "@/lib/etsy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/etsy/products?connectionId=...
 * Active listings for the connected shop.
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
    const ref = db.collection("users").doc(uid).collection("etsyConnections").doc(connectionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const shopId = String(data.shopId || "");
    if (!shopId) {
      return NextResponse.json({ error: "Shop id missing on connection" }, { status: 400 });
    }
    const accessToken = await getValidEtsyAccessToken(ref, data);

    const products: Array<{
      productId: string;
      productTitle: string;
      status: string | null;
      imageUrl: string | null;
      imageUrls: string[];
      skus: Array<{ skuId: string; sellerSku: string | null; quantity: number | null }>;
    }> = [];

    let offset = 0;
    const limit = 100;
    for (let page = 0; page < 20; page++) {
      const res = await etsyApiRequest<{
        count?: number;
        results?: EtsyListing[];
      }>({
        path: `/shops/${encodeURIComponent(shopId)}/listings/active`,
        accessToken,
        query: { limit, offset, includes: "Images" },
      });

      const rows = res.results ?? [];
      for (const listing of rows) {
        const listingId = String(listing.listing_id ?? "");
        if (!listingId) continue;
        const imageUrls = (listing.images ?? [])
          .map((img) => img.url_570xN || img.url_fullxfull || "")
          .filter((u) => u.startsWith("http"));
        const sellerSku =
          Array.isArray(listing.sku) && listing.sku.length > 0
            ? String(listing.sku[0])
            : null;
        products.push({
          productId: listingId,
          productTitle: listing.title || listingId,
          status: listing.state ?? null,
          imageUrl: imageUrls[0] ?? null,
          imageUrls,
          skus: [
            {
              skuId: listingId,
              sellerSku,
              quantity:
                typeof listing.quantity === "number" ? listing.quantity : null,
            },
          ],
        });
      }

      offset += rows.length;
      if (rows.length < limit) break;
      if (typeof res.count === "number" && offset >= res.count) break;
    }

    return NextResponse.json({
      products,
      shopId,
      shopName: data.shopName ?? "Etsy Shop",
    });
  } catch (err: unknown) {
    if (err instanceof EtsyReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[etsy/products]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load Etsy listings" },
      { status: 500 }
    );
  }
}
