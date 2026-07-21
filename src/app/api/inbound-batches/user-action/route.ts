import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { getAdminDb, getAdminFieldValue } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const MAX_SELECTED_CANCEL = 100;

function cleanString(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text || null;
}

function parsePositiveNumber(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseDateValue(value: unknown): Date | null | undefined {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const d = new Date(`${value}T12:00:00`);
  if (Number.isNaN(d.getTime())) return undefined;
  return d;
}

async function refreshBatchCounts(userId: string, batchId: string) {
  const db = getAdminDb();
  const linesSnap = await db
    .collection("users")
    .doc(userId)
    .collection("inboundBatches")
    .doc(batchId)
    .collection("lines")
    .get();
  const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: linesSnap.size };
  linesSnap.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
    const status = String(doc.data().status || "pending");
    if (status === "approved") counts.approved += 1;
    else if (status === "rejected") counts.rejected += 1;
    else if (status === "cancelled") counts.cancelled += 1;
    else counts.pending += 1;
  });

  let status: "pending" | "partial" | "completed" | "cancelled" = "pending";
  if (counts.total > 0 && counts.cancelled === counts.total) status = "cancelled";
  else if (counts.total > 0 && counts.pending === 0) status = "completed";
  else if (counts.approved > 0 || counts.rejected > 0 || counts.cancelled > 0) status = "partial";

  await db.collection("users").doc(userId).collection("inboundBatches").doc(batchId).update({
    status,
    totalLines: counts.total,
    pendingLines: counts.pending,
    approvedLines: counts.approved,
    rejectedLines: counts.rejected,
    cancelledLines: counts.cancelled,
  });
}

export async function POST(request: NextRequest) {
  const decoded = await verifyBearerToken(request);
  if (!decoded?.uid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "");
  const batchId = String(body.batchId || "");
  const action = String(body.action || "");
  if (!userId || !batchId || userId !== decoded.uid) {
    return NextResponse.json({ error: "Invalid batch request." }, { status: 400 });
  }

  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  const batchRef = db.collection("users").doc(userId).collection("inboundBatches").doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) {
    return NextResponse.json({ error: "Batch not found." }, { status: 404 });
  }

  if (action === "updateLine") {
    const lineId = String(body.lineId || "");
    const payload = body.line || {};
    if (!lineId) return NextResponse.json({ error: "Line id is required." }, { status: 400 });

    const lineRef = batchRef.collection("lines").doc(lineId);
    const lineSnap = await lineRef.get();
    if (!lineSnap.exists) return NextResponse.json({ error: "Line not found." }, { status: 404 });
    if (String(lineSnap.data()?.status || "pending") !== "pending") {
      return NextResponse.json({ error: "Only pending lines can be edited." }, { status: 400 });
    }

    const productName = cleanString(payload.productName);
    const quantity = parsePositiveNumber(payload.quantity);
    if (!productName || !quantity) {
      return NextResponse.json({ error: "Product name and quantity are required." }, { status: 400 });
    }

    const update: Record<string, unknown> = {
      productName,
      quantity,
      requestedQuantity: quantity,
      sku: cleanString(payload.sku) ?? FieldValue.delete(),
      retailIdentifier: cleanString(payload.retailIdentifier) ?? FieldValue.delete(),
      remarks: cleanString(payload.remarks) ?? FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: userId,
    };
    const expiryDate = parseDateValue(payload.expiryDate);
    if (expiryDate !== undefined) update.expiryDate = expiryDate ?? FieldValue.delete();

    const imageUrls = Array.isArray(payload.imageUrls)
      ? payload.imageUrls.map((u: unknown) => String(u || "").trim()).filter(Boolean)
      : typeof payload.imageUrl === "string" && payload.imageUrl.trim()
        ? [payload.imageUrl.trim()]
        : null;
    if (imageUrls) {
      update.imageUrls = imageUrls;
      update.imageUrl = imageUrls[0] ?? FieldValue.delete();
    } else if (payload.clearImage === true) {
      update.imageUrls = [];
      update.imageUrl = FieldValue.delete();
    }

    await lineRef.update(update);

    // Keep mirrored inventory request in sync when present
    const inventoryRequestId = String(lineSnap.data()?.inventoryRequestId || "").trim();
    if (inventoryRequestId) {
      const requestUpdate: Record<string, unknown> = {
        productName,
        quantity,
        requestedQuantity: quantity,
        sku: cleanString(payload.sku) ?? FieldValue.delete(),
        retailIdentifier: cleanString(payload.retailIdentifier) ?? FieldValue.delete(),
        remarks: cleanString(payload.remarks) ?? FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (expiryDate !== undefined) requestUpdate.expiryDate = expiryDate ?? FieldValue.delete();
      if (imageUrls) {
        requestUpdate.imageUrls = imageUrls;
        requestUpdate.imageUrl = imageUrls[0] ?? FieldValue.delete();
      } else if (payload.clearImage === true) {
        requestUpdate.imageUrls = [];
        requestUpdate.imageUrl = FieldValue.delete();
      }
      await db.doc(`users/${userId}/inventoryRequests/${inventoryRequestId}`).update(requestUpdate);
    }

    return NextResponse.json({ success: true });
  }

  if (action === "cancelLines") {
    const reason = cleanString(body.reason) || "Cancelled by user.";
    const allPending = body.allPending === true;
    let cancelled = 0;

    if (allPending) {
      while (true) {
        const snap = await batchRef.collection("lines").where("status", "==", "pending").limit(400).get();
        if (snap.empty) break;
        const writeBatch = db.batch();
        snap.docs.forEach((doc: FirebaseFirestore.QueryDocumentSnapshot) => {
          writeBatch.update(doc.ref, {
            status: "cancelled",
            cancelledAt: FieldValue.serverTimestamp(),
            cancelledBy: userId,
            cancellationReason: reason,
          });
        });
        await writeBatch.commit();
        cancelled += snap.size;
      }
    } else {
      const lineIds = Array.isArray(body.lineIds) ? body.lineIds.map(String).slice(0, MAX_SELECTED_CANCEL) : [];
      if (lineIds.length === 0) {
        return NextResponse.json({ error: "Select at least one line to cancel." }, { status: 400 });
      }
      const writeBatch = db.batch();
      for (const lineId of lineIds) {
        const lineRef = batchRef.collection("lines").doc(lineId);
        const lineSnap = await lineRef.get();
        if (!lineSnap.exists || String(lineSnap.data()?.status || "pending") !== "pending") continue;
        writeBatch.update(lineRef, {
          status: "cancelled",
          cancelledAt: FieldValue.serverTimestamp(),
          cancelledBy: userId,
          cancellationReason: reason,
        });
        cancelled += 1;
      }
      if (cancelled > 0) await writeBatch.commit();
    }

    await refreshBatchCounts(userId, batchId);
    return NextResponse.json({ success: true, cancelled });
  }

  return NextResponse.json({ error: "Unsupported action." }, { status: 400 });
}
