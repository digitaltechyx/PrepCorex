/**
 * API Route: Generate Monthly Storage Invoices
 * Generates storage invoices for all users with storage pricing configured
 * Should be called monthly (e.g., on the 1st of each month)
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { format } from "date-fns";
import { generateInvoiceNumber } from "@/lib/invoice-utils";
import { applyClientInvoiceLifecycleFields } from "@/lib/client-invoice-lifecycle";
import { getLatestStorageTierRates, listActivePalletCycles, toDate, add30Days, getRateForPaidCycle } from "@/lib/pallet-storage-sync";

const CRON_SECRET = process.env.INVOICE_CRON_SECRET || process.env.CRON_SECRET;

function isAdminLikeUserDoc(data: any): boolean {
  if (!data) return false;
  if (data.isAdmin === true || data.admin === true || data.is_admin === true) return true;
  if (data.isSubAdmin === true || data.is_sub_admin === true) return true;

  const role = String(data.role || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;

  const roles = Array.isArray(data.roles) ? data.roles.map((r: any) => String(r || "").trim().toLowerCase().replace(/[\s-]+/g, "_")) : [];
  if (roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin")) return true;

  // features can be array or map
  if (Array.isArray(data.features)) {
    if (data.features.includes("admin_dashboard") || data.features.includes("manage_invoices") || data.features.includes("manage_users")) return true;
  } else if (data.features && typeof data.features === "object") {
    if (data.features.admin_dashboard === true || data.features.manage_invoices === true || data.features.manage_users === true) return true;
  }

  return false;
}

async function isAuthorized(request: NextRequest): Promise<boolean> {
  // If no secret is configured, allow (dev/test).
  if (!CRON_SECRET) return true;

  // 1) Cron secret (header or query param)
  const header = request.headers.get("authorization");
  if (header === `Bearer ${CRON_SECRET}`) return true;
  const url = new URL(request.url);
  const secretParam = url.searchParams.get("secret");
  if (secretParam && secretParam === CRON_SECRET) return true;

  // 2) Admin user session via Firebase ID token (for live admin UI)
  // We intentionally reuse Authorization: Bearer <idToken> (if it isn't the CRON secret)
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    if (token && token !== CRON_SECRET) {
      try {
        const decoded = await adminAuth().verifyIdToken(token);
        const uid = decoded?.uid;
        if (!uid) return false;
        const db = adminDb();
        const snap = await db.collection("users").doc(uid).get();
        const userData = snap.exists ? snap.data() : null;
        if (isAdminLikeUserDoc(userData)) return true;
      } catch (e) {
        // ignore
      }
    }
  }

  return false;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Handle both GET (for testing) and POST (for cron)
export async function GET(request: NextRequest) {
  return handleRequest(request);
}

export async function POST(request: NextRequest) {
  return handleRequest(request);
}

async function handleRequest(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db = adminDb();
    const url = new URL(request.url);
    const userIdParam = url.searchParams.get("userId") || undefined;
    const monthParam = url.searchParams.get("month") || undefined; // YYYY-MM
    const isTest = ["1", "true", "yes"].includes((url.searchParams.get("test") || "").toLowerCase());
    const force = ["1", "true", "yes"].includes((url.searchParams.get("force") || "").toLowerCase());

    const now = new Date();
    const invoiceMonthBase = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : format(now, "yyyy-MM");
    const invoiceMonthForDoc = isTest ? `${invoiceMonthBase}-test-${format(now, "yyyyMMdd-HHmmss")}` : invoiceMonthBase;

    const usersSnapshot = userIdParam
      ? await db.collection("users").where("__name__", "==", userIdParam).get()
      : await db.collection("users").get();
    const results: Array<Record<string, unknown>> = [];
    const today = now;

    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data() || {};

      // Skip if user is deleted or not approved
      if (userData.status === "deleted" || (userData.status && userData.status !== "approved")) {
        results.push({ userId, status: "skipped_user_not_approved" });
        continue;
      }

      const storageType = userData.storageType || "pallet_base";
      if (storageType !== "pallet_base") {
        results.push({ userId, status: "skipped_non_pallet_storage", storageType });
        continue;
      }

      const tierRates = await getLatestStorageTierRates(db, userId);
      if (!tierRates.month1Rate && !tierRates.month2to6Rate && !tierRates.month6PlusRate) {
        results.push({ userId, status: "skipped_invalid_price" });
        continue;
      }

      const activeCycles = await listActivePalletCycles(db, userId);
      const dueCycles = activeCycles.filter((cycle) => {
        const freeUntil = toDate((cycle as any).freeUntil);
        if (freeUntil && freeUntil.getTime() > now.getTime()) {
          return false;
        }
        const dueDate = toDate(cycle.nextInvoiceDate) || toDate(cycle.assignedAt);
        if (!dueDate) return false;
        return force || dueDate.getTime() <= now.getTime();
      });

      if (dueCycles.length === 0) {
        results.push({
          userId,
          status: "skipped_no_due_cycles",
          activePallets: activeCycles.length,
        });
        continue;
      }

      const invoiceItems = dueCycles.map((cycle) => {
        const paidCycleCount = Math.max(0, Number((cycle as any).paidCycleCount) || 0);
        const unitPrice = getRateForPaidCycle(paidCycleCount, tierRates);
        const label = String((cycle as any).positionLabel || cycle.id).trim();
        return {
          quantity: 1,
          productName: `Storage — Pallet ${label} (cycle ${paidCycleCount + 1})`,
          shipDate: format(today, "yyyy-MM-dd"),
          shipTo: "N/A",
          packaging: "Storage",
          unitPrice,
          amount: unitPrice,
          palletCycleId: cycle.id,
          paidCycleCount,
        };
      });

      const itemCount = dueCycles.length;
      const totalAmount = Number(
        invoiceItems.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)
      );
      if (totalAmount <= 0) {
        results.push({ userId, status: "skipped_no_charge", dueCycles: itemCount });
        continue;
      }

      const invoiceNumber = generateInvoiceNumber(today);
      const orderNumber = `STOR-${format(today, "yyyyMMdd")}-${Date.now().toString().slice(-4)}`;

      const invoiceDoc = applyClientInvoiceLifecycleFields({
        invoiceNumber,
        date: format(today, "yyyy-MM-dd"),
        orderNumber,
        soldTo: {
          name: userData.name || userData.companyName || "Client",
          email: userData.email || "",
          phone: userData.phone || "",
          address: userData.address || "",
        },
        fbm: "Storage Fee",
        items: invoiceItems,
        subtotal: totalAmount,
        grandTotal: totalAmount,
        status: "pending",
        createdAt: new Date(),
        userId,
        type: "storage",
        invoiceMonth: invoiceMonthForDoc,
        autoGenerated: true,
        autoGeneratedAt: new Date(),
        storageType,
        itemCount,
        palletCount: itemCount,
        palletCycleIds: dueCycles.map((c) => c.id),
        ...(isTest && { isTest: true, testRunAt: new Date(), testOfInvoiceMonth: invoiceMonthBase }),
      });

      const createdInvoice = await db.collection(`users/${userId}/invoices`).add(invoiceDoc);

      for (const cycle of dueCycles) {
        const currentDueDate = toDate(cycle.nextInvoiceDate) || now;
        const nextDate = add30Days(currentDueDate);
        const prevPaid = Math.max(0, Number((cycle as any).paidCycleCount) || 0);
        await db.collection(`users/${userId}/palletStorageCycles`).doc(cycle.id).update({
          lastInvoicedAt: now,
          lastInvoiceId: createdInvoice.id,
          lastInvoiceNumber: invoiceNumber,
          nextInvoiceDate: nextDate,
          paidCycleCount: prevPaid + 1,
          updatedAt: now,
        });
      }

      results.push({
        userId,
        status: "invoice_created",
        invoiceNumber,
        storageType,
        itemCount,
        total: totalAmount,
        invoiceMonth: invoiceMonthForDoc,
        palletCyclesInvoiced: dueCycles.length,
        ...(isTest && { isTest: true }),
      });
    }

    return NextResponse.json({
      success: true,
      invoiceMonth: invoiceMonthForDoc,
      results,
    });
  } catch (error: any) {
    console.error("Monthly storage invoice generation failed:", error);
    return NextResponse.json(
      {
        error: "Monthly storage invoice generation failed",
        details: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}

