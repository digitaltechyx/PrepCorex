import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminLikeUserDoc } from "@/lib/api-admin-auth";
import { adminDb } from "@/lib/firebase-admin";
import { getAuditRequestMeta } from "@/lib/user-audit-request-meta";
import { appendUserAuditEvent } from "@/lib/user-audit-trail-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uid: string }> };

/**
 * Validates admin can open a client preview and writes an audit event.
 * Does NOT mint Firebase custom tokens — admin Auth stays put; the UI opens
 * `/dashboard?viewAs={uid}` so multiple client tabs can run alongside admin.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { uid } = await context.params;
  const targetUid = uid?.trim();
  if (!targetUid) {
    return NextResponse.json({ error: "User id is required." }, { status: 400 });
  }

  if (targetUid === auth.uid) {
    return NextResponse.json(
      { error: "You are already signed in as this user." },
      { status: 400 }
    );
  }

  try {
    const userRef = adminDb().collection("users").doc(targetUid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const data = snap.data() || {};
    if (isAdminLikeUserDoc(data)) {
      return NextResponse.json(
        { error: "Cannot view admin or sub-admin accounts as a client." },
        { status: 403 }
      );
    }

    const status = String(data.status || "").toLowerCase();
    if (status === "deleted") {
      return NextResponse.json({ error: "Cannot view a deleted account." }, { status: 400 });
    }
    if (status && status !== "approved") {
      return NextResponse.json(
        { error: "Only approved client accounts can be opened." },
        { status: 400 }
      );
    }

    const email = String(data.email || "").trim().toLowerCase();
    const clientName =
      String(data.name || data.companyName || email || targetUid).trim() || targetUid;

    try {
      await appendUserAuditEvent(targetUid, {
        type: "user_action",
        action: "Viewed as client by admin",
        description: `Admin opened client preview (uid ${auth.uid}) without switching Auth.`,
        meta: getAuditRequestMeta(request),
        performedByUid: auth.uid,
        metadata: {
          impersonation: true,
          mode: "preview",
          adminUid: auth.uid,
          adminName: auth.name || null,
        },
      });
    } catch (auditErr) {
      console.warn("[impersonate] audit failed", auditErr);
    }

    return NextResponse.json({
      success: true,
      mode: "preview",
      client: {
        uid: targetUid,
        name: clientName,
        email: email || null,
        clientId: data.clientId ? String(data.clientId) : null,
      },
      admin: {
        uid: auth.uid,
        name: auth.name || null,
      },
    });
  } catch (e: unknown) {
    console.error("[POST /api/admin/users/impersonate]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to start client view." },
      { status: 500 }
    );
  }
}
