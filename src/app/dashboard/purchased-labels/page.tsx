"use client";

import { useAuth } from "@/hooks/use-auth";
import { PurchasedLabelsPanel } from "@/components/labels/purchased-labels-panel";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tag } from "lucide-react";

export default function PurchasedLabelsPage() {
  const { userProfile } = useAuth();

  return (
    <div className="container mx-auto space-y-6 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">
            <span className="bg-gradient-to-r from-indigo-600 via-violet-600 to-sky-500 bg-clip-text text-transparent">
              Purchased Labels
            </span>
          </h1>
          <p className="text-sm text-muted-foreground">
            View, download, and track all labels you&apos;ve purchased.
          </p>
        </div>
        <Button asChild variant="default" size="lg" className="shadow-md">
          <Link href="/dashboard/buy-labels">
            <Tag className="mr-2 h-5 w-5" />
            Buy Labels
          </Link>
        </Button>
      </div>

      <PurchasedLabelsPanel userId={userProfile?.uid} />
    </div>
  );
}
