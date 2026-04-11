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

/** GET: Shopify + eBay connections for target user (admin / sub_admin only). Query: targetUid */
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

  const targetUid = request.nextUrl.searchParams.get("targetUid")?.trim();
  if (!targetUid) {
    return NextResponse.json({ error: "Missing targetUid" }, { status: 400 });
  }

  try {
    const db = adminDb();
    const [shopifySnap, ebaySnap, userSnap] = await Promise.all([
      db.collection("users").doc(targetUid).collection("shopifyConnections").get(),
      db.collection("users").doc(targetUid).collection("ebayConnections").get(),
      db.collection("users").doc(targetUid).get(),
    ]);

    const profile = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : {};
    const shopify = shopifySnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        shop: data.shop,
        shopName: data.shopName ?? data.shop?.replace?.(".myshopify.com", "") ?? "",
        connectedAt: data.connectedAt,
        selectedVariants: data.selectedVariants ?? [],
      };
    });
    const ebay = ebaySnap.docs.map((d) => {
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

    return NextResponse.json({
      targetUid,
      profile: {
        email: String(profile.email ?? profile.userEmail ?? ""),
        displayName: String(
          profile.displayName ?? profile.name ?? profile.fullName ?? profile.email ?? "User"
        ),
        clientId: String(profile.clientId ?? ""),
      },
      shopify,
      ebay,
    });
  } catch (err: unknown) {
    console.error("[admin/integrations/user GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
