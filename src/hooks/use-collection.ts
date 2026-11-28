"use client";

import { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, Query, collectionGroup } from 'firebase/firestore';
import { db, clearFirestoreCache } from '@/lib/firebase';

export function useCollection<T>(path: string, firestoreQuery?: Query) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const clearAttemptedRef = useRef(false);

  useEffect(() => {
    // Reset immediately when path changes so callers never keep stale rates
    // from a previous pricing profile while the new listener loads.
    setData([]);
    setError(null);
    clearAttemptedRef.current = false;

    if (!path) {
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const collectionRef = collection(db, path);
      const q = firestoreQuery || query(collectionRef);
      
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const docs: T[] = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data() as Record<string, unknown>;
          // For users, document id is the Auth uid — don't let a stale uid field win.
          const withIds =
            path === "users"
              ? { ...data, id: doc.id, uid: doc.id }
              : { id: doc.id, ...data };
          docs.push(withIds as T);
        });
        setData(docs);
        setLoading(false);
        setError(null); // Clear error on success
        clearAttemptedRef.current = false; // Reset on success
      }, (err: any) => {
        // Handle abort errors gracefully - these happen when component unmounts or navigation occurs
        if (err?.message?.includes('aborted') || 
            err?.message?.includes('request aborted') ||
            err?.code === 'cancelled') {
          setError(null);
          setLoading(false);
          return;
        }

        // Permission-denied can be expected for some roles/paths (e.g. View as client switch).
        // Treat as non-fatal. Avoid console.error — Next.js dev overlay treats it as a runtime error.
        if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
          console.warn('Firestore permission denied for path:', path);
          setData([]);
          setError(null);
          setLoading(false);
          return;
        }

        console.warn('Firestore error for path:', path, err);
        
        // Handle internal assertion failures - these indicate corrupted client state
        if (err?.message?.includes('INTERNAL ASSERTION FAILED') || 
            err?.message?.includes('Unexpected state')) {
          if (!clearAttemptedRef.current) {
            clearAttemptedRef.current = true;
            void clearFirestoreCache().then((cleared) => {
              if (cleared && typeof window !== 'undefined') {
                alert('Firestore cache has been cleared. Please refresh the page (F5) to continue.');
              }
            });
          }
          setError(null);
          setLoading(false);
          return;
        }
        
        setError(null);
        setLoading(false);
      });

      return () => unsubscribe();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err : new Error("An unknown error occurred"));
      setLoading(false);
    }
  }, [path, firestoreQuery]);

  return { data, loading, error };
}

export function useCollectionGroup<T>(collectionName: string, firestoreQuery?: Query) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!collectionName) {
      setLoading(false);
      return;
    }

    try {
      const collectionGroupRef = collectionGroup(db, collectionName);
      const q = firestoreQuery || query(collectionGroupRef);
      
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const docs: T[] = [];
        querySnapshot.forEach((doc) => {
          docs.push({ id: doc.id, ...doc.data() } as T);
        });
        setData(docs);
        setLoading(false);
        setError(null);
      }, (err: any) => {
        // Permission-denied is expected when auth switches (e.g. View as client).
        if (err?.code === "permission-denied" || err?.message?.includes("permission")) {
          console.warn("Firestore collectionGroup permission denied:", collectionName);
          setData([]);
          setError(null);
          setLoading(false);
          return;
        }
        console.error("Firestore collectionGroup error:", err);
        setError(err instanceof Error ? err : new Error("An unknown error occurred"));
        setLoading(false);
      });

      return () => unsubscribe();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err : new Error("An unknown error occurred"));
      setLoading(false);
    }
  }, [collectionName, firestoreQuery]);

  return { data, loading, error };
}
