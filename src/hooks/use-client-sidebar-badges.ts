"use client";

import { useMemo } from "react";
import { collection, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { hasRole } from "@/lib/permissions";
import type {
  Commission,
  DisposeRequest,
  InventoryRequest,
  Invoice,
  ProductReturn,
  ShipmentRequest,
  ShopifyOrder,
  UploadedPDF,
  UserProfile,
} from "@/types";

type DocumentRequestLite = {
  id?: string;
  status?: string;
};

const ACTIVE_RETURN_STATUSES = new Set(["pending", "approved", "in_progress"]);

function normalizeStatus(value: unknown): string {
  return String(value || "").toLowerCase();
}

export function useClientSidebarBadges() {
  const { userProfile, user } = useAuth();
  const uid = userProfile?.uid;
  const pathPrefix = uid ? `users/${uid}` : "";
  const hasAgentRole = hasRole(userProfile, "commission_agent");

  const { data: invoices } = useCollection<Invoice>(pathPrefix ? `${pathPrefix}/invoices` : "");
  const { data: shopifyOrders } = useCollection<ShopifyOrder>(
    pathPrefix ? `${pathPrefix}/shopifyOrders` : ""
  );
  const { data: inventoryRequests } = useCollection<InventoryRequest>(
    pathPrefix ? `${pathPrefix}/inventoryRequests` : ""
  );
  const { data: shipmentRequests } = useCollection<ShipmentRequest>(
    pathPrefix ? `${pathPrefix}/shipmentRequests` : ""
  );
  const { data: productReturns } = useCollection<ProductReturn>(
    pathPrefix ? `${pathPrefix}/productReturns` : ""
  );
  const { data: documentRequests } = useCollection<DocumentRequestLite>(
    pathPrefix ? `${pathPrefix}/documentRequests` : ""
  );
  const { data: disposeRequests } = useCollection<DisposeRequest>(
    pathPrefix ? `${pathPrefix}/disposeRequests` : ""
  );
  const { data: allUploadedPDFs } = useCollection<UploadedPDF>("uploadedPDFs");
  const { data: allUsers } = useCollection<UserProfile>(hasAgentRole ? "users" : "");

  const commissionsQuery = useMemo(() => {
    if (!hasAgentRole || !uid) return undefined;
    return query(collection(db, "commissions"), where("agentId", "==", uid));
  }, [hasAgentRole, uid]);

  const { data: commissions } = useCollection<Commission>(
    hasAgentRole && uid ? "commissions" : "",
    commissionsQuery
  );

  const uploadedPDFs = useMemo(() => {
    if (!user?.uid) return [];
    if (userProfile?.role === "admin") return allUploadedPDFs;
    return allUploadedPDFs.filter((pdf) => pdf.uploadedBy === user.uid);
  }, [allUploadedPDFs, user?.uid, userProfile?.role]);

  const pendingInvoicesCount = useMemo(
    () => invoices.filter((inv) => inv.status === "pending").length,
    [invoices]
  );

  const pendingShopifyOrdersCount = useMemo(
    () => shopifyOrders.filter((order) => order.fulfillment_status !== "fulfilled").length,
    [shopifyOrders]
  );

  const pendingInboundCount = useMemo(
    () => inventoryRequests.filter((req) => normalizeStatus(req.status) === "pending").length,
    [inventoryRequests]
  );

  const pendingOutboundCount = useMemo(
    () =>
      shipmentRequests.filter((req) => {
        const status = normalizeStatus(req.status);
        return status === "pending" || status === "awaiting_label_upload";
      }).length,
    [shipmentRequests]
  );

  const inventoryActionCount = useMemo(
    () => pendingInboundCount + pendingOutboundCount,
    [pendingInboundCount, pendingOutboundCount]
  );

  const pendingProductReturnsCount = useMemo(
    () => productReturns.filter((item) => ACTIVE_RETURN_STATUSES.has(normalizeStatus(item.status))).length,
    [productReturns]
  );

  const pendingDocumentsCount = useMemo(
    () => documentRequests.filter((req) => normalizeStatus(req.status) === "pending").length,
    [documentRequests]
  );

  const pendingDisposeCount = useMemo(
    () => disposeRequests.filter((req) => normalizeStatus(req.status) === "pending").length,
    [disposeRequests]
  );

  const pendingLabelsCount = useMemo(
    () => uploadedPDFs.filter((pdf) => !pdf.status || pdf.status === "pending").length,
    [uploadedPDFs]
  );

  const pendingAffiliateClientsCount = useMemo(() => {
    if (!hasAgentRole || !uid) return 0;
    return allUsers.filter(
      (profile) =>
        profile.role === "user" && profile.referredByAgentId === uid && profile.status === "pending"
    ).length;
  }, [allUsers, hasAgentRole, uid]);

  const pendingAffiliateCommissionsCount = useMemo(() => {
    if (!hasAgentRole) return 0;
    return commissions.filter((commission) => commission.status === "pending").length;
  }, [commissions, hasAgentRole]);

  const affiliateAttentionCount = pendingAffiliateClientsCount + pendingAffiliateCommissionsCount;

  return {
    pendingInvoicesCount,
    pendingShopifyOrdersCount,
    pendingInboundCount,
    pendingOutboundCount,
    inventoryActionCount,
    pendingProductReturnsCount,
    pendingDocumentsCount,
    pendingDisposeCount,
    pendingLabelsCount,
    pendingAffiliateClientsCount,
    pendingAffiliateCommissionsCount,
    affiliateAttentionCount,
  };
}
