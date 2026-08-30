import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { parseTikTokError, tikTokApiRequest } from "@/lib/tiktok-api";
import {
  extractOrderDeliveryOption,
  extractOrderFulfillmentSignals,
  extractPackageDeliveryOption,
  isPlatformLogisticsDeliveryOption,
  isSellerShippedDeliveryOption,
  isTikTokNotSellerShippedError,
  isTikTokPlatformShippingOrder,
  loadTikTokOrderDetail,
  loadTikTokPackageDetail,
  resolveTikTokShippingProviderId,
  shipTikTokSellerPackage,
  TIKTOK_PLATFORM_SHIPPING_DETAIL,
} from "@/lib/tiktok-fulfillment";
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
      order: Record<string, unknown> | null;
      lineItemIds: string[];
      packageIdFromOrder: string;
      detailError?: string;
    }> => {
      const loaded = await loadTikTokOrderDetail({ accessToken, shopCipher, orderId });
      if (!loaded.order) {
        return {
          order: null,
          lineItemIds: [],
          packageIdFromOrder: "",
          detailError: loaded.errorDetail,
        };
      }
      return {
        order: loaded.order,
        lineItemIds: extractLineItemIds(loaded.order),
        packageIdFromOrder: extractPackageIdFromOrder(loaded.order),
      };
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

    const orderDetail = await loadOrderDetail();
    const resolvedProvider = await resolveTikTokShippingProviderId({
      accessToken,
      shopCipher,
      orderLike: orderDetail.order,
      preferredProviderId: shippingProviderId,
    });
    shippingProviderId = resolvedProvider.shippingProviderId;

    if (!shippingProviderId) {
      return NextResponse.json(
        {
          error: "Shipping carrier is required",
          detail:
            resolvedProvider.errorDetail ||
            "Select a carrier for this order. TikTok needs shipping_provider_id for seller-fulfilled shipments.",
          providers: resolvedProvider.providers,
          deliveryOptionId: orderDetail.order
            ? String(orderDetail.order.delivery_option_id ?? "")
            : null,
        },
        { status: 400 }
      );
    }

    const orderDelivery = extractOrderDeliveryOption(orderDetail.order);
    if (orderDetail.order && isTikTokPlatformShippingOrder(orderDetail.order)) {
      const signals = extractOrderFulfillmentSignals(orderDetail.order);
      return NextResponse.json(
        {
          error: "This order uses TikTok/platform shipping",
          detail: TIKTOK_PLATFORM_SHIPPING_DETAIL,
          deliveryOption: orderDelivery.name || orderDelivery.id || null,
          shippingType: signals.shippingType || null,
          fulfillmentType: signals.fulfillmentType || null,
        },
        { status: 400 }
      );
    }

    const shipExtras = {
      tracking_number: trackingNumber,
      shipping_provider_id: shippingProviderId,
    };

    // Preferred seller-fulfill path: ship package with self_shipment (TikTok 202309 API).
    const resolvePackageForShip = async (): Promise<{
      packageId: string;
      detail?: string;
      platformPackage?: boolean;
    }> => {
      let candidateId = packageId || orderDetail.packageIdFromOrder;
      if (!candidateId) {
        const searched = await searchPackages();
        if (searched.errorDetail && /access denied|scope/i.test(searched.errorDetail)) {
          return { packageId: "", detail: searched.errorDetail };
        }
        candidateId = searched.packageId;
      }

      let lineItemIds = [...clientLineItemIds];
      if (!lineItemIds.length) lineItemIds = orderDetail.lineItemIds;

      const ensureSellerPackage = async (): Promise<string> => {
        if (candidateId) {
          const loaded = await loadTikTokPackageDetail({
            accessToken,
            shopCipher,
            packageId: candidateId,
          });
          const delivery = extractPackageDeliveryOption(loaded.pkg);
          if (
            loaded.pkg &&
            isPlatformLogisticsDeliveryOption(delivery) &&
            !isSellerShippedDeliveryOption(delivery)
          ) {
            candidateId = "";
          }
        }

        if (candidateId) return candidateId;

        const created = await createPackage(lineItemIds);
        if (created.packageId) return created.packageId;

        const again = await searchPackages();
        return again.packageId;
      };

      const resolvedId = await ensureSellerPackage();
      if (!resolvedId) {
        return {
          packageId: "",
          detail:
            lineItemIds.length === 0
              ? "TikTok did not return line items for packaging."
              : "Could not create or find a seller-shippable package for this order.",
        };
      }

      return { packageId: resolvedId };
    };

    const packageForShip = await resolvePackageForShip();
    let lastShipDetail = packageForShip.detail || "";
    if (packageForShip.detail && /access denied|scope/i.test(packageForShip.detail)) {
      return NextResponse.json(
        {
          error: "Failed to load packages for order",
          detail: `${packageForShip.detail} Enable Fulfillment Basic and Package Write in Partner Center → Manage API, approve, then Disconnect and Connect TikTok again.`,
        },
        { status: 502 }
      );
    }

    if (packageForShip.packageId) {
      const shipped = await shipTikTokSellerPackage({
        accessToken,
        shopCipher,
        packageId: packageForShip.packageId,
        trackingNumber,
        shippingProviderId,
      });
      if (shipped.ok) {
        return NextResponse.json({
          ok: true,
          mode: shipped.mode,
          packageId: packageForShip.packageId,
          trackingNumber,
          shippingProviderId,
        });
      }

      lastShipDetail = shipped.detail;
      packageId = packageForShip.packageId;

      if (isTikTokNotSellerShippedError(shipped.detail)) {
        return NextResponse.json(
          {
            error: "This order uses TikTok/platform shipping",
            detail: TIKTOK_PLATFORM_SHIPPING_DETAIL,
            packageId,
          },
          { status: 400 }
        );
      }
    } else {
      packageId = "";
    }

    // Secondary: order-level shipping update (some markets).
    const orderShipAttempts: Array<{ path: string; body: Record<string, unknown> }> = [
      {
        path: `/fulfillment/202309/orders/${encodeURIComponent(orderId)}/shipping_info/update`,
        body: shipExtras,
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
          packageId: packageId || null,
          trackingNumber,
          shippingProviderId,
        });
      }
      lastShipDetail = parseTikTokError(res);
      if (isTikTokNotSellerShippedError(lastShipDetail)) {
        return NextResponse.json(
          {
            error: "This order uses TikTok/platform shipping",
            detail: TIKTOK_PLATFORM_SHIPPING_DETAIL,
            packageId: packageId || null,
          },
          { status: 400 }
        );
      }
    }

    if (isTikTokNotSellerShippedError(lastShipDetail)) {
      return NextResponse.json(
        {
          error: "This order uses TikTok/platform shipping",
          detail: TIKTOK_PLATFORM_SHIPPING_DETAIL,
          packageId: packageId || null,
        },
        { status: 400 }
      );
    }

    if (!packageId) {
      const resolved = await resolvePackageForShip();
      packageId = resolved.packageId;
      if (!packageId) {
        return NextResponse.json(
          {
            error: "Could not mark this TikTok order as shipped",
            detail:
              lastShipDetail ||
              resolved.detail ||
              "Confirm the order is AWAITING_SHIPMENT, uses seller shipping, and fulfilment scopes are approved.",
          },
          { status: 502 }
        );
      }
    }

    // Last resort for seller packages: update shipping info (provider_id per TikTok SDK).
    const updateAttempts = [
      {
        path: `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_info/update`,
        body: {
          package_id: packageId,
          tracking_number: trackingNumber,
          provider_id: shippingProviderId,
        },
      },
      {
        path: `/fulfillment/202309/packages/${encodeURIComponent(packageId)}/shipping_info/update`,
        body: shipExtras,
      },
    ] as const;

    let lastUpdateDetail = lastShipDetail;
    for (const attempt of updateAttempts) {
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
          mode: "package_shipping_info",
          packageId,
          trackingNumber,
          shippingProviderId,
        });
      }
      lastUpdateDetail = parseTikTokError(res);
      if (isTikTokNotSellerShippedError(lastUpdateDetail)) {
        return NextResponse.json(
          {
            error: "This order uses TikTok/platform shipping",
            detail: TIKTOK_PLATFORM_SHIPPING_DETAIL,
            packageId,
          },
          { status: 400 }
        );
      }
    }

    if (isTikTokNotSellerShippedError(lastUpdateDetail)) {
      return NextResponse.json(
        {
          error: "This order uses TikTok/platform shipping",
          detail: TIKTOK_PLATFORM_SHIPPING_DETAIL,
          packageId,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        error: "Failed to update delivery status",
        detail: lastUpdateDetail || "TikTok rejected all ship attempts for this order.",
        packageId,
      },
      { status: 502 }
    );
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
