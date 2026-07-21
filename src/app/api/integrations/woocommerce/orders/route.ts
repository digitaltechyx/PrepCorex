import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { syncWooCommerceOrdersForConnection } from "@/lib/woocommerce-sync";

export const dynamic = "force-dynamic";

type WooOrderDoc = {
  id: string;
  connectionId?: string;
  dateModified?: string;
  syncedAt?: string;
  status?: string;
  [key: string]: unknown;
};

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

/** GET: list synced WooCommerce orders. Query: userId (admin), connectionId, status. */
export async function GET(request: NextRequest) {
  try {
    const { callerUid, isAdmin } = await resolveCaller(request);
    const uid = request.nextUrl.searchParams.get("userId")?.trim() || callerUid;
    if (uid !== callerUid && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
    const status = request.nextUrl.searchParams.get("status")?.trim();

    const snapshot = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("woocommerceOrders")
      .limit(500)
      .get();

    let orders: WooOrderDoc[] = snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<WooOrderDoc, "id">),
    }));
    if (connectionId) {
      orders = orders.filter((o) => o.connectionId === connectionId);
    }
    if (status) {
      orders = orders.filter((o) => String(o.status || "") === status);
    }

    orders.sort((a, b) => {
      const aDate = String(a.dateModified || a.syncedAt || "");
      const bDate = String(b.dateModified || b.syncedAt || "");
      return bDate.localeCompare(aDate);
    });

    return NextResponse.json({ orders: orders.slice(0, 400) });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load orders" },
      { status: status === 401 ? 401 : status === 403 ? 403 : 500 }
    );
  }
}

/** POST: sync orders from WooCommerce. Body/query: userId (admin), connectionId. */
export async function POST(request: NextRequest) {
  try {
    const { callerUid, isAdmin } = await resolveCaller(request);
    const body = await request.json().catch(() => ({}));
    const uid =
      String(body.userId || request.nextUrl.searchParams.get("userId") || "").trim() || callerUid;
    if (uid !== callerUid && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const connectionId = String(
      body.connectionId || request.nextUrl.searchParams.get("connectionId") || ""
    ).trim();

    const col = adminDb().collection("users").doc(uid).collection("woocommerceConnections");
    let connDoc;
    if (connectionId) {
      connDoc = await col.doc(connectionId).get();
      if (!connDoc.exists) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }
    } else {
      const snap = await col.limit(1).get();
      if (snap.empty) {
        return NextResponse.json({ error: "No WooCommerce connection" }, { status: 400 });
      }
      connDoc = snap.docs[0];
    }

    const data = connDoc.data() || {};
    const storeUrl = String(data.storeUrl || "").trim();
    const consumerKey = String(data.consumerKey || "").trim();
    const consumerSecret = String(data.consumerSecret || "").trim();
    if (!storeUrl || !consumerKey || !consumerSecret) {
      return NextResponse.json({ error: "WooCommerce credentials missing" }, { status: 400 });
    }

    const result = await syncWooCommerceOrdersForConnection({
      userId: uid,
      connectionId: connDoc.id,
      creds: { storeUrl, consumerKey, consumerSecret },
    });

    return NextResponse.json({ ok: true, ...result, connectionId: connDoc.id, userId: uid });
  } catch (error: unknown) {
    console.error("[woocommerce orders sync]", error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync WooCommerce orders",
      },
      { status: status === 401 ? 401 : status === 403 ? 403 : 500 }
    );
  }
}
