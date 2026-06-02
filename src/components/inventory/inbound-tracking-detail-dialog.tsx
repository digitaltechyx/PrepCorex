"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { InboundTrackingEntry } from "@/types";
import { format } from "date-fns";
import { toMillis } from "@/lib/inbound-tracking";

function formatCheckedAt(entry: InboundTrackingEntry): string {
  const ms = toMillis(entry.lastCheckedAt);
  if (!ms) return "Not checked yet";
  return format(new Date(ms), "MMM d, yyyy h:mm a");
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productName: string;
  trackings?: InboundTrackingEntry[] | null;
};

export function InboundTrackingDetailDialog({
  open,
  onOpenChange,
  productName,
  trackings,
}: Props) {
  const list = trackings ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inbound tracking</DialogTitle>
          <DialogDescription>
            {productName} — carrier status from Shippo. Refreshes every <strong>6 hours</strong>.
            Delivered here does not mean received at the warehouse.
          </DialogDescription>
        </DialogHeader>
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No tracking numbers on file.</p>
        ) : (
          <ul className="space-y-4">
            {list.map((t) => (
              <li key={t.id} className="rounded-md border p-3 text-sm space-y-1">
                <p className="font-mono font-medium">{t.trackingNumber}</p>
                <p className="text-muted-foreground">
                  Carrier: {t.carrier || "—"} · Status:{" "}
                  <span className="text-foreground">
                    {t.lastStatusLabel || t.lastStatus || "Pending check"}
                  </span>
                </p>
                {t.lastStatusDetails ? (
                  <p className="text-xs text-muted-foreground">{t.lastStatusDetails}</p>
                ) : null}
                {t.lastError ? (
                  <p className="text-xs text-destructive">{t.lastError}</p>
                ) : null}
                <p className="text-xs text-muted-foreground">Last checked: {formatCheckedAt(t)}</p>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
