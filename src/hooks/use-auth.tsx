"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from "firebase/auth";
import {
  doc,
  getDoc,
  getDocFromServer,
  onSnapshot,
  updateDoc,
  arrayUnion,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import type { UserProfile, AuthContextType } from "@/types";
import { hasRole } from "@/lib/permissions";
import { findDefaultWarehouseLocationId } from "@/lib/default-warehouse";

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authInitialized, setAuthInitialized] = useState(false);

  useEffect(() => {
    // Set up auth state listener
    // onAuthStateChanged fires immediately with the current user if authenticated
    const unsubscribeAuth = onAuthStateChanged(
      auth,
      async (fbUser) => {
      setUser(fbUser);
        setAuthInitialized(true);
      if (!fbUser) {
          setUserProfile(null);
          setLoading(false);
        }
        // If user exists, profile will be loaded in the next useEffect
      },
      (error) => {
        console.error("Auth state error:", error);
        setUser(null);
        setUserProfile(null);
        setAuthInitialized(true);
        setLoading(false);
      }
    );
    return () => unsubscribeAuth();
  }, []);

  useEffect(() => {
    // Only proceed if auth has been initialized
    if (!authInitialized) {
      return;
    }

    if (user) {
      setLoading(true);
      const userRef = doc(db, "users", user.uid);

      const normalizeRole = (r: unknown) => String(r ?? "").trim().toLowerCase();
      const buildProfile = (data: Record<string, unknown>) => {
        const roleList = Array.isArray(data.roles) ? data.roles : (data.role != null ? [data.role] : ["user"]);
        const rolesNormalized = roleList.map(normalizeRole).filter(Boolean);
        return {
          uid: user.uid,
          ...data,
          email: data.email ?? null,
          name: data.name ?? null,
          phone: data.phone ?? null,
          role: normalizeRole(data.role) || "user",
          status: data.status || "approved",
          roles: rolesNormalized.length ? rolesNormalized : ["user"],
          features: Array.isArray(data.features) ? data.features : [],
        } as UserProfile;
      };

      (async () => {
        try {
          const serverSnap = await getDocFromServer(userRef);
          if (serverSnap.exists()) {
            setUserProfile(buildProfile(serverSnap.data()));
          } else {
            setUserProfile(null);
          }
        } catch {
          const fallbackSnap = await getDoc(userRef);
          if (fallbackSnap.exists()) {
            setUserProfile(buildProfile(fallbackSnap.data()));
          } else {
            setUserProfile(null);
          }
        } finally {
          setLoading(false);
        }
      })();

      const unsubProfile = onSnapshot(
        userRef,
        (docSnapshot) => {
          if (docSnapshot.exists()) {
            setUserProfile(buildProfile(docSnapshot.data()));
          } else {
            setUserProfile(null);
          }
          setLoading(false);
        },
        (error) => {
          if (error?.message?.includes('aborted') || error?.message?.includes('user aborted') || error?.code === 'cancelled') return;
          console.error("Error fetching user profile:", error);
          setUserProfile(null);
          setLoading(false);
        }
      );
      return () => unsubProfile();
    } else {
      // If user is null, ensure loading is false
      setUserProfile(null);
      setLoading(false);
    }
  }, [user, authInitialized]);

  useEffect(() => {
    if (!user?.uid || !userProfile) return;
    if (!hasRole(userProfile, "user")) return;
    const locs = userProfile.locations ?? [];
    let cancelled = false;
    (async () => {
      const defaultId = await findDefaultWarehouseLocationId();
      if (cancelled || !defaultId) return;
      if (locs.includes(defaultId)) return;
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        const fresh = snap.exists()
          ? (((snap.data() as Record<string, unknown>).locations as string[] | undefined) ?? [])
          : [];
        if (fresh.includes(defaultId)) return;
        await updateDoc(doc(db, "users", user.uid), { locations: arrayUnion(defaultId) });
      } catch (err) {
        console.error("Could not merge default warehouse location:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.uid, userProfile]);

  const signOut = async () => {
    await firebaseSignOut(auth);
    setUser(null);
    setUserProfile(null);
  };

  return (
    <AuthContext.Provider value={{ user, userProfile, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};

