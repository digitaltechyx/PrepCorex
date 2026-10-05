import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  veeqoGetOrder,
  veeqoPurchaseLabel,
  type VeeqoShippingRate,
} from "@/lib/veeqo-api";
import { syncVeeqoOrdersForConnection } from "@/lib/veeqo-sync";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return (
    role === "admin" ||
    role === "sub_admin" ||
    (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")))
  );
}

async function resolveCaller(request: NextRequest): Promise<{ callerUid: string; isAdmin: boolean }> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const decoded = await adminAuth().verifyIdToken(token);
  if (!decoded.uid) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const userDoc = await adminDb().collection("users").doc(decoded.uid).get();
  return {
    callerUid: decoded.uid,
    isAdmin: isAdminOrSubAdmin(userDoc.data() as Record<string, unknown> | undefined),
  };
}

/**
 * POST: purchase a Veeqo shipping label for an order allocation.
 * Body: connectionId, orderId, allocationId, rate, carrierId?, serviceOptionValues?, notifyCustomer?
 * Label cost is billed on the linked Veeqo account.
 */
export async function POST(request: NextRequest) {
  try {
    const { callerUid, isAdmin } = await resolveCaller(request);
    const body = await request.json();
    const uid = String(body.userId || "").trim() || callerUid;
    if (uid !== callerUid && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const connectionId = String(body.connectionId || "").trim();
    const orderId = Number(body.orderId);
    const allocationId = Number(body.allocationId);
    const rate = body.rate as VeeqoShippingRate | undefined;

    if (!connectionId || !Number.isFinite(orderId) || !Number.isFinite(allocationId) || !rate) {
      return NextResponse.json(
        { error: "connectionId, orderId, allocationId, and rate are required" },
        { status: 400 }
      );
    }

    const connRef = adminDb()
      .collection("users")
      .doc(uid)
      .collection("veeqoConnections")
      .doc(connectionId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    const apiKey = String(connSnap.data()?.apiKey || "").trim();
    if (!apiKey) {
      return NextResponse.json({ error: "Veeqo credentials missing" }, { status: 400 });
    }

    const creds = { apiKey };
    const shipment = await veeqoPurchaseLabel(creds, {
      allocationId,
      rate,
      carrierId: body.carrierId,
      notifyCustomer: body.notifyCustomer !== false,
      serviceOptionValues:
        body.serviceOptionValues && typeof body.serviceOptionValues === "object"
          ? (body.serviceOptionValues as Record<string, string>)
          : undefined,
    });

    // Refresh local order row from Veeqo
    let refreshed = null;
    try {
      const live = await veeqoGetOrder(creds, orderId);
      const labeledAlloc =
        (Array.isArray(live.allocations) ? live.allocations : []).find(
          (a) => a.id === allocationId
        ) || (Array.isArray(live.allocations) ? live.allocations : [])[0];
      refreshed = {
        hasPurchasedLabel: Boolean(
          labeledAlloc?.shipment?.tracking_number || labeledAlloc?.shipment?.id
        ),
        trackingNumber: labeledAlloc?.shipment?.tracking_number || null,
        carrierCode: labeledAlloc?.shipment?.carrier || rate.service_carrier || rate.carrier || null,
        serviceCode: labeledAlloc?.shipment?.service_type || rate.name || null,
        shipmentId: labeledAlloc?.shipment?.id ?? null,
        labelShipDate: labeledAlloc?.shipment?.shipped_at || new Date().toISOString(),
        orderStatus: live.status || "shipped",
      };
      const docId = `${connectionId}_${orderId}`;
      await adminDb()
        .collection("users")
        .doc(uid)
        .collection("veeqoOrders")
        .doc(docId)
        .set(
          {
            ...refreshed,
            allocationId,
            syncedAt: new Date().toISOString(),
            updatedAt: adminFieldValue().serverTimestamp(),
          },
          { merge: true }
        );
    } catch (refreshErr) {
      console.warn("[veeqo purchase-label] local refresh failed", refreshErr);
      try {
        await syncVeeqoOrdersForConnection({ userId: uid, connectionId, creds });
      } catch {
        /* ignore */
      }
    }

    return NextResponse.json({
      ok: true,
      shipment,
      order: refreshed,
    });
  } catch (error: unknown) {
    console.error("[veeqo purchase-label]", error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to purchase Veeqo label",
      },
      { status: status === 401 ? 401 : status === 403 ? 403 : 500 }
    );
  }
}
