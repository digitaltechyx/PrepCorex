import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isFullAdminToken, isFullAdminUserDoc } from "@/lib/api-admin-auth";

export type TrackerActor = {
  uid: string | null;
  name: string;
};

/** Public tracker APIs accept anonymous callers; signed-in admins keep their name on audit fields. */
export async function resolveTrackerActor(request: NextRequest): Promise<TrackerActor> {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { uid: null, name: "Public" };
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return { uid: null, name: "Public" };
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded?.uid;
    if (!uid) {
      return { uid: null, name: "Public" };
    }

    if (isFullAdminToken(decoded as Record<string, unknown>)) {
      return { uid, name: String(decoded.name || decoded.email || "Admin") };
    }

    const snap = await adminDb().collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() : null;
    if (snap.exists && isFullAdminUserDoc(data)) {
      return { uid, name: String(data?.name || data?.email || "Admin") };
    }

    return {
      uid,
      name: String(data?.name || decoded.email || "User"),
    };
  } catch {
    return { uid: null, name: "Public" };
  }
}
