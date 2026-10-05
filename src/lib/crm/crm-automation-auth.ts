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

function tokenMatchesRequest(request: NextRequest, key: string): boolean {
  const bearer = request.headers.get("authorization") || "";
  if (bearer === `Bearer ${key}`) return true;
  const apiKey = request.headers.get("x-api-key") || "";
  if (apiKey === key) return true;
  return false;
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

  return { ok: false as const, status: 401, error: "Unauthorized" };
}
