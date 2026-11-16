import { adminDb } from "@/lib/firebase-admin";
import { hasFeature, hasRole } from "@/lib/permissions";
import type { UserProfile } from "@/types";
import { NextRequest } from "next/server";
import { verifyBearerToken } from "@/lib/api-admin-auth";

function mapUserDoc(docId: string, data: FirebaseFirestore.DocumentData): UserProfile {
  const uid = String(data.uid ?? docId).trim() || docId;
  return { ...data, uid } as UserProfile;
}

/**
 * Auth for client Lexi APIs: signed-in user with opt-in `lexi_assistant` feature.
 * Not granted by default — admin enables per client in Roles & Features.
 */
export async function requireLexiClient(request: NextRequest): Promise<
  | { ok: true; uid: string; name: string; profile: UserProfile }
  | { ok: false; status: number; error: string }
> {
  const decoded = await verifyBearerToken(request);
  if (!decoded?.uid) {
    return { ok: false, status: 401, error: "Unauthorized" };
  }

  const snap = await adminDb().collection("users").doc(decoded.uid).get();
  if (!snap.exists) {
    return { ok: false, status: 403, error: "Profile not found." };
  }

  const profile = mapUserDoc(snap.id, snap.data()!);
  if (!hasRole(profile, "user")) {
    return { ok: false, status: 403, error: "LEXI client chat is for client accounts only." };
  }
  if (!hasFeature(profile, "lexi_assistant")) {
    return {
      ok: false,
      status: 403,
      error: "LEXI is not enabled for this account. Ask PrepCorex admin to enable LEXI™ Assistant.",
    };
  }

  return {
    ok: true,
    uid: snap.id,
    name: String(profile.name || profile.email || snap.id),
    profile,
  };
}
