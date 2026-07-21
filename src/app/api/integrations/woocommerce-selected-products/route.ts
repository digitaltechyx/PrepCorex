import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb, adminFieldValue } from "@/lib/firebase-admin";
import {
  wooListProducts,
  wooListProductVariations,
  type WooCommerceCredentials,
} from "@/lib/woocommerce-api";

export const dynamic = "force-dynamic";

export type WooSelectedProduct = {
  productId: string;
  variationId?: string | null;
  title: string;
  sku?: string;
};

/** PUT: Save selected Woo products and sync into user inventory. */
export async function PUT(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let uid: string;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    uid = decoded.uid;
    if (!uid) throw new Error("No uid");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const connectionId = String(body.connectionId || "").trim();
  const raw = body.selectedProducts;
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }

  const selectedProducts: WooSelectedProduct[] = Array.isArray(raw)
    ? raw
        .filter(
          (v: unknown) =>
            v &&
            typeof v === "object" &&
            typeof (v as { productId?: unknown }).productId === "string" &&
            typeof (v as { title?: unknown }).title === "string"
        )
        .map((v: { productId: string; variationId?: string | null; title: string; sku?: string }) => {
          const item: WooSelectedProduct = {
            productId: v.productId,
            title: v.title,
            variationId: v.variationId ? String(v.variationId) : null,
          };
          if (v.sku != null && v.sku !== "") item.sku = v.sku;
          return item;
        })
    : [];

  try {
    const db = adminDb();
    const connRef = db
      .collection("users")
      .doc(uid)
      .collection("woocommerceConnections")
      .doc(connectionId);
    const connSnap = await connRef.get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Store not connected" }, { status: 404 });
    }

    const data = connSnap.data() || {};
    const creds: WooCommerceCredentials = {
      storeUrl: String(data.storeUrl || "").trim(),
      consumerKey: String(data.consumerKey || "").trim(),
      consumerSecret: String(data.consumerSecret || "").trim(),
    };
    if (!creds.storeUrl || !creds.consumerKey || !creds.consumerSecret) {
      return NextResponse.json({ error: "Credentials missing" }, { status: 400 });
    }

    await connRef.update({ selectedProducts });

    const selectedKeys = new Set(
      selectedProducts.map((p) => `${p.productId}:${p.variationId || p.productId}`)
    );
    const FieldValue = adminFieldValue();
    const invRef = db.collection("users").doc(uid).collection("inventory");
    const lookupRef = db.collection("woocommerceInventoryLookup");

    // Build qty map from live catalog
    const qtyMap: Record<
      string,
      { quantity: number; sku: string | null; productTitle: string }
    > = {};
    if (selectedProducts.length > 0) {
      const products = await wooListProducts(creds, { maxPages: 6, perPage: 50 });
      const byId = new Map(products.map((p) => [String(p.id), p]));

      for (const sel of selectedProducts) {
        const p = byId.get(sel.productId);
        if (!p) {
          qtyMap[`${sel.productId}:${sel.variationId || sel.productId}`] = {
            quantity: 0,
            sku: sel.sku || null,
            productTitle: sel.title,
          };
          continue;
        }
        if (String(p.type || "") === "variable" && sel.variationId && sel.variationId !== sel.productId) {
          try {
            const variations = await wooListProductVariations(creds, p.id, { maxPages: 3 });
            const v = variations.find((x) => String(x.id) === String(sel.variationId));
            qtyMap[`${sel.productId}:${sel.variationId}`] = {
              quantity: typeof v?.stock_quantity === "number" ? v.stock_quantity : 0,
              sku: v?.sku || sel.sku || null,
              productTitle: sel.title,
            };
          } catch {
            qtyMap[`${sel.productId}:${sel.variationId}`] = {
              quantity: 0,
              sku: sel.sku || null,
              productTitle: sel.title,
            };
          }
        } else {
          qtyMap[`${sel.productId}:${sel.productId}`] = {
            quantity: typeof p.stock_quantity === "number" ? p.stock_quantity : 0,
            sku: p.sku || sel.sku || null,
            productTitle: sel.title || p.name || `Product ${p.id}`,
          };
        }
      }

      for (const sel of selectedProducts) {
        const key = `${sel.productId}:${sel.variationId || sel.productId}`;
        const info = qtyMap[key] ?? {
          quantity: 0,
          sku: sel.sku || null,
          productTitle: sel.title,
        };
        const variationId =
          sel.variationId && sel.variationId !== sel.productId ? sel.variationId : null;
        const docId = `woocommerce_${connectionId}_${sel.productId}${
          variationId ? `_${variationId}` : ""
        }`;
        const inventoryPath = `users/${uid}/inventory/${docId}`;
        const quantity = info.quantity;
        const docData: Record<string, unknown> = {
          productName: info.productTitle || sel.title,
          quantity,
          status: quantity > 0 ? "In Stock" : "Out of Stock",
          dateAdded: FieldValue.serverTimestamp(),
          source: "woocommerce",
          woocommerceConnectionId: connectionId,
          woocommerceProductId: sel.productId,
          woocommerceStoreUrl: creds.storeUrl,
        };
        if (variationId) docData.woocommerceVariationId = variationId;
        if (info.sku) docData.sku = info.sku;
        else if (sel.sku) docData.sku = sel.sku;

        await invRef.doc(docId).set(docData, { merge: true });

        const lookupId = `${connectionId}_${sel.productId}${variationId ? `_${variationId}` : ""}`;
        await lookupRef.doc(lookupId).set(
          {
            userId: uid,
            inventoryPath,
            connectionId,
            productId: sel.productId,
            variationId: variationId || null,
            storeUrl: creds.storeUrl,
          },
          { merge: true }
        );
      }
    }

    const toRemove = await invRef
      .where("source", "==", "woocommerce")
      .where("woocommerceConnectionId", "==", connectionId)
      .get();
    for (const d of toRemove.docs) {
      const row = d.data();
      const pid = String(row.woocommerceProductId || "");
      const vid = row.woocommerceVariationId
        ? String(row.woocommerceVariationId)
        : pid;
      const key = `${pid}:${vid}`;
      if (pid && !selectedKeys.has(key) && !selectedKeys.has(`${pid}:${pid}`)) {
        await d.ref.delete();
        const lookupId = `${connectionId}_${pid}${
          row.woocommerceVariationId ? `_${row.woocommerceVariationId}` : ""
        }`;
        await lookupRef.doc(lookupId).delete().catch(() => undefined);
      }
    }

    return NextResponse.json({ success: true, count: selectedProducts.length });
  } catch (err: unknown) {
    console.error("[woocommerce-selected-products PUT]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
