"use client";

import { useAuth } from "@/hooks/use-auth";
import { hasRole } from "@/lib/permissions";

/** Page-level title strip (warehouse selector lives in the top bar). */
export function WarehouseOpsHeader({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  const { userProfile } = useAuth();

  return (
    <div className="mb-5 sm:mb-6 space-y-1 border-b border-border/40 pb-4">
      <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{title}</h1>
      {(description || userProfile) && (
        <p className="text-sm text-muted-foreground">
          {description ??
            `${userProfile?.name || userProfile?.email || "Operator"}${
              hasRole(userProfile, "admin") ? " · Admin (all warehouses)" : ""
            }`}
        </p>
      )}
    </div>
  );
}
