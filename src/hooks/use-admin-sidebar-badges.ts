"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, collectionGroup, getCountFromServer, onSnapshot, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getUserRoles } from "@/lib/permissions";
import type { UserProfile } from "@/types";

function isUnfulfilledShopifyOrder(status: unknown): boolean {
  return String(status || "").toLowerCase() !== "fulfilled";
}

function isUnfulfilledEbayOrder(status: unknown): boolean {
  return String(status || "").toUpperCase() !== "FULFILLED";
}

export function useAdminSidebarBadges(managedUsers: UserProfile[], enabled = true) {
  const [shipmentPendingCount, setShipmentPendingCount] = useState(0);
  const [inventoryPendingCount, setInventoryPendingCount] = useState(0);
  const [productReturnsPendingCount, setProductReturnsPendingCount] = useState(0);
  const [disposePendingCount, setDisposePendingCount] = useState(0);
  const [pendingDocumentRequestsCount, setPendingDocumentRequestsCount] = useState(0);
  const [pendingInvoicesCount, setPendingInvoicesCount] = useState(0);
  const [pendingLabelsCount, setPendingLabelsCount] = useState(0);
  const [unfulfilledShopifyOrdersCount, setUnfulfilledShopifyOrdersCount] = useState(0);
  const [unfulfilledEbayOrdersCount, setUnfulfilledEbayOrdersCount] = useState(0);

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

  const pendingRequestsCount = useMemo(
    () =>
      shipmentPendingCount +
      inventoryPendingCount +
      productReturnsPendingCount +
      disposePendingCount,
    [shipmentPendingCount, inventoryPendingCount, productReturnsPendingCount, disposePendingCount]
  );

  const inventoryActionCount = useMemo(
    () => shipmentPendingCount + inventoryPendingCount,
    [shipmentPendingCount, inventoryPendingCount]
  );

  const totalAdminAttentionCount = useMemo(
    () =>
      pendingRequestsCount +
      pendingDocumentRequestsCount +
      pendingInvoicesCount +
      pendingLabelsCount +
      pendingUsersCount +
      pendingCommissionAgentsCount,
    [
      pendingRequestsCount,
      pendingDocumentRequestsCount,
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
          documentPending,
          invoicePending,
        ] = await Promise.all([
          countStatuses("shipmentRequests", ["pending", "Pending"]),
          countStatuses("inventoryRequests", ["pending", "Pending"]),
          countStatuses("productReturns", [
            "pending",
            "Pending",
            "approved",
            "Approved",
            "in_progress",
            "In Progress",
            "in progress",
          ]),
          countStatuses("disposeRequests", ["pending", "Pending"]),
          countStatuses("documentRequests", ["pending", "Pending"]),
          countStatuses("invoices", ["pending", "Pending"]),
        ]);

        if (cancelled) return;
        setShipmentPendingCount(shipmentPending);
        setInventoryPendingCount(inventoryPending);
        setProductReturnsPendingCount(productReturnPending);
        setDisposePendingCount(disposePending);
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
      where(
        "status",
        "in",
        ["pending", "Pending", "approved", "Approved", "in_progress", "In Progress", "in progress"]
      )
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
    const unsub4 = onSnapshot(
      documentsQ,
      (snap) => {
        if (!cancelled) setPendingDocumentRequestsCount(snap.size);
      },
      onListenerError("documentRequests")
    );
    const unsub5 = onSnapshot(
      disposeQ,
      (snap) => {
        if (!cancelled) setDisposePendingCount(snap.size);
      },
      onListenerError("disposeRequests")
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
    const unsub8 = onSnapshot(
      shopifyQ,
      (snap) => {
        if (cancelled) return;
        const count = snap.docs.filter((docSnap) =>
          isUnfulfilledShopifyOrder(docSnap.data().fulfillment_status)
        ).length;
        setUnfulfilledShopifyOrdersCount(count);
      },
      onListenerError("shopifyOrders")
    );
    const unsub9 = onSnapshot(
      ebayQ,
      (snap) => {
        if (cancelled) return;
        const count = snap.docs.filter((docSnap) =>
          isUnfulfilledEbayOrder(docSnap.data().orderFulfillmentStatus)
        ).length;
        setUnfulfilledEbayOrdersCount(count);
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
      unsub6();
      unsub7();
      unsub8();
      unsub9();
    };
  }, [enabled]);

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
