import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Registered Etsy OAuth redirect URI.
 * Forwards code/state to the dashboard callback page (needs Firebase login).
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code") || "";
  const state = searchParams.get("state") || "";
  const error = searchParams.get("error") || "";
  const errorDescription = searchParams.get("error_description") || "";

  const dest = new URL("/dashboard/integrations/etsy/callback", request.nextUrl.origin);
  if (error) {
    dest.searchParams.set("error", error);
    if (errorDescription) dest.searchParams.set("error_description", errorDescription);
  } else {
    if (code) dest.searchParams.set("code", code);
    if (state) dest.searchParams.set("state", state);
  }
  return NextResponse.redirect(dest);
}
