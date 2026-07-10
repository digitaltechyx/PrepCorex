import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isOpsCaller(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = String(data.role ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (role === "admin" || role === "sub_admin" || role === "warehouse_operator") return true;
  const roles = Array.isArray(data.roles) ? data.roles.map((r) => String(r).toLowerCase()) : [];
  return roles.some((r) =>
    ["admin", "sub_admin", "sub-admin", "subadmin", "warehouse_operator", "warehouse operator"].includes(
      r.replace(/[\s-]+/g, "_")
    )
  );
}

function normType(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function isMirrorableLineType(inventoryType: unknown): boolean {
  const t = normType(inventoryType);
  return !t || t === "product" || t === "container";
}

/**
 * Mirror pending inbound batch lines into users/{uid}/inventoryRequests so
 * Warehouse Ops receiving can list them (older 1-line batches often lack mirrors).
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = await adminAuth().verifyIdToken(authHeader.slice(7).trim());
    const callerSnap = await adminDb().collection("users").doc(decoded.uid).get();
    if (!isOpsCaller(callerSnap.data() as Record<string, unknown> | undefined)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const userIds = Array.isArray(body.userIds)
      ? body.userIds.map((id: unknown) => String(id || "").trim()).filter(Boolean)
      : [];
    if (userIds.length === 0) {
      return NextResponse.json({ error: "userIds required" }, { status: 400 });
    }

    const db = adminDb();
    let created = 0;
    let repaired = 0;

    for (const userId of userIds.slice(0, 200)) {
      const batchSnap = await db
        .collection("users")
        .doc(userId)
        .collection("inboundBatches")
        .where("status", "in", ["pending", "partial"])
        .get();

      for (const batchDoc of batchSnap.docs) {
        const batch = batchDoc.data();
        const linesSnap = await batchDoc.ref.collection("lines").get();

        for (const lineDoc of linesSnap.docs) {
          const line = lineDoc.data();
          const lineStatus = normType(line.status || "pending");
          if (lineStatus && lineStatus !== "pending") continue;
          if (!isMirrorableLineType(line.inventoryType)) continue;

          const existingId = String(line.inventoryRequestId ?? "").trim();
          if (existingId) {
            const reqRef = db.collection("users").doc(userId).collection("inventoryRequests").doc(existingId);
            const reqSnap = await reqRef.get();
            if (reqSnap.exists) continue;
            // Stale pointer — recreate below.
          }

          const now = Timestamp.now();
          const trackingNumber = String(line.trackingNumber ?? "").trim();
          const payload: Record<string, unknown> = {
            userId: batch.userId ?? userId,
            userName: batch.userName ?? "Unknown User",
            batchId: batchDoc.id,
            batchLineId: lineDoc.id,
            inventoryType: line.inventoryType ?? "product",
            productName: line.productName ?? "Product",
            quantity: line.quantity ?? 0,
            requestedQuantity: line.requestedQuantity ?? line.quantity ?? 0,
            sku: line.sku ?? null,
            retailIdentifier: line.retailIdentifier ?? null,
            expiryDate: line.expiryDate ?? null,
            productSubType: line.productSubType ?? null,
            productId: line.productId ?? null,
            productEntryMode: line.productEntryMode ?? null,
            color: line.color ?? null,
            size: line.size ?? null,
            variantLabel: line.variantLabel ?? null,
            parentProductName: line.parentProductName ?? null,
            containerSize: line.containerSize ?? null,
            remarks: line.remarks ?? null,
            imageUrl: line.imageUrl ?? null,
            imageUrls: line.imageUrls ?? null,
            addDate: line.addDate ?? batch.addDate ?? now,
            requestedAt: line.requestedAt ?? batch.requestedAt ?? now,
            requestedBy: batch.requestedBy ?? userId,
            status: "pending",
            mirroredAt: FieldValue.serverTimestamp(),
            mirroredBy: decoded.uid,
          };
          if (trackingNumber) {
            payload.trackingNumber = trackingNumber;
            if (line.carrier) payload.carrier = line.carrier;
            payload.inboundTrackings = [
              {
                id: `trk_${trackingNumber.replace(/\W+/g, "").slice(0, 24) || Date.now()}`,
                trackingNumber,
                carrier: line.carrier ?? null,
                addedAt: now,
                addedBy: userId,
              },
            ];
          }

          const reqRef = await db.collection("users").doc(userId).collection("inventoryRequests").add(payload);
          await lineDoc.ref.update({ inventoryRequestId: reqRef.id });
          if (existingId) repaired += 1;
          else created += 1;
        }
      }
    }

    return NextResponse.json({ success: true, created, repaired });
  } catch (e) {
    console.error("[inbound-batches/mirror-lines]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Mirror failed" },
      { status: 500 }
    );
  }
}
