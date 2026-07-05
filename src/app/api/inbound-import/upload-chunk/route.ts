import { NextRequest, NextResponse } from "next/server";
import { getAdminAuth, getAdminDb, getAdminFieldValue } from "@/lib/firebase-admin";

export const runtime = "nodejs";

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
      return { ok: false as const, status: 403, error: "You can only upload your own import jobs." };
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, status: 401, error: "Invalid auth token." };
  }
}

export async function POST(req: NextRequest) {
  const { userId, jobId, index, startLine, lines } = await req.json().catch(() => ({}));
  if (!userId || !jobId || !Array.isArray(lines)) {
    return NextResponse.json({ error: "Missing userId, jobId, or lines." }, { status: 400 });
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

  const chunkRef = jobRef.collection("chunks").doc(String(index));
  await chunkRef.set({
    index: Number(index || 0),
    status: "pending",
    startLine: Number(startLine || 1),
    rowCount: lines.length,
    lines,
    createdAt: FieldValue.serverTimestamp(),
  });

  return NextResponse.json({ ok: true, rowCount: lines.length });
}
