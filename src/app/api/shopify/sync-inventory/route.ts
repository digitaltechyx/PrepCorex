import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * POST: Set inventory quantity on Shopify for a variant (PrepCorex → Shopify).
 * Body: { userId, shop, shopifyVariantId, shopifyInventoryItemId?, newQuantity }
 * Requires Bearer token (admin or the user). Shopify app needs write_inventory scope.
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
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    isAdmin = (userDoc.data()?.role as string) === "admin";
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = (body.userId as string)?.trim() || callerUid;
  const shop = (body.shop as string)?.trim();
  const shopifyVariantId = body.shopifyVariantId as string | undefined;
  const shopifyInventoryItemId = body.shopifyInventoryItemId as string | undefined;
  const newQuantity = typeof body.newQuantity === "number" ? Math.max(0, Math.floor(body.newQuantity)) : undefined;

  if (!shop || !shopifyVariantId || newQuantity === undefined) {
    return NextResponse.json(
      { error: "Missing shop, shopifyVariantId, or newQuantity" },
      { status: 400 }
    );
  }
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let shopNorm = shop.toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }

  try {
    const db = adminDb();
    const connSnap = await db
      .collection("users")
      .doc(userId)
      .collection("shopifyConnections")
      .where("shop", "==", shopNorm)
      .limit(1)
      .get();

    if (connSnap.empty) {
      return NextResponse.json({ error: "Store not connected" }, { status: 404 });
    }
    const accessToken = connSnap.docs[0].data().accessToken as string;

    let inventoryItemId = shopifyInventoryItemId;
    if (!inventoryItemId) {
      const variantRes = await fetch(
        `https://${shopNorm}/admin/api/2025-04/variants/${shopifyVariantId}.json`,
        {
          headers: {
            "X-Shopify-Access-Token": accessToken,
            "Content-Type": "application/json",
          },
        }
      );
      if (!variantRes.ok) {
        return NextResponse.json({ error: "Could not get variant from Shopify" }, { status: 502 });
      }
      const variantData = (await variantRes.json()) as { variant?: { inventory_item_id?: number } };
      inventoryItemId = variantData.variant?.inventory_item_id != null
        ? String(variantData.variant.inventory_item_id)
        : undefined;
    }
    if (!inventoryItemId) {
      return NextResponse.json({ error: "Variant has no inventory item" }, { status: 400 });
    }

    const locRes = await fetch(
      `https://${shopNorm}/admin/api/2025-04/locations.json?limit=250`,
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    if (!locRes.ok) {
      const errBody = await locRes.text();
      const hint = locRes.status === 403
        ? " Add read_locations scope in your Shopify app and re-connect the store."
        : "";
      return NextResponse.json(
        { error: `Could not get location from Shopify (${locRes.status})${hint}` },
        { status: 502 }
      );
    }
    const locData = (await locRes.json()) as { locations?: { id: number }[] };
    const locations = locData.locations ?? [];
    if (locations.length === 0) {
      return NextResponse.json({ error: "No location on store" }, { status: 400 });
    }

    // Set primary (first) location to newQuantity; set all other locations to 0
    // so total inventory in Shopify matches PrepCorex (avoids e.g. 60 + 50 = 110).
    const headers = {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
    };
    for (let i = 0; i < locations.length; i++) {
      const locationId = locations[i].id;
      const available = i === 0 ? newQuantity : 0;
      const setRes = await fetch(
        `https://${shopNorm}/admin/api/2025-04/inventory_levels/set.json`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            location_id: locationId,
            inventory_item_id: Number(inventoryItemId),
            available,
          }),
        }
      );
      if (!setRes.ok) {
        const errText = await setRes.text();
        console.error("[Shopify sync-inventory]", setRes.status, errText);
        return NextResponse.json(
          { error: "Shopify rejected inventory update. Ensure app has write_inventory scope." },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({ success: true, available: newQuantity });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[shopify/sync-inventory]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
