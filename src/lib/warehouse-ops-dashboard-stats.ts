import { countOpenCycleCountTasks } from "@/lib/warehouse-cycle-count";
import { countInboundDockQueue } from "@/lib/warehouse-inbound-requests";
import { countOutboundQueueStats } from "@/lib/warehouse-pack";
import { countReturnQcQueue } from "@/lib/warehouse-returns";
import { listWarehouseCartonsForStats } from "@/lib/warehouse-carton-firestore";
import { isActiveWarehouseCarton } from "@/lib/warehouse-carton-states";
import type { UserFeature, UserProfile, WarehouseCartonDoc, WarehouseDoc } from "@/types";

export type WarehouseOpsDashboardStats = {
  inboundDock: number;
  awaitingPutaway: number;
  activeCartons: number;
  quarantineUnits: number;
  pickQueue: number;
  packQueue: number;
  dispatchReady: number;
  cycleCountOpen: number;
  returnQc: number;
};

export type WarehouseOpsFlowMetric = {
  key: string;
  label: string;
  description: string;
  count: number;
  href: string;
  feature: UserFeature;
  tone: "neutral" | "info" | "warning" | "success" | "danger";
};

export type WarehouseOpsQueueStats = Pick<
  WarehouseOpsDashboardStats,
  "inboundDock" | "pickQueue" | "packQueue" | "dispatchReady" | "cycleCountOpen" | "returnQc"
>;

const STATS_CACHE_MS = 60_000;
const SESSION_CACHE_MS = 5 * 60_000;
const SESSION_KEY_PREFIX = "wops-stats-v1-";

const statsCache = new Map<
  string,
  { loadedAt: number; stats: WarehouseOpsDashboardStats }
>();
const inFlightLoads = new Map<string, Promise<WarehouseOpsDashboardStats>>();

function countAwaitingPutaway(cartons: WarehouseCartonDoc[]): number {
  let n = 0;
  for (const c of cartons) {
    if (!isActiveWarehouseCarton(c)) continue;
    if (
      c.status !== "received" &&
      c.status !== "receiving" &&
      c.status !== "stowed_partial"
    ) {
      continue;
    }
    const lines = c.lines ?? [];
    if (lines.length === 0) {
      if (!c.binId) n += 1;
      continue;
    }
    if (lines.some((l) => !l.binId)) n += 1;
  }
  return n;
}

function countQuarantineUnits(cartons: WarehouseCartonDoc[]): number {
  let units = 0;
  for (const c of cartons) {
    if (!isActiveWarehouseCarton(c)) continue;
    if (c.status === "quarantine" || c.status === "damaged") {
      units += Math.max(0, c.quantity);
      continue;
    }
    for (const l of c.lines ?? []) {
      if (l.condition === "damaged") units += Math.max(0, l.quantity);
    }
  }
  return units;
}

export function cartonDerivedDashboardStats(
  cartons: WarehouseCartonDoc[]
): Pick<
  WarehouseOpsDashboardStats,
  "awaitingPutaway" | "activeCartons" | "quarantineUnits"
> {
  const active = cartons.filter(isActiveWarehouseCarton);
  return {
    awaitingPutaway: countAwaitingPutaway(active),
    activeCartons: active.length,
    quarantineUnits: countQuarantineUnits(active),
  };
}

const EMPTY_QUEUE_STATS: WarehouseOpsQueueStats = {
  inboundDock: 0,
  pickQueue: 0,
  packQueue: 0,
  dispatchReady: 0,
  cycleCountOpen: 0,
  returnQc: 0,
};

