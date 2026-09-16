"use client";

import Link from "next/link";
import { InboundTrackerPortal } from "@/components/admin/inbound-tracker-portal";
import { OutboundTrackerPortal } from "@/components/admin/outbound-tracker-portal";
import { PublicTrackersPinGate } from "@/components/trackers/public-trackers-pin-gate";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PackageSearch, Truck } from "lucide-react";

export default function PublicTrackersPage() {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/40">
        <div className="container mx-auto flex max-w-6xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              PrepCorex
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">Parcel trackers</h1>
            <p className="text-sm text-muted-foreground">
              Inbound and outbound tracking for warehouse and partners.
            </p>
          </div>
          <Link
            href="/login"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Admin login
          </Link>
        </div>
      </header>

      <main className="container mx-auto max-w-6xl px-4 py-6">
        <PublicTrackersPinGate>
          <Tabs defaultValue="inbound" className="space-y-6">
            <TabsList className="grid w-full max-w-md grid-cols-2">
              <TabsTrigger value="inbound" className="gap-2">
                <PackageSearch className="h-4 w-4" />
                Inbound
              </TabsTrigger>
              <TabsTrigger value="outbound" className="gap-2">
                <Truck className="h-4 w-4" />
                Outbound
              </TabsTrigger>
            </TabsList>
            <TabsContent value="inbound" className="mt-0 focus-visible:outline-none">
              <InboundTrackerPortal mode="public" />
            </TabsContent>
            <TabsContent value="outbound" className="mt-0 focus-visible:outline-none">
              <OutboundTrackerPortal mode="public" />
            </TabsContent>
          </Tabs>
        </PublicTrackersPinGate>
      </main>
    </div>
  );
}
