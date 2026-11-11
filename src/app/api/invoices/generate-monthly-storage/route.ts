/**
 * API Route: Generate Monthly Storage Invoices
 * Generates storage invoices for all users with storage pricing configured
 * Should be called monthly (e.g., on the 1st of each month)
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { format } from "date-fns";
import { getLatestStorageTierRates, listActivePalletCycles, toDate, add30Days, getRateForPaidCycle } from "@/lib/pallet-storage-sync";
import { formatStoragePalletInvoiceProductName } from "@/lib/pallet-storage-billing";
import { createCrmStorageDraftInvoiceAdmin } from "@/lib/crm-storage-draft-invoice-admin";

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
  // CRM Storage draft path is on by default. Opt out with DISABLE_MONTHLY_STORAGE_CRM_DRAFT=true.
  // (Old PrepCorex-direct auto-invoice remains off; drafts go to CRM for review first.)
  if (process.env.DISABLE_MONTHLY_STORAGE_CRM_DRAFT === "true") {
    return NextResponse.json(
      {
        ok: false,
        disabled: true,
        error: "monthly_storage_crm_draft_disabled",
        message:
          "Monthly storage → CRM draft generation is disabled (DISABLE_MONTHLY_STORAGE_CRM_DRAFT=true).",
      },
      { status: 410 }
    );
  }

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

      const crmLines = dueCycles.map((cycle) => {
        const paidCycleCount = Math.max(0, Number((cycle as any).paidCycleCount) || 0);
        const unitPrice = getRateForPaidCycle(paidCycleCount, tierRates);
        const description = formatStoragePalletInvoiceProductName({
          id: cycle.id,
          positionLabel: (cycle as any).positionLabel,
          palletSequence: (cycle as any).palletSequence,
          assignedAt: (cycle as any).assignedAt,
          paidCycleCount,
          cartonCount: (cycle as any).cartonCount,
          source: (cycle as any).source,
        });
        return {
          description: `${description} · Month ${invoiceMonthBase}`,
          quantity: 1,
          unitPrice,
          amount: unitPrice,
          palletCycleId: cycle.id,
          sourceKey: `storage:${cycle.id}:${invoiceMonthBase}:${paidCycleCount}`,
        };
      });

      const itemCount = dueCycles.length;
      const totalAmount = Number(
        crmLines.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)
      );
      if (totalAmount <= 0) {
        results.push({ userId, status: "skipped_no_charge", dueCycles: itemCount });
        continue;
      }

      // CRM Storage draft first — PrepCorex only after admin Send / Mark as sent + sync.
      const draft = await createCrmStorageDraftInvoiceAdmin({
        db,
        clientUserId: userId,
        clientName: userData.name || userData.companyName || "Client",
        clientEmail: userData.email || "",
        clientPhone: userData.phone || "",
        invoiceMonth: invoiceMonthBase,
        lines: crmLines,
        palletCycleIds: dueCycles.map((c) => c.id),
        isTest,
        forceNew: isTest,
      });

      if (draft.created) {
        for (const cycle of dueCycles) {
          const currentDueDate = toDate(cycle.nextInvoiceDate) || now;
          const nextDate = add30Days(currentDueDate);
          const prevPaid = Math.max(0, Number((cycle as any).paidCycleCount) || 0);
          await db.collection(`users/${userId}/palletStorageCycles`).doc(cycle.id).update({
            lastInvoicedAt: now,
            lastCrmStorageDraftId: draft.externalInvoiceId,
            lastInvoiceNumber: draft.invoiceNumber,
            nextInvoiceDate: nextDate,
            paidCycleCount: prevPaid + 1,
            updatedAt: now,
          });
        }
      }

      results.push({
        userId,
        status: draft.created ? "crm_storage_draft_created" : "crm_storage_draft_exists",
        invoiceNumber: draft.invoiceNumber,
        externalInvoiceId: draft.externalInvoiceId,
        storageType,
        itemCount,
        total: totalAmount,
        invoiceMonth: invoiceMonthForDoc,
        palletCyclesInvoiced: dueCycles.length,
        destination: "crm_storage_draft",
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

