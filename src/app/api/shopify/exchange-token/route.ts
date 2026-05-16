import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { ensureShopifyAppSubscriptionAfterConnect } from "@/lib/shopify-billing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPES = "read_orders,read_products,write_fulfillments,read_inventory";

/**
 * Verify Shopify's HMAC over the OAuth callback query string.
 * Per Shopify spec: sort all params except `hmac`/`signature`, build
 * `k=v&k=v` (URL-decoded), HMAC-SHA256 with the app's client secret,
 * compare hex digests in constant time.
 */
function verifyShopifyHmac(rawQuery: string, clientSecret: string): boolean {
  if (!rawQuery) return false;
  const params = new URLSearchParams(rawQuery);
  const provided = params.get("hmac");
  if (!provided) return false;
  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    if (key === "hmac" || key === "signature") return;
    entries.push([key, value]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");
  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");
  const a = Buffer.from(digest, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

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
  const code = body.code as string | undefined;
  const shop = (body.shop as string | undefined)?.trim().toLowerCase();
  const redirectUri = typeof body.redirect_uri === "string" ? body.redirect_uri.trim() : undefined;
  const callbackState = typeof body.state === "string" ? body.state : "";
  const callbackHmac = typeof body.hmac === "string" ? body.hmac : "";
  const rawQuery = typeof body.raw_query === "string" ? body.raw_query : "";
  if (!code || !shop) {
    return NextResponse.json(
      { error: "Missing code or shop" },
      { status: 400 }
    );
  }
  if (!redirectUri) {
    return NextResponse.json(
      { error: "Missing redirect_uri" },
      { status: 400 }
    );
  }
  const normalizedShop = shop.includes(".myshopify.com") ? shop : `${shop}.myshopify.com`;

  const clientId = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "Shopify app not configured" },
      { status: 500 }
    );
  }

  /**
   * App Store: if this OAuth callback originated from a Shopify-initiated
   * install (cookie set by /api/shopify/install), bind the install attempt
   * to this callback via state + HMAC. We only enforce the cookie check
   * when an install cookie is present so the existing in-app "Connect
   * another store" flow still works for already-installed merchants.
   */
  const installShopCookie = request.cookies.get("shopify_install_shop")?.value;
  const stateCookie = request.cookies.get("shopify_oauth_state")?.value;
  if (installShopCookie) {
    if (installShopCookie !== normalizedShop) {
      return NextResponse.json(
        { error: "Install shop mismatch" },
        { status: 400 }
      );
    }
    if (!stateCookie || !callbackState || stateCookie !== callbackState) {
      return NextResponse.json(
        { error: "Invalid or expired OAuth state. Restart the install from Shopify." },
        { status: 400 }
      );
    }
  }
  if (callbackHmac && rawQuery && !verifyShopifyHmac(rawQuery, clientSecret)) {
    return NextResponse.json(
      { error: "Invalid OAuth callback signature" },
      { status: 401 }
    );
  }

  try {
    const res = await fetch(`https://${normalizedShop}/admin/oauth/access_token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error("[Shopify exchange-token]", res.status, text);
      let detail: string | undefined;
      try {
        const errJson = JSON.parse(text) as { error?: string; error_description?: string };
        detail = errJson.error_description || errJson.error || text.slice(0, 200);
      } catch {
        // Shopify often returns HTML; extract <title> or first meaningful line for user
        const titleMatch = text.match(/<title[^>]*>([^<]+)<\/title>/i);
        detail = titleMatch ? titleMatch[1].trim() : text.replace(/\s+/g, " ").slice(0, 150);
      }
      return NextResponse.json(
        { error: "Failed to exchange code with Shopify", detail },
        { status: 502 }
      );
    }
    const data = (await res.json()) as { access_token?: string };
    const accessToken = data.access_token;
    if (!accessToken) {
      return NextResponse.json(
        { error: "No access token in Shopify response" },
        { status: 502 }
      );
    }

    const db = adminDb();
    const col = db.collection("users").doc(uid).collection("shopifyConnections");
    const snapshot = await col.where("shop", "==", normalizedShop).limit(1).get();
    const connectedAt = new Date();
    const docData = {
      shop: normalizedShop,
      shopName: normalizedShop.replace(".myshopify.com", ""),
      accessToken,
      connectedAt: { seconds: Math.floor(connectedAt.getTime() / 1000), nanoseconds: 0 },
    };
    if (!snapshot.empty) {
      await snapshot.docs[0].ref.update(docData);
    } else {
      await col.add(docData);
    }

    // Map shop → userId for order webhooks
    const shopToUserRef = db.collection("shopifyShopToUser").doc(normalizedShop.replace(/\./g, "_"));
    await shopToUserRef.set({ userId: uid });

    // Register inventory_levels/update webhook so Shopify → PrepCorex updates work without re-selecting
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const isPublicUrl = baseUrl && !baseUrl.includes("localhost");
    if (isPublicUrl) {
      const webhookAddress = `${baseUrl}/api/shopify/webhooks`;
      const headers = {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      };
      const topics = [
        "app/uninstalled",
        "inventory_levels/update",
        "products/update",
        "products/delete",
        "orders/create",
        "orders/updated",
        "customers/data_request",
        "customers/redact",
        "shop/redact",
      ];
      for (const topic of topics) {
        const webhookRes = await fetch(
          `https://${normalizedShop}/admin/api/2025-04/webhooks.json`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              webhook: { topic, address: webhookAddress, format: "json" },
            }),
          }
        );
        if (!webhookRes.ok) {
          const errText = await webhookRes.text();
          if (webhookRes.status === 422 && errText.includes("already been taken")) {
            // Webhook already registered (e.g. from previous connect); skip
            continue;
          }
          if (webhookRes.status === 403 && (topic === "orders/create" || topic === "orders/updated")) {
            console.warn(
              "[Shopify exchange-token] Orders webhooks require Protected Customer Data access. In Partner Dashboard: Apps → Your app → API access requests → Protected customer data access → Request access. See docs/SHOPIFY_ORDERS_WEBHOOK_PCD.md"
            );
          } else {
            console.warn("[Shopify exchange-token] Webhook registration:", topic, webhookRes.status, errText);
          }
        }
      }
    } else if (!baseUrl) {
      console.warn("[Shopify exchange-token] Set NEXT_PUBLIC_APP_URL or VERCEL_URL to enable Shopify→PrepCorex inventory webhook.");
    } else {
      console.warn("[Shopify exchange-token] Webhook skipped: URL must be public (no localhost). Set NEXT_PUBLIC_APP_URL to your production URL.");
    }

    /** App Store: use Shopify Billing API ($0 recurring) unless SHOPIFY_BILLING_API=false. */
    let billingConfirmationUrl: string | undefined;
    let billingNotice: string | undefined;
    if (baseUrl && !baseUrl.includes("localhost")) {
      try {
        const billing = await ensureShopifyAppSubscriptionAfterConnect({
          shop: normalizedShop,
          accessToken,
          appBaseUrl: baseUrl,
        });
        if (billing.kind === "confirmation") {
          billingConfirmationUrl = billing.confirmationUrl;
        } else if (billing.kind === "error") {
          billingNotice = billing.message;
          console.warn("[Shopify exchange-token] Billing API:", billing.message);
        }
      } catch (e: unknown) {
        billingNotice = e instanceof Error ? e.message : String(e);
        console.warn("[Shopify exchange-token] Billing API exception:", billingNotice);
      }
    }

    const response = NextResponse.json({
      success: true,
      shop: normalizedShop,
      ...(billingConfirmationUrl ? { billingConfirmationUrl } : {}),
      ...(billingNotice ? { billingNotice } : {}),
    });
    // One-shot install cookies — clear so they can't be replayed.
    response.cookies.set("shopify_oauth_state", "", { maxAge: 0, path: "/" });
    response.cookies.set("shopify_install_shop", "", { maxAge: 0, path: "/" });
    return response;
  } catch (err: unknown) {
    console.error("[Shopify exchange-token]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Server error" },
      { status: 500 }
    );
  }
}
