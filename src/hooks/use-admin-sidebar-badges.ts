"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  collection,
  collectionGroup,
  getCountFromServer,
  onSnapshot,
  query,
  where,
  type QueryDocumentSnapshot,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getUserRoles } from "@/lib/permissions";
import type { UserProfile } from "@/types";

/** Matches ShopifyOrdersPanel unfulfilled filter (not partial/cancelled). */
function isUnfulfilledShopifyOrder(status: unknown): boolean {
  const s = status == null ? "" : String(status);
  return !s || s === "unfulfilled" || s === "null";
}

/** Matches admin eBay orders "Quick Fulfill" eligibility. */
function isActionableEbayOrder(data: Record<string, unknown>): boolean {
  if (String(data.orderFulfillmentStatus || "") === "FULFILLED") return false;
  const items = Array.isArray(data.lineItems) ? data.lineItems : [];
  return items.some((li) => {
    const fs = String((li as Record<string, unknown>).lineItemFulfillmentStatus || "");
    return fs === "NOT_STARTED" || fs === "IN_PROGRESS";
  });
}

function ownerUid(doc: QueryDocumentSnapshot): string | null {
  return doc.ref.parent.parent?.id ?? null;
}

function countScopedMarketplaceOrders(
  docs: QueryDocumentSnapshot[],
  managedUids: Set<string>,
  connectedUids: Set<string>,
  isCountable: (data: Record<string, unknown>) => boolean
): number {
  let count = 0;
  for (const docSnap of docs) {
    const uid = ownerUid(docSnap);
    if (!uid || !managedUids.has(uid) || !connectedUids.has(uid)) continue;
    if (isCountable(docSnap.data())) count++;
  }
  return count;
}

