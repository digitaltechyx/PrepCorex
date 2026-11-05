import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { syncEbayOrdersForConnection } from "@/lib/ebay-order-sync";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return role === "admin" || role === "sub_admin" || (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
}

/** GET: list eBay orders from Firestore. Query: userId (admin only). Default: caller's orders. */
export async function GET(request: NextRequest) {
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
    isAdmin = isAdminOrSubAdmin(userDoc.data());
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("userId")?.trim() || callerUid;
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  if (uid !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const snapshot = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("ebayOrders")
      .orderBy("creationDate", "desc")
      .limit(200)
      .get();

    let orders = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (connectionId) {
      orders = orders.filter((o) => (o as { connectionId?: string }).connectionId === connectionId);
    }
    orders.sort((a, b) => {
      const aRaw = String((a as { creationDate?: string }).creationDate || "");
      const bRaw = String((b as { creationDate?: string }).creationDate || "");
      const aMs = aRaw ? Date.parse(aRaw) : 0;
      const bMs = bRaw ? Date.parse(bRaw) : 0;
      return (Number.isNaN(bMs) ? 0 : bMs) - (Number.isNaN(aMs) ? 0 : aMs);
    });
    return NextResponse.json({ orders });
  } catch (err: unknown) {
    console.error("[ebay orders GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** POST: sync eBay orders (getOrders from eBay, filter by selected listings, save to Firestore). Query: userId (admin only). */
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
    isAdmin = isAdminOrSubAdmin(userDoc.data());
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const uid = searchParams.get("userId")?.trim() || callerUid;
  const connectionId = searchParams.get("connectionId")?.trim() || undefined;
  if (uid !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const filter = request.nextUrl.searchParams.get("filter");
  const result = await syncEbayOrdersForConnection({
    uid,
    connectionId,
    filterNotStarted: filter === "not_started",
    maxPages: 20,
    pageSize: 50,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error || "Sync failed" }, { status: 500 });
  }
  return NextResponse.json(result);
}
