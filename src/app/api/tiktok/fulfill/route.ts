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
  package_status?: string;
};

/**
 * POST: Mark a TikTok order as shipped with tracking (admin-only).
 * Body: { connectionId, orderId, trackingNumber, userId?, shippingProviderId?, packageId? }
 *
 * Flow (OMS-style):
 * 1) Find existing package for the order
 * 2) If none, create a package from order line items
 * 3) Upload tracking / mark shipped
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
      // Try both body shapes TikTok has used across markets/versions
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

    const getOrderLineItemIds = async (): Promise<{
      lineItemIds: string[];
      packageIdFromOrder: string;
    }> => {
      const detail = await tikTokApiRequest<{
        orders?: Array<{
          id?: string;
          line_items?: TikTokLineItem[];
          package_list?: TikTokPackage[];
          packages?: TikTokPackage[];
        }>;
      }>({
        method: "POST",
        path: "/order/202309/orders/detail",
        accessToken,
        shopCipher,
        body: { order_id_list: [orderId] },
      });

      if (detail.code !== 0 || !detail.data?.orders?.length) {
        return { lineItemIds: [], packageIdFromOrder: "" };
      }
      const order = detail.data.orders[0];
      const fromPackages = pickPackageId(order.package_list || order.packages);
      const fromLines =
        order.line_items?.map((li) => String(li.package_id || "")).find((id) => id) || "";
      const lineItemIds = (order.line_items ?? [])
        .map((li) => String(li.id || li.order_line_item_id || ""))
        .filter(Boolean);
      return {
        lineItemIds,
        packageIdFromOrder: fromPackages || fromLines,
      };
    };

    const createPackage = async (lineItemIds: string[]): Promise<{ packageId: string; detail?: string }> => {
      if (!lineItemIds.length) {
        return { packageId: "", detail: "Order has no line items to package." };
      }

      const createAttempts: Array<{ path: string; body: Record<string, unknown> }> = [
        {
          path: "/fulfillment/202309/packages",
          body: { order_id: orderId, order_line_item_ids: lineItemIds },
        },
        {
          path: "/fulfillment/202309/packages",
          body: {
            packages: [{ order_id: orderId, order_line_item_ids: lineItemIds }],
          },
        },
      ];

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

    if (!packageId) {
      const { lineItemIds, packageIdFromOrder } = await getOrderLineItemIds();
      packageId = packageIdFromOrder;
      if (!packageId) {
        const created = await createPackage(lineItemIds);
        packageId = created.packageId;
        if (!packageId) {
          // One more search in case create succeeded but id was only on search
          const again = await searchPackages();
          packageId = again.packageId;
        }
        if (!packageId) {
          return NextResponse.json(
            {
              error: "Could not create a TikTok package for this order",
              detail:
                created.detail ||
                "TikTok requires a package before tracking can be uploaded. Check fulfillment scopes and that the order is AWAITING_SHIPMENT.",
            },
            { status: 502 }
          );
        }
      }
    }

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