export function useAdminSidebarBadges(managedUsers: UserProfile[], enabled = true) {
  const [shipmentPendingCount, setShipmentPendingCount] = useState(0);
  const [inventoryPendingCount, setInventoryPendingCount] = useState(0);
  const [productReturnsPendingCount, setProductReturnsPendingCount] = useState(0);
  const [disposePendingCount, setDisposePendingCount] = useState(0);
  const [deletePendingCount, setDeletePendingCount] = useState(0);
  const [quarantinePendingCount, setQuarantinePendingCount] = useState(0);
  const [labelRefundPendingCount, setLabelRefundPendingCount] = useState(0);
  const [pendingDocumentRequestsCount, setPendingDocumentRequestsCount] = useState(0);
  const [pendingInvoicesCount, setPendingInvoicesCount] = useState(0);
  const [pendingLabelsCount, setPendingLabelsCount] = useState(0);
  const [unfulfilledShopifyOrdersCount, setUnfulfilledShopifyOrdersCount] = useState(0);
  const [unfulfilledEbayOrdersCount, setUnfulfilledEbayOrdersCount] = useState(0);

  const managedUidSet = useMemo(
    () => new Set(managedUsers.map((user) => user.uid).filter((uid): uid is string => Boolean(uid))),
    [managedUsers]
  );
  const managedUidSetRef = useRef(managedUidSet);
  managedUidSetRef.current = managedUidSet;

  const marketplaceStateRef = useRef({
    shopifyDocs: [] as QueryDocumentSnapshot[],
    ebayDocs: [] as QueryDocumentSnapshot[],
    shopifyConnectedUids: new Set<string>(),
    ebayConnectedUids: new Set<string>(),
  });
  const recomputeMarketplaceCountsRef = useRef<() => void>(() => {});

  const pendingUsersCount = useMemo(
    () => managedUsers.filter((user) => user.status === "pending").length,
    [managedUsers]
  );

  const pendingCommissionAgentsCount = useMemo(
    () =>
      managedUsers.filter(
        (user) => getUserRoles(user).includes("commission_agent") && user.status === "pending"
      ).length,
    [managedUsers]
  );

  /** Matches Admin Notifications types (pending only). Documents stay separate. */
  const pendingRequestsCount = useMemo(
    () =>
      shipmentPendingCount +
      inventoryPendingCount +
      productReturnsPendingCount +
      disposePendingCount +
      deletePendingCount +
      quarantinePendingCount +
      labelRefundPendingCount,
    [
      shipmentPendingCount,
      inventoryPendingCount,
      productReturnsPendingCount,
      disposePendingCount,
      deletePendingCount,
      quarantinePendingCount,
      labelRefundPendingCount,
    ]
  );

  const inventoryActionCount = useMemo(
    () => shipmentPendingCount + inventoryPendingCount,
    [shipmentPendingCount, inventoryPendingCount]
  );

  const totalAdminAttentionCount = useMemo(
    () =>
      pendingRequestsCount +
      pendingInvoicesCount +
      pendingLabelsCount +
      pendingUsersCount +
      pendingCommissionAgentsCount,
    [
      pendingRequestsCount,
      pendingInvoicesCount,
      pendingLabelsCount,
      pendingUsersCount,
      pendingCommissionAgentsCount,
    ]
  );

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;

    const countStatuses = async (collectionName: string, statuses: string[]) => {
      const counts = await Promise.all(
        statuses.map(async (status) => {
          const q = query(collectionGroup(db, collectionName), where("status", "==", status));
          const snap = await getCountFromServer(q);
          return snap.data().count || 0;
        })
      );
      return counts.reduce((a, b) => a + b, 0);
    };

    const refreshCounts = async () => {
      try {
        const [
          shipmentPending,
          inventoryPending,
          productReturnPending,
          disposePending,
          deletePending,
          quarantinePending,
          labelRefundPending,
          documentPending,
          invoicePending,
        ] = await Promise.all([
          countStatuses("shipmentRequests", ["pending", "Pending"]),
          countStatuses("inventoryRequests", ["pending", "Pending"]),
          countStatuses("productReturns", ["pending", "Pending"]),
          countStatuses("disposeRequests", ["pending", "Pending"]),
          countStatuses("deleteRequests", ["pending", "Pending"]),
          countStatuses("quarantineRequests", ["pending", "Pending"]),
          countStatuses("labelRefundRequests", ["pending", "Pending"]),
          countStatuses("documentRequests", ["pending", "Pending"]),
          countStatuses("invoices", ["pending", "Pending"]),
        ]);

        if (cancelled) return;
        setShipmentPendingCount(shipmentPending);
        setInventoryPendingCount(inventoryPending);
        setProductReturnsPendingCount(productReturnPending);
        setDisposePendingCount(disposePending);
        setDeletePendingCount(deletePending);
        setQuarantinePendingCount(quarantinePending);
        setLabelRefundPendingCount(labelRefundPending);
        setPendingDocumentRequestsCount(documentPending);
        setPendingInvoicesCount(invoicePending);
      } catch (err) {
        console.warn("[AdminSidebarBadges] Badge count refresh failed; keeping last counts.", err);
      }
    };

    void refreshCounts();

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
      where("status", "in", ["pending", "Pending"])
    );
    const deleteQ = query(
      collectionGroup(db, "deleteRequests"),
      where("status", "in", ["pending", "Pending"])
    );
    const quarantineQ = query(
      collection(db, "quarantineRequests"),
      where("status", "in", ["pending", "Pending"])
    );
    const labelRefundQ = query(
      collectionGroup(db, "labelRefundRequests"),
      where("status", "in", ["pending", "Pending"])
    );
    const documentsQ = query(
      collectionGroup(db, "documentRequests"),
      where("status", "in", ["pending", "Pending"])
    );
    const disposeQ = query(
      collectionGroup(db, "disposeRequests"),
      where("status", "in", ["pending", "Pending"])
    );
    const invoicesQ = query(
      collectionGroup(db, "invoices"),
      where("status", "in", ["pending", "Pending"])
    );
    const labelsQ = collection(db, "uploadedPDFs");
    const shopifyQ = query(collectionGroup(db, "shopifyOrders"));
    const ebayQ = query(collectionGroup(db, "ebayOrders"));
    const shopifyConnectionsQ = query(collectionGroup(db, "shopifyConnections"));
    const ebayConnectionsQ = query(collectionGroup(db, "ebayConnections"));

    const recomputeMarketplaceCounts = () => {
      if (cancelled) return;
      const state = marketplaceStateRef.current;
      const managed = managedUidSetRef.current;
      setUnfulfilledShopifyOrdersCount(
        countScopedMarketplaceOrders(
          state.shopifyDocs,
          managed,
          state.shopifyConnectedUids,
          (data) => isUnfulfilledShopifyOrder(data.fulfillment_status)
        )
      );
      setUnfulfilledEbayOrdersCount(
        countScopedMarketplaceOrders(
          state.ebayDocs,
          managed,
          state.ebayConnectedUids,
          isActionableEbayOrder
        )
      );
    };
    recomputeMarketplaceCountsRef.current = recomputeMarketplaceCounts;

    const onListenerError = (label: string) => (err: unknown) => {
      if (cancelled) return;
      const e = err as { code?: string; message?: string };
      console.warn(`[AdminSidebarBadges] ${label} badge listener:`, e?.code || e?.message || err);
    };

    const unsub1 = onSnapshot(
      shipmentQ,
      (snap) => {
        if (!cancelled) setShipmentPendingCount(snap.size);
      },
      onListenerError("shipmentRequests")
    );
    const unsub2 = onSnapshot(
      inventoryQ,
      (snap) => {
        if (!cancelled) setInventoryPendingCount(snap.size);
      },
      onListenerError("inventoryRequests")
    );
    const unsub3 = onSnapshot(
      returnsQ,
      (snap) => {
        if (!cancelled) setProductReturnsPendingCount(snap.size);
      },
      onListenerError("productReturns")
    );
    const unsub5 = onSnapshot(
      disposeQ,
      (snap) => {
        if (!cancelled) setDisposePendingCount(snap.size);
      },
      onListenerError("disposeRequests")
    );
    const unsubDelete = onSnapshot(
      deleteQ,
      (snap) => {
        if (!cancelled) setDeletePendingCount(snap.size);
      },
      onListenerError("deleteRequests")
    );
    const unsubQuarantine = onSnapshot(
      quarantineQ,
      (snap) => {
        if (!cancelled) setQuarantinePendingCount(snap.size);
      },
      onListenerError("quarantineRequests")
    );
    const unsubLabelRefund = onSnapshot(
      labelRefundQ,
      (snap) => {
        if (!cancelled) setLabelRefundPendingCount(snap.size);
      },
      onListenerError("labelRefundRequests")
    );
    const unsub4 = onSnapshot(
      documentsQ,
      (snap) => {
        if (!cancelled) setPendingDocumentRequestsCount(snap.size);
      },
      onListenerError("documentRequests")
    );
    const unsub6 = onSnapshot(
      invoicesQ,
      (snap) => {
        if (!cancelled) setPendingInvoicesCount(snap.size);
      },
      onListenerError("invoices")
    );
    const unsub7 = onSnapshot(
      labelsQ,
      (snap) => {
        if (cancelled) return;
        const pending = snap.docs.filter((docSnap) => {
          const status = docSnap.data().status;
          return !status || status === "pending";
        }).length;
        setPendingLabelsCount(pending);
      },
      onListenerError("uploadedPDFs")
    );
    const unsubShopifyConnections = onSnapshot(
      shopifyConnectionsQ,
      (snap) => {
        if (cancelled) return;
        const connected = new Set<string>();
        for (const doc of snap.docs) {
          const uid = ownerUid(doc);
          if (uid) connected.add(uid);
        }
        marketplaceStateRef.current.shopifyConnectedUids = connected;
        recomputeMarketplaceCounts();
      },
      onListenerError("shopifyConnections")
    );
    const unsubEbayConnections = onSnapshot(
      ebayConnectionsQ,
      (snap) => {
        if (cancelled) return;
        const connected = new Set<string>();
        for (const doc of snap.docs) {
          const uid = ownerUid(doc);
          if (uid) connected.add(uid);
        }
        marketplaceStateRef.current.ebayConnectedUids = connected;
        recomputeMarketplaceCounts();
      },
      onListenerError("ebayConnections")
    );
    const unsub8 = onSnapshot(
      shopifyQ,
      (snap) => {
        if (cancelled) return;
        marketplaceStateRef.current.shopifyDocs = snap.docs;
        recomputeMarketplaceCounts();
      },
      onListenerError("shopifyOrders")
    );
    const unsub9 = onSnapshot(
      ebayQ,
      (snap) => {
        if (cancelled) return;
        marketplaceStateRef.current.ebayDocs = snap.docs;
        recomputeMarketplaceCounts();
      },
      onListenerError("ebayOrders")
    );

    const onVis = () => {
      if (document.visibilityState === "visible") void refreshCounts();
    };
    document.addEventListener("visibilitychange", onVis);
    const interval = setInterval(() => void refreshCounts(), 60000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(interval);
      unsub1();
      unsub2();
      unsub3();
      unsub4();
      unsub5();
      unsubDelete();
      unsubQuarantine();
      unsubLabelRefund();
      unsub6();
      unsub7();
      unsubShopifyConnections();
      unsubEbayConnections();
      unsub8();
      unsub9();
    };
  }, [enabled]);

  useEffect(() => {
    recomputeMarketplaceCountsRef.current();
  }, [managedUidSet]);

  return {
    shipmentPendingCount,
    inventoryPendingCount,
    productReturnsPendingCount,
    disposePendingCount,
    pendingDocumentRequestsCount,
    pendingInvoicesCount,
    pendingLabelsCount,
    pendingUsersCount,
    pendingCommissionAgentsCount,
    pendingRequestsCount,
    inventoryActionCount,
    unfulfilledShopifyOrdersCount,
    unfulfilledEbayOrdersCount,
    totalAdminAttentionCount,
  };
}
