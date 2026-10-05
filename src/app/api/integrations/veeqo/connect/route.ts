import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { veeqoValidateCredentials } from "@/lib/veeqo-api";
import { syncVeeqoOrdersForConnection } from "@/lib/veeqo-sync";

export const dynamic = "force-dynamic";

async function requireUid(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const decoded = await adminAuth().verifyIdToken(token);
  if (!decoded.uid) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return decoded.uid;
}

/** POST: connect Veeqo with API key, then sync recent orders. */
export async function POST(request: NextRequest) {
  try {
    const uid = await requireUid(request);
    const body = await request.json();
    const apiKey = String(body.apiKey || "").trim();
    const accountLabel = String(body.accountLabel || "").trim() || "Veeqo";

    if (!apiKey) {
      return NextResponse.json({ error: "API Key is required" }, { status: 400 });
    }

    await veeqoValidateCredentials({ apiKey });

    const col = adminDb().collection("users").doc(uid).collection("veeqoConnections");
    const existing = await col.where("apiKey", "==", apiKey).limit(1).get();

    let connectionId: string;
    if (!existing.empty) {
      connectionId = existing.docs[0].id;
      await col.doc(connectionId).set(
        {
          apiKey,
          accountLabel,
          updatedAt: adminFieldValue().serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const docRef = await col.add({
        apiKey,
        accountLabel,
        connectedAt: adminFieldValue().serverTimestamp(),
        updatedAt: adminFieldValue().serverTimestamp(),
      });
      connectionId = docRef.id;
    }

    const sync = await syncVeeqoOrdersForConnection({
      userId: uid,
      connectionId,
      creds: { apiKey },
    });

    return NextResponse.json({
      ok: true,
      connectionId,
      synced: sync.synced,
      withLabels: sync.withLabels,
      openCount: sync.openCount,
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    console.error("[veeqo connect]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to connect Veeqo",
      },
      { status: status === 401 ? 401 : 500 }
    );
  }
}
