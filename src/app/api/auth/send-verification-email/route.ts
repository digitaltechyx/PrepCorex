import { NextRequest, NextResponse } from "next/server";
import { buildEmailVerificationEmail } from "@/lib/account-email-templates";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { friendlySmtpErrorMessage, sendTransactionalEmail } from "@/lib/smtp-send";

export const dynamic = "force-dynamic";

const RESEND_COOLDOWN_MS = 60 * 1000;

function getEmailVerificationContinueUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "";
  return `${base}/login?verified=1`;
}

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid || !decoded.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (decoded.email_verified) {
      return NextResponse.json({ error: "Email is already verified." }, { status: 400 });
    }

    const userSnap = await adminDb().collection("users").doc(decoded.uid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    if (userData?.emailVerificationRequired !== true) {
      return NextResponse.json({ error: "Email verification is not required for this account." }, { status: 400 });
    }

    const lastSent = userData?.lastVerificationEmailSentAt;
    const lastSentMs =
      lastSent && typeof lastSent === "object" && typeof lastSent.toMillis === "function"
        ? lastSent.toMillis()
        : lastSent instanceof Date
          ? lastSent.getTime()
          : 0;
    const elapsedMs = lastSentMs ? Date.now() - lastSentMs : Number.POSITIVE_INFINITY;
    if (elapsedMs < RESEND_COOLDOWN_MS) {
      return NextResponse.json({
        success: true,
        throttled: true,
        cooldownSeconds: Math.ceil((RESEND_COOLDOWN_MS - elapsedMs) / 1000),
      });
    }

    const verificationUrl = await adminAuth().generateEmailVerificationLink(decoded.email, {
      url: getEmailVerificationContinueUrl(),
    });

    const mail = buildEmailVerificationEmail({
      contactName: String(userData?.name || decoded.name || ""),
      verificationUrl,
    });

    await sendTransactionalEmail({
      to: decoded.email,
      fromName: "PrepCorex",
      ...mail,
    });

    await adminDb().collection("users").doc(decoded.uid).set(
      {
        lastVerificationEmailSentAt: new Date(),
      },
      { merge: true }
    );

    return NextResponse.json({ success: true });
  } catch (e) {
    console.error("[POST /api/auth/send-verification-email]", e);
    const message = friendlySmtpErrorMessage(e);
    if (message.includes("already requested recently")) {
      return NextResponse.json(
        { error: message },
        { status: 429 }
      );
    }
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
