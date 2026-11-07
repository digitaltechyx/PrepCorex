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
/** Reuse on-demand history across tables/dialogs mounted for the same client. */
const HISTORY_CACHE_MS = 60_000;

type Listener = (sessions: WarehouseCameraSession[]) => void;

type LivePool = {
  sessions: WarehouseCameraSession[];
  listeners: Set<Listener>;
  timer: number | null;
  inFlight: boolean;
  onVisibility: () => void;
  user: User;
  clientUserId?: string;
};

type HistoryEntry = {
  sessions: WarehouseCameraSession[];
  loadedAt: number;
};

const livePools = new Map<string, LivePool>();
const historyCache = new Map<string, HistoryEntry>();
const historyLoads = new Map<string, Promise<WarehouseCameraSession[]>>();

function poolKey(userId: string, clientUserId?: string): string {
  return `${userId}:${clientUserId || ""}`;
}

function hasActiveLiveSession(sessions: WarehouseCameraSession[]): boolean {
  return sessions.some((row) => isWarehouseCameraSessionActive(row));
}

function desiredPollMs(sessions: WarehouseCameraSession[]): number {
  return hasActiveLiveSession(sessions) ? POLL_LIVE_MS : POLL_IDLE_MS;
}

function scheduleLivePool(key: string, nextMs: number): void {
  const pool = livePools.get(key);
  if (!pool) return;
  if (pool.timer != null) window.clearTimeout(pool.timer);
  pool.timer = window.setTimeout(() => {
    const current = livePools.get(key);
    if (current) current.timer = null;
    void refreshLivePool(key);
  }, nextMs);
}

async function refreshLivePool(key: string): Promise<void> {
  const pool = livePools.get(key);
  if (!pool || pool.inFlight) return;
  if (document.visibilityState !== "visible") {
    scheduleLivePool(key, POLL_IDLE_MS);
    return;
  }

  pool.inFlight = true;
  try {
    const sessions = await listWarehouseCameraSessions(pool.user, {
      clientUserId: pool.clientUserId,
      activeOnly: true,
    });
    const current = livePools.get(key);
    if (!current) return;
    current.sessions = sessions;
    current.listeners.forEach((listener) => listener(sessions));
  } catch {
    // Keep the last successful live state so a temporary failure does not flicker the banner.
  } finally {
    const current = livePools.get(key);
    if (current) {
      current.inFlight = false;
      scheduleLivePool(key, desiredPollMs(current.sessions));
    }
  }
}

function subscribeLivePool(
  key: string,
  user: User,
  clientUserId: string | undefined,
  listener: Listener
): () => void {
  let pool = livePools.get(key);
  if (!pool) {
    pool = {
      sessions: [],
      listeners: new Set(),
      timer: null,
      inFlight: false,
      user,
      clientUserId,
      onVisibility: () => {
        const current = livePools.get(key);
        if (!current) return;
        if (document.visibilityState === "visible") {
          if (current.timer != null) window.clearTimeout(current.timer);
          current.timer = null;
          void refreshLivePool(key);
        }
      },
    };
    livePools.set(key, pool);
    document.addEventListener("visibilitychange", pool.onVisibility);
    void refreshLivePool(key);
  }

  pool.listeners.add(listener);
  listener(pool.sessions);

  return () => {
    const current = livePools.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    if (current.timer != null) window.clearTimeout(current.timer);
    document.removeEventListener("visibilitychange", current.onVisibility);
    livePools.delete(key);
  };
}

async function loadHistory(
  key: string,
  user: User,
  clientUserId?: string,
  force = false
): Promise<WarehouseCameraSession[]> {
  const cached = historyCache.get(key);
  if (!force && cached && Date.now() - cached.loadedAt < HISTORY_CACHE_MS) {
    return cached.sessions;
  }
  const existing = historyLoads.get(key);
  if (existing) return existing;

  const load = listWarehouseCameraSessions(user, { clientUserId })
    .then((sessions) => {
      historyCache.set(key, { sessions, loadedAt: Date.now() });
      return sessions;
    })
    .finally(() => {
      historyLoads.delete(key);
    });
  historyLoads.set(key, load);
  return load;
}

/** Recording history is loaded once on demand and shared briefly across consumers. */
export function useWarehouseCameraSessions(clientUserId?: string, enabled = true) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<WarehouseCameraSession[]>([]);

  useEffect(() => {
    if (!user || !enabled) {
      setSessions([]);
      return;
    }
    const key = poolKey(user.uid, clientUserId);
    let cancelled = false;
    let historyRows: WarehouseCameraSession[] = [];
    let liveRows: WarehouseCameraSession[] = [];
    let hadActive = false;

    const publish = () => {
      if (cancelled) return;
      const liveIds = new Set(liveRows.map((row) => row.id));
      setSessions([...liveRows, ...historyRows.filter((row) => !liveIds.has(row.id))]);
    };

    const unsubscribeLive = subscribeLivePool(
      key,
      user,
      clientUserId,
      (rows) => {
        const hasActive = hasActiveLiveSession(rows);
        liveRows = rows;
        publish();
        if (hadActive && !hasActive) {
          void loadHistory(key, user, clientUserId, true).then((nextHistory) => {
            historyRows = nextHistory;
            publish();
          });
        }
        hadActive = hasActive;
      }
    );

    void loadHistory(key, user, clientUserId).then((rows) => {
      historyRows = rows;
      publish();
    });

    return () => {
      cancelled = true;
      unsubscribeLive();
    };
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

/** Only active live/paused sessions are polled; requests never overlap. */
export function useWarehouseCameraLiveSessions(clientUserId?: string, enabled = true) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<WarehouseCameraSession[]>([]);

  useEffect(() => {
    if (!user || !enabled) {
      setSessions([]);
      return;
    }
    return subscribeLivePool(
      poolKey(user.uid, clientUserId),
      user,
      clientUserId,
      setSessions
    );
  }, [clientUserId, enabled, user]);

  return { sessions };
}
