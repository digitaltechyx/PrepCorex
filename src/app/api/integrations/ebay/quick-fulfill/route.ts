import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  executeEbayQuickFulfill,
  type EbayQuickFulfillLineInput,
} from "@/lib/ebay-quick-fulfill";

export const dynamic = "force-dynamic";

/**
 * POST: Quick-fulfill an eBay order from warehouse inventory.
 * Admin / sub_admin only.
 */
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
  let callerName = "Admin";
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
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
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : "";
  const orderId = typeof body.orderId === "string" ? body.orderId.trim() : "";
  const trackingNumber =
    typeof body.trackingNumber === "string" ? body.trackingNumber.trim() : undefined;
  const shippingCarrierCode =
    typeof body.shippingCarrierCode === "string" ? body.shippingCarrierCode.trim() : undefined;
  const labelPrice =
    body.labelPrice != null && Number.isFinite(Number(body.labelPrice))
      ? Number(body.labelPrice)
      : null;
  const labelPurchaseId =
    typeof body.labelPurchaseId === "string" ? body.labelPurchaseId.trim() : null;

  const rawLines = Array.isArray(body.lines) ? body.lines : [];
  const lines: EbayQuickFulfillLineInput[] = rawLines.map((line: Record<string, unknown>) => ({
    ebayLineItemId: String(line.ebayLineItemId || "").trim(),
    inventoryId: String(line.inventoryId || "").trim(),
    quantity: Math.floor(Number(line.quantity) || 0),
    lineTitle: line.lineTitle != null ? String(line.lineTitle) : null,
    lineSku: line.lineSku != null ? String(line.lineSku) : null,
  }));

  if (!userId || !connectionId || !orderId || lines.length === 0) {
    return NextResponse.json(
      { error: "userId, connectionId, orderId, and lines are required" },
      { status: 400 }
    );
  }
  if (trackingNumber && !shippingCarrierCode) {
    return NextResponse.json(
      { error: "shippingCarrierCode is required when trackingNumber is provided" },
      { status: 400 }
    );
  }
  if (shippingCarrierCode && !trackingNumber) {
    return NextResponse.json(
      { error: "trackingNumber is required when shippingCarrierCode is provided" },
      { status: 400 }
    );
  }

  try {
    const result = await executeEbayQuickFulfill({
      db: adminDb(),
      ownerUserId: userId,
      connectionId,
      orderId,
      lines,
      trackingNumber,
      shippingCarrierCode,
      fulfilledBy: callerUid,
      labelPrice,
      labelPurchaseId,
    });

    return NextResponse.json({
      ok: true,
      shippedId: result.shippedId,
      alreadyProcessed: result.alreadyProcessed,
      ebaySyncHints: result.ebaySyncHints,
      warehouseDeducted: result.warehouseDeducted,
      warehouseShortfall: result.warehouseShortfall,
      fulfilledByName: callerName,
    });
  } catch (err) {
    console.error("[ebay/quick-fulfill]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Quick fulfill failed" },
      { status: 500 }
    );
  }
}
