import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import { normalizeWooStoreUrl, wooValidateCredentials } from "@/lib/woocommerce-api";
import { syncWooCommerceOrdersForConnection } from "@/lib/woocommerce-sync";

export const dynamic = "force-dynamic";

async function requireUid(request: NextRequest): Promise<string> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  const decoded = await adminAuth().verifyIdToken(token);
  if (!decoded.uid) throw Object.assign(new Error("Unauthorized"), { status: 401 });
  return decoded.uid;
}

/** POST: connect WooCommerce store (URL + Consumer Key/Secret), then sync orders. */
export async function POST(request: NextRequest) {
  try {
    const uid = await requireUid(request);
    const body = await request.json();
    const consumerKey = String(body.consumerKey || "").trim();
    const consumerSecret = String(body.consumerSecret || "").trim();
    const accountLabel = String(body.accountLabel || "").trim() || "WooCommerce";
    let storeUrl = String(body.storeUrl || "").trim();

    if (!storeUrl || !consumerKey || !consumerSecret) {
      return NextResponse.json(
        { error: "Store URL, Consumer Key, and Consumer Secret are required" },
        { status: 400 }
      );
    }

    storeUrl = normalizeWooStoreUrl(storeUrl);
    await wooValidateCredentials({ storeUrl, consumerKey, consumerSecret });

    const col = adminDb().collection("users").doc(uid).collection("woocommerceConnections");
    const existing = await col.where("storeUrl", "==", storeUrl).limit(1).get();

    let connectionId: string;
    if (!existing.empty) {
      connectionId = existing.docs[0].id;
      await col.doc(connectionId).set(
        {
          storeUrl,
          consumerKey,
          consumerSecret,
          accountLabel,
          updatedAt: adminFieldValue().serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const docRef = await col.add({
        storeUrl,
        consumerKey,
        consumerSecret,
        accountLabel,
        connectedAt: adminFieldValue().serverTimestamp(),
        updatedAt: adminFieldValue().serverTimestamp(),
      });
      connectionId = docRef.id;
    }

    const sync = await syncWooCommerceOrdersForConnection({
      userId: uid,
      connectionId,
      creds: { storeUrl, consumerKey, consumerSecret },
    });

    return NextResponse.json({
      ok: true,
      connectionId,
      storeUrl,
      synced: sync.synced,
      openCount: sync.openCount,
    });
  } catch (error: unknown) {
    const status = (error as { status?: number })?.status || 500;
    console.error("[woocommerce connect]", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to connect WooCommerce",
      },
      { status: status === 401 ? 401 : 500 }
    );
  }
}
