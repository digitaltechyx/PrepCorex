import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export type ShopifyRouteAuth = {
  callerUid: string;
  isAdmin: boolean;
};

export async function authorizeShopifyUserRoute(
  request: NextRequest,
  userId: string
): Promise<ShopifyRouteAuth | NextResponse> {
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
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    const data = userDoc.data();
    const role = data?.role as string;
    const roles = data?.roles as string[] | undefined;
    const isAdmin =
      role === "admin" ||
      role === "sub_admin" ||
      (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
    if (userId !== callerUid && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return { callerUid, isAdmin };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
}

export function normalizeShopParam(shop: string): string {
  let shopNorm = shop.trim().toLowerCase();
  if (!shopNorm.includes(".myshopify.com")) {
    shopNorm = `${shopNorm}.myshopify.com`;
  }
  return shopNorm;
}
