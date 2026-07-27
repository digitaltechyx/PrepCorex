import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { ShopifyReconnectRequired, getShopifyAccessTokenForUserShop } from "@/lib/shopify-access-token";
import { authorizeShopifyUserRoute, normalizeShopParam } from "@/lib/shopify-route-auth";
import {
  getOpenFulfillmentOrderIdForLabel,
  purchaseShopifyShippingLabel,
} from "@/lib/shopify-shipping-label";

export const dynamic = "force-dynamic";

/**
 * POST: Purchase a Shopify Shipping label for an order (billed to the merchant's Shopify account).
 * Body: {
 *   userId, shop, orderId,
 *   lengthIn?, widthIn?, heightIn?, totalWeightLb?,
 *   notifyCustomer?
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userId = (body.userId as string)?.trim();
  const shop = (body.shop as string)?.trim();
  const orderId = (body.orderId as string)?.trim();
  const notifyCustomer = body.notify_customer === true || body.notifyCustomer === true;

  if (!userId || !shop || !orderId) {
    return NextResponse.json({ error: "Missing userId, shop, or orderId" }, { status: 400 });
  }

  const auth = await authorizeShopifyUserRoute(request, userId);
  if (auth instanceof NextResponse) return auth;

  const lengthIn = Number(body.lengthIn ?? body.length_in ?? 12);
  const widthIn = Number(body.widthIn ?? body.width_in ?? 9);
  const heightIn = Number(body.heightIn ?? body.height_in ?? 6);
  const totalWeightLb = Number(body.totalWeightLb ?? body.total_weight_lb ?? 1);

  if (
    !Number.isFinite(lengthIn) ||
    !Number.isFinite(widthIn) ||
    !Number.isFinite(heightIn) ||
    !Number.isFinite(totalWeightLb) ||
    lengthIn <= 0 ||
    widthIn <= 0 ||
    heightIn <= 0 ||
    totalWeightLb <= 0
  ) {
    return NextResponse.json(
      { error: "Package dimensions and total weight must be positive numbers." },
      { status: 400 }
    );
  }

  const shopNorm = normalizeShopParam(shop);

  try {
    const db = adminDb();
    const accessToken = await getShopifyAccessTokenForUserShop(db, userId, shopNorm);
    const fulfillmentOrderId = await getOpenFulfillmentOrderIdForLabel(shopNorm, accessToken, orderId);
    const result = await purchaseShopifyShippingLabel({
      shop: shopNorm,
      accessToken,
      fulfillmentOrderId,
      notifyCustomer,
      pkg: { lengthIn, widthIn, heightIn, totalWeightLb },
    });

    if (result.status === "PURCHASE_FAILED") {
      const message =
        result.errors.join("; ") ||
        "Shopify could not purchase the label. Ensure Shopify Shipping is enabled and billing is set up on the store.";
      return NextResponse.json({ error: message, result }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      result,
      label: result.labels[0] ?? null,
    });
  } catch (err: unknown) {
    if (err instanceof ShopifyReconnectRequired) {
      return NextResponse.json(
        {
          error: `${err.message} The store also needs the write_orders scope — disconnect and reconnect Shopify from Integrations.`,
        },
        { status: 409 }
      );
    }
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[shopify/label/purchase]", err);
    if (/scope|access denied|permission/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "Missing Shopify permissions for label purchase. Ask the client to disconnect and reconnect their Shopify store from Integrations.",
        },
        { status: 403 }
      );
    }
    if (/terms of service|shopify shipping/i.test(message)) {
      return NextResponse.json(
        {
          error:
            "This store must accept Shopify Shipping terms in Shopify admin before labels can be purchased via API.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
