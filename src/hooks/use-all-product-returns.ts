"use client";

import { useEffect, useState } from "react";
import { collectionGroup, onSnapshot, query } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ProductReturn } from "@/types";

export type AdminProductReturn = ProductReturn & {
  /** Firestore path: users/{ownerUserId}/productReturns/{id} */
  ownerUserId: string;
};

export function getReturnOwnerId(
  item: { ownerUserId?: string; userId?: string } | null | undefined
): string {
  if (!item) return "";
  return item.ownerUserId || item.userId || "";
}

export function useAllProductReturns() {
  const [data, setData] = useState<AdminProductReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const q = query(collectionGroup(db, "productReturns"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const docs: AdminProductReturn[] = [];
        snap.forEach((docSnap) => {
          const pathParts = docSnap.ref.path.split("/");
          const ownerUserId = pathParts[1] || "";
          docs.push({
            id: docSnap.id,
            ...(docSnap.data() as ProductReturn),
            ownerUserId,
          });
        });
        setData(docs);
        setLoading(false);
        setError(null);
      },
      (err) => {
        console.error("[useAllProductReturns]", err);
        setError(err instanceof Error ? err : new Error("Failed to load product returns"));
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  return { data, loading, error };
}
