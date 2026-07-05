import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, getAdminFieldValue } from "@/lib/firebase-admin";

export const runtime = "nodejs";

const CHUNKS_PER_RUN = 5;
const LINE_WRITES_PER_BATCH = 400;

async function requireSelf(req: NextRequest, userId: string) {
  const header = req.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false as const, status: 401, error: "Missing auth token." };
  }
  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false as const, status: 401, error: "Missing auth token." };
  }
  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    if (decoded.uid !== userId) {
      return { ok: false as const, status: 403, error: "You can only process your own import jobs." };
    }
    return { ok: true as const, uid: decoded.uid };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid auth token." };
  }
}

function elapsedMsFrom(startedAt: unknown): number | null {
  if (!startedAt || typeof startedAt !== "object" || typeof (startedAt as any).toMillis !== "function") {
    return null;
  }
  return Date.now() - (startedAt as { toMillis: () => number }).toMillis();
}

function toLineDoc(line: Record<string, unknown>, context: {
  batchId: string;
  lineNumber: number;
  userId: string;
  userName: string;
  now: unknown;
}) {
  const doc: Record<string, unknown> = {
    batchId: context.batchId,
    lineNumber: context.lineNumber,
    userId: context.userId,
    userName: context.userName,
    inventoryType: line.inventoryType,
    productName: line.productName,
    quantity: line.quantity,
    requestedQuantity: line.requestedQuantity ?? line.quantity,
    status: "pending",
    addDate: context.now,
    requestedAt: context.now,
    requestedBy: context.userId,
  };

  for (const key of [
    "productSubType",
    "productEntryMode",
    "productId",
    "sku",
    "color",
    "size",
    "variantLabel",
    "parentProductName",
    "containerSize",
    "retailIdentifier",
    "expiryDate",
    "remarks",
    "trackingNumber",
    "carrier",
    "imageUrls",
    "imageUrl",
  ]) {
    if (line[key] !== undefined && line[key] !== null && line[key] !== "") {
      doc[key] = key === "expiryDate" ? reviveTimestampLike(line[key]) : line[key];
    }
  }

  return doc;
}

function reviveTimestampLike(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "seconds" in value &&
    "nanoseconds" in value
  ) {
    const seconds = Number((value as { seconds: unknown }).seconds);
    const nanoseconds = Number((value as { nanoseconds: unknown }).nanoseconds);
    if (Number.isFinite(seconds) && Number.isFinite(nanoseconds)) {
      return new Date(seconds * 1000 + Math.floor(nanoseconds / 1000000));
    }
  }
  return value;
}

