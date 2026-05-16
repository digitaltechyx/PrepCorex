import { NextRequest, NextResponse } from "next/server";
import {
  buildOAuthAuthorizeUrl,
  createOAuthState,
  normalizeShopDomain,
  verifyShopifyQueryHmac,
} from "@/lib/shopify-oauth";

export const dynamic = "force-dynamic";

const STATE_COOKIE = "shopify_oauth_state";
const STATE_MAX_AGE = 600; // 10 minutes

function redirectUri(request: NextRequest): string {
  const origin =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    request.nextUrl.origin;
  return `${origin}/dashboard/integrations/shopify/callback`;
}

/**
 * Shopify App Store install entry (application_url).
 * Verifies HMAC when Shopify sends it; sets OAuth state cookie and redirects to authorize.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const shopRaw = params.get("shop");
  if (!shopRaw) {
    return NextResponse.json(
      { error: "Missing shop parameter. Install PrepCorex from the Shopify App Store or your Partner test store." },
      { status: 400 }
    );
  }

  const shop = normalizeShopDomain(shopRaw);
  if (!shop) {
    return NextResponse.json({ error: "Invalid shop domain" }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Shopify app not configured" }, { status: 500 });
  }

  const hmac = params.get("hmac");
  // During App Store review, PrepCorex dashboard may start OAuth without Shopify HMAC.
  // Set SHOPIFY_ALLOW_MANUAL_INSTALL=false after listing to require Shopify-initiated install only.
  const allowManual = process.env.SHOPIFY_ALLOW_MANUAL_INSTALL !== "false";

  if (hmac) {
    if (!verifyShopifyQueryHmac(params, clientSecret)) {
      return NextResponse.json({ error: "Invalid HMAC" }, { status: 401 });
    }
  } else if (!allowManual) {
    return NextResponse.json(
      {
        error:
          "Install must be initiated from Shopify (Add app). Manual shop entry is for testing only while the app is under review.",
      },
      { status: 400 }
    );
  }

  const state = createOAuthState();
  const authorizeUrl = buildOAuthAuthorizeUrl({
    shop,
    clientId,
    redirectUri: redirectUri(request),
    state,
  });

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: STATE_MAX_AGE,
    path: "/",
  });
  return response;
}
