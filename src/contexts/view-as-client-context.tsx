"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { onAuthStateChanged, type User } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { normalizeUserLocationIds } from "@/lib/user-locations";
import type { UserProfile } from "@/types";

const VIEW_AS_SESSION_KEY = "pcx_view_as_client_uid_v1";

export type ViewAsClientState = {
  /** True when admin is previewing a client dashboard without switching Firebase Auth. */
  isViewingAsClient: boolean;
  /** URL/session has a viewAs target but profile/staff check is still resolving. */
  isViewAsPending: boolean;
  targetUid: string | null;
  targetProfile: UserProfile | null;
  targetLoading: boolean;
  clearViewAs: () => void;
};

export const ViewAsClientContext = createContext<ViewAsClientState>({
  isViewingAsClient: false,
  isViewAsPending: false,
  targetUid: null,
  targetProfile: null,
  targetLoading: false,
  clearViewAs: () => {},
});

function buildTargetProfile(uid: string, data: Record<string, unknown>): UserProfile {
  const normalizeRole = (r: unknown) => String(r ?? "").trim().toLowerCase();
  const roleList = Array.isArray(data.roles) ? data.roles : data.role != null ? [data.role] : ["user"];
  const rolesNormalized = roleList.map(normalizeRole).filter(Boolean);
  return {
    ...data,
    uid,
    email: (data.email as string | null | undefined) ?? null,
    name: (data.name as string | null | undefined) ?? null,
    phone: (data.phone as string | null | undefined) ?? null,
    role: normalizeRole(data.role) || "user",
    status: (data.status as UserProfile["status"]) || "approved",
    roles: rolesNormalized.length ? rolesNormalized : ["user"],
    features: Array.isArray(data.features) ? (data.features as string[]) : [],
    locations: normalizeUserLocationIds(data.locations),
    assignedWarehouseIds: Array.isArray(data.assignedWarehouseIds)
      ? (data.assignedWarehouseIds as string[]).map((id) => String(id).trim()).filter(Boolean)
      : [],
  } as UserProfile;
}

