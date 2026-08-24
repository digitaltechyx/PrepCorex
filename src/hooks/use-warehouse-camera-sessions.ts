"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/hooks/use-auth";
import { listWarehouseCameraSessions } from "@/lib/warehouse-camera-client";
import {
  warehouseCameraRecordedRequestIds,
  warehouseCameraRecordedShipmentIds,
  type WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";

const POLL_MS = 5_000;

type Listener = (sessions: WarehouseCameraSession[]) => void;

type Pool = {
  sessions: WarehouseCameraSession[];
  listeners: Set<Listener>;
  timer: number | null;
  onVisibility: () => void;
};

const pools = new Map<string, Pool>();

function poolKey(userId: string, clientUserId?: string): string {
  return `${userId}:${clientUserId || ""}`;
}

async function refreshPool(key: string, user: User, clientUserId?: string): Promise<void> {
  const pool = pools.get(key);
  if (!pool || document.visibilityState !== "visible") return;
  try {
    const sessions = await listWarehouseCameraSessions(user, { clientUserId });
    const current = pools.get(key);
    if (!current) return;
    current.sessions = sessions;
    current.listeners.forEach((listener) => listener(sessions));
  } catch {
    // Keep the last successful list so a blip does not hide recorded videos.
  }
}

function subscribePool(
  key: string,
  user: User,
  clientUserId: string | undefined,
  listener: Listener
): () => void {
  let pool = pools.get(key);
  if (!pool) {
    pool = {
      sessions: [],
      listeners: new Set(),
      timer: null,
      onVisibility: () => {
        void refreshPool(key, user, clientUserId);
      },
    };
    pools.set(key, pool);
    pool.timer = window.setInterval(pool.onVisibility, POLL_MS);
    document.addEventListener("visibilitychange", pool.onVisibility);
    void refreshPool(key, user, clientUserId);
  }

  pool.listeners.add(listener);
  listener(pool.sessions);

  return () => {
    const current = pools.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    if (current.timer != null) window.clearInterval(current.timer);
    document.removeEventListener("visibilitychange", current.onVisibility);
    pools.delete(key);
  };
}

export function useWarehouseCameraSessions(clientUserId?: string, enabled = true) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<WarehouseCameraSession[]>([]);

  useEffect(() => {
    if (!user || !enabled) {
      setSessions([]);
      return;
    }
    return subscribePool(poolKey(user.uid, clientUserId), user, clientUserId, setSessions);
  }, [clientUserId, enabled, user]);

  const recordedRequestIds = useMemo(
    () => warehouseCameraRecordedRequestIds(sessions),
    [sessions]
  );

  const recordedShipmentIds = useMemo(
    () => warehouseCameraRecordedShipmentIds(sessions),
    [sessions]
  );

  return { sessions, recordedRequestIds, recordedShipmentIds };
}
