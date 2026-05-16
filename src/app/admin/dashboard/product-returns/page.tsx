"use client";

import React, { Suspense } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductReturnsManagement } from "@/components/admin/product-returns-management";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { useSearchParams } from "next/navigation";
import { Package } from "lucide-react";

function ProductReturnsContent() {
  const searchParams = useSearchParams();
  const filterUserId = searchParams.get("userId");
  const initialReturnId = searchParams.get("returnId") ?? undefined;

  const { managedUsers: users, loading: usersLoading } = useManagedUsers();

  return (
    <Card className="border-2 shadow-xl overflow-hidden rounded-xl border-border/50">
      <CardContent className="p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-teal-100 dark:bg-teal-900/30 text-teal-600 dark:text-teal-400 shadow-sm">
            <Package className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Product Returns</h1>
            <p className="text-sm text-muted-foreground">
              All client return requests — filter by client or submit a new request on behalf of a user
            </p>
          </div>
        </div>
        {usersLoading ? (
          <Skeleton className="h-64 w-full rounded-xl" />
        ) : (
          <ProductReturnsManagement
            managedUsers={users}
            filterUserId={filterUserId}
            initialReturnId={initialReturnId}
          />
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminProductReturnsPage() {
  return (
    <div className="container mx-auto py-6 space-y-6">
      <Suspense
        fallback={
          <Card className="border-2 shadow-xl rounded-xl">
            <CardContent className="p-6">
              <Skeleton className="h-64 w-full rounded-xl" />
            </CardContent>
          </Card>
        }
      >
        <ProductReturnsContent />
      </Suspense>
    </div>
  );
}
