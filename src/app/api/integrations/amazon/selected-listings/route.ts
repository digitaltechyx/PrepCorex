import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import type { AmazonSelectedListing } from "@/types";
import { buildAmazonListingKey, sanitizeAmazonFirestoreKey } from "@/lib/amazon-sp-api";

export const dynamic = "force-dynamic";

const AMAZON_INVENTORY_SOURCE = "amazon";

type SelectedListingPayload = AmazonSelectedListing;

function parseSelectedListings(raw: unknown): SelectedListingPayload[] {
  if (!Array.isArray(raw)) return [];
  const rows: SelectedListingPayload[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const sellerSku =
      (typeof rec.sellerSku === "string" && rec.sellerSku.trim()) ||
      (typeof rec.sku === "string" && rec.sku.trim()) ||
      "";
    const marketplaceId =
      typeof rec.marketplaceId === "string" ? rec.marketplaceId.trim() : "";
    if (!sellerSku || !marketplaceId) continue;

    const id =
      (typeof rec.id === "string" && rec.id.trim()) ||
      buildAmazonListingKey(marketplaceId, sellerSku);
    const title =
      (typeof rec.title === "string" && rec.title.trim()) || sellerSku;
    const asin = typeof rec.asin === "string" ? rec.asin.trim() : undefined;
    const status = typeof rec.status === "string" ? rec.status : undefined;
    const fulfillmentChannel =
      typeof rec.fulfillmentChannel === "string" ? rec.fulfillmentChannel : undefined;
    const parsedQuantity =
      typeof rec.quantity === "number"
        ? rec.quantity
        : typeof rec.quantity === "string"
          ? Number(rec.quantity)
          : NaN;
    const quantity =
      Number.isFinite(parsedQuantity) && parsedQuantity >= 0
        ? Math.floor(parsedQuantity)
        : undefined;

    rows.push({
      id,
      sellerSku,
      marketplaceId,
      title,
      ...(asin ? { asin } : {}),
      sku: sellerSku,
      ...(status ? { status } : {}),
      ...(typeof quantity === "number" ? { quantity } : {}),
      ...(fulfillmentChannel ? { fulfillmentChannel } : {}),
    });
  }
  return rows;
}

/** GET: return selected Amazon listings for a connection. */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim() || undefined;

  try {
    const col = adminDb().collection("users").doc(uid).collection("amazonConnections");
    let data: Record<string, unknown> = {};
    if (connectionId) {
      const snap = await col.doc(connectionId).get();
      if (!snap.exists) {
        return NextResponse.json({ selectedListings: [], selectedListingKeys: [] });
      }
      data = snap.data() ?? {};
    } else {
      const snapshot = await col.limit(1).get();
      if (snapshot.empty) {
        return NextResponse.json({ selectedListings: [], selectedListingKeys: [] });
      }
      data = snapshot.docs[0]!.data() ?? {};
    }

    const selectedListings = Array.isArray(data.selectedListings) ? data.selectedListings : [];
    const selectedListingKeys = Array.isArray(data.selectedListingKeys)
      ? data.selectedListingKeys
      : Array.isArray(data.selectedAsinKeys)
        ? data.selectedAsinKeys
        : [];
    return NextResponse.json({ selectedListings, selectedListingKeys });
  } catch (err: unknown) {
    console.error("[amazon selected-listings GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}

/** POST: save selected Amazon listings and sync PrepCorex inventory rows. */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const connectionId = typeof body.connectionId === "string" ? body.connectionId.trim() : undefined;
  const selectedListings = parseSelectedListings(body.selectedListings);

  try {
    const col = adminDb().collection("users").doc(uid).collection("amazonConnections");
    let docRef;
    if (connectionId) {
      const snap = await col.doc(connectionId).get();
      if (!snap.exists) {
        return NextResponse.json({ error: "No Amazon connection found" }, { status: 400 });
      }
      docRef = snap.ref;
    } else {
      const snapshot = await col.limit(1).get();
      if (snapshot.empty) {
        return NextResponse.json({ error: "No Amazon connection found" }, { status: 400 });
      }
      docRef = snapshot.docs[0]!.ref;
    }

    const selectedListingsMap = new Map<string, SelectedListingPayload>();
    for (const row of selectedListings) {
      selectedListingsMap.set(row.id, row);
    }
    const selectedListingKeys = Array.from(selectedListingsMap.keys());
    const connId = docRef.id;

    await docRef.update({
      selectedListings: Array.from(selectedListingsMap.values()),
      selectedListingKeys,
      selectedAsinKeys: selectedListingKeys,
    });

    const FieldValue = adminFieldValue();
    const invRef = adminDb().collection("users").doc(uid).collection("inventory");
    const lookupRef = adminDb().collection("amazonInventoryLookup");
    const selectedIds = new Set(selectedListingsMap.keys());

    for (const row of selectedListingsMap.values()) {
      const quantity = typeof row.quantity === "number" ? row.quantity : 0;
      const statusLower = (row.status || "").toLowerCase();
      const status =
        statusLower.includes("buyable") || statusLower.includes("active") || quantity > 0
          ? "In Stock"
          : "Out of Stock";
      const safeMarketplace = sanitizeAmazonFirestoreKey(row.marketplaceId);
      const safeSku = sanitizeAmazonFirestoreKey(row.sellerSku);
      const docId = `amazon_${connId}_${safeMarketplace}_${safeSku}`;
      const inventoryPath = `users/${uid}/inventory/${docId}`;

      await invRef.doc(docId).set(
        {
          productName: row.title || row.sellerSku,
          sku: row.sellerSku,
          quantity,
          status,
          dateAdded: FieldValue.serverTimestamp(),
          source: AMAZON_INVENTORY_SOURCE,
          amazonConnectionId: connId,
          amazonSellerSku: row.sellerSku,
          amazonMarketplaceId: row.marketplaceId,
          ...(row.asin ? { amazonAsin: row.asin } : {}),
        },
        { merge: true }
      );

      const lookupId = `${uid}_${connId}_${sanitizeAmazonFirestoreKey(row.id)}`;
      await lookupRef.doc(lookupId).set(
        {
          userId: uid,
          connectionId: connId,
          inventoryPath,
          listingKey: row.id,
          sellerSku: row.sellerSku,
          marketplaceId: row.marketplaceId,
          ...(row.asin ? { asin: row.asin } : {}),
        },
        { merge: true }
      );
    }

    const existingAmazon = await invRef
      .where("source", "==", AMAZON_INVENTORY_SOURCE)
      .where("amazonConnectionId", "==", connId)
      .get();

    for (const d of existingAmazon.docs) {
      const data = d.data();
      const sellerSku = String(data.amazonSellerSku ?? "");
      const marketplaceId = String(data.amazonMarketplaceId ?? "");
      const key =
        sellerSku && marketplaceId
          ? buildAmazonListingKey(marketplaceId, sellerSku)
          : d.id.replace(`amazon_${connId}_`, "");
      if (!selectedIds.has(key)) {
        await d.ref.delete();
        const lookupId = `${uid}_${connId}_${sanitizeAmazonFirestoreKey(key)}`;
        await lookupRef.doc(lookupId).delete();
      }
    }

    return NextResponse.json({
      ok: true,
      selectedListings: Array.from(selectedListingsMap.values()),
      selectedListingKeys,
    });
  } catch (err: unknown) {
    console.error("[amazon selected-listings POST]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
