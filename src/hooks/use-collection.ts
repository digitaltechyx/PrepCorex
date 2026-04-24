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
    if (!path) {
      setLoading(false);
      return;
    }

    try {
      const collectionRef = collection(db, path);
      const q = firestoreQuery || query(collectionRef);
      
      const unsubscribe = onSnapshot(q, (querySnapshot) => {
        const docs: T[] = [];
        querySnapshot.forEach((doc) => {
          docs.push({ id: doc.id, ...doc.data() } as T);
        });
        setData(docs);
        setLoading(false);
        setError(null); // Clear error on success
        clearAttemptedRef.current = false; // Reset on success
      }, async (err: any) => {
        // Handle abort errors gracefully - these happen when component unmounts or navigation occurs
        if (err?.message?.includes('aborted') || 
            err?.message?.includes('user aborted') ||
            err?.code === 'cancelled') {
          // This is normal - component unmounted or user navigated away
          // Don't log as error, just silently ignore
          setError(null);
          setLoading(false);
          return;
        }

        // Permission-denied can be expected for some roles/paths (e.g. global admin collections).
        // Treat as non-fatal: keep UI running with empty data and avoid noisy console errors.
        if (err?.code === 'permission-denied' || err?.message?.includes('permission')) {
          console.warn('Firestore permission denied for path:', path);
          setData([]);
          setError(null);
          setLoading(false);
          return;
        }

        console.error('Firestore error for path:', path, err);
        
        // Handle internal assertion failures - these indicate corrupted client state
        if (err?.message?.includes('INTERNAL ASSERTION FAILED') || 
            err?.message?.includes('Unexpected state')) {
          console.error('âš ï¸ Firestore client is corrupted! Attempting to clear cache...');
          
          // Only attempt to clear once per component mount
          if (!clearAttemptedRef.current) {
            clearAttemptedRef.current = true;
            const cleared = await clearFirestoreCache();
            if (cleared) {
              console.log('✅ Cache cleared. Please refresh the page (F5) to reload.');
              // Show alert to user
              if (typeof window !== 'undefined') {
                alert('Firestore cache has been cleared. Please refresh the page (F5) to continue.');
              }
            }
          }
          
          // Don't set error to prevent UI breakage, but log it
          setError(null);
          setLoading(false);
          return;
        }
        
        // For other errors, log but don't break the UI
        console.warn('Firestore error (non-critical):', err);
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
        console.error('Firestore collectionGroup error:', err);
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
