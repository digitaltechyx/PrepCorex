import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";
import { getValidShopifyAccessToken } from "@/lib/shopify-access-token";
import {
  normalizeShopifyOrder,
  shopifyOrderToFirestoreDoc,
} from "@/lib/shopify-order-normalize";
import {
  applyShopifyAvailableToPaths,
  pullShopifyVariantQuantities,
  resolveShopifyInventoryPaths,
  shopifyShopKey,
} from "@/lib/shopify-inventory-pull";

export const dynamic = "force-dynamic";

/** Recursively remove undefined values so Firestore accepts the object. */
function stripUndefined<T>(value: T): T {
  if (value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => stripUndefined(v)) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}

/** GET: Confirm webhook URL is reachable. Shopify sends POST only. Required for App Store automated checks. */
export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Shopify webhook endpoint. Mandatory compliance webhooks (customers/data_request, customers/redact, shop/redact) are supported. All POST requests are verified with X-Shopify-Hmac-Sha256 before processing. Returns 401 if HMAC invalid, 200 on success.",
  });
}

/**
 * POST: Shopify webhooks (e.g. inventory_levels/update).
 * Verify X-Shopify-Hmac-Sha256, then update PrepCorex inventory for matching docs.
 * Register this URL in Shopify admin: https://your-domain.com/api/shopify/webhooks
 */
