import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";
import {
  getValidTikTokAccessToken,
  TikTokReconnectRequired,
} from "@/lib/tiktok-access-token";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type TikTokPackage = {
  id?: string;
  package_id?: string;
  status?: string;
};

type TikTokLineItem = {
  id?: string;
  order_line_item_id?: string;
  package_id?: string;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function extractLineItemIds(orderLike: unknown): string[] {
  const order = asRecord(orderLike);
  if (!order) return [];
  const buckets = [order.line_items, order.item_list, order.order_line_items, order.sku_list];
  const ids: string[] = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const raw of bucket) {
      const li = asRecord(raw) as TikTokLineItem | null;
      if (!li) continue;
      const id = String(li.id || li.order_line_item_id || "").trim();
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function extractPackageIdFromOrder(orderLike: unknown): string {
  const order = asRecord(orderLike);
  if (!order) return "";
  const packages = order.package_list || order.packages;
  if (Array.isArray(packages) && packages[0]) {
    const p = asRecord(packages[0]);
    const id = String(p?.id || p?.package_id || "").trim();
    if (id) return id;
  }
  for (const bucket of [order.line_items, order.item_list]) {
    if (!Array.isArray(bucket)) continue;
    for (const raw of bucket) {
      const li = asRecord(raw);
      const id = String(li?.package_id || "").trim();
      if (id) return id;
    }
  }
  return "";
}

/**
 * POST: Mark a TikTok order as shipped with tracking (admin-only).
 * Body: {
 *   connectionId, orderId, trackingNumber,
 *   userId?, shippingProviderId?, packageId?, orderLineItemIds?
 * }
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
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  if (!isAdmin) {
    return NextResponse.json(
      { error: "Only admins can mark TikTok orders as shipped." },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const userId = (typeof body.userId === "string" && body.userId.trim()) || callerUid;
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const trackingNumber =
    typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : "";
  let packageId = typeof body.packageId === "string" ? body.packageId.trim() : "";
  let shippingProviderId =
    typeof body.shippingProviderId === "string" ? body.shippingProviderId.trim() : "";
  const clientLineItemIds = Array.isArray(body.orderLineItemIds)
    ? body.orderLineItemIds
        .map((v: unknown) => String(v || "").trim())
        .filter(Boolean)
    : [];

  if (!connectionId || !orderId || !trackingNumber) {
    return NextResponse.json(
      { error: "Missing connectionId, orderId, or trackingNumber" },
      { status: 400 }
    );
  }
  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const db = adminDb();
    const ref = db.collection("users").doc(userId).collection("tiktokConnections").doc(connectionId);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const data = snap.data()!;
    const accessToken = await getValidTikTokAccessToken(ref, data);
    const shopCipher = (data.shopCipher as string) || null;

    const pickPackageId = (packages?: TikTokPackage[]) => {
      const first = packages?.[0];
      return String(first?.id || first?.package_id || "");
    };

    const searchPackages = async (): Promise<{ packageId: string; errorDetail?: string }> => {
      const attempts: Array<Record<string, unknown>> = [
        { order_id: orderId },
        { order_ids: [orderId] },
      ];
      let lastDetail = "";
      for (const searchBody of attempts) {
        const pkgRes = await tikTokApiRequest<{ packages?: TikTokPackage[] }>({
          method: "POST",
          path: "/fulfillment/202309/packages/search",
          accessToken,
          shopCipher,
          query: { page_size: 50 },
          body: searchBody,
        });
        if (pkgRes.code !== 0) {
          lastDetail = parseTikTokError(pkgRes);
          continue;
        }
        const id = pickPackageId(pkgRes.data?.packages);
        if (id) return { packageId: id };
      }
      return { packageId: "", errorDetail: lastDetail || undefined };
    };

    const loadOrderDetail = async (): Promise<{
      lineItemIds: string[];
      packageIdFromOrder: string;
      detailError?: string;
    }> => {
      const detailAttempts: Array<{ path: string; body?: Record<string, unknown>; method?: "GET" | "POST" }> = [
        {
          method: "POST",
          path: "/order/202309/orders/detail",
          body: { order_id_list: [orderId] },
        },
        {
          method: "POST",
          path: "/order/202309/orders/detail",
          body: { ids: [orderId] },
        },
        {
          method: "GET",
          path: `/order/202309/orders/${encodeURIComponent(orderId)}`,
        },
      ];

      let lastDetail = "";
      for (const attempt of detailAttempts) {
        const detail = await tikTokApiRequest<Record<string, unknown>>({
          method: attempt.method ?? "POST",
          path: attempt.path,
          accessToken,
          shopCipher,
          body: attempt.body ?? null,
        });
        if (detail.code !== 0) {
          lastDetail = parseTikTokError(detail);
          continue;
        }
        const payload = detail.data ?? {};
        const orders = Array.isArray(payload.orders)
          ? payload.orders
          : payload.order
            ? [payload.order]
            : [payload];
        const order = orders[0];
        const lineItemIds = extractLineItemIds(order);
        const packageIdFromOrder = extractPackageIdFromOrder(order);
        if (lineItemIds.length || packageIdFromOrder) {
          return { lineItemIds, packageIdFromOrder };
        }
        // Keep looping — maybe another endpoint shape has items
        lastDetail = "Order detail returned without line items.";
      }
      return { lineItemIds: [], packageIdFromOrder: "", detailError: lastDetail };
    };

    const createPackage = async (
      lineItemIds: string[]
    ): Promise<{ packageId: string; detail?: string }> => {
      const createAttempts: Array<{ path: string; body: Record<string, unknown> }> = [];
      if (lineItemIds.length) {
        createAttempts.push(
          {
            path: "/fulfillment/202309/packages",
            body: { order_id: orderId, order_line_item_ids: lineItemIds },
          },
          {
            path: "/fulfillment/202309/packages",
            body: {
              packages: [{ order_id: orderId, order_line_item_ids: lineItemIds }],
            },
          }
        );
      }
      // Some markets accept order_id alone
      createAttempts.push({
        path: "/fulfillment/202309/packages",
        body: { order_id: orderId },
      });

      let lastDetail = "";
      for (const attempt of createAttempts) {
        const created = await tikTokApiRequest<{
          package_id?: string;
          id?: string;
          packages?: TikTokPackage[];
        }>({
          method: "POST",
          path: attempt.path,
          accessToken,
          shopCipher,
          body: attempt.body,
        });
        if (created.code !== 0) {
          lastDetail = parseTikTokError(created);
          continue;
        }
        const id =
          String(created.data?.package_id || created.data?.id || "") ||
          pickPackageId(created.data?.packages);
        if (id) return { packageId: id };
      }
      return { packageId: "", detail: lastDetail || "Create package returned no package id." };
    };

    if (!shippingProviderId) {
      const providersRes = await tikTokApiRequest<{
        shipping_providers?: Array<{ id?: string; name?: string }>;
        delivery_options?: Array<{
          shipping_provider_list?: Array<{ id?: string; name?: string }>;
        }>;
      }>({
        method: "GET",
        path: "/logistics/202309/shipping_providers",
        accessToken,
        shopCipher,
      });
      if (providersRes.code === 0) {
        const fromList = providersRes.data?.shipping_providers?.[0];
        const fromOptions =
          providersRes.data?.delivery_options?.[0]?.shipping_provider_list?.[0];
        shippingProviderId = String(fromList?.id || fromOptions?.id || "");
      }
    }

    // Preferred seller-fulfill path: update shipping info on the order (no package required)
    const orderShipAttempts: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/shipping_info/update`,
        body: {
          tracking_number: trackingNumber,
          ...(shippingProviderId ? { shipping_provider_id: shippingProviderId } : {}),
        },
      },
      {
        path: `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/packages`,
        body: {
          tracking_number: trackingNumber,
          ...(shippingProviderId ? { shipping_provider_id: shippingProviderId } : {}),
          ...(clientLineItemIds.length ? { order_line_item_ids: clientLineItemIds } : {}),
        },
      },
    ];

    for (const attempt of orderShipAttempts) {
      const res = await tikTokApiRequest({
        method: "POST",
        path: attempt.path,
        accessToken,
        shopCipher,
        body: attempt.body,
      });
      if (res.code === 0) {
        return NextResponse.json({
          ok: true,
          mode: "order_shipping_info",
          packageId: null,
          trackingNumber,
          shippingProviderId: shippingProviderId || null,
        });
      }
    }

    // Fallback: package search → create → ship package
    if (!packageId) {
      const searched = await searchPackages();
      if (searched.errorDetail && /access denied|scope/i.test(searched.errorDetail)) {
        return NextResponse.json(
          {
            error: "Failed to load packages for order",
            detail: `${searched.errorDetail} Enable Fulfillment Basic and Package Write in Partner Center → Manage API, approve, then Disconnect and Connect TikTok again.`,
          },
          { status: 502 }
        );
      }
      packageId = searched.packageId;
    }

    let lineItemIds = [...clientLineItemIds];
    if (!packageId || !lineItemIds.length) {
      const loaded = await loadOrderDetail();
      if (!packageId) packageId = loaded.packageIdFromOrder;
      if (!lineItemIds.length) lineItemIds = loaded.lineItemIds;
    }

    if (!packageId) {
      const created = await createPackage(lineItemIds);
      packageId = created.packageId;
      if (!packageId) {
        const again = await searchPackages();
        packageId = again.packageId;
      }
      if (!packageId) {
        return NextResponse.json(
          {
            error: "Could not mark this TikTok order as shipped",
            detail:
              lineItemIds.length === 0
                ? "TikTok did not return line items for packaging, and order-level shipping update also failed. Confirm the order is AWAITING_SHIPMENT and fulfillment scopes are approved, then reconnect TikTok."
                : created.detail ||
                  "Package create failed. Check fulfillment scopes and reconnect TikTok.",
          },
          { status: 502 }
        );
      }
    }

    const shipBody: Record<string, unknown> = {
      tracking_number: trackingNumber,
    };
    if (shippingProviderId) {
      shipBody.shipping_provider_id = shippingProviderId;
    }

    const shipRes = await tikTokApiRequest({
      method: "POST",
      path: `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_info/update`,
      accessToken,
      shopCipher,
      body: shipBody,
    });

    if (shipRes.code !== 0) {
      const altAttempts = [
        {
          path: "/fulfillment/202309/packages/ship",
          body: {
            package_id: packageId,
            tracking_number: trackingNumber,
            ...(shippingProviderId ? { shipping_provider_id: shippingProviderId } : {}),
          },
        },
        {
          path: `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/ship`,
          body: {
            tracking_number: trackingNumber,
            ...(shippingProviderId ? { shipping_provider_id: shippingProviderId } : {}),
          },
        },
      ] as const;

      let lastAlt = "";
      let shipped = false;
      for (const attempt of altAttempts) {
        const alt = await tikTokApiRequest({
          method: "POST",
          path: attempt.path,
          accessToken,
          shopCipher,
          body: attempt.body,
        });
        if (alt.code === 0) {
          shipped = true;
          break;
        }
        lastAlt = parseTikTokError(alt);
      }
      if (!shipped) {
        return NextResponse.json(
          {
            error: "Failed to update delivery status",
            detail: parseTikTokError(shipRes),
            altDetail: lastAlt || undefined,
            packageId,
          },
          { status: 502 }
        );
      }
    }

    return NextResponse.json({
      ok: true,
      mode: "package_shipping_info",
      packageId,
      trackingNumber,
      shippingProviderId: shippingProviderId || null,
    });
  } catch (err: unknown) {
    if (err instanceof TikTokReconnectRequired) {
      return NextResponse.json({ error: err.message, reconnect: true }, { status: 401 });
    }
    console.error("[tiktok/fulfill]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
