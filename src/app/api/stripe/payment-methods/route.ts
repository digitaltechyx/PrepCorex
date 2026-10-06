import { NextRequest, NextResponse } from "next/server";
import { verifyBearerToken } from "@/lib/api-admin-auth";
import { detachSavedCard, listSavedCards } from "@/lib/stripe-customer";

/** GET — list saved cards for the signed-in user */
export async function GET(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cards = await listSavedCards(decoded.uid);
    return NextResponse.json({ cards });
  } catch (error: unknown) {
    console.error("[stripe/payment-methods GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list cards." },
      { status: 500 }
    );
  }
}

/** DELETE — remove a saved card (?paymentMethodId=pm_xxx) */
export async function DELETE(request: NextRequest) {
  try {
    const decoded = await verifyBearerToken(request);
    if (!decoded?.uid) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const paymentMethodId = String(
      request.nextUrl.searchParams.get("paymentMethodId") || ""
    ).trim();
    if (!paymentMethodId) {
      return NextResponse.json({ error: "paymentMethodId is required" }, { status: 400 });
    }

    await detachSavedCard(decoded.uid, paymentMethodId);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    console.error("[stripe/payment-methods DELETE]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to remove card." },
      { status: 500 }
    );
  }
}