function isAdminLikeProfile(data: Record<string, unknown> | null | undefined): boolean {
  if (!data) return false;
  if (data.isAdmin === true || data.admin === true || data.is_admin === true) return true;
  if (data.isSubAdmin === true || data.is_sub_admin === true) return true;
  const role = String(data.role || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (role === "admin" || role === "sub_admin" || role === "subadmin") return true;
  const roles = Array.isArray(data.roles)
    ? data.roles.map((r) =>
        String(r || "")
          .trim()
          .toLowerCase()
          .replace(/[\s-]+/g, "_")
      )
    : [];
  return roles.includes("admin") || roles.includes("sub_admin") || roles.includes("subadmin");
}

function readSessionViewAs(): string {
  if (typeof window === "undefined") return "";
  try {
    return (sessionStorage.getItem(VIEW_AS_SESSION_KEY) || "").trim();
  } catch {
    return "";
  }
}

function writeSessionViewAs(uid: string | null) {
  if (typeof window === "undefined") return;
  try {
    if (uid) sessionStorage.setItem(VIEW_AS_SESSION_KEY, uid);
    else sessionStorage.removeItem(VIEW_AS_SESSION_KEY);
  } catch {
    // ignore
  }
}

export function ViewAsClientProvider({ children }: { children: ReactNode }) {
  const [adminUser, setAdminUser] = useState<User | null>(null);
  const [adminIsStaff, setAdminIsStaff] = useState(false);
  const [staffResolved, setStaffResolved] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const viewAsFromUrl = (searchParams.get("viewAs") || "").trim();
  const [viewAsUid, setViewAsUid] = useState<string>("");

  const onClientDashboard = (pathname || "").startsWith("/dashboard");

  useEffect(() => {
    const unsubAuth = onAuthStateChanged(auth, (fbUser) => {
      setAdminUser(fbUser);
      setAuthReady(true);
      if (!fbUser) {
        setAdminIsStaff(false);
        setStaffResolved(true);
        writeSessionViewAs(null);
        setViewAsUid("");
      } else {
        setStaffResolved(false);
      }
    });
    return () => unsubAuth();
  }, []);

  useEffect(() => {
    if (!adminUser?.uid) {
      setAdminIsStaff(false);
      setStaffResolved(true);
      return;
    }
    const unsub = onSnapshot(
      doc(db, "users", adminUser.uid),
      (snap) => {
        setAdminIsStaff(snap.exists() && isAdminLikeProfile(snap.data() as Record<string, unknown>));
        setStaffResolved(true);
      },
      () => {
        setAdminIsStaff(false);
        setStaffResolved(true);
      }
    );
    return () => unsub();
  }, [adminUser?.uid]);

  // URL wins on first load; otherwise keep per-tab sessionStorage (survives in-app navigation).
  useEffect(() => {
    if (!authReady) return;
    if (viewAsFromUrl) {
      writeSessionViewAs(viewAsFromUrl);
      setViewAsUid(viewAsFromUrl);
      return;
    }
    // On admin routes, do not resurrect a previous viewAs session — admin must stay admin.
    if ((pathname || "").startsWith("/admin")) {
      return;
    }
    const fromSession = readSessionViewAs();
    setViewAsUid(fromSession);
  }, [authReady, viewAsFromUrl, pathname]);

  const canViewAs = authReady && !!adminUser && adminIsStaff;

  const [targetProfile, setTargetProfile] = useState<UserProfile | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);

  // Visiting admin while a viewAs session exists: clear it so admin UI is never wrapped as client.
  useEffect(() => {
    if (!(pathname || "").startsWith("/admin")) return;
    if (!viewAsFromUrl && readSessionViewAs()) {
      writeSessionViewAs(null);
      setViewAsUid("");
      setTargetProfile(null);
    }
  }, [pathname, viewAsFromUrl]);

  useEffect(() => {
    if (!viewAsUid) {
      setTargetProfile(null);
      setTargetLoading(false);
      return;
    }

    // Still figuring out whether the signed-in user is admin/staff.
    if (!staffResolved) {
      setTargetLoading(true);
      return;
    }

    if (!canViewAs) {
      // Non-admin with ?viewAs= — ignore quietly.
      setTargetProfile(null);
      setTargetLoading(false);
      writeSessionViewAs(null);
      setViewAsUid("");
      return;
    }

    if (viewAsUid === adminUser?.uid) {
      setTargetProfile(null);
      setTargetLoading(false);
      writeSessionViewAs(null);
      setViewAsUid("");
      return;
    }

    let cancelled = false;
    setTargetLoading(true);

    (async () => {
      try {
        const snap = await getDoc(doc(db, "users", viewAsUid));
        if (cancelled) return;
        if (!snap.exists()) {
          setTargetProfile(null);
          writeSessionViewAs(null);
          setViewAsUid("");
          return;
        }
        const data = snap.data() as Record<string, unknown>;
        if (isAdminLikeProfile(data)) {
          setTargetProfile(null);
          writeSessionViewAs(null);
          setViewAsUid("");
          return;
        }
        setTargetProfile(buildTargetProfile(viewAsUid, data));
      } catch (e) {
        console.warn("[view-as] failed to load target profile", e);
        if (!cancelled) setTargetProfile(null);
      } finally {
        if (!cancelled) setTargetLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [viewAsUid, canViewAs, staffResolved, adminUser?.uid]);

  const clearViewAs = useCallback(() => {
    writeSessionViewAs(null);
    setViewAsUid("");
    setTargetProfile(null);
    router.push("/admin/dashboard/users");
  }, [router]);

  const isViewingAsClient = Boolean(
    onClientDashboard && canViewAs && viewAsUid && targetProfile && !targetLoading
  );

  const value = useMemo<ViewAsClientState>(
    () => ({
      isViewingAsClient,
      isViewAsPending: Boolean(viewAsUid && onClientDashboard && !isViewingAsClient && (targetLoading || !staffResolved)),
      targetUid: isViewingAsClient ? viewAsUid : null,
      targetProfile: isViewingAsClient ? targetProfile : null,
      targetLoading: Boolean(viewAsUid && onClientDashboard && (targetLoading || !staffResolved)),
      clearViewAs,
    }),
    [
      isViewingAsClient,
      viewAsUid,
      onClientDashboard,
      targetLoading,
      staffResolved,
      targetProfile,
      clearViewAs,
    ]
  );

  return (
    <ViewAsClientContext.Provider value={value}>{children}</ViewAsClientContext.Provider>
  );
}

export function useViewAsClient(): ViewAsClientState {
  return useContext(ViewAsClientContext);
}
