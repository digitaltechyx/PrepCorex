"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Package, Home, LogOut, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { auth } from "@/lib/firebase";
import { signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { getOpsNavItems, isOpsSupervisor } from "@/lib/warehouse-ops-permissions";
import { hasRole } from "@/lib/permissions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function WarehouseOpsSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { userProfile } = useAuth();
  const navItems = getOpsNavItems(userProfile);

  return (
    <aside className="flex w-full sm:w-56 flex-col border-r bg-gradient-to-b from-orange-50/80 to-background dark:from-orange-950/20 shrink-0">
      <div className="p-4 border-b">
        <div className="flex items-center gap-2">
          <Package className="h-6 w-6 text-orange-600" />
          <div>
            <p className="font-semibold text-sm">Warehouse Ops</p>
            <p className="text-xs text-muted-foreground">PrepCorex floor</p>
          </div>
        </div>
        {isOpsSupervisor(userProfile) ? (
          <Badge variant="secondary" className="mt-2 text-xs gap-1">
            <Shield className="h-3 w-3" />
            Supervisor
          </Badge>
        ) : null}
      </div>
      <nav className="flex-1 p-2 space-y-1">
        {navItems.map((item) => {
          const active =
            item.href === "/warehouse-ops"
              ? pathname === "/warehouse-ops"
              : pathname?.startsWith(item.href);
          const content = (
            <span
              className={cn(
                "flex flex-col rounded-lg px-3 py-2.5 text-sm transition-colors",
                active
                  ? "bg-orange-600 text-white"
                  : "text-foreground hover:bg-muted",
                item.disabled && "opacity-50 pointer-events-none"
              )}
            >
              <span className="font-medium">{item.title}</span>
              {item.description ? (
                <span
                  className={cn(
                    "text-xs mt-0.5",
                    active ? "text-orange-100" : "text-muted-foreground"
                  )}
                >
                  {item.description}
                </span>
              ) : null}
            </span>
          );
          if (item.disabled) {
            return <div key={item.href}>{content}</div>;
          }
          return (
            <Link key={item.href} href={item.href}>
              {content}
            </Link>
          );
        })}
      </nav>
      <div className="p-3 border-t space-y-2">
        {hasRole(userProfile, "admin") || hasRole(userProfile, "sub_admin") ? (
          <Button variant="outline" size="sm" className="w-full" asChild>
            <Link href="/admin/dashboard">Admin dashboard</Link>
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-muted-foreground"
          onClick={async () => {
            await signOut(auth);
            router.replace("/login");
          }}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </Button>
      </div>
    </aside>
  );
}
