import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  wooListProducts,
  wooListProductVariations,
  type WooCommerceCredentials,
} from "@/lib/woocommerce-api";

export const dynamic = "force-dynamic";

function isAdminOrSubAdmin(data: Record<string, unknown> | undefined): boolean {
  if (!data) return false;
  const role = data.role as string;
  const roles = data.roles as string[] | undefined;
  return (
    role === "admin" ||
    role === "sub_admin" ||
    (Array.isArray(roles) && (roles.includes("admin") || roles.includes("sub_admin")))
  );
}

/** GET: list WooCommerce products (+ variations) for selection. Query: connectionId, userId?, search? */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let callerUid: string;
  let isAdmin = false;
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    callerUid = decoded.uid;
    const userDoc = await adminDb().collection("users").doc(callerUid).get();
    isAdmin = isAdminOrSubAdmin(userDoc.data() as Record<string, unknown> | undefined);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const connectionId = request.nextUrl.searchParams.get("connectionId")?.trim();
  const search = request.nextUrl.searchParams.get("search")?.trim() || undefined;
  const uid = request.nextUrl.searchParams.get("userId")?.trim() || callerUid;
  if (!connectionId) {
    return NextResponse.json({ error: "Missing connectionId" }, { status: 400 });
  }
  if (uid !== callerUid && !isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const connSnap = await adminDb()
      .collection("users")
      .doc(uid)
      .collection("woocommerceConnections")
      .doc(connectionId)
      .get();
    if (!connSnap.exists) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 });
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

    const products = await wooListProducts(creds, { maxPages: 4, perPage: 50, search });
    const out: Array<{
      productId: string;
      productTitle: string;
      type: string;
      variants: Array<{
        variantId: string;
        title: string;
        sku: string | null;
        inventoryQuantity: number | null;
      }>;
    }> = [];

    for (const p of products) {
      const productId = String(p.id);
      const type = String(p.type || "simple");
      if (type === "variable") {
        try {
          const variations = await wooListProductVariations(creds, p.id, { maxPages: 3 });
          out.push({
            productId,
            productTitle: p.name || `Product ${p.id}`,
            type,
            variants: variations.map((v) => {
              const attrLabel = (v.attributes || [])
                .map((a) => a.option || a.name)
                .filter(Boolean)
                .join(" / ");
              return {
                variantId: String(v.id),
                title: attrLabel || `Variation ${v.id}`,
                sku: v.sku || null,
                inventoryQuantity:
                  typeof v.stock_quantity === "number" ? v.stock_quantity : null,
              };
            }),
          });
        } catch (e) {
          console.warn("[woocommerce products] variations failed", p.id, e);
          out.push({
            productId,
            productTitle: p.name || `Product ${p.id}`,
            type,
            variants: [],
          });
        }
      } else {
        out.push({
          productId,
          productTitle: p.name || `Product ${p.id}`,
          type,
          variants: [
            {
              variantId: productId,
              title: "Default",
              sku: p.sku || null,
              inventoryQuantity:
                typeof p.stock_quantity === "number" ? p.stock_quantity : null,
            },
          ],
        });
      }
    }

    const selectedProducts = Array.isArray(data.selectedProducts) ? data.selectedProducts : [];
    return NextResponse.json({ products: out, selectedProducts, storeUrl: creds.storeUrl });
  } catch (error: unknown) {
    console.error("[woocommerce products GET]", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load products" },
      { status: 500 }
    );
  }
}