export async function POST(req: NextRequest) {
  const { userId, jobId } = await req.json().catch(() => ({}));
  if (!userId || !jobId) {
    return NextResponse.json({ error: "Missing userId or jobId." }, { status: 400 });
  }

  const auth = await requireSelf(req, String(userId));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const db = getAdminDb();
  const FieldValue = getAdminFieldValue();
  const jobRef = db.collection("users").doc(String(userId)).collection("inboundImportJobs").doc(String(jobId));
  const jobSnap = await jobRef.get();
  if (!jobSnap.exists) {
    return NextResponse.json({ error: "Import job not found." }, { status: 404 });
  }

  const job = jobSnap.data() || {};
  const now = FieldValue.serverTimestamp();

  if (job.cancelRequested || job.status === "cancelling") {
    await jobRef.update({
      status: "cancelled",
      cancelledAt: now,
      completedAt: now,
      elapsedMs: elapsedMsFrom(job.startedAt) ?? job.elapsedMs ?? null,
      lastProgressAt: now,
    });
    return NextResponse.json({
      status: "cancelled",
      processedRows: Number(job.processedRows || 0),
      totalRows: Number(job.totalRows || 0),
    });
  }

  if (job.status === "completed" || job.status === "cancelled" || job.status === "failed") {
    return NextResponse.json({
      status: job.status,
      processedRows: Number(job.processedRows || 0),
      totalRows: Number(job.totalRows || 0),
    });
  }

  if (!job.startedAt) {
    await jobRef.update({ status: "processing", startedAt: now, lastProgressAt: now });
  } else if (job.status !== "processing") {
    await jobRef.update({ status: "processing", lastProgressAt: now });
  }

  try {
    const chunksSnap = await jobRef
      .collection("chunks")
      .where("status", "==", "pending")
      .limit(CHUNKS_PER_RUN)
      .get();

    let processedRows = 0;
    let processedChunks = 0;

    for (const chunkDoc of chunksSnap.docs) {
      const chunk = chunkDoc.data();
      const lines = Array.isArray(chunk.lines) ? chunk.lines : [];
      const startLine = Number(chunk.startLine || 1);

      for (let start = 0; start < lines.length; start += LINE_WRITES_PER_BATCH) {
        const batch = db.batch();
        const slice = lines.slice(start, start + LINE_WRITES_PER_BATCH);
        slice.forEach((line: Record<string, unknown>, index: number) => {
          const lineRef = db
            .collection("users")
            .doc(String(userId))
            .collection("inboundBatches")
            .doc(String(job.batchId))
            .collection("lines")
            .doc();
          batch.set(lineRef, toLineDoc(line, {
            batchId: String(job.batchId),
            lineNumber: startLine + start + index,
            userId: String(userId),
            userName: String(job.userName || "User"),
            now,
          }));
        });
        await batch.commit();
      }

      await chunkDoc.ref.update({
        status: "done",
        processedAt: now,
        lines: FieldValue.delete(),
      });
      processedRows += lines.length;
      processedChunks += 1;
    }

    if (processedRows > 0) {
      await jobRef.update({
        processedRows: FieldValue.increment(processedRows),
        processedChunks: FieldValue.increment(processedChunks),
        lastProgressAt: now,
      });
    }

    const freshSnap = await jobRef.get();
    const fresh = freshSnap.data() || job;
    const totalRows = Number(fresh.totalRows || job.totalRows || 0);
    const currentProcessedRows = Number(fresh.processedRows || 0);
    const totalChunks = Number(fresh.totalChunks || job.totalChunks || 0);
    const currentProcessedChunks = Number(fresh.processedChunks || 0);
    const isComplete =
      totalRows > 0 &&
      totalChunks > 0 &&
      currentProcessedRows >= totalRows &&
      currentProcessedChunks >= totalChunks;

    if (isComplete) {
      const completedAt = FieldValue.serverTimestamp();
      const elapsedMs = elapsedMsFrom(fresh.startedAt || job.startedAt);
      await db.collection("users").doc(String(userId)).collection("inboundBatches").doc(String(job.batchId)).set({
        userId: String(userId),
        userName: String(job.userName || "User"),
        shipmentType: job.shipmentType ?? null,
        loadContents: job.loadContents ?? null,
        productNotes: job.productNotes ?? null,
        status: "pending",
        totalLines: totalRows,
        pendingLines: totalRows,
        approvedLines: 0,
        rejectedLines: 0,
        cancelledLines: 0,
        addDate: fresh.addDate || now,
        requestedAt: fresh.requestedAt || now,
        requestedBy: String(userId),
        sourceImportJobId: String(jobId),
      });
      await jobRef.update({
        status: "completed",
        processedRows: totalRows,
        processedChunks: totalChunks,
        completedAt,
        elapsedMs,
        lastProgressAt: completedAt,
      });
      return NextResponse.json({ status: "completed", processedRows: totalRows, totalRows, elapsedMs });
    }

    return NextResponse.json({
      status: "processing",
      processedRows: currentProcessedRows,
      totalRows,
      pendingChunksProcessed: processedRows,
    });
  } catch (error: any) {
    await jobRef.update({
      status: "failed",
      errorMessage: error?.message || "Import processing failed.",
      completedAt: now,
      lastProgressAt: now,
    });
    return NextResponse.json({ error: error?.message || "Import processing failed." }, { status: 500 });
  }
}
