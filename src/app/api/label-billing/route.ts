import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { requireAdmin, verifyBearerToken } from "@/lib/api-admin-auth";
import {
  ensureLabelBillingPeriodRolled,
  adminUpdateLabelBilling,
  isLabelBillingExemptUser,
  loadNormalizedLabelBilling,
} from "@/lib/label-billing-admin";
import {
  formatLabelBillingPeriod,
  isLabelApiFeeBlocking,
  labelBillingRemainingCents,
  labelBillingPeriodEndsAt,
  labelBillingSummaryLine,
  normalizeLabelBillingSettings,
} from "@/lib/label-billing";
import type { LabelBillingPeriod } from "@/types";

/** GET ?userId= — self or admin */
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userId = String(request.nextUrl.searchParams.get("userId") || decoded.uid).trim();
    if (userId !== decoded.uid) {
      const admin = await requireAdmin(request);
      if (!admin.ok) {
        return NextResponse.json({ error: admin.error }, { status: admin.status });
      }
    }

    const exempt = await isLabelBillingExemptUser(adminDb(), userId);
    const settings = exempt
      ? (await loadNormalizedLabelBilling(adminDb(), userId)).settings
      : await ensureLabelBillingPeriodRolled(adminDb(), userId);
    const ends = labelBillingPeriodEndsAt(settings.period);
    return NextResponse.json({
      settings,
      exempt,
      apiFeeBlocking: !exempt && isLabelApiFeeBlocking(settings),
      summary: labelBillingSummaryLine(settings),
      remainingCents: labelBillingRemainingCents(settings),
      periodEndsAtIso: ends.toISOString(),
      periodLabel: formatLabelBillingPeriod(settings.period),
    });
  } catch (error: unknown) {
    console.error("[label-billing GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load billing." },
      { status: 500 }
    );
  }
}

/** PATCH — admin update mode/limit/period/reset/adjust/reissue */
export async function PATCH(request: NextRequest) {
  try {
    const admin = await requireAdmin(request);
    if (!admin.ok) {
      return NextResponse.json({ error: admin.error }, { status: admin.status });
    }

    const body = (await request.json()) as {
      userId?: string;
      mode?: "limit" | "wallet";
      limitAmountCents?: number;
      limitAmountDollars?: number;
      period?: LabelBillingPeriod;
      resetPeriodUsed?: boolean;
      walletBalanceCents?: number;
      walletBalanceDollars?: number;
      reissueCreditCents?: number;
      reissueCreditDollars?: number;
      markupCents?: number;
      markupDollars?: number;
      allowShippo?: boolean;
      allowShipbest?: boolean;
      apiFeeEnabled?: boolean;
      apiFeeCadence?: "monthly" | "onetime";
      apiFeeAmountCents?: number;
      apiFeeAmountDollars?: number;
      reason?: string;
    };

    const userId = String(body.userId || "").trim();
    if (!userId) {
      return NextResponse.json({ error: "userId is required." }, { status: 400 });
    }

    const limitAmountCents =
      body.limitAmountCents != null
        ? Math.round(Number(body.limitAmountCents))
        : body.limitAmountDollars != null
          ? Math.round(Number(body.limitAmountDollars) * 100)
          : undefined;

    const walletBalanceCents =
      body.walletBalanceCents != null
        ? Math.round(Number(body.walletBalanceCents))
        : body.walletBalanceDollars != null
          ? Math.round(Number(body.walletBalanceDollars) * 100)
          : undefined;

    const reissueCreditCents =
      body.reissueCreditCents != null
        ? Math.round(Number(body.reissueCreditCents))
        : body.reissueCreditDollars != null
          ? Math.round(Number(body.reissueCreditDollars) * 100)
          : undefined;

    const markupCents =
      body.markupCents != null
        ? Math.round(Number(body.markupCents))
        : body.markupDollars != null
          ? Math.round(Number(body.markupDollars) * 100)
          : undefined;

    const apiFeeAmountCents =
      body.apiFeeAmountCents != null
        ? Math.round(Number(body.apiFeeAmountCents))
        : body.apiFeeAmountDollars != null
          ? Math.round(Number(body.apiFeeAmountDollars) * 100)
          : undefined;

    if (body.period && !["daily", "weekly", "monthly", "yearly"].includes(body.period)) {
      return NextResponse.json({ error: "Invalid period." }, { status: 400 });
    }

    if (
      body.apiFeeCadence != null &&
      body.apiFeeCadence !== "monthly" &&
      body.apiFeeCadence !== "onetime"
    ) {
      return NextResponse.json({ error: "Invalid API fee cadence." }, { status: 400 });
    }

    if (
      typeof body.allowShippo === "boolean" &&
      typeof body.allowShipbest === "boolean" &&
      !body.allowShippo &&
      !body.allowShipbest
    ) {
      return NextResponse.json(
        { error: "Enable at least one courier (Shippo or PrepCorex GOFO)." },
        { status: 400 }
      );
    }

    const settings = await adminUpdateLabelBilling(adminDb(), {
      userId,
      mode: body.mode,
      limitAmountCents,
      period: body.period,
      resetPeriodUsed: Boolean(body.resetPeriodUsed),
      walletBalanceCents,
      reissueCreditCents,
      markupCents,
      allowShippo: body.allowShippo,
      allowShipbest: body.allowShipbest,
      apiFeeEnabled: body.apiFeeEnabled,
      apiFeeCadence: body.apiFeeCadence,
      apiFeeAmountCents,
      reason: body.reason || null,
      actorUid: admin.uid,
      actorName: admin.name || null,
    });

    // Touch updatedAt on user for clients listening
    await adminDb().collection("users").doc(userId).set(
      { labelBilling: { ...normalizeLabelBillingSettings(settings), updatedAt: FieldValue.serverTimestamp() } },
      { merge: true }
    );

    return NextResponse.json({
      ok: true,
      settings,
      summary: labelBillingSummaryLine(settings),
    });
  } catch (error: unknown) {
    console.error("[label-billing PATCH]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update billing." },
      { status: 500 }
    );
  }
}
