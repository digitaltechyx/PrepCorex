import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Copy dock-receive photos from warehouse cartons onto the client's inventory rows
 * (and inbound requests) when putaway already ran without images.
 */
export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decoded = await adminAuth().verifyIdToken(authHeader.slice(7).trim());
    const body = await request.json().catch(() => ({}));
    const userId = String(body.userId || decoded.uid).trim();
    if (!userId) {
      return NextResponse.json({ error: "userId required" }, { status: 400 });
    }

    if (decoded.uid !== userId) {
      const caller = await adminDb().collection("users").doc(decoded.uid).get();
      const role = String(caller.data()?.role ?? "").toLowerCase();
      const roles = Array.isArray(caller.data()?.roles) ? caller.data()!.roles : [];
      const ok =
        role === "admin" ||
        role === "sub_admin" ||
        role === "warehouse_operator" ||
        roles.some((r: unknown) =>
          ["admin", "sub_admin", "warehouse_operator"].includes(String(r).toLowerCase().replace(/\s+/g, "_"))
        );
      if (!ok) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const db = adminDb();
    const invSnap = await db.collection("users").doc(userId).collection("inventory").get();
    const reqSnap = await db.collection("users").doc(userId).collection("inventoryRequests").get();
    const reqById = new Map(reqSnap.docs.map((d) => [d.id, d.data()]));
    const reqBySku = new Map<string, Record<string, unknown>>();
    for (const d of reqSnap.docs) {
      const data = d.data();
      const sku = String(data.sku ?? "").trim().toLowerCase();
      if (sku && !reqBySku.has(sku)) reqBySku.set(sku, { id: d.id, ...data });
    }

    // Collect photos from warehouse cartons owned by / linked to this client.
    const warehouses = await db.collection("warehouses").get();
    const photosByRequestId = new Map<string, string[]>();
    const photosBySku = new Map<string, string[]>();

    const merge = (map: Map<string, string[]>, key: string, urls: string[]) => {
      if (!key || urls.length === 0) return;
      const prev = map.get(key) ?? [];
      map.set(key, [...new Set([...prev, ...urls])]);
    };

    for (const wh of warehouses.docs) {
      const cartons = await db.collection("warehouses").doc(wh.id).collection("cartons").get();
      for (const c of cartons.docs) {
        const data = c.data();
        const clientId = String(data.clientId ?? "").trim();
        const lines = Array.isArray(data.lines) ? data.lines : [];
        const linkedToUser =
          clientId === userId ||
          lines.some((l: { clientId?: string }) => String(l?.clientId ?? "").trim() === userId);
        if (!linkedToUser) continue;

        const urls = [
          ...(Array.isArray(data.photoUrls) ? data.photoUrls : []),
          data.photoUrl ? String(data.photoUrl) : "",
        ]
          .map((u) => String(u || "").trim())
          .filter(Boolean);
        if (urls.length === 0) continue;

        const rootReq = String(data.inventoryRequestId ?? "").trim();
        if (rootReq) merge(photosByRequestId, rootReq, urls);
        const rootSku = String(data.sku ?? "").trim().toLowerCase();
        if (rootSku && rootSku !== "mixed" && rootSku !== "container") {
          merge(photosBySku, rootSku, urls);
        }
        for (const line of lines) {
          const lineReq = String(line?.inventoryRequestId ?? "").trim();
          const lineSku = String(line?.sku ?? "").trim().toLowerCase();
          if (lineReq) merge(photosByRequestId, lineReq, urls);
          if (lineSku) merge(photosBySku, lineSku, urls);
        }
      }
    }

    let patchedInventory = 0;
    let patchedRequests = 0;

    for (const d of invSnap.docs) {
      const data = d.data();
      const existing = Array.isArray(data.imageUrls)
        ? data.imageUrls.map((u: unknown) => String(u || "").trim()).filter(Boolean)
        : data.imageUrl
          ? [String(data.imageUrl).trim()]
          : [];
      if (existing.length > 0) continue;

      const sourceId = String(data.sourceRequestId ?? "").trim();
      const sku = String(data.sku ?? "").trim().toLowerCase();
      const fromReqDoc = sourceId ? reqById.get(sourceId) : sku ? reqBySku.get(sku) : undefined;
      const fromReq = fromReqDoc
        ? [
            ...(Array.isArray(fromReqDoc.imageUrls) ? fromReqDoc.imageUrls : []),
            fromReqDoc.imageUrl ? String(fromReqDoc.imageUrl) : "",
          ]
            .map((u) => String(u || "").trim())
            .filter(Boolean)
        : [];
      const fromCarton = [
        ...(sourceId ? photosByRequestId.get(sourceId) ?? [] : []),
        ...(sku ? photosBySku.get(sku) ?? [] : []),
      ];
      const merged = [...new Set([...fromReq, ...fromCarton])];
      if (merged.length === 0) continue;

      await d.ref.update({
        imageUrls: merged,
        imageUrl: merged[0],
        updatedAt: FieldValue.serverTimestamp(),
      });
      patchedInventory += 1;
    }

    // Also ensure inbound requests carry carton photos for future matching.
    for (const [requestId, urls] of photosByRequestId) {
      const ref = db.collection("users").doc(userId).collection("inventoryRequests").doc(requestId);
      const snap = await ref.get();
      if (!snap.exists) continue;
      const data = snap.data() || {};
      const existing = Array.isArray(data.imageUrls)
        ? data.imageUrls.map((u: unknown) => String(u || "").trim()).filter(Boolean)
        : data.imageUrl
          ? [String(data.imageUrl).trim()]
          : [];
      const merged = [...new Set([...existing, ...urls])];
      if (merged.length === existing.length) continue;
      await ref.update({
        imageUrls: merged,
        imageUrl: merged[0],
        updatedAt: FieldValue.serverTimestamp(),
      });
      patchedRequests += 1;
    }

    return NextResponse.json({
      success: true,
      patchedInventory,
      patchedRequests,
    });
  } catch (e) {
    console.error("[inventory/backfill-photos]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
