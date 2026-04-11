import { NextRequest, NextResponse } from "next/server";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

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

type AdminIntegrationUserRow = {
  uid: string;
  email: string;
  displayName: string;
  clientId: string;
  shopifyCount: number;
  ebayCount: number;
};

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** GET: users who have ≥1 Shopify or eBay connection (admin / sub_admin only). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const callerDoc = await adminDb().collection("users").doc(callerUid).get();
    if (!isAdminOrSubAdmin(callerDoc.data() as Record<string, unknown> | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const db = adminDb();
    const [shopifySnap, ebaySnap] = await Promise.all([
      db.collectionGroup("shopifyConnections").get(),
      db.collectionGroup("ebayConnections").get(),
    ]);

    const counts = new Map<string, { shopify: number; ebay: number }>();

    const bump = (uid: string, key: "shopify" | "ebay") => {
      const cur = counts.get(uid) ?? { shopify: 0, ebay: 0 };
      cur[key] += 1;
      counts.set(uid, cur);
    };

    for (const d of shopifySnap.docs) {
      const userRef = d.ref.parent.parent;
      if (!userRef || userRef.id === "_") continue;
      bump(userRef.id, "shopify");
    }
    for (const d of ebaySnap.docs) {
      const userRef = d.ref.parent.parent;
      if (!userRef || userRef.id === "_") continue;
      bump(userRef.id, "ebay");
    }

    const uids = [...counts.keys()];
    if (uids.length === 0) {
      return NextResponse.json({
        totalUsersWithIntegrations: 0,
        users: [] as AdminIntegrationUserRow[],
      });
    }

    const refs = uids.map((uid) => db.collection("users").doc(uid));
    const userSnaps: DocumentSnapshot[] = [];
    for (const group of chunk(refs, 10)) {
      const snaps = await db.getAll(...group);
      userSnaps.push(...snaps);
    }

    const users: AdminIntegrationUserRow[] = [];
    for (const snap of userSnaps) {
      if (!snap.exists) continue;
      const uid = snap.id;
      const c = counts.get(uid);
      if (!c) continue;
      const data = snap.data() as Record<string, unknown>;
      const email = String(data.email ?? data.userEmail ?? "");
      const displayName = String(
        data.displayName ?? data.name ?? data.fullName ?? email.split("@")[0] ?? "User"
      );
      const clientId = String(data.clientId ?? "");
      users.push({
        uid,
        email,
        displayName,
        clientId,
        shopifyCount: c.shopify,
        ebayCount: c.ebay,
      });
    }

    users.sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" }));

    return NextResponse.json({
      totalUsersWithIntegrations: users.length,
      users,
    });
  } catch (err: unknown) {
    console.error("[admin/integrations/overview GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
