"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { hasRole } from "@/lib/permissions";
import { getPostLoginPath } from "@/lib/auth-redirect";
import { loginPathWithNext } from "@/lib/safe-redirect";
import {
  buildAdminShippedOrdersPath,
  buildClientShippedOrdersPath,
} from "@/lib/prepcorex-order-open";

function OrdersOpenContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, userProfile, loading } = useAuth();

  const order = String(
    searchParams.get("order") || searchParams.get("search") || ""
  ).trim();
  const clientUserId = String(
    searchParams.get("client") || searchParams.get("userId") || ""
  ).trim();

  useEffect(() => {
    if (loading) return;

    const bridgeQs = new URLSearchParams();
    if (order) bridgeQs.set("order", order);
    if (clientUserId) bridgeQs.set("client", clientUserId);
    const bridgePath = `/orders/open${bridgeQs.toString() ? `?${bridgeQs}` : ""}`;

    if (!user) {
      router.replace(loginPathWithNext(bridgePath));
      return;
    }

    if (!userProfile) return;

    const isAdmin =
      hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin");
    const isClient = hasRole(userProfile, "user");

    if (isAdmin && clientUserId) {
      router.replace(buildAdminShippedOrdersPath(clientUserId, order));
      return;
    }

    if (isClient) {
      // Own account: open Shipped Orders filtered to this order id.
      router.replace(buildClientShippedOrdersPath(order));
      return;
    }

    if (isAdmin) {
      // Admin link without client id — still try inventory search if possible.
      router.replace(
        clientUserId
          ? buildAdminShippedOrdersPath(clientUserId, order)
          : "/admin/dashboard"
      );
      return;
    }

    router.replace(getPostLoginPath(userProfile));
  }, [loading, user, userProfile, order, clientUserId, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
    </div>
  );
}

export default function OrdersOpenPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      }
    >
      <OrdersOpenContent />
    </Suspense>
  );
}
