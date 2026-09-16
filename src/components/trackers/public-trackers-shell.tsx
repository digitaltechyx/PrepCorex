"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";
import { PackageSearch, Truck } from "lucide-react";

const NAV_ITEMS = [
  { href: "/trackers/inbound", label: "Inbound tracker", icon: PackageSearch },
  { href: "/trackers/outbound", label: "Outbound tracker", icon: Truck },
] as const;

export function PublicTrackersShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/60 backdrop-blur-sm">
        <div className="container mx-auto max-w-6xl px-4 py-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 max-w-[220px] sm:max-w-[280px]">
              <Logo href="/trackers/inbound" className="w-full" />
            </div>
            <Link
              href="/login"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline sm:shrink-0"
            >
              Admin login
            </Link>
          </div>

          <div className="mt-5 border-t pt-4">
            <p className="text-sm font-medium text-foreground">Parcel trackers</p>
            <p className="text-xs text-muted-foreground">
              Inbound and outbound tracking for warehouse and partners.
            </p>
            <nav
              className="mt-4 flex flex-wrap gap-1 border-b"
              aria-label="Tracker sections"
            >
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active =
                  pathname === href || (href === "/trackers/inbound" && pathname === "/trackers");
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors -mb-px",
                      active
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:border-muted-foreground/30 hover:text-foreground"
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
