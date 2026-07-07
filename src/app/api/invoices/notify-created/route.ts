/**
 * Manual fallback to resend invoice-created email.
 * Primary automation runs in Firebase Functions (`onClientInvoiceCreated`).
 */
import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { notifyClientInvoiceCreated } from "@/lib/client-invoice-email-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CRON_SECRET = process.env.INVOICE_CRON_SECRET || process.env.CRON_SECRET;

function normalizeRole(v: unknown): string {
  return String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isAdminLikeToken(claims: Record<string, unknown> | undefined): boolean {
  if (!claims) return false;
  if (claims.admin === true || claims.isAdmin === true) return true;
  if (claims.sub_admin === true || claims.subAdmin === true || claims.isSubAdmin === true) return true;
  const role = normalizeRole(claims.role);
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;
  const roles = Array.isArray(claims.roles) ? claims.roles.map(normalizeRole) : [];
  return roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin");
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  if (!CRON_SECRET) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${CRON_SECRET}`) return true;
  const secretParam = new URL(request.url).searchParams.get("secret");
  if (secretParam === CRON_SECRET) return true;

  if (header?.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token && token !== CRON_SECRET) {
      try {
        const decoded = await adminAuth().verifyIdToken(token);
        if (isAdminLikeToken(decoded as Record<string, unknown>)) return true;
      } catch {
        return false;
      }
    }
  }
  return false;
}

export async function POST(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const userId = String(body.userId || "").trim();
    const invoiceId = String(body.invoiceId || "").trim();
    if (!userId || !invoiceId) {
      return NextResponse.json({ error: "userId and invoiceId are required." }, { status: 400 });
    }

    const result = await notifyClientInvoiceCreated({ userId, invoiceId });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error("notify-created failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to notify invoice created." },
      { status: 500 }
    );
  }
}
