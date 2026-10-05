import { NextRequest, NextResponse } from "next/server";
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

/** GET: list Veeqo connections (never returns API key). */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let callerUid: string;
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    isAdmin = isAdminOrSubAdmin(userDoc.data() as Record<string, unknown> | undefined);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const uidParam = request.nextUrl.searchParams.get("userId")?.trim();
  const uid = uidParam && isAdmin ? uidParam : callerUid;
  if (uid !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const snapshot = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("veeqoConnections")
      .get();

    const connections = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        accountLabel: data.accountLabel || "Veeqo",
        connectedAt: data.connectedAt,
        lastSyncedAt: data.lastSyncedAt || null,
        lastSyncOrderCount: data.lastSyncOrderCount ?? null,
        lastSyncLabeledCount: data.lastSyncLabeledCount ?? null,
        lastSyncOpenCount: data.lastSyncOpenCount ?? null,
        apiKeyHint: data.apiKey
          ? `${String(data.apiKey).slice(0, 4)}…${String(data.apiKey).slice(-4)}`
          : null,
      };
    });

    return NextResponse.json({ connections });
  } catch (err: unknown) {
    console.error("[veeqo-connections GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** DELETE: remove connection + synced orders for that connection. */
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing connection id" }, { status: 400 });
  }

  try {
    const connRef = adminDb().collection("users").doc(uid).collection("veeqoConnections").doc(id);
    const connSnap = await connRef.get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }

    const ordersSnap = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("veeqoOrders")
      .where("connectionId", "==", id)
      .get();

    const batchSize = 400;
    let batch = adminDb().batch();
    let count = 0;
    for (const doc of ordersSnap.docs) {
      batch.delete(doc.ref);
      count += 1;
      if (count % batchSize === 0) {
        await batch.commit();
        batch = adminDb().batch();
      }
    }
    batch.delete(connRef);
    await batch.commit();

    return NextResponse.json({ ok: true, removedOrders: ordersSnap.size });
  } catch (err: unknown) {
    console.error("[veeqo-connections DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
