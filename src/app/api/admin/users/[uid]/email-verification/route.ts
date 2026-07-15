import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "@/lib/api-admin-auth";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getAuditRequestMeta } from "@/lib/user-audit-request-meta";
import { appendUserAuditEvent } from "@/lib/user-audit-trail-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uid: string }> };

type Action = "defer" | "revoke_defer" | "mark_verified";

/**
 * Admin email-verification controls:
 * - defer: let user continue without verifying (they can verify later)
 * - revoke_defer: require verification again before login
 * - mark_verified: set Firebase Auth emailVerified=true (permanent verify)
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

  let body: { action?: string };
  try {
    body = (await request.json()) as { action?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const action = String(body.action || "").trim() as Action;
  if (action !== "defer" && action !== "revoke_defer" && action !== "mark_verified") {
    return NextResponse.json(
      { error: "action must be defer, revoke_defer, or mark_verified." },
      { status: 400 }
    );
  }

  try {
    const userRef = adminDb().collection("users").doc(targetUid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    if (action === "mark_verified") {
      try {
        await adminAuth().updateUser(targetUid, { emailVerified: true });
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code?: string }).code || "")
            : "";
        if (code === "auth/user-not-found") {
          return NextResponse.json(
            { error: "Auth account not found for this user." },
            { status: 404 }
          );
        }
        throw e;
      }

      await userRef.update({
        emailVerificationDeferredByAdmin: FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      try {
        await appendUserAuditEvent(targetUid, {
          type: "account_activated",
          action: "Email marked verified by admin",
          description: "Admin marked Firebase email as verified.",
          meta: getAuditRequestMeta(request),
          performedByUid: auth.uid,
          metadata: { emailVerificationAction: "mark_verified" },
        });
      } catch (auditErr) {
        console.warn("[email-verification] audit failed", auditErr);
      }

      return NextResponse.json({ success: true, action });
    }

    if (action === "defer") {
      await userRef.update({
        emailVerificationDeferredByAdmin: true,
        // Keep emailVerificationRequired so they can still verify later
        emailVerificationRequired: true,
        updatedAt: FieldValue.serverTimestamp(),
      });

      try {
        await appendUserAuditEvent(targetUid, {
          type: "account_activated",
          action: "Email verification deferred by admin",
          description:
            "Admin allowed this user to continue without email verification. They may verify later.",
          meta: getAuditRequestMeta(request),
          performedByUid: auth.uid,
          metadata: { emailVerificationAction: "defer" },
        });
      } catch (auditErr) {
        console.warn("[email-verification] audit failed", auditErr);
      }

      return NextResponse.json({ success: true, action, deferred: true });
    }

    // revoke_defer
    await userRef.update({
      emailVerificationDeferredByAdmin: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      await appendUserAuditEvent(targetUid, {
        type: "account_activated",
        action: "Email verification deferral revoked",
        description: "Admin requires email verification again before login.",
        meta: getAuditRequestMeta(request),
        performedByUid: auth.uid,
        metadata: { emailVerificationAction: "revoke_defer" },
      });
    } catch (auditErr) {
      console.warn("[email-verification] audit failed", auditErr);
    }

    return NextResponse.json({ success: true, action, deferred: false });
  } catch (e) {
    console.error("[POST /api/admin/users/email-verification]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update email verification." },
      { status: 500 }
    );
  }
}
