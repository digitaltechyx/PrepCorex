"use client";

import Link from "next/link";
import { LogOut, Shield, Warehouse } from "lucide-react";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { auth } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useWarehouseOps } from "@/components/warehouse-ops/warehouse-ops-provider";
import { isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import { hasRole } from "@/lib/permissions";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function initials(name?: string | null): string {
  if (!name) return "OP";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function WarehouseOpsTopbar() {
  const router = useRouter();
  const { userProfile } = useAuth();
  const { warehouses, selectedWarehouse, setSelectedWarehouseId, loading } = useWarehouseOps();
  const supervisor = isOpsSupervisor(userProfile);

  return (
    <header className="sticky top-0 z-40 flex h-14 sm:h-16 shrink-0 items-center gap-2 sm:gap-4 border-b border-border/40 bg-background/95 px-3 sm:px-4 lg:px-6 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <SidebarTrigger className="-ml-1 shrink-0" />

      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <div className="hidden min-w-0 sm:block">
          <p className="truncate text-sm font-semibold leading-tight">Warehouse Ops</p>
          <p className="truncate text-xs text-muted-foreground">PrepCorex floor</p>
        </div>

        {loading ? (
          <p className="ml-auto text-xs text-muted-foreground">Loading warehouses…</p>
        ) : warehouses.length > 0 ? (
          <div className="ml-auto flex min-w-0 max-w-[min(100%,14rem)] sm:max-w-xs items-center gap-2">
            <Warehouse className="hidden h-4 w-4 shrink-0 text-orange-600 sm:block" />
            <Select
              value={selectedWarehouse?.id ?? ""}
              onValueChange={setSelectedWarehouseId}
              disabled={warehouses.length <= 1}
            >
              <SelectTrigger className="h-9 w-full border-orange-200/60 bg-orange-50/40 dark:border-orange-900/40 dark:bg-orange-950/20">
                <SelectValue placeholder="Warehouse" />
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
          <p className="ml-auto max-w-[12rem] sm:max-w-none text-right text-xs text-amber-700 dark:text-amber-300">
            No warehouse assigned — ask admin in Roles &amp; Permissions
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {supervisor ? (
          <Badge variant="secondary" className="hidden gap-1 sm:inline-flex text-xs">
            <Shield className="h-3 w-3" />
            Supervisor
          </Badge>
        ) : null}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0">
              <Avatar className="h-9 w-9 border border-orange-200/60">
                <AvatarImage
                  src={`https://avatar.vercel.sh/${userProfile?.email ?? "ops"}.png`}
                  alt={userProfile?.name ?? "Operator"}
                />
                <AvatarFallback className="bg-gradient-to-br from-orange-500 to-amber-600 text-xs font-semibold text-white">
                  {initials(userProfile?.name)}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">{userProfile?.name ?? "Operator"}</span>
                <span className="text-xs text-muted-foreground">{userProfile?.email}</span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin") ? (
              <DropdownMenuItem asChild>
                <Link href="/admin/dashboard">Admin dashboard</Link>
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={async () => {
                await signOut(auth);
                router.replace("/login");
              }}
            >
              <LogOut className="mr-2 h-4 w-4" />
              Sign out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
