import { NextRequest } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

function normalizeRole(v: unknown): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function isAdminLikeToken(claims: Record<string, unknown> | undefined): boolean {
  if (!claims) return false;
  if (claims.admin === true || claims.isAdmin === true) return true;
  if (claims.sub_admin === true || claims.subAdmin === true || claims.isSubAdmin === true) return true;
  const role = normalizeRole(claims.role);
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;
  const roles = Array.isArray(claims.roles) ? claims.roles.map(normalizeRole) : [];
  return roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin");
}

export function isAdminLikeUserDoc(data: FirebaseFirestore.DocumentData | undefined | null): boolean {
  if (!data) return false;
  if (data.isAdmin === true || data.admin === true || data.is_admin === true) return true;
  if (data.isSubAdmin === true || data.is_sub_admin === true) return true;
  const role = normalizeRole(data.role || data.userRole || data.userType);
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;
  const roles = Array.isArray(data.roles) ? data.roles.map(normalizeRole) : [];
  if (roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin")) return true;
  if (Array.isArray(data.features)) {
    if (
      data.features.includes("admin_dashboard") ||
      data.features.includes("manage_invoices") ||
      data.features.includes("manage_users") ||
      data.features.includes("manage_quotes")
    ) {
      return true;
    }
  }
  return false;
}

export async function requireAdmin(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const uid = decoded?.uid;
    if (!uid) {
      return { ok: false as const, status: 401, error: "Unauthorized" };
    }

    if (isAdminLikeToken(decoded as Record<string, unknown>)) {
      return { ok: true as const, uid, name: String(decoded.name || decoded.email || "") };
    }

    const snap = await adminDb().collection("users").doc(uid).get();
    const data = snap.exists ? snap.data() : null;
    if (!snap.exists || !isAdminLikeUserDoc(data)) {
      return { ok: false as const, status: 403, error: "Forbidden" };
    }

    return {
      ok: true as const,
      uid,
      name: String(data?.name || data?.email || ""),
    };
  } catch {
    return { ok: false as const, status: 401, error: "Unauthorized" };
  }
}

export async function verifyBearerToken(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;
  try {
    return await adminAuth().verifyIdToken(token);
  } catch {
    return null;
  }
}
