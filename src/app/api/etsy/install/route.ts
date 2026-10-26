import { NextRequest, NextResponse } from "next/server";
import {
  buildEtsyAuthorizeUrl,
  createEtsyOAuthState,
  createEtsyPkcePair,
  getEtsyAppCredentials,
  getEtsyRedirectUri,
} from "@/lib/etsy-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start Etsy OAuth (PKCE). Redirects seller to Etsy, then back to
 * /api/integrations/etsy/callback (registered redirect URI).
 */
export async function GET(request: NextRequest) {
  try {
    getEtsyAppCredentials();
  } catch {
    return new NextResponse(
      "Etsy app not configured. Set ETSY_API_KEYSTRING and ETSY_SHARED_SECRET.",
      { status: 500 }
    );
  }

  const { keystring } = getEtsyAppCredentials();
  const origin = request.nextUrl.origin;
  let redirectUri: string;
  try {
    redirectUri = getEtsyRedirectUri(origin);
  } catch (e) {
    return new NextResponse(
      e instanceof Error ? e.message : "App URL not configured",
      { status: 500 }
    );
  }

  const state = createEtsyOAuthState();
  const { verifier, challenge } = createEtsyPkcePair();
  const authUrl = buildEtsyAuthorizeUrl({
    keystring,
    redirectUri,
    state,
    codeChallenge: challenge,
  });

  const response = NextResponse.redirect(authUrl);
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 600,
  };
  response.cookies.set("etsy_oauth_state", state, cookieOpts);
  response.cookies.set("etsy_pkce_verifier", verifier, cookieOpts);
  return response;
}
