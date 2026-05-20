"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { hasRole } from "@/lib/permissions";

export function WarehouseOpsHeader({ title }: { title: string }) {
  const { userProfile } = useAuth();
  const { warehouses, selectedWarehouse, setSelectedWarehouseId, loading } = useWarehouseOps();

  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b pb-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          {userProfile?.name || userProfile?.email || "Operator"}
          {hasRole(userProfile, "admin") ? " · Admin (all warehouses)" : null}
        </p>
      </div>
      {warehouses.length > 0 ? (
        <div className="flex flex-col gap-1 sm:items-end min-w-[200px]">
          <span className="text-xs text-muted-foreground">Working warehouse</span>
          <Select
            value={selectedWarehouse?.id ?? ""}
            onValueChange={setSelectedWarehouseId}
            disabled={loading || warehouses.length <= 1}
          >
            <SelectTrigger className="w-full sm:w-[220px]">
              <SelectValue placeholder="Select warehouse" />
            </SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.code} — {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <p className="text-sm text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-md px-3 py-2 max-w-md">
          No warehouse assigned. Ask an admin to set your warehouses in Roles &amp; Permissions.
        </p>
      )}
    </header>
  );
}