export async function POST(request: NextRequest) {
  // Use raw bytes for HMAC so platform cannot alter body (fixes 401 on Vercel/some runtimes)
  const rawBytes = await request.arrayBuffer();
  const rawBody = new TextDecoder("utf-8").decode(rawBytes);
  const hmac = request.headers.get("x-shopify-hmac-sha256");
  const topic = request.headers.get("x-shopify-topic");
  const shop = request.headers.get("x-shopify-shop-domain")?.toLowerCase();

  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret) {
    console.error("[Shopify webhooks] SHOPIFY_CLIENT_SECRET not set");
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }
  if (!hmac || !shop) {
    return NextResponse.json({ error: "Missing headers" }, { status: 401 });
  }

  // App Store requirement: verify webhooks with HMAC (X-Shopify-Hmac-Sha256 = base64(SHA256-HMAC(raw body, client secret))).
  const computed = createHmac("sha256", secret).update(Buffer.from(rawBytes)).digest("base64");
  const computedBuf = Buffer.from(computed, "utf8");
  const hmacBuf = Buffer.from(hmac, "utf8");
  if (computedBuf.length !== hmacBuf.length || !timingSafeEqual(computedBuf, hmacBuf)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const shopNorm = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;

  // app/uninstalled – fired when merchant uninstalls app; token already invalid, ack and optionally clean up.
  if (topic === "app/uninstalled") {
    console.log("[Shopify webhooks] app/uninstalled received", { shop: shopNorm });
    try {
      const db = adminDb();
      const shopKey = shopNorm.replace(/\./g, "_");
      await db.collection("shopifyShopToUser").doc(shopKey).delete();
    } catch (e) {
      console.warn("[Shopify webhooks] app/uninstalled cleanup", e);
    }
    return NextResponse.json({ received: true });
  }

  // Mandatory GDPR compliance webhooks (required for App Store). Ack with 200; we verify HMAC above.
  if (topic === "customers/data_request" || topic === "customers/redact" || topic === "shop/redact") {
    console.log("[Shopify webhooks] compliance webhook received", { topic, shop: shopNorm });
    return NextResponse.json({ received: true });
  }

  if (topic === "inventory_levels/update") {
    console.log("[Shopify webhooks] received inventory_levels/update", { shop: shopNorm });
    const raw = payload as Record<string, unknown>;
    const data = (raw?.inventory_level as Record<string, unknown>) ?? raw;
    const availableFromWebhook = data.available != null ? Number(data.available) : 0;
    // Prefer extracting inventory_item_id from raw body as string to avoid JS number precision loss (Shopify IDs can be > 2^53)
    let idStr: string | null = null;
    const idMatch = rawBody.match(/"inventory_item_id"\s*:\s*"?(\d+)"?/);
    if (idMatch) idStr = idMatch[1];
    if (!idStr) {
      const fromPayload = data.inventory_item_id;
      if (fromPayload != null) idStr = String(fromPayload);
    }
    if (!idStr) {
      console.warn("[Shopify webhooks] inventory_levels/update missing inventory_item_id", { shop: shopNorm });
      return NextResponse.json({ error: "Missing inventory_item_id" }, { status: 400 });
    }

    try {
      const db = adminDb();
      // Use total available across ALL locations so PrepCorex shows correct qty
      let available = availableFromWebhook;
      const shopKey = shopifyShopKey(shopNorm);
      const shopToUserSnap = await db.collection("shopifyShopToUser").doc(shopKey).get();
      const userId = shopToUserSnap.exists
        ? (shopToUserSnap.data()?.userId as string | undefined)
        : undefined;

      if (userId) {
        const connSnap = await db
          .collection("users")
          .doc(userId)
          .collection("shopifyConnections")
          .where("shop", "==", shopNorm)
          .limit(1)
          .get();
        if (!connSnap.empty) {
          const connDoc = connSnap.docs[0];
          let accessToken = "";
          try {
            accessToken = await getValidShopifyAccessToken(connDoc.ref, connDoc.data(), shopNorm);
          } catch (e) {
            console.warn("[Shopify webhooks] Could not refresh access token for inventory_levels/update", e);
          }
          if (accessToken) {
            const levelsRes = await fetch(
              `${shopifyAdminRestUrl(shopNorm, "/inventory_levels.json")}?inventory_item_ids=${encodeURIComponent(idStr)}&limit=250`,
              { headers: { "X-Shopify-Access-Token": accessToken } }
            );
            if (levelsRes.ok) {
              const levelsData = (await levelsRes.json()) as {
                inventory_levels?: Array<{ available?: number }>;
              };
              const levels = levelsData.inventory_levels ?? [];
              available = levels.reduce(
                (sum, l) => sum + (l.available != null ? Number(l.available) : 0),
                0
              );
            }
          }
        }
      }

      const paths = await resolveShopifyInventoryPaths(db, shopNorm, idStr, userId);
      if (paths.length === 0) {
        console.warn(
          "[Shopify webhooks] inventory_levels/update no inventory path — re-save product selection in Integrations → Manage products",
          { shop: shopNorm, shopifyInventoryItemId: idStr, available }
        );
      } else {
        const updated = await applyShopifyAvailableToPaths(db, paths, available);
        console.log("[Shopify webhooks] inventory_levels/update OK", {
          shop: shopNorm,
          shopifyInventoryItemId: idStr,
          available,
          updated,
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Shopify webhooks inventory_levels/update]", msg, err);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  if (topic === "products/delete") {
    const raw = payload as Record<string, unknown>;
    const productObj = raw?.product as Record<string, unknown> | undefined;
    const productId = (productObj?.id ?? raw?.id) != null ? String(productObj?.id ?? raw?.id) : null;
    if (!productId) {
      console.warn("[Shopify webhooks] products/delete missing id", { shop: shopNorm });
      return NextResponse.json({ received: true });
    }
    try {
      const db = adminDb();
      const productLookupRef = db.collection("shopifyProductLookup");
      const lookupRef = db.collection("shopifyInventoryLookup");
      const plId = `${shopNorm.replace(/\./g, "_")}_${productId}`;
      const plSnap = await productLookupRef.doc(plId).get();
      if (!plSnap.exists) {
        console.log("[Shopify webhooks] products/delete no product lookup", { shop: shopNorm, productId });
        return NextResponse.json({ received: true });
      }
      const pl = plSnap.data()!;
      const paths = (pl.paths as string[]) || [];
      const lookupIds = (pl.lookupIds as string[]) || [];
      for (const path of paths) {
        try {
          await db.doc(path).delete();
        } catch (e) {
          console.warn("[Shopify webhooks] products/delete could not delete doc", path, e);
        }
      }
      for (const lid of lookupIds) {
        try {
          await lookupRef.doc(lid).delete();
        } catch (e) {
          console.warn("[Shopify webhooks] products/delete could not delete lookup", lid, e);
        }
      }
      await productLookupRef.doc(plId).delete();
      console.log("[Shopify webhooks] products/delete OK", { shop: shopNorm, productId, removed: paths.length });
    } catch (err: unknown) {
      console.error("[Shopify webhooks products/delete]", err);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  if (topic === "orders/create" || topic === "orders/updated") {
    console.log("[Shopify webhooks] received order webhook", { topic, shop: shopNorm });
    const raw = payload as Record<string, unknown>;
    const order = (raw?.order as Record<string, unknown>) ?? raw;
    const orderId = order?.id != null ? String(order.id) : null;
    if (!orderId) {
      console.warn("[Shopify webhooks] orders missing id", { shop: shopNorm });
      return NextResponse.json({ received: true });
    }
    try {
      const db = adminDb();
      const shopKey = shopNorm.replace(/\./g, "_");
      const shopToUserSnap = await db.collection("shopifyShopToUser").doc(shopKey).get();
      if (!shopToUserSnap.exists) {
        console.warn("[Shopify webhooks] orders no shopToUser — disconnect and reconnect the store in PrepCorex Integrations so orders can sync", { shop: shopNorm });
        return NextResponse.json({ received: true });
      }
      const userId = shopToUserSnap.data()?.userId as string;
      if (!userId) {
        console.warn("[Shopify webhooks] orders no userId in shopToUser", { shop: shopNorm });
        return NextResponse.json({ received: true });
      }
      const connSnap = await db
        .collection("users")
        .doc(userId)
        .collection("shopifyConnections")
        .where("shop", "==", shopNorm)
        .limit(1)
        .get();
      const connectionId = connSnap.empty ? null : connSnap.docs[0].id;
      const shopName =
        (connSnap.empty ? null : (connSnap.docs[0].data()?.shopName as string | undefined)) ||
        shopNorm.replace(".myshopify.com", "");

      const normalized = normalizeShopifyOrder(order, {
        shop: shopNorm,
        connectionId,
        shopName,
      });
      normalized.syncedAt = new Date().toISOString();
      const orderData = stripUndefined(shopifyOrderToFirestoreDoc(normalized)) as Record<string, unknown>;
      await db.collection("users").doc(userId).collection("shopifyOrders").doc(orderId).set(orderData, { merge: true });
      console.log("[Shopify webhooks] orders saved", { shop: shopNorm, orderId, userId });

      // Backup Shopify → PrepCorex qty sync when inventory_levels webhook is missing/late.
      const lineItems = Array.isArray(order.line_items)
        ? (order.line_items as Array<Record<string, unknown>>)
        : [];
      const variantIds = lineItems
        .map((li) => (li.variant_id != null ? String(li.variant_id) : ""))
        .filter(Boolean);
      if (variantIds.length > 0 && !connSnap.empty) {
        try {
          const accessToken = await getValidShopifyAccessToken(
            connSnap.docs[0].ref,
            connSnap.docs[0].data(),
            shopNorm
          );
          const pull = await pullShopifyVariantQuantities({
            db,
            userId,
            shop: shopNorm,
            accessToken,
            variantIds,
          });
          console.log("[Shopify webhooks] orders qty pull", {
            shop: shopNorm,
            orderId,
            updated: pull.updated,
          });
        } catch (e) {
          console.warn("[Shopify webhooks] orders qty pull failed", e);
        }
      }
    } catch (err: unknown) {
      console.error("[Shopify webhooks orders]", err);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  if (topic === "products/update") {
    const raw = payload as Record<string, unknown>;
    const product = (raw?.product as Record<string, unknown>) ?? raw;
    const productId = product?.id != null ? String(product.id) : null;
    const title = typeof product?.title === "string" ? product.title.trim() : null;
    if (!productId) {
      console.warn("[Shopify webhooks] products/update missing product id", { shop: shopNorm });
      return NextResponse.json({ received: true });
    }
    try {
      const db = adminDb();
      const productLookupRef = db.collection("shopifyProductLookup");
      const plId = `${shopNorm.replace(/\./g, "_")}_${productId}`;
      const plSnap = await productLookupRef.doc(plId).get();
      if (!plSnap.exists) {
        console.log("[Shopify webhooks] products/update no product lookup", { shop: shopNorm, productId });
        return NextResponse.json({ received: true });
      }
      const pl = plSnap.data()!;
      const paths = (pl.paths as string[]) || [];
      const userId = typeof pl.userId === "string" ? pl.userId : "";

      if (title) {
        for (const path of paths) {
          try {
            await db.doc(path).update({ productName: title });
          } catch (e) {
            console.warn("[Shopify webhooks] products/update could not update title", path, e);
          }
        }
      }

      // Also pull live variant qtys when Shopify sends inventory on the product payload.
      const variants = Array.isArray(product.variants)
        ? (product.variants as Array<Record<string, unknown>>)
        : [];
      const variantIds = variants
        .map((v) => (v.id != null ? String(v.id) : ""))
        .filter(Boolean);
      if (userId && variantIds.length > 0) {
        const connSnap = await db
          .collection("users")
          .doc(userId)
          .collection("shopifyConnections")
          .where("shop", "==", shopNorm)
          .limit(1)
          .get();
        if (!connSnap.empty) {
          try {
            const accessToken = await getValidShopifyAccessToken(
              connSnap.docs[0].ref,
              connSnap.docs[0].data(),
              shopNorm
            );
            await pullShopifyVariantQuantities({
              db,
              userId,
              shop: shopNorm,
              accessToken,
              variantIds,
            });
          } catch (e) {
            console.warn("[Shopify webhooks] products/update qty pull failed", e);
          }
        }
      }

      console.log("[Shopify webhooks] products/update OK", {
        shop: shopNorm,
        productId,
        title,
        updated: paths.length,
      });
    } catch (err: unknown) {
      console.error("[Shopify webhooks products/update]", err);
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
