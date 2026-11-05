import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/api-admin-auth";

export type CrmAutomationActor = {
  uid: string;
  name: string;
  via: "api_key" | "admin";
};

function readConfiguredKey(): string {
  return (
    process.env.CRM_AUTOMATION_API_KEY?.trim() ||
    process.env.CHATGPT_CRM_API_KEY?.trim() ||
    ""
  );
}

/** Normalize GPT / n8n Authorization quirks (Bearer, double Bearer, raw key). */
function extractPresentedSecrets(request: NextRequest): string[] {
  const out: string[] = [];
  const auth = (request.headers.get("authorization") || "").trim();
  if (auth) {
    out.push(auth);
    const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) {
      let token = bearerMatch[1].trim();
      if (/^Bearer\s+/i.test(token)) {
        token = token.replace(/^Bearer\s+/i, "").trim();
      }
      out.push(token);
    }
  }
  const apiKey = (request.headers.get("x-api-key") || "").trim();
  if (apiKey) out.push(apiKey);
  return out.filter(Boolean);
}

function tokenMatchesRequest(request: NextRequest, key: string): boolean {
  if (!key) return false;
  return extractPresentedSecrets(request).some((secret) => secret === key);
}

/** ChatGPT automation key, or Firebase admin/sub-admin Bearer as fallback. */
export async function requireCrmAutomation(request: NextRequest) {
  const key = readConfiguredKey();
  if (key && tokenMatchesRequest(request, key)) {
    return {
      ok: true as const,
      actor: {
        uid: "crm-automation",
        name: "CRM automation",
        via: "api_key" as const,
      },
    };
  }

  const admin = await requireAdmin(request);
  if (admin.ok) {
    return {
      ok: true as const,
      actor: {
        uid: admin.uid,
        name: admin.name || "Admin",
        via: "admin" as const,
      },
    };
  }

  if (!key) {
    return {
      ok: false as const,
      status: 503,
      error: "CRM automation is not configured. Set CRM_AUTOMATION_API_KEY on the server.",
    };
  }

  return {
    ok: false as const,
    status: 401,
    error:
      "Unauthorized. Use Authorization: Bearer <CRM_AUTOMATION_API_KEY> (same value as the CRM host env).",
  };
}
