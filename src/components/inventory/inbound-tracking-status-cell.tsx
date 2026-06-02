"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { InboundTrackingEntry } from "@/types";
import { summarizeInboundTrackings } from "@/lib/inbound-tracking";
import { cn } from "@/lib/utils";
import { Eye, Plus } from "lucide-react";

const VARIANT_CLASS = {
  none: "bg-slate-100 text-slate-600 border-slate-200",
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  transit: "bg-blue-50 text-blue-800 border-blue-200",
  delivered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  error: "bg-red-50 text-red-800 border-red-200",
  unknown: "bg-slate-100 text-slate-600 border-slate-200",
};

type Props = {
  trackings?: InboundTrackingEntry[] | null;
  canAddTracking: boolean;
  onAddTracking?: () => void;
  onViewTracking?: () => void;
};

export function InboundTrackingStatusCell({
  trackings,
  canAddTracking,
  onAddTracking,
  onViewTracking,
}: Props) {
  const summary = summarizeInboundTrackings(trackings);
  const hasTracking = (trackings?.length ?? 0) > 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <Badge
        variant="outline"
        className={cn("text-[10px] font-medium whitespace-nowrap", VARIANT_CLASS[summary.variant])}
      >
        {summary.label}
      </Badge>
      <div className="flex items-center gap-0.5">
        {canAddTracking && onAddTracking ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Add tracking"
            onClick={onAddTracking}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        ) : null}
        {hasTracking && onViewTracking ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="View tracking details"
            onClick={onViewTracking}
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
        ) : null}
      </div>
    </div>
  );
}
