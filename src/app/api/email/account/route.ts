import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import {
  buildAccountApprovedEmail,
  buildWelcomeAccountEmail,
} from "@/lib/account-email-templates";
import { requireAdmin, verifyBearerToken } from "@/lib/api-admin-auth";
import { adminDb } from "@/lib/firebase-admin";
import { getAppLoginUrl, sendTransactionalEmail } from "@/lib/smtp-send";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const type = String(body.type || "").trim();

    if (type === "welcome") {
      const decoded = await verifyBearerToken(request);
      if (!decoded?.uid) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }

      const userSnap = await adminDb().collection("users").doc(decoded.uid).get();
      if (!userSnap.exists) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      const user = userSnap.data()!;
      if (user.status !== "pending") {
        return NextResponse.json({ error: "Welcome email not applicable" }, { status: 400 });
      }

      const createdAt = user.createdAt;
      let createdMs = Date.now();
      if (createdAt instanceof Timestamp) createdMs = createdAt.toMillis();
      else if (createdAt instanceof Date) createdMs = createdAt.getTime();
      else if (typeof createdAt === "string") createdMs = new Date(createdAt).getTime();

      if (Date.now() - createdMs > 15 * 60 * 1000) {
        return NextResponse.json({ error: "Registration window expired" }, { status: 400 });
      }

      const contactName = String(body.contactName || user.name || "there");
      const companyName = String(body.companyName || user.companyName || "your company");
      const to = String(body.email || user.email || decoded.email || "").trim();
      if (!to) {
        return NextResponse.json({ error: "Missing recipient email" }, { status: 400 });
      }

      const mail = buildWelcomeAccountEmail({
        contactName,
        companyName,
        loginUrl: getAppLoginUrl(),
      });
      await sendTransactionalEmail({ to, ...mail });
      return NextResponse.json({ success: true });
    }

    if (type === "approved") {
      const auth = await requireAdmin(request);
      if (!auth.ok) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
      }

      const userId = String(body.userId || "").trim();
      const to = String(body.email || "").trim();
      const contactName = String(body.contactName || "there").trim();
      const companyName = String(body.companyName || "your company").trim();

      if (!to) {
        return NextResponse.json({ error: "Missing recipient email" }, { status: 400 });
      }

      const mail = buildAccountApprovedEmail({
        contactName,
        companyName,
        loginUrl: getAppLoginUrl(),
      });
      await sendTransactionalEmail({ to, ...mail });

      if (userId) {
        await adminDb().collection("users").doc(userId).set(
          { approvalEmailSentAt: Timestamp.now() },
          { merge: true }
        );
      }

      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid email type" }, { status: 400 });
  } catch (e) {
    console.error("[Account email]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to send email" },
      { status: 500 }
    );
  }
}
