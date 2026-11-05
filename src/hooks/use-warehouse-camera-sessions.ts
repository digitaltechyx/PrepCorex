"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { useAuth } from "@/hooks/use-auth";
import { listWarehouseCameraSessions } from "@/lib/warehouse-camera-client";
import {
  isWarehouseCameraSessionActive,
  warehouseCameraRecordedRequestIds,
  warehouseCameraRecordedShipmentIds,
  type WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";

/** While a receive/outbound session is live or paused. */
const POLL_LIVE_MS = 5_000;
/** No active live session — still detect new lives, but stop spamming the server. */
const POLL_IDLE_MS = 30_000;

type Listener = (sessions: WarehouseCameraSession[]) => void;

type Pool = {
  sessions: WarehouseCameraSession[];
  listeners: Set<Listener>;
  timer: number | null;
  pollMs: number;
  onVisibility: () => void;
};

const pools = new Map<string, Pool>();

function poolKey(userId: string, clientUserId?: string): string {
  return `${userId}:${clientUserId || ""}`;
}

function hasActiveLiveSession(sessions: WarehouseCameraSession[]): boolean {
  return sessions.some((row) => isWarehouseCameraSessionActive(row));
}

function desiredPollMs(sessions: WarehouseCameraSession[]): number {
  return hasActiveLiveSession(sessions) ? POLL_LIVE_MS : POLL_IDLE_MS;
}

function reschedulePool(pool: Pool, nextMs: number): void {
  if (pool.pollMs === nextMs && pool.timer != null) return;
  if (pool.timer != null) window.clearInterval(pool.timer);
  pool.pollMs = nextMs;
  pool.timer = window.setInterval(pool.onVisibility, nextMs);
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
    reschedulePool(current, desiredPollMs(sessions));
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
      pollMs: POLL_IDLE_MS,
      onVisibility: () => {
        void refreshPool(key, user, clientUserId);
      },
    };
    pools.set(key, pool);
    reschedulePool(pool, POLL_IDLE_MS);
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
