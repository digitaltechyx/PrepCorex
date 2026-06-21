import { loadActiveCycleCountTasks } from "@/lib/warehouse-cycle-count";
import { countInboundDockQueue } from "@/lib/warehouse-inbound-requests";
import { countOutboundQueueStats } from "@/lib/warehouse-pack";
import { countReturnQcQueue } from "@/lib/warehouse-returns";
import { listWarehouseCartons } from "@/lib/warehouse-carton-firestore";
import { isActiveWarehouseCarton } from "@/lib/warehouse-carton-states";
import type { UserFeature, UserProfile, WarehouseCartonDoc, WarehouseDoc } from "@/types";

export type WarehouseOpsDashboardStats = {
  inboundDock: number;
  awaitingPutaway: number;
  inStaging: number;
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

const STATS_CACHE_MS = 30_000;
const statsCache = new Map<
  string,
  { loadedAt: number; stats: WarehouseOpsDashboardStats }
>();

function countInStaging(cartons: WarehouseCartonDoc[]): number {
  let n = 0;
  for (const c of cartons) {
    if (!isActiveWarehouseCarton(c)) continue;
    if (c.status !== "received" && c.status !== "receiving") continue;
    const lines = c.lines ?? [];
    if (lines.length === 0) {
      if (!c.binId) n += 1;
      continue;
    }
    if (lines.some((l) => !l.binId)) n += 1;
  }
  return n;
}

function countAwaitingPutaway(cartons: WarehouseCartonDoc[]): number {
  let n = 0;
  for (const c of cartons) {
    if (!isActiveWarehouseCarton(c)) continue;
    if (c.status !== "received" && c.status !== "stowed_partial") continue;
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
  "awaitingPutaway" | "inStaging" | "activeCartons" | "quarantineUnits"
> {
  const active = cartons.filter(isActiveWarehouseCarton);
  return {
    awaitingPutaway: countAwaitingPutaway(active),
    inStaging: countInStaging(active),
    activeCartons: active.length,
    quarantineUnits: countQuarantineUnits(active),
  };
}

const EMPTY_QUEUE_STATS: Pick<
  WarehouseOpsDashboardStats,
  "inboundDock" | "pickQueue" | "packQueue" | "dispatchReady" | "cycleCountOpen" | "returnQc"
> = {
  inboundDock: 0,
  pickQueue: 0,
  packQueue: 0,
  dispatchReady: 0,
  cycleCountOpen: 0,
  returnQc: 0,
};

export async function loadWarehouseOpsDashboardStats(input: {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  /** Skip cache and force a fresh Firestore read. */
  forceRefresh?: boolean;
  /** Called as soon as carton counts are ready, before queue queries finish. */
  onPartial?: (stats: WarehouseOpsDashboardStats) => void;
}): Promise<WarehouseOpsDashboardStats> {
  const { warehouse, clients, forceRefresh = false, onPartial } = input;
  const cacheKey = warehouse.id;

  if (!forceRefresh) {
    const cached = statsCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < STATS_CACHE_MS) {
      return cached.stats;
    }
  }

  const cartonsPromise = listWarehouseCartons(warehouse.id);
  void cartonsPromise.then((cartons) => {
    onPartial?.({
      ...EMPTY_QUEUE_STATS,
      ...cartonDerivedDashboardStats(cartons),
    });
  });

  const [cartons, outbound, inboundDock, cycleCountOpen, returnQc] = await Promise.all([
    cartonsPromise,
    countOutboundQueueStats({ warehouse, clients }).catch(() => ({
      pickQueue: 0,
      packQueue: 0,
      dispatchReady: 0,
    })),
    cartonsPromise.then((loaded) =>
      countInboundDockQueue({ warehouse, clients, cartons: loaded }).catch(() => 0)
    ),
    loadActiveCycleCountTasks(warehouse.id)
      .then((tasks) => tasks.length)
      .catch(() => 0),
    cartonsPromise.then((loaded) =>
      countReturnQcQueue({ warehouse, clients, cartons: loaded }).catch(() => 0)
    ),
  ]);

  const cartonStats = cartonDerivedDashboardStats(cartons);

  const stats: WarehouseOpsDashboardStats = {
    ...cartonStats,
    inboundDock,
    pickQueue: outbound.pickQueue,
    packQueue: outbound.packQueue,
    dispatchReady: outbound.dispatchReady,
    cycleCountOpen,
    returnQc,
  };

  statsCache.set(cacheKey, { loadedAt: Date.now(), stats });
  return stats;
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
      description: "Received cartons need bin placement",
      count: stats.awaitingPutaway,
      href: "/warehouse-ops/putaway",
      feature: "ops_putaway",
      tone: stats.awaitingPutaway > 0 ? "warning" : "neutral",
    },
    {
      key: "staging",
      label: "In staging",
      description: "Received at dock, not yet in storage bin",
      count: stats.inStaging,
      href: "/warehouse-ops/putaway",
      feature: "ops_putaway",
      tone: stats.inStaging > 0 ? "warning" : "neutral",
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
