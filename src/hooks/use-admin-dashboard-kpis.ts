"use client";

import { useEffect, useMemo, useState } from "react";
import {
  collection,
  collectionGroup,
  onSnapshot,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { UserProfile } from "@/types";

function toMs(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === "object" && v !== null && "seconds" in v && typeof (v as { seconds: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  if (v instanceof Date) return v.getTime();
  return 0;
}

function uidFromPath(path: string): string {
  return path.split("/")[1] || "";
}

function isAllowedUser(
  path: string,
  adminUid: string | undefined,
  managedIds: Set<string> | null
): boolean {
  const userId = uidFromPath(path);
  if (!userId || userId === adminUid) return false;
  if (managedIds !== null && !managedIds.has(userId)) return false;
  return true;
}

function todayTimestampBounds() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return {
    start: Timestamp.fromDate(start),
    end: Timestamp.fromDate(end),
    startMs: start.getTime(),
    endMs: end.getTime(),
  };
}

function sumPendingInvoiceAmount(
  docs: Array<{ ref: { path: string }; data: () => Record<string, unknown> }>,
  adminUid: string | undefined,
  managedIds: Set<string> | null
): number {
  let total = 0;
  for (const doc of docs) {
    if (!isAllowedUser(doc.ref.path, adminUid, managedIds)) continue;
    total += Number(doc.data().grandTotal || 0);
  }
  return total;
}

function countTodayShipped(
  docs: Array<{ ref: { path: string }; data: () => Record<string, unknown> }>,
  adminUid: string | undefined,
  managedIds: Set<string> | null,
  startMs: number,
  endMs: number
): number {
  let count = 0;
  for (const doc of docs) {
    if (!isAllowedUser(doc.ref.path, adminUid, managedIds)) continue;
    const ms = toMs(doc.data().date);
    if (ms >= startMs && ms < endMs) count += 1;
  }
  return count;
}

function sumTodayReceivedUnits(
  docs: Array<{ ref: { path: string }; data: () => Record<string, unknown> }>,
  adminUid: string | undefined,
  managedIds: Set<string> | null,
  startMs: number,
  endMs: number
): number {
  let qty = 0;
  for (const doc of docs) {
    if (!isAllowedUser(doc.ref.path, adminUid, managedIds)) continue;
    const data = doc.data();
    const ms = toMs(data.receivingDate) || toMs(data.dateAdded);
    if (ms >= startMs && ms < endMs) qty += Number(data.quantity) || 0;
  }
  return qty;
}

function countPendingRequests(
  shipmentDocs: Array<{ ref: { path: string } }>,
  inventoryDocs: Array<{ ref: { path: string } }>,
  returnDocs: Array<{ ref: { path: string } }>,
  adminUid: string | undefined,
  managedIds: Set<string> | null
): number {
  let total = 0;
  for (const doc of [...shipmentDocs, ...inventoryDocs, ...returnDocs]) {
    if (isAllowedUser(doc.ref.path, adminUid, managedIds)) total += 1;
  }
  return total;
}

export type AdminDashboardKpis = {
  pendingRequestsCount: number;
  pendingInvoicesCount: number;
  pendingInvoicesAmount: number;
  ordersShippedToday: number;
  receivedUnitsToday: number;
  requestsLoading: boolean;
  invoicesLoading: boolean;
  shippedAndReceivedLoading: boolean;
};

export function useAdminDashboardKpis(
  adminUid: string | undefined,
  users: UserProfile[] | null | undefined,
  managedUserIds: string[] | null
): AdminDashboardKpis {
  const [pendingRequestsCount, setPendingRequestsCount] = useState(0);
  const [pendingInvoicesCount, setPendingInvoicesCount] = useState(0);
  const [pendingInvoicesAmount, setPendingInvoicesAmount] = useState(0);
  const [ordersShippedToday, setOrdersShippedToday] = useState(0);
  const [receivedUnitsToday, setReceivedUnitsToday] = useState(0);
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [shippedAndReceivedLoading, setShippedAndReceivedLoading] = useState(true);

  const managedIds = useMemo(
    () => (managedUserIds === null ? null : new Set(managedUserIds)),
    [managedUserIds]
  );

  const ready = Boolean(adminUid && users && users.length > 0);

  useEffect(() => {
    if (!ready || !adminUid) {
      setPendingRequestsCount(0);
      setRequestsLoading(false);
      return;
    }

    setRequestsLoading(true);
    const shipmentQ = query(
      collectionGroup(db, "shipmentRequests"),
      where("status", "in", ["pending", "Pending"])
    );
    const inventoryQ = query(
      collectionGroup(db, "inventoryRequests"),
      where("status", "in", ["pending", "Pending"])
    );
    const returnsQ = query(
      collectionGroup(db, "productReturns"),
      where(
        "status",
        "in",
        ["pending", "Pending", "approved", "Approved", "in_progress", "In Progress", "in progress"]
      )
    );

    let shipDocs: Array<{ ref: { path: string } }> = [];
    let invDocs: Array<{ ref: { path: string } }> = [];
    let retDocs: Array<{ ref: { path: string } }> = [];
    let loaded = { ship: false, inv: false, ret: false };

    const publish = () => {
      if (!loaded.ship || !loaded.inv || !loaded.ret) return;
      setPendingRequestsCount(countPendingRequests(shipDocs, invDocs, retDocs, adminUid, managedIds));
      setRequestsLoading(false);
    };

    const unsub1 = onSnapshot(
      shipmentQ,
      (snap) => {
        shipDocs = snap.docs;
        loaded.ship = true;
        publish();
      },
      () => {
        loaded.ship = true;
        publish();
      }
    );
    const unsub2 = onSnapshot(
      inventoryQ,
      (snap) => {
        invDocs = snap.docs;
        loaded.inv = true;
        publish();
      },
      () => {
        loaded.inv = true;
        publish();
      }
    );
    const unsub3 = onSnapshot(
      returnsQ,
      (snap) => {
        retDocs = snap.docs;
        loaded.ret = true;
        publish();
      },
      () => {
        loaded.ret = true;
        publish();
      }
    );

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [ready, adminUid, managedIds]);

  useEffect(() => {
    if (!ready || !adminUid) {
      setPendingInvoicesCount(0);
      setPendingInvoicesAmount(0);
      setInvoicesLoading(false);
      return;
    }

    setInvoicesLoading(true);
    const invoicesQ = query(
      collectionGroup(db, "invoices"),
      where("status", "in", ["pending", "Pending"])
    );

    const unsub = onSnapshot(
      invoicesQ,
      (snap) => {
        const allowed = snap.docs.filter((d) => isAllowedUser(d.ref.path, adminUid, managedIds));
        setPendingInvoicesCount(allowed.length);
        setPendingInvoicesAmount(
          sumPendingInvoiceAmount(
            allowed as Array<{ ref: { path: string }; data: () => Record<string, unknown> }>,
            adminUid,
            managedIds
          )
        );
        setInvoicesLoading(false);
      },
      () => {
        setPendingInvoicesCount(0);
        setPendingInvoicesAmount(0);
        setInvoicesLoading(false);
      }
    );

    return () => unsub();
  }, [ready, adminUid, managedIds]);

  useEffect(() => {
    if (!ready || !adminUid) {
      setOrdersShippedToday(0);
      setReceivedUnitsToday(0);
      setShippedAndReceivedLoading(false);
      return;
    }

    setShippedAndReceivedLoading(true);
    const { start, end, startMs, endMs } = todayTimestampBounds();

    const shippedQ = query(
      collectionGroup(db, "shipped"),
      where("date", ">=", start),
      where("date", "<", end)
    );
    const receivedByReceivingQ = query(
      collectionGroup(db, "inventory"),
      where("receivingDate", ">=", start),
      where("receivingDate", "<", end)
    );
    const receivedByAddedQ = query(
      collectionGroup(db, "inventory"),
      where("dateAdded", ">=", start),
      where("dateAdded", "<", end)
    );

    let shippedCount = 0;
    let recv1Docs: Array<{ id: string; ref: { path: string }; data: () => Record<string, unknown> }> = [];
    let recv2Docs: Array<{ id: string; ref: { path: string }; data: () => Record<string, unknown> }> = [];
    let loaded = { shipped: false, recv1: false, recv2: false };
    const receivedIds = new Set<string>();
    let receivedQty = 0;

    const recomputeReceived = () => {
      receivedIds.clear();
      receivedQty = 0;
      addReceivedDocs(recv1Docs);
      addReceivedDocs(recv2Docs);
    };

    const publishAll = () => {
      if (!loaded.shipped || !loaded.recv1 || !loaded.recv2) return;
      recomputeReceived();
      setOrdersShippedToday(shippedCount);
      setReceivedUnitsToday(receivedQty);
      setShippedAndReceivedLoading(false);
    };

    const addReceivedDocs = (
      docs: Array<{ id: string; ref: { path: string }; data: () => Record<string, unknown> }>
    ) => {
      for (const doc of docs) {
        if (!isAllowedUser(doc.ref.path, adminUid, managedIds)) continue;
        if (receivedIds.has(doc.id)) continue;
        const data = doc.data();
        const ms = toMs(data.receivingDate) || toMs(data.dateAdded);
        if (ms < startMs || ms >= endMs) continue;
        receivedIds.add(doc.id);
        receivedQty += Number(data.quantity) || 0;
      }
    };

    const unsubShipped = onSnapshot(
      shippedQ,
      (snap) => {
        shippedCount = countTodayShipped(snap.docs, adminUid, managedIds, startMs, endMs);
        loaded.shipped = true;
        publishAll();
      },
      () => {
        loaded.shipped = true;
        publishAll();
      }
    );

    const unsubRecv1 = onSnapshot(
      receivedByReceivingQ,
      (snap) => {
        recv1Docs = snap.docs;
        loaded.recv1 = true;
        publishAll();
      },
      () => {
        loaded.recv1 = true;
        publishAll();
      }
    );

    const unsubRecv2 = onSnapshot(
      receivedByAddedQ,
      (snap) => {
        recv2Docs = snap.docs;
        loaded.recv2 = true;
        publishAll();
      },
      () => {
        loaded.recv2 = true;
        publishAll();
      }
    );

    return () => {
      unsubShipped();
      unsubRecv1();
      unsubRecv2();
    };
  }, [ready, adminUid, managedIds]);

  return {
    pendingRequestsCount,
    pendingInvoicesCount,
    pendingInvoicesAmount,
    ordersShippedToday,
    receivedUnitsToday,
    requestsLoading,
    invoicesLoading,
    shippedAndReceivedLoading,
  };
}
