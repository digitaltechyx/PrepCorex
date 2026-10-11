import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { requireAdmin } from "@/lib/api-admin-auth";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getAuditRequestMeta } from "@/lib/user-audit-request-meta";
import { appendUserAuditEvent } from "@/lib/user-audit-trail-server";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ uid: string }> };

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

  let body: { email?: string; password?: string };
  try {
    body = (await request.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email && !password) {
    return NextResponse.json(
      { error: "Provide a new email and/or password." },
      { status: 400 }
    );
  }

  if (email) {
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
    }
  }

  if (password && password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters." },
      { status: 400 }
    );
  }

  try {
    const userRef = adminDb().collection("users").doc(targetUid);
    const snap = await userRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }

    const prev = snap.data() || {};
    const prevEmail = String(prev.email || "").trim().toLowerCase();
    const loginEmail = email || prevEmail;

    const authUpdate: { email?: string; password?: string } = {};
    if (email && email !== prevEmail) authUpdate.email = email;
    if (password) authUpdate.password = password;

    /** Resolve Auth uid: Firestore doc id first, then email (fixes stale/wrong users.uid). */
    async function resolveAuthUid(): Promise<string> {
      try {
        await adminAuth().getUser(targetUid);
        return targetUid;
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code?: string }).code || "")
            : "";
        if (code !== "auth/user-not-found" || !loginEmail) throw e;
      }
      try {
        const byEmail = await adminAuth().getUserByEmail(loginEmail);
        return byEmail.uid;
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code?: string }).code || "")
            : "";
        if (code === "auth/user-not-found") {
          throw Object.assign(new Error("Auth account not found for this user."), {
            code: "auth/user-not-found",
          });
        }
        throw e;
      }
    }

    if (Object.keys(authUpdate).length > 0) {
      try {
        const authUid = await resolveAuthUid();
        await adminAuth().updateUser(authUid, authUpdate);
      } catch (e: unknown) {
        const code =
          e && typeof e === "object" && "code" in e
            ? String((e as { code?: string }).code || "")
            : "";
        const message =
          e instanceof Error && e.message
            ? e.message
            : "Failed to update credentials.";
        if (code === "auth/email-already-exists") {
          return NextResponse.json(
            { error: "That email is already used by another login account.", code },
            { status: 409 }
          );
        }
        if (code === "auth/invalid-email") {
          return NextResponse.json({ error: "Invalid email address.", code }, { status: 400 });
        }
        if (code === "auth/weak-password" || code === "auth/password-does-not-meet-requirements") {
          return NextResponse.json(
            {
              error:
                "Password does not meet Firebase requirements. Try a longer password with letters and numbers.",
              code,
            },
            { status: 400 }
          );
        }
        if (code === "auth/user-not-found") {
          return NextResponse.json(
            {
              error:
                "Auth account not found for this user. Confirm the email exists under Firebase Authentication → Users.",
              code,
            },
            { status: 404 }
          );
        }
        return NextResponse.json(
          { error: message, code: code || undefined },
          { status: 500 }
        );
      }
    }

    const firestoreUpdate: Record<string, unknown> = {
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (email) firestoreUpdate.email = email;
    if (password) firestoreUpdate.password = password;

    await userRef.update(firestoreUpdate);

    const parts: string[] = [];
    if (email && email !== prevEmail) parts.push(`email → ${email}`);
    if (password) parts.push("password reset");

    try {
      await appendUserAuditEvent(targetUid, {
        type: "account_activated",
        action: "Credentials updated by admin",
        description: parts.join(" · ") || "Credentials updated",
        meta: getAuditRequestMeta(request),
        performedByUid: auth.uid,
        metadata: {
          emailChanged: Boolean(email && email !== prevEmail),
          passwordChanged: Boolean(password),
          previousEmail: prevEmail || null,
          newEmail: email || null,
        },
      });
    } catch (auditErr) {
      console.warn("[credentials] audit failed", auditErr);
    }

    return NextResponse.json({
      success: true,
      emailUpdated: Boolean(email && email !== prevEmail),
      passwordUpdated: Boolean(password),
      email: email || prevEmail || null,
    });
  } catch (e) {
    console.error("[POST /api/admin/users/credentials]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to update credentials." },
      { status: 500 }
    );
  }
}
