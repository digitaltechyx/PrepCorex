import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  EtsyReconnectRequired,
  getValidEtsyAccessToken,
} from "@/lib/etsy-access-token";
import {
  etsyApiRequest,
  type EtsyListingInventory,
  type EtsyListingInventoryProduct,
} from "@/lib/etsy-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function moneyToNumber(price: unknown): number | undefined {
  if (typeof price === "number" && Number.isFinite(price)) return price;
  if (price && typeof price === "object") {
    const amount = Number((price as { amount?: number }).amount);
    const divisor = Math.max(1, Number((price as { divisor?: number }).divisor ?? 100));
    if (Number.isFinite(amount)) return amount / divisor;
  }
  return undefined;
}

/**
 * POST: Push PrepCorex quantity to an Etsy listing inventory.
 * Body: { connectionId, listingId|productId|etsyListingId, quantity|newQuantity, userId? }
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
    const data = userDoc.data();
    const role = data?.role as string;
    const roles = data?.roles as string[] | undefined;
    isAdmin =
      role === "admin" ||
      role === "sub_admin" ||
      (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId =
    typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : callerUid;
  const connectionId =
    (typeof body.connectionId === "string" && body.connectionId.trim()) ||
    (typeof body.etsyConnectionId === "string" && body.etsyConnectionId.trim()) ||
    "";
  const listingId =
    (typeof body.listingId === "string" && body.listingId.trim()) ||
    (typeof body.productId === "string" && body.productId.trim()) ||
    (typeof body.etsyListingId === "string" && body.etsyListingId.trim()) ||
    "";
  const quantityRaw =
    typeof body.quantity === "number"
      ? body.quantity
      : typeof body.newQuantity === "number"
        ? body.newQuantity
        : undefined;
  const quantity =
    typeof quantityRaw === "number" ? Math.max(0, Math.floor(quantityRaw)) : undefined;

  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if ((!connectionId && !body.etsyShopId) || !listingId || quantity === undefined) {
    return NextResponse.json(
      { error: "Missing connectionId, listingId, or quantity" },
      { status: 400 }
    );
  }

  try {
    const db = adminDb();
    let ref = connectionId
      ? db.collection("users").doc(userId).collection("etsyConnections").doc(connectionId)
      : null;
    let snap = ref ? await ref.get() : null;

    if ((!snap || !snap.exists) && typeof body.etsyShopId === "string" && body.etsyShopId.trim()) {
      const shopId = body.etsyShopId.trim();
      const list = await db.collection("users").doc(userId).collection("etsyConnections").get();
      const match = list.docs.find((d) => String(d.data()?.shopId ?? "") === shopId);
      if (match) {
        ref = match.ref;
        snap = match;
      }
    }

    if (!ref || !snap?.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const accessToken = await getValidEtsyAccessToken(ref, data);

    const inventory = await etsyApiRequest<EtsyListingInventory>({
      path: `/listings/${encodeURIComponent(listingId)}/inventory`,
      accessToken,
    });

    const products = (inventory.products ?? []).filter((p) => !p.is_deleted);
    if (!products.length) {
      return NextResponse.json(
        { error: "Etsy listing has no inventory products to update" },
        { status: 400 }
      );
    }

    const updatedProducts: EtsyListingInventoryProduct[] = products.map((product) => {
      const offerings = (product.offerings ?? []).map((offering) => {
        const priceNum = moneyToNumber(offering.price as never);
        const next: Record<string, unknown> = {
          quantity,
          is_enabled: offering.is_enabled !== false,
        };
        if (priceNum != null) next.price = priceNum;
        if (typeof offering.readiness_state_id === "number") {
          next.readiness_state_id = offering.readiness_state_id;
        }
        return next;
      });
      return {
        sku: product.sku || undefined,
        property_values: product.property_values ?? [],
        offerings,
      };
    });

    const putBody: Record<string, unknown> = { products: updatedProducts };
    if (Array.isArray(inventory.price_on_property) && inventory.price_on_property.length) {
      putBody.price_on_property = inventory.price_on_property;
    }
    if (Array.isArray(inventory.quantity_on_property) && inventory.quantity_on_property.length) {
      putBody.quantity_on_property = inventory.quantity_on_property;
    }
    if (Array.isArray(inventory.sku_on_property) && inventory.sku_on_property.length) {
      putBody.sku_on_property = inventory.sku_on_property;
    }

    await etsyApiRequest({
      method: "PUT",
      path: `/listings/${encodeURIComponent(listingId)}/inventory`,
      accessToken,
      body: putBody,
    });

    return NextResponse.json({ ok: true, listingId, quantity });
  } catch (err: unknown) {
    if (err instanceof EtsyReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[etsy/sync-inventory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to sync Etsy inventory" },
      { status: 500 }
    );
  }
}
