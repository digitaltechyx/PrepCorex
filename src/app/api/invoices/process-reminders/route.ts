/**
 * Manual fallback for client invoice reminders.
 * Primary automation runs in Firebase Functions (`sendClientInvoiceReminders`).
 */
import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { processClientInvoiceRemindersForUser } from "@/lib/client-invoice-email-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CRON_SECRET = process.env.INVOICE_CRON_SECRET || process.env.CRON_SECRET;

function isAuthorized(request: NextRequest): boolean {
  if (!CRON_SECRET) return true;
  const header = request.headers.get("authorization");
  if (header === `Bearer ${CRON_SECRET}`) return true;
  const secretParam = new URL(request.url).searchParams.get("secret");
  return secretParam === CRON_SECRET;
}

export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

async function handleRequest(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = adminDb();
    const usersSnapshot = await db.collection("users").get();
    const results: Record<string, unknown>[] = [];

    for (const userDoc of usersSnapshot.docs) {
      const userResults = await processClientInvoiceRemindersForUser(userDoc.id);
      results.push(...userResults);
    }

    return NextResponse.json({
      success: true,
      actions: results.length,
      results,
    });
  } catch (error) {
    console.error("Client invoice reminder processing failed:", error);
    return NextResponse.json(
      {
        error: "Client invoice reminder processing failed",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
