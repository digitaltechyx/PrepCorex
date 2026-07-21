import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { syncShipStationOrdersForConnection } from "@/lib/shipstation-sync";

export const dynamic = "force-dynamic";

type ShipStationOrderDoc = {
  id: string;
  connectionId?: string;
  hasPurchasedLabel?: boolean;
  modifyDate?: string;
  syncedAt?: string;
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

/** GET: list synced ShipStation orders. Query: userId (admin), connectionId, labeledOnly. */
export async function GET(request: NextRequest) {
  try {
    const { callerUid, isAdmin } = await resolveCaller(request);
    const uid = request.nextUrl.searchParams.get("userId")?.trim() || callerUid;
    if (uid !== callerUid && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
    const labeledOnly = request.nextUrl.searchParams.get("labeledOnly") === "1";

    const snapshot = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("shipstationOrders")
      .limit(500)
      .get();

    let orders: ShipStationOrderDoc[] = snapshot.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<ShipStationOrderDoc, "id">),
    }));
    if (connectionId) {
      orders = orders.filter((o) => o.connectionId === connectionId);
    }
    if (labeledOnly) {
      orders = orders.filter((o) => Boolean(o.hasPurchasedLabel));
    }

    orders.sort((a, b) => {
      const aDate = String(a.modifyDate || a.syncedAt || "");
      const bDate = String(b.modifyDate || b.syncedAt || "");
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

/** POST: sync orders (+ purchased labels). Body/query: userId (admin), connectionId. */
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

    const col = adminDb().collection("users").doc(uid).collection("shipstationConnections");
    let connDoc;
    if (connectionId) {
      connDoc = await col.doc(connectionId).get();
      if (!connDoc.exists) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 });
      }
    } else {
      const snap = await col.limit(1).get();
      if (snap.empty) {
        return NextResponse.json({ error: "No ShipStation connection" }, { status: 400 });
      }
      connDoc = snap.docs[0];
    }

    const data = connDoc.data() || {};
    const apiKey = String(data.apiKey || "").trim();
    const apiSecret = String(data.apiSecret || "").trim();
    if (!apiKey || !apiSecret) {
      return NextResponse.json({ error: "ShipStation credentials missing" }, { status: 400 });
    }

    const result = await syncShipStationOrdersForConnection({
      userId: uid,
      connectionId: connDoc.id,
      creds: { apiKey, apiSecret },
    });

    return NextResponse.json({ ok: true, ...result, connectionId: connDoc.id, userId: uid });
  } catch (error: unknown) {
    console.error("[shipstation orders sync]", error);
    const status = (error as { status?: number })?.status || 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to sync ShipStation orders",
      },
      { status: status === 401 ? 401 : status === 403 ? 403 : 500 }
    );
  }
}
