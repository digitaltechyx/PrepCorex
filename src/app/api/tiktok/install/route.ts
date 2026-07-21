import { NextRequest, NextResponse } from "next/server";
import {
  buildTikTokAuthorizeUrl,
  createTikTokOAuthState,
  getTikTokAppCredentials,
} from "@/lib/tiktok-oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Start TikTok Shop OAuth. Redirects the seller to TikTok authorize,
 * then back to /dashboard/integrations/tiktok/callback with auth_code.
 */
export async function GET(_request: NextRequest) {
  try {
    getTikTokAppCredentials();
  } catch {
    return new NextResponse(
      "TikTok app not configured. Set TIKTOK_APP_KEY, TIKTOK_APP_SECRET, and TIKTOK_APP_ID.",
      { status: 500 }
    );
  }

  const { serviceId } = getTikTokAppCredentials();
  const state = createTikTokOAuthState();
  const authUrl = buildTikTokAuthorizeUrl({ serviceId, state });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set("tiktok_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return response;
}
