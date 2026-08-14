import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";
import { getShopifyAccessTokenForUserShop } from "@/lib/shopify-access-token";
import {
  executeShopifyQuickFulfill,
  type QuickFulfillLineInput,
} from "@/lib/shopify-quick-fulfill";

export const dynamic = "force-dynamic";

/**
 * POST: Quick-fulfill a Shopify order from warehouse inventory.
 * Body: {
 *   userId, shop, orderId, orderName?, orderNumber?,
 *   lines: [{ shopifyLineItemId, inventoryId, quantity }],
 *   tracking_number?, tracking_company?, notify_customer?
 * }
 * Admin / sub_admin only. Deducts warehouse stock, creates shipped entry,
 * fulfills on Shopify with tracking. Idempotent per shop+order.
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
  let callerName = "Admin";
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    const data = userDoc.data();
    const role = data?.role as string;
    const roles = data?.roles as string[] | undefined;
    const isAdmin =
      role === "admin" ||
      role === "sub_admin" ||
      (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    callerName = String(data?.name || data?.email || "Admin");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const shop = String(body.shop || "").trim();
  const orderId = String(body.orderId || "").trim();
  const orderName =
    typeof body.orderName === "string" ? body.orderName.trim() : undefined;
  const shipTo = typeof body.shipTo === "string" ? body.shipTo.trim() : undefined;
  const orderNumber =
    typeof body.orderNumber === "number"
      ? body.orderNumber
      : Number.isFinite(Number(body.orderNumber))
        ? Number(body.orderNumber)
        : undefined;
  const trackingNumber =
    typeof body.tracking_number === "string" ? body.tracking_number.trim() : undefined;
  const trackingCompany =
    typeof body.tracking_company === "string" ? body.tracking_company.trim() : undefined;
  const notifyCustomer = body.notify_customer === true;
  const labelPriceRaw = Number(body.label_price ?? body.labelPrice);
  const labelPrice = Number.isFinite(labelPriceRaw) ? labelPriceRaw : undefined;
  const labelPurchaseId =
    typeof body.label_purchase_id === "string"
      ? body.label_purchase_id.trim()
      : typeof body.labelPurchaseId === "string"
        ? body.labelPurchaseId.trim()
        : undefined;

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: QuickFulfillLineInput[] = rawLines.map((line: Record<string, unknown>) => ({
    shopifyLineItemId: String(line.shopifyLineItemId || line.lineItemId || "").trim(),
    inventoryId: String(line.inventoryId || "").trim(),
    quantity: Math.floor(Number(line.quantity) || 0),
    shopifyLineTitle:
      typeof line.shopifyLineTitle === "string"
        ? line.shopifyLineTitle.trim()
        : typeof line.title === "string"
          ? line.title.trim()
          : undefined,
    shopifyLineSku:
      typeof line.shopifyLineSku === "string"
        ? line.shopifyLineSku.trim()
        : typeof line.sku === "string"
          ? line.sku.trim()
          : undefined,
  }));

  if (!userId || !shop || !orderId) {
    return NextResponse.json(
      { error: "Missing userId, shop, or orderId" },
      { status: 400 }
    );
  }

  try {
    const db = adminDb();
    const result = await executeShopifyQuickFulfill({
      db,
      ownerUserId: userId,
      shop,
      orderId,
      orderName,
      orderNumber,
      shipTo,
      lines,
      trackingNumber,
      trackingCompany,
      notifyCustomer,
      fulfilledBy: callerName,
      labelPrice,
      labelPurchaseId,
    });

    const syncErrors: string[] = [];
    for (const hint of result.shopifySyncHints) {
      try {
        await syncShopifyAbsoluteQty({
          db,
          userId,
          shop: hint.shop,
          shopifyVariantId: hint.shopifyVariantId,
          shopifyInventoryItemId: hint.shopifyInventoryItemId,
          newQuantity: hint.newQuantity,
        });
      } catch (err) {
        syncErrors.push(
          err instanceof Error ? err.message : "Shopify inventory sync failed"
        );
      }
    }

    return NextResponse.json({
      success: true,
      shippedId: result.shippedId,
      alreadyProcessed: result.alreadyProcessed,
      warehouseDeducted: result.warehouseDeducted,
      warehouseShortfall: result.warehouseShortfall,
      syncErrors: syncErrors.length ? syncErrors : undefined,
    });
  } catch (err: unknown) {
    console.error("[shopify/quick-fulfill]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

async function syncShopifyAbsoluteQty(input: {
  db: Firestore;
  userId: string;
  shop: string;
  shopifyVariantId: string;
  shopifyInventoryItemId?: string;
  newQuantity: number;
}) {
  let shopNorm = input.shop.toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }
  const accessToken = await getShopifyAccessTokenForUserShop(input.db, input.userId, shopNorm);

  let inventoryItemId = input.shopifyInventoryItemId;
  if (!inventoryItemId) {
    const variantRes = await fetch(
      shopifyAdminRestUrl(shopNorm, `/variants/${input.shopifyVariantId}.json`),
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    if (!variantRes.ok) throw new Error("Could not get variant from Shopify");
    const variantData = (await variantRes.json()) as {
      variant?: { inventory_item_id?: number };
    };
    inventoryItemId =
      variantData.variant?.inventory_item_id != null
        ? String(variantData.variant.inventory_item_id)
        : undefined;
  }
  if (!inventoryItemId) throw new Error("Variant has no inventory item");

  const locRes = await fetch(`${shopifyAdminRestUrl(shopNorm, "/locations.json")}?limit=250`, {
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!locRes.ok) throw new Error(`Could not get Shopify locations (${locRes.status})`);
  const locData = (await locRes.json()) as { locations?: { id: number }[] };
  const locations = locData.locations ?? [];
  if (locations.length === 0) throw new Error("No location on store");

  const headers = {
    "X-Shopify-Access-Token": accessToken,
    "Content-Type": "application/json",
  };
  for (let i = 0; i < locations.length; i++) {
    const available = i === 0 ? Math.max(0, Math.floor(input.newQuantity)) : 0;
    const setRes = await fetch(shopifyAdminRestUrl(shopNorm, "/inventory_levels/set.json"), {
      method: "POST",
      headers,
      body: JSON.stringify({
        location_id: locations[i].id,
        inventory_item_id: Number(inventoryItemId),
        available,
      }),
    });
    if (!setRes.ok) {
      const text = await setRes.text();
      throw new Error(`Shopify inventory set failed (${setRes.status}): ${text.slice(0, 160)}`);
    }
  }
}
