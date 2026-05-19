import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { shopifyAdminRestUrl } from "@/lib/shopify-api";

export const dynamic = "force-dynamic";

/**
 * POST: Mark a Shopify order as fulfilled (create fulfillment on Shopify).
 * Body: { userId, shop, orderId, tracking_number?, tracking_company?, notify_customer? }
 * Caller must be admin/sub_admin or the user.
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
    isAdmin = role === "admin" || role === "sub_admin" || (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = (body.userId as string)?.trim();
  const shop = (body.shop as string)?.trim();
  const orderId = (body.orderId as string)?.trim();
  const trackingNumber = typeof body.tracking_number === "string" ? body.tracking_number.trim() : undefined;
  const trackingCompany = typeof body.tracking_company === "string" ? body.tracking_company.trim() : undefined;
  const notifyCustomer = body.notify_customer === true;

  if (!userId || !shop || !orderId) {
    return NextResponse.json(
      { error: "Missing userId, shop, or orderId" },
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

    // Get fulfillment orders for this order
    const foRes = await fetch(
      shopifyAdminRestUrl(shopNorm, `/orders/${orderId}/fulfillment_orders.json`),
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );
    if (!foRes.ok) {
      const errText = await foRes.text();
      console.error("[shopify/fulfill] fulfillment_orders", foRes.status, errText);
      return NextResponse.json(
        { error: "Failed to load fulfillment orders" },
        { status: 502 }
      );
    }
    const foData = (await foRes.json()) as { fulfillment_orders?: Array<{ id: number; status: string; supported_actions?: string[]; line_items?: Array<{ id: number; fulfillable_quantity: number }> }> };
    const fulfillmentOrders = foData.fulfillment_orders ?? [];
    const openOrders = fulfillmentOrders.filter(
      (fo) => (fo.status === "open" || fo.status === "scheduled") && (fo.supported_actions?.includes("create_fulfillment"))
    );
    if (openOrders.length === 0) {
      return NextResponse.json(
        { error: "No fulfillable orders (already fulfilled or not open)" },
        { status: 400 }
      );
    }

    const lineItemsByFulfillmentOrder: Array<{
      fulfillment_order_id: number;
      fulfillment_order_line_items: Array<{ id: number; quantity: number }>;
    }> = [];
    for (const fo of openOrders) {
      const lineItems = fo.line_items ?? [];
      const items = lineItems
        .filter((li) => li.fulfillable_quantity > 0)
        .map((li) => ({ id: li.id, quantity: li.fulfillable_quantity }));
      if (items.length > 0) {
        lineItemsByFulfillmentOrder.push({
          fulfillment_order_id: fo.id,
          fulfillment_order_line_items: items,
        });
      }
    }
    if (lineItemsByFulfillmentOrder.length === 0) {
      return NextResponse.json(
        { error: "No line items to fulfill" },
        { status: 400 }
      );
    }

    const fulfillmentPayload: Record<string, unknown> = {
      line_items_by_fulfillment_order: lineItemsByFulfillmentOrder,
      notify_customer: notifyCustomer,
    };
    if (trackingNumber || trackingCompany) {
      fulfillmentPayload.tracking_info = {
        ...(trackingNumber ? { number: trackingNumber } : {}),
        ...(trackingCompany ? { company: trackingCompany } : {}),
      };
    }

    const createRes = await fetch(
      shopifyAdminRestUrl(shopNorm, "/fulfillments.json"),
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ fulfillment: fulfillmentPayload }),
      }
    );
    if (!createRes.ok) {
      const errText = await createRes.text();
      console.error("[shopify/fulfill] create", createRes.status, errText);
      return NextResponse.json(
        { error: "Shopify fulfillment failed" },
        { status: 502 }
      );
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.error("[shopify/fulfill]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
