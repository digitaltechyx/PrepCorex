import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getValidEbayToken, getEbayApiBaseUrl } from "@/lib/ebay-api";
import { XMLParser } from "fast-xml-parser";

export const dynamic = "force-dynamic";

/**
 * POST: Set inventory quantity on eBay (PrepCorex → eBay).
 * Body: { userId, connectionId, offerId?, listingId?, newQuantity }
 * If offerId: use Inventory API updateOffer. If only listingId: use Trading API ReviseInventoryStatus.
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let callerUid: string;
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    if (!callerUid) throw new Error("No uid");
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    const data = userDoc.data();
    isAdmin =
      (data?.role as string) === "admin" ||
      (Array.isArray(data?.roles) && (data?.roles as string[]).includes("admin"));
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const userId = (body.userId as string)?.trim() || callerUid;
  const connectionId = (body.connectionId as string)?.trim();
  const offerId = (body.offerId as string)?.trim() || undefined;
  const listingId = (body.listingId as string)?.trim() || undefined;
  const newQuantity = typeof body.newQuantity === "number" ? Math.max(0, Math.floor(body.newQuantity)) : undefined;

  if (userId !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!connectionId || newQuantity === undefined) {
    return NextResponse.json(
      { error: "Missing connectionId or newQuantity" },
      { status: 400 }
    );
  }
  if (!offerId && !listingId) {
    return NextResponse.json(
      { error: "Provide at least one of offerId or listingId" },
      { status: 400 }
    );
  }

  const conn = await getValidEbayToken(userId, connectionId);
  if (!conn) {
    return NextResponse.json({ error: "eBay connection not found or token invalid" }, { status: 404 });
  }

  const base = getEbayApiBaseUrl(conn.isSandbox);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${conn.accessToken}`,
    "Content-Type": "application/json",
    "Accept-Language": "en-US",
    "Content-Language": "en-US",
  };

  try {
    if (offerId) {
      const getRes = await fetch(`${base}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, { headers });
      if (!getRes.ok) {
        const err = await getRes.json().catch(() => ({}));
        console.error("[ebay sync-inventory getOffer]", getRes.status, err);
        return NextResponse.json(
          { error: "Could not load offer from eBay. Ensure the listing uses the Inventory API." },
          { status: 502 }
        );
      }
      const offer = (await getRes.json()) as Record<string, unknown>;
      offer.availableQuantity = newQuantity;
      const putRes = await fetch(`${base}/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(offer),
      });
      if (!putRes.ok) {
        const errText = await putRes.text();
        console.error("[ebay sync-inventory updateOffer]", putRes.status, errText);
        return NextResponse.json(
          { error: "eBay rejected the quantity update. Check app has sell.inventory scope." },
          { status: 502 }
        );
      }
      return NextResponse.json({ success: true, available: newQuantity });
    }

    if (listingId) {
      const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, trimValues: true });
      const bodyXml = `<?xml version="1.0" encoding="utf-8"?>
<ReviseInventoryStatusRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <InventoryStatus>
    <ItemID>${listingId}</ItemID>
    <Quantity>${newQuantity}</Quantity>
  </InventoryStatus>
</ReviseInventoryStatusRequest>`;
      const tradingBase = conn.isSandbox ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";
      const res = await fetch(`${tradingBase}/ws/api.dll`, {
        method: "POST",
        headers: {
          "Content-Type": "text/xml; charset=utf-8",
          "X-EBAY-API-CALL-NAME": "ReviseInventoryStatus",
          "X-EBAY-API-SITEID": "0",
          "X-EBAY-API-COMPATIBILITY-LEVEL": "1209",
          "X-EBAY-API-IAF-TOKEN": conn.accessToken,
        },
        body: bodyXml,
      });
      const xml = await res.text();
      if (!res.ok) {
        console.error("[ebay sync-inventory ReviseInventoryStatus]", res.status, xml.slice(0, 500));
        return NextResponse.json(
          { error: "eBay Trading API rejected the update." },
          { status: 502 }
        );
      }
      const parsed = parser.parse(xml) as { ReviseInventoryStatusResponse?: { Ack?: string; Errors?: unknown } };
      const ack = (parsed.ReviseInventoryStatusResponse?.Ack ?? "").toLowerCase();
      if (ack !== "success" && ack !== "warning") {
        console.error("[ebay sync-inventory ReviseInventoryStatus Ack]", ack, parsed);
        return NextResponse.json(
          { error: "eBay could not update quantity for this Seller Hub listing." },
          { status: 502 }
        );
      }
      return NextResponse.json({ success: true, available: newQuantity });
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Server error";
    console.error("[ebay sync-inventory]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  return NextResponse.json({ error: "Provide offerId or listingId" }, { status: 400 });
}
