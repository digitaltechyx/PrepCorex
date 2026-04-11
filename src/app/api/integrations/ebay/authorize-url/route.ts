import { NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { getRequestHost, resolveEbayRuName } from "@/lib/ebay-oauth";

export const dynamic = "force-dynamic";

const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment.readonly",
  "https://api.ebay.com/oauth/api_scope/sell.account.readonly",
].join(" ");

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    await adminAuth().verifyIdToken(token);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const clientId = process.env.NEXT_PUBLIC_EBAY_APP_ID;
  const host = getRequestHost(request);
  const ruName = resolveEbayRuName(host);
  if (!clientId || !ruName) {
    return NextResponse.json(
      {
        error:
          "eBay app not configured (missing App ID or RuName). For a new domain, add an OAuth redirect in the eBay developer portal and set EBAY_RUNAME or EBAY_RUNAME_BY_HOST.",
      },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const addNew = searchParams.get("addNew") === "true";
  const state = addNew ? "ebay_add" : "ebay";

  const isSandbox =
    process.env.EBAY_SANDBOX !== "false" &&
    (clientId.includes("SBX") || process.env.EBAY_SANDBOX === "true");
  const authHost = isSandbox
    ? "https://auth.sandbox.ebay.com/oauth2/authorize"
    : "https://auth.ebay.com/oauth2/authorize";

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: ruName,
    scope: EBAY_SCOPES,
    state,
  });
  // Force eBay to show login/consent so user can sign in with a different account
  if (addNew) {
    params.set("prompt", "login");
  }
  const url = authHost + "?" + params.toString();
  return NextResponse.json({ url });
}
