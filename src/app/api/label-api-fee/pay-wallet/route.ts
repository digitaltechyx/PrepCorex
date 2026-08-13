import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { payLabelApiFeeFromWallet } from "@/lib/label-billing-admin";

export async function POST(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await payLabelApiFeeFromWallet(adminDb(), {
      userId: decoded.uid,
      actorUid: decoded.uid,
      actorName: null,
    });

    return NextResponse.json({ ok: true, settings });
  } catch (error: unknown) {
    console.error("[label-api-fee/pay-wallet]", error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code || "")
        : "";
    const status =
      code === "WALLET_INSUFFICIENT" ||
      code === "API_FEE_PENDING" ||
      code === "API_FEE_ALREADY_PAID" ||
      code === "API_FEE_NOT_REQUIRED"
        ? 400
        : 500;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not pay API fee." },
      { status }
    );
  }
}
