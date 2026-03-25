import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getValidEbayToken, getEbayApiBaseUrl } from "@/lib/ebay-api";
import { XMLParser } from "fast-xml-parser";

export const dynamic = "force-dynamic";

function toArray<T>(value: T | T[] | undefined | null): T[] {
  if (Array.isArray(value)) return value;
  if (value == null) return [];
  return [value];
}

/**
 * POST: Refresh eBay inventory doc quantities from eBay (eBay → PrepCorex).
 * Body: { userId, connectionId } or cron with no body (runs for first N connections).
 * Updates users/{uid}/inventory docs where source=ebay and ebayConnectionId=connectionId.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const secret = process.env.EBAY_CRON_SECRET || process.env.CRON_SECRET;
  const isCron = !!secret && (authHeader === `Bearer ${secret}` || request.nextUrl.searchParams.get("secret") === secret);

  let userId: string | undefined;
  let connectionId: string | undefined;
  if (!isCron) {
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const token = authHeader.slice(7).trim();
    let callerUid: string;
    let isAdmin = false;
    try {
      const decoded = await adminAuth().verifyIdToken(token);
      callerUid = decoded.uid;
      const userDoc = await adminDb().collection("users").doc(callerUid).get();
      const data = userDoc.data();
      isAdmin = (data?.role as string) === "admin" || (Array.isArray(data?.roles) && (data?.roles as string[]).includes("admin"));
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const body = await request.json().catch(() => ({}));
    userId = (body.userId as string)?.trim() || callerUid;
    connectionId = (body.connectionId as string)?.trim();
    if (userId !== callerUid && !isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  } else {
    const body = await request.json().catch(() => ({}));
    userId = (body.userId as string)?.trim();
    connectionId = (body.connectionId as string)?.trim();
  }

  const db = adminDb();

  async function refreshConnection(uid: string, connId: string): Promise<{ updated: number; error?: string }> {
    const conn = await getValidEbayToken(uid, connId);
    if (!conn) return { updated: 0, error: "Token invalid" };

    const connSnap = await db.collection("users").doc(uid).collection("ebayConnections").doc(connId).get();
    if (!connSnap.exists) return { updated: 0 };
    const connData = connSnap.data() ?? {};
    const selectedListings = Array.isArray(connData.selectedListings) ? (connData.selectedListings as Array<{ id?: string; offerId?: string; listingId?: string }>) : [];
    if (selectedListings.length === 0) return { updated: 0 };

    const base = getEbayApiBaseUrl(conn.isSandbox);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${conn.accessToken}`,
      "Accept-Language": "en-US",
      "Content-Language": "en-US",
    };

    const quantityByKey: Record<string, number> = {};

    const offerIds = selectedListings.map((s) => s.offerId).filter(Boolean) as string[];
    for (const offerId of offerIds) {
      try {
        const res = await fetch(`${base}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { headers });
        if (res.ok) {
          const data = (await res.json()) as { availableQuantity?: number };
          const q = Number(data.availableQuantity ?? 0);
          quantityByKey[offerId] = q;
        }
      } catch {
        // skip
      }
    }

    const listingIds = selectedListings.map((s) => s.listingId).filter(Boolean) as string[];
    if (listingIds.length > 0) {
      const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
      const bodyXml = `<?xml version="1.0" encoding="utf-8"?>
<GetMyeBaySellingRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <DetailLevel>ReturnAll</DetailLevel>
  <ActiveList>
    <Include>true</Include>
    <Pagination><EntriesPerPage>200</EntriesPerPage><PageNumber>1</PageNumber></Pagination>
  </ActiveList>
</GetMyeBaySellingRequest>`;
      const tradingBase = conn.isSandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
      const res = await fetch(`${tradingBase}/ws/api.dll`, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "X-EBAY-API-CALL-NAME": "GetMyeBaySelling",
          "X-EBAY-API-SITEID": "0",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "1209",
          "X-EBAY-API-IAF-TOKEN": conn.accessToken,
        },
        body: bodyXml,
      });
      if (res.ok) {
        const xml = await res.text();
        const parsed = parser.parse(xml) as { GetMyeBaySellingResponse?: { ActiveList?: { ItemArray?: { Item?: unknown } } } };
        const items = toArray(parsed.GetMyeBaySellingResponse?.ActiveList?.ItemArray?.Item);
        for (const item of items) {
          const raw = item as Record<string, unknown>;
          const itemId = String(raw?.ItemID ?? raw?.itemID ?? "").trim();
          const qty = Number(raw?.QuantityAvailable ?? raw?.quantityAvailable ?? raw?.Quantity ?? raw?.quantity ?? 0);
          if (itemId) quantityByKey[itemId] = qty;
        }
      }
    }

    let updated = 0;
    const invRef = db.collection("users").doc(uid).collection("inventory");
    for (const row of selectedListings) {
      const key = row.id || row.offerId || row.listingId || "";
      if (!key) continue;
      const q = quantityByKey[key] ?? quantityByKey[row.offerId!] ?? quantityByKey[row.listingId!];
      if (q === undefined) continue;
      const docId = `ebay_${connId}_${key}`.replace(/\s/g, "_");
      const status = q > 0 ? "In Stock" : "Out of Stock";
      await invRef.doc(docId).set({ quantity: q, status }, { merge: true });
      updated++;
    }
    return { updated };
  }

  try {
    if (userId && connectionId) {
      const result = await refreshConnection(userId, connectionId);
      return NextResponse.json({ ok: true, updated: result.updated, error: result.error });
    }

    if (isCron) {
      const snap = await db.collectionGroup("ebayConnections").limit(20).get();
      let totalUpdated = 0;
      for (const d of snap.docs) {
        const uid = d.reference.parent.parent?.id;
        if (!uid) continue;
        const result = await refreshConnection(uid, d.id);
        totalUpdated += result.updated;
      }
      return NextResponse.json({ ok: true, connections: snap.size, totalUpdated });
    }

    return NextResponse.json({ error: "Provide userId and connectionId" }, { status: 400 });
  } catch (err: unknown) {
    console.error("[ebay refresh-inventory]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
