import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { fetchAmazonSellerProfile, refreshAmazonAccessToken } from "@/lib/amazon-sp-api";

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

/** GET: list current user's Amazon connections. */
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
      .collection("amazonConnections")
      .get();
    const list = await Promise.all(
      snapshot.docs.map(async (d) => {
        const data = d.data();
        let storeName = typeof data.storeName === "string" ? data.storeName.trim() : "";
        let businessName =
          typeof data.businessName === "string" ? data.businessName.trim() : "";
        let marketplaces = Array.isArray(data.marketplaces) ? data.marketplaces : [];
        const refreshToken = String(data.refreshToken ?? "").trim();
        // Refresh when missing a real store/business name (includes old "Amazon seller" fallback).
        const needsProfile =
          !storeName ||
          storeName.toLowerCase() === "amazon seller" ||
          (!businessName && marketplaces.length === 0);
        if (needsProfile && refreshToken) {
          try {
            const tokens = await refreshAmazonAccessToken(refreshToken);
            const profile = await fetchAmazonSellerProfile(tokens.access_token);
            storeName = profile.storeName || storeName;
            businessName = profile.businessName || businessName;
            if (profile.marketplaces.length > 0) marketplaces = profile.marketplaces;
            if (storeName || businessName || profile.marketplaces.length > 0) {
              await d.ref.update({
                ...(storeName ? { storeName } : {}),
                ...(businessName ? { businessName } : {}),
                ...(profile.marketplaces.length > 0 ? { marketplaces: profile.marketplaces } : {}),
              });
            }
          } catch (err) {
            console.warn("[amazon-connections] store name refresh failed", d.id, err);
          }
        }
        const displayName =
          storeName ||
          businessName ||
          (Array.isArray(marketplaces)
            ? marketplaces
                .map((m: { storeName?: string | null; name?: string | null; countryCode?: string | null }) =>
                  m?.storeName || m?.name || m?.countryCode
                )
                .find(Boolean)
            : null) ||
          null;
        return {
          id: d.id,
          connectedAt: data.connectedAt,
          environment: data.environment ?? "production",
          sellingPartnerId: data.sellingPartnerId ?? null,
          storeName: displayName,
          businessName: businessName || null,
          marketplaceRegion: data.marketplaceRegion ?? "NA",
          selectedAsinKeys: Array.isArray(data.selectedAsinKeys) ? data.selectedAsinKeys : [],
          marketplaces,
        };
      })
    );
    return NextResponse.json({ connections: list });
  } catch (err: unknown) {
    console.error("[amazon-connections GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** DELETE: remove Amazon connection. Query param id = doc id. */
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
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const ref = adminDb().collection("users").doc(uid).collection("amazonConnections").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
    }
    await ref.delete();
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[amazon-connections DELETE]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
