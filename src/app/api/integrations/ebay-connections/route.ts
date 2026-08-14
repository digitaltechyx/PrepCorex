import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return role === "admin" || role === "sub_admin" || (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
}

/** GET: list current user's eBay connection (single account for now). */
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

  const uidParam = request.nextUrl.searchParams.get("userId")?.trim();
  const uid = uidParam && isAdmin ? uidParam : callerUid;
  if (uid !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const snapshot = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("ebayConnections")
      .get();
    const list = snapshot.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        connectedAt: data.connectedAt,
        environment: data.environment ?? "sandbox",
        selectedOfferIds: Array.isArray(data.selectedOfferIds) ? data.selectedOfferIds : [],
        selectedListingIds: Array.isArray(data.selectedListingIds) ? data.selectedListingIds : [],
        selectedListings: Array.isArray(data.selectedListings) ? data.selectedListings : [],
      };
    });
    return NextResponse.json({ connections: list });
  } catch (err: unknown) {
    console.error("[ebay-connections GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** DELETE: remove eBay connection. Query param id = doc id. */
export async function DELETE(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const removeInventory = searchParams.get("removeInventory") === "true";
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const db = adminDb();
    const ref = db.collection("users").doc(uid).collection("ebayConnections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    await ref.delete();

    let removedInventoryCount = 0;
    if (removeInventory) {
      const invSnap = await db
        .collection("users")
        .doc(uid)
        .collection("inventory")
        .where("source", "==", "ebay")
        .where("ebayConnectionId", "==", id)
        .get();
      const lookupSnap = await db
        .collection("ebayInventoryLookup")
        .where("userId", "==", uid)
        .where("connectionId", "==", id)
        .get();
      const batch = db.batch();
      for (const d of invSnap.docs) batch.delete(d.ref);
      for (const d of lookupSnap.docs) batch.delete(d.ref);
      if (invSnap.docs.length > 0 || lookupSnap.docs.length > 0) {
        await batch.commit();
        removedInventoryCount = invSnap.docs.length;
      }
    }

    return NextResponse.json({ ok: true, removedInventoryCount });
  } catch (err: unknown) {
    console.error("[ebay-connections DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
