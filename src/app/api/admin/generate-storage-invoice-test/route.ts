/**
 * Admin-only API: Generate a test storage invoice for a single user + month.
 * - Auth: Firebase ID token (Authorization: Bearer <idToken>)
 * - No CRON secret required
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { format } from "date-fns";
import { getLatestStorageTierRates, listActivePalletCycles, toDate, add30Days, getRateForPaidCycle } from "@/lib/pallet-storage-sync";
import { formatStoragePalletInvoiceProductName } from "@/lib/pallet-storage-billing";
import { createCrmStorageDraftInvoiceAdmin } from "@/lib/crm-storage-draft-invoice-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function normalizeRole(v: any): string {
  return String(v || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function isAdminLikeUserDoc(data: any): boolean {
  if (!data) return false;
  if (data.isAdmin === true || data.admin === true || data.is_admin === true) return true;
  if (data.isSubAdmin === true || data.is_sub_admin === true) return true;
  const role = normalizeRole(data.role || data.userRole || data.userType);
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;
  const roles = Array.isArray(data.roles) ? data.roles.map(normalizeRole) : [];
  if (roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin")) return true;
  if (Array.isArray(data.features)) {
    if (data.features.includes("admin_dashboard") || data.features.includes("manage_invoices") || data.features.includes("manage_users")) return true;
  } else if (data.features && typeof data.features === "object") {
    if (data.features.admin_dashboard === true || data.features.manage_invoices === true || data.features.manage_users === true) return true;
  }
  return false;
}

async function requireAdmin(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) return { ok: false as const, status: 401, error: "Unauthorized" };

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded?.uid;
    if (!uid) return { ok: false as const, status: 401, error: "Unauthorized" };

    const db = adminDb();
    const snap = await db.collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() : null;
    if (!isAdminLikeUserDoc(data)) {
      return { ok: false as const, status: 403, error: "Forbidden" };
    }

    return { ok: true as const, uid };
  } catch {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = await request.json().catch(() => ({}));
    const userId = String(body?.userId || "").trim();
    const monthParam = String(body?.month || "").trim(); // YYYY-MM

    if (!userId) {
      return NextResponse.json({ error: "Missing userId" }, { status: 400 });
    }

    const db = adminDb();
    const userSnap = await db.collection("users").doc(userId).get();
    if (!userSnap.exists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const userData = userSnap.data() || {};

    // Only generate for approved users (same as cron job)
    if (userData.status === "deleted" || (userData.status && userData.status !== "approved")) {
      return NextResponse.json({ error: "User is not approved" }, { status: 400 });
    }

    const now = new Date();
    const invoiceMonthBase = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? monthParam : format(now, "yyyy-MM");

    const invoiceMonthForDoc = `${invoiceMonthBase}-test-${format(now, "yyyyMMdd-HHmmss")}`;
    const storageType = userData.storageType || "pallet_base";
    if (storageType !== "pallet_base") {
      return NextResponse.json({ error: "Only pallet_base storage is supported now" }, { status: 400 });
    }

    const tierRates = await getLatestStorageTierRates(db, userId);
    if (!tierRates.month1Rate && !tierRates.month2to6Rate && !tierRates.month6PlusRate) {
      return NextResponse.json({ error: "No storage pricing configured or invalid price" }, { status: 400 });
    }

    const activeCycles = await listActivePalletCycles(db, userId);
    const dueCycles = activeCycles.filter((c) => {
      const freeUntil = toDate((c as any).freeUntil);
      if (freeUntil && freeUntil.getTime() > now.getTime()) return false;
      const dueDate = toDate(c.nextInvoiceDate) || toDate(c.assignedAt);
      return dueDate ? dueDate.getTime() <= now.getTime() : false;
    });

    if (dueCycles.length === 0) {
      return NextResponse.json(
        { error: "No due pallet cycles right now. Try after nextInvoiceDate or use cron force mode." },
        { status: 400 }
      );
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
        sourceKey: `storage:${cycle.id}:${invoiceMonthBase}:${paidCycleCount}:test`,
      };
    });
    const itemCount = dueCycles.length;
    const totalAmount = Number(
      crmLines.reduce((sum, item) => sum + Number(item.amount || 0), 0).toFixed(2)
    );

    if (totalAmount <= 0) {
      return NextResponse.json({ error: "No charge for this month (0 items/pallets)" }, { status: 400 });
    }

    const draft = await createCrmStorageDraftInvoiceAdmin({
      db,
      clientUserId: userId,
      clientName: userData.name || userData.companyName || "Client",
      clientEmail: userData.email || "",
      clientPhone: userData.phone || "",
      invoiceMonth: invoiceMonthBase,
      lines: crmLines,
      palletCycleIds: dueCycles.map((c) => c.id),
      adminUid: auth.uid,
      isTest: true,
      forceNew: true,
    });

    for (const cycle of dueCycles) {
      const dueDate = toDate(cycle.nextInvoiceDate) || now;
      const prevPaid = Math.max(0, Number((cycle as any).paidCycleCount) || 0);
      await db.collection(`users/${userId}/palletStorageCycles`).doc(cycle.id).update({
        lastInvoicedAt: now,
        lastCrmStorageDraftId: draft.externalInvoiceId,
        lastInvoiceNumber: draft.invoiceNumber,
        nextInvoiceDate: add30Days(dueDate),
        paidCycleCount: prevPaid + 1,
        updatedAt: now,
      });
    }

    return NextResponse.json({
      success: true,
      invoiceNumber: draft.invoiceNumber,
      externalInvoiceId: draft.externalInvoiceId,
      destination: "crm_storage_draft",
      invoiceMonth: invoiceMonthForDoc,
      itemCount,
      total: totalAmount,
      storageType,
    });
  } catch (error: any) {
    console.error("Admin storage test invoice generation failed:", error);
    return NextResponse.json(
      {
        error: "Monthly storage invoice generation failed",
        details: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}


