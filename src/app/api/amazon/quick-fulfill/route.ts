import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  executeAmazonQuickFulfill,
  type AmazonQuickFulfillLineInput,
} from "@/lib/amazon-quick-fulfill";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let callerName = "Admin";
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    if (!decoded.uid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(decoded.uid).get();
    const data = userDoc.data();
    const role = data?.role as string;
    const roles = data?.roles as string[] | undefined;
    const isAdmin =
      role === "admin" ||
      role === "sub_admin" ||
      (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")));
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    callerName = String(data?.name || data?.email || "Admin");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const connectionId = String(body.connectionId || "").trim();
  const amazonOrderId = String(body.amazonOrderId || body.orderId || "").trim();
  const marketplaceId = String(body.marketplaceId || "").trim();
  const storeName = typeof body.storeName === "string" ? body.storeName.trim() : undefined;
  const shipTo = typeof body.shipTo === "string" ? body.shipTo.trim() : undefined;
  const trackingNumber =
    typeof body.tracking_number === "string"
      ? body.tracking_number.trim()
      : typeof body.trackingNumber === "string"
        ? body.trackingNumber.trim()
        : undefined;
  const trackingCompany =
    typeof body.tracking_company === "string"
      ? body.tracking_company.trim()
      : typeof body.trackingCompany === "string"
        ? body.trackingCompany.trim()
        : undefined;
  const labelPriceRaw = Number(body.label_price ?? body.labelPrice);
  const labelPrice = Number.isFinite(labelPriceRaw) ? labelPriceRaw : undefined;
  const labelPurchaseId =
    typeof body.label_purchase_id === "string"
      ? body.label_purchase_id.trim()
      : typeof body.labelPurchaseId === "string"
        ? body.labelPurchaseId.trim()
        : undefined;

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: AmazonQuickFulfillLineInput[] = rawLines.map((line: Record<string, unknown>) => ({
    orderItemId: String(line.orderItemId || line.amazonOrderItemId || ""),
    inventoryId: String(line.inventoryId || ""),
    quantity: Math.floor(Number(line.quantity) || 0),
    lineTitle: typeof line.lineTitle === "string" ? line.lineTitle : undefined,
    lineSku: typeof line.lineSku === "string" ? line.lineSku : undefined,
  }));

  if (!userId || !connectionId || !amazonOrderId || !marketplaceId) {
    return NextResponse.json(
      { error: "Missing userId, connectionId, amazonOrderId, or marketplaceId" },
      { status: 400 }
    );
  }

  try {
    const result = await executeAmazonQuickFulfill({
      db: adminDb(),
      ownerUserId: userId,
      connectionId,
      amazonOrderId,
      marketplaceId,
      storeName,
      shipTo,
      lines,
      trackingNumber,
      trackingCompany,
      fulfilledBy: callerName,
      labelPrice,
      labelPurchaseId,
    });
    return NextResponse.json({
      ok: true,
      ...result,
    });
  } catch (err: unknown) {
    console.error("[amazon/quick-fulfill POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
