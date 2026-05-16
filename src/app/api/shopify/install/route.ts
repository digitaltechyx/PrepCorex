/**
 * Shopify-initiated install entrypoint.
 *
 * This endpoint is the `application_url` set in shopify.app.toml. Shopify
 * directs merchants here when they install the app from the Shopify App Store
 * or click "Open app" from the Shopify admin. The query string includes
 * `shop`, `hmac`, `timestamp`, and `host`. We verify the HMAC (per
 * https://shopify.dev/docs/apps/auth/oauth/getting-started#verify-the-installation-request),
 * then redirect the merchant to Shopify's OAuth authorize URL.
 *
 * This is the App Store-compliant install initiation surface: the merchant
 * never has to type their shop domain into our UI to install.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SHOPIFY_SCOPES =
  "read_orders,read_products,write_products,write_fulfillments,read_inventory,read_locations,write_inventory,write_locations,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders";

function isValidShopDomain(shop: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(shop);
}

/**
 * Verify the HMAC on a Shopify install/callback request.
 * Spec: sort all params except `hmac` and `signature`, build `k=v&k=v`,
 * compute HMAC-SHA256 with the app's client secret, compare hex digests.
 */
function verifyShopifyHmac(searchParams: URLSearchParams, clientSecret: string): boolean {
  const providedHmac = searchParams.get("hmac");
  if (!providedHmac) return false;

  const entries: [string, string][] = [];
  searchParams.forEach((value, key) => {
    if (key === "hmac" || key === "signature") return;
    entries.push([key, value]);
  });
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const message = entries.map(([k, v]) => `${k}=${v}`).join("&");

  const digest = createHmac("sha256", clientSecret).update(message).digest("hex");
  const provided = Buffer.from(providedHmac, "utf8");
  const computed = Buffer.from(digest, "utf8");
  if (provided.length !== computed.length) return false;
  try {
    return timingSafeEqual(provided, computed);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const shopRaw = searchParams.get("shop")?.trim().toLowerCase() ?? "";

  // No shop param: this is a direct visit to application_url, not an install.
  // Send the visitor to the app's integrations page so the dashboard remains usable.
  if (!shopRaw) {
    return NextResponse.redirect(new URL("/dashboard/integrations", request.url));
  }

  if (!isValidShopDomain(shopRaw)) {
    return new NextResponse(
      "Invalid shop parameter. This URL must be opened from Shopify.",
      { status: 400 }
    );
  }

  const clientId = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return new NextResponse("Shopify app not configured (missing client id/secret).", {
      status: 500,
    });
  }

  const hasHmac = searchParams.has("hmac");
  const allowManual = process.env.SHOPIFY_ALLOW_MANUAL_INSTALL !== "false";
  if (hasHmac) {
    if (!verifyShopifyHmac(searchParams, clientSecret)) {
      return new NextResponse(
        "Invalid request signature. This URL must be opened from Shopify.",
        { status: 401 }
      );
    }
  } else if (!allowManual) {
    return new NextResponse(
      "Install must be started from Shopify (Add app). Manual store entry is for testing only while the app is under review.",
      { status: 400 }
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!baseUrl || baseUrl.includes("localhost")) {
    return new NextResponse(
      "App base URL not configured. Set NEXT_PUBLIC_APP_URL to the public HTTPS origin.",
      { status: 500 }
    );
  }

  const redirectUri = `${baseUrl}/dashboard/integrations/shopify/callback`;
  const state = randomBytes(24).toString("hex");

  const oauthUrl =
    `https://${shopRaw}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(SHOPIFY_SCOPES)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  const response = NextResponse.redirect(oauthUrl);
  // Short-lived cookies to bind the OAuth callback to this install attempt.
  const cookieOptions = {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  response.cookies.set("shopify_oauth_state", state, cookieOptions);
  response.cookies.set("shopify_install_shop", shopRaw, cookieOptions);
  return response;
}