function readSessionStats(warehouseId: string): WarehouseOpsDashboardStats | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(`${SESSION_KEY_PREFIX}${warehouseId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { loadedAt: number; stats: WarehouseOpsDashboardStats };
    if (Date.now() - parsed.loadedAt > SESSION_CACHE_MS) return null;
    return parsed.stats;
  } catch {
    return null;
  }
}

function writeSessionStats(warehouseId: string, stats: WarehouseOpsDashboardStats): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(
      `${SESSION_KEY_PREFIX}${warehouseId}`,
      JSON.stringify({ loadedAt: Date.now(), stats })
    );
  } catch {
    // ignore quota / private mode
  }
}

function persistStats(warehouseId: string, stats: WarehouseOpsDashboardStats): void {
  statsCache.set(warehouseId, { loadedAt: Date.now(), stats });
  writeSessionStats(warehouseId, stats);
}

/** Store latest stats for instant display on next visit. */
export function rememberWarehouseOpsDashboardStats(
  warehouseId: string,
  stats: WarehouseOpsDashboardStats
): void {
  persistStats(warehouseId, stats);
}

/** Instant stats from memory or session (for first paint). */
export function peekCachedWarehouseOpsDashboardStats(
  warehouseId: string
): WarehouseOpsDashboardStats | null {
  const cached = statsCache.get(warehouseId);
  if (cached && Date.now() - cached.loadedAt < STATS_CACHE_MS) {
    return cached.stats;
  }
  const session = readSessionStats(warehouseId);
  if (session) {
    statsCache.set(warehouseId, { loadedAt: Date.now(), stats: session });
    return session;
  }
  return null;
}

export async function loadCartonDashboardStats(warehouseId: string): Promise<{
  cartons: WarehouseCartonDoc[];
  stats: Pick<
    WarehouseOpsDashboardStats,
    "awaitingPutaway" | "activeCartons" | "quarantineUnits"
  >;
}> {
  const cartons = await listWarehouseCartonsForStats(warehouseId);
  return { cartons, stats: cartonDerivedDashboardStats(cartons) };
}

export async function loadQueueDashboardStats(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  cartons: WarehouseCartonDoc[];
  onPartial?: (patch: Partial<WarehouseOpsQueueStats>) => void;
}): Promise<WarehouseOpsQueueStats> {
  const { warehouse, clients, cartons, onPartial } = input;
  const running: WarehouseOpsQueueStats = { ...EMPTY_QUEUE_STATS };
  const patch = (next: Partial<WarehouseOpsQueueStats>) => {
    Object.assign(running, next);
    onPartial?.(next);
  };

  const outboundPromise = countOutboundQueueStats({ warehouse, clients })
    .catch(() => ({ pickQueue: 0, packQueue: 0, dispatchReady: 0 }))
    .then((outbound) => {
      patch(outbound);
      return outbound;
    });

  const inboundPromise = countInboundDockQueue({ warehouse, clients, cartons })
    .catch(() => 0)
    .then((inboundDock) => {
      patch({ inboundDock });
      return inboundDock;
    });

  const cyclePromise = countOpenCycleCountTasks(warehouse.id)
    .catch(() => 0)
    .then((cycleCountOpen) => {
      patch({ cycleCountOpen });
      return cycleCountOpen;
    });

  const returnPromise = countReturnQcQueue({ warehouse, clients, cartons })
    .catch(() => 0)
    .then((returnQc) => {
      patch({ returnQc });
      return returnQc;
    });

  const [outbound, inboundDock, cycleCountOpen, returnQc] = await Promise.all([
    outboundPromise,
    inboundPromise,
    cyclePromise,
    returnPromise,
  ]);

  return {
    inboundDock,
    pickQueue: outbound.pickQueue,
    packQueue: outbound.packQueue,
    dispatchReady: outbound.dispatchReady,
    cycleCountOpen,
    returnQc,
  };
}

async function fetchWarehouseOpsDashboardStats(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  forceRefresh?: boolean;
  onPartial?: (stats: WarehouseOpsDashboardStats) => void;
}): Promise<WarehouseOpsDashboardStats> {
  const { warehouse, clients, onPartial } = input;
  const warehouseId = warehouse.id;

  const { cartons, stats: cartonStats } = await loadCartonDashboardStats(warehouseId);
  const runningQueues: WarehouseOpsQueueStats = { ...EMPTY_QUEUE_STATS };
  const partial: WarehouseOpsDashboardStats = {
    ...EMPTY_QUEUE_STATS,
    ...cartonStats,
  };
  onPartial?.(partial);

  const queueStats = await loadQueueDashboardStats({
    warehouse,
    clients,
    cartons,
    onPartial: (patch) => {
      Object.assign(runningQueues, patch);
      onPartial?.({ ...cartonStats, ...runningQueues });
    },
  });

  const stats: WarehouseOpsDashboardStats = {
    ...cartonStats,
    ...queueStats,
  };

  persistStats(warehouseId, stats);
  return stats;
}

export async function loadWarehouseOpsDashboardStats(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  forceRefresh?: boolean;
  onPartial?: (stats: WarehouseOpsDashboardStats) => void;
}): Promise<WarehouseOpsDashboardStats> {
  const { warehouse, forceRefresh = false, onPartial } = input;
  const warehouseId = warehouse.id;

  if (!forceRefresh) {
    const cached = peekCachedWarehouseOpsDashboardStats(warehouseId);
    if (cached) {
      onPartial?.(cached);
      const memory = statsCache.get(warehouseId);
      if (memory && Date.now() - memory.loadedAt < STATS_CACHE_MS) {
        return cached;
      }
      // Stale cache: show immediately, refresh in background.
      void fetchWarehouseOpsDashboardStats({ ...input, forceRefresh: true, onPartial }).catch(
        () => undefined
      );
      return cached;
    }
  }

  const existing = inFlightLoads.get(warehouseId);
  if (existing && !forceRefresh) {
    return existing;
  }

  const loadPromise = fetchWarehouseOpsDashboardStats(input).finally(() => {
    inFlightLoads.delete(warehouseId);
  });
  inFlightLoads.set(warehouseId, loadPromise);
  return loadPromise;
}

export function buildWarehouseOpsFlowMetrics(
  stats: WarehouseOpsDashboardStats
): WarehouseOpsFlowMetric[] {
  return [
    {
      key: "inbound",
      label: "Dock intake",
      description: "Approved inbound awaiting receive",
      count: stats.inboundDock,
      href: "/warehouse-ops/receiving",
      feature: "ops_receive",
      tone: stats.inboundDock > 0 ? "info" : "neutral",
    },
    {
      key: "putaway",
      label: "Putaway",
      description: "Received at dock — scan carton to storage bin",
      count: stats.awaitingPutaway,
      href: "/warehouse-ops/putaway",
      feature: "ops_putaway",
      tone: stats.awaitingPutaway > 0 ? "warning" : "neutral",
    },
    {
      key: "pick",
      label: "Pick queue",
      description: "Orders ready to pick",
      count: stats.pickQueue,
      href: "/warehouse-ops/pick",
      feature: "ops_pick",
      tone: stats.pickQueue > 0 ? "info" : "neutral",
    },
    {
      key: "pack",
      label: "Pack queue",
      description: "Picked orders awaiting pack verify",
      count: stats.packQueue,
      href: "/warehouse-ops/pack",
      feature: "ops_pack",
      tone: stats.packQueue > 0 ? "info" : "neutral",
    },
    {
      key: "dispatch",
      label: "Dispatch",
      description: "Packed and ready for carrier",
      count: stats.dispatchReady,
      href: "/warehouse-ops/dispatch",
      feature: "ops_pack",
      tone: stats.dispatchReady > 0 ? "success" : "neutral",
    },
    {
      key: "returns",
      label: "Return QC",
      description: "Returns awaiting inspection",
      count: stats.returnQc,
      href: "/warehouse-ops/return-qc",
      feature: "ops_returns",
      tone: stats.returnQc > 0 ? "danger" : "neutral",
    },
    {
      key: "cycle",
      label: "Cycle count",
      description: "Open count tasks",
      count: stats.cycleCountOpen,
      href: "/warehouse-ops/cycle-count",
      feature: "ops_count",
      tone: stats.cycleCountOpen > 0 ? "warning" : "neutral",
    },
  ];
}
