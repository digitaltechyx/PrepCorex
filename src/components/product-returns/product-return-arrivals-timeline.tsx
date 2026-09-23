"use client";

import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import type { ProductReturn, ReturnArrival } from "@/types";
import {
  formatReturnArrivalUnitType,
  groupArrivalsByTracking,
  normalizeReturnArrivals,
  returnArrivalStatusLabel,
  summarizeReturnArrivals,
} from "@/lib/product-return-arrivals";
import { Package, Truck, Video } from "lucide-react";

function formatTs(value: ReturnArrival["arrivedAt"]): string {
  if (!value) return "";
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? value : format(d, "PPp");
  }
  if (typeof value === "object" && "seconds" in value) {
    return format(new Date(value.seconds * 1000), "PPp");
  }
  return "";
}

function statusBadgeVariant(
  status: ReturnArrival["status"]
): "outline" | "secondary" | "default" {
  if (status === "received") return "default";
  if (status === "opened") return "secondary";
  return "outline";
}

export function ProductReturnArrivalsTimeline({
  returnItem,
  compact = false,
}: {
  returnItem: Pick<
    ProductReturn,
    | "returnArrivals"
    | "receivedQuantity"
    | "receivedGoodQuantity"
    | "receivedDamagedQuantity"
    | "requestedQuantity"
  >;
  compact?: boolean;
}) {
  const arrivals = normalizeReturnArrivals(returnItem.returnArrivals);
  const summary = summarizeReturnArrivals(arrivals);

  if (arrivals.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No physical arrivals logged yet. Admin will record cartons, pallets, or packages when
        they reach the warehouse.
      </p>
    );
  }

  const byTracking = groupArrivalsByTracking(arrivals);

  return (
    <div className={compact ? "space-y-3" : "space-y-4"}>
      <div className="flex flex-wrap gap-2 text-sm">
        <Badge variant="outline" className="tabular-nums">
          Good: {summary.goodTotal}
        </Badge>
        {summary.damagedTotal > 0 ? (
          <Badge variant="destructive" className="tabular-nums">
            Damaged: {summary.damagedTotal}
          </Badge>
        ) : null}
        {summary.arrivedOnly > 0 ? (
          <Badge variant="secondary" className="tabular-nums">
            {summary.arrivedOnly} awaiting open
          </Badge>
        ) : null}
        <span className="text-muted-foreground tabular-nums">
          Received good / requested: {returnItem.receivedQuantity ?? summary.goodTotal} /{" "}
          {returnItem.requestedQuantity}
        </span>
      </div>

      <div className="space-y-4">
        {[...byTracking.entries()].map(([tracking, items]) => (
          <div key={tracking} className="rounded-lg border bg-muted/20 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Truck className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-mono break-all">{tracking}</span>
            </div>
            <div className="space-y-2 pl-6">
              {items.map((arrival) => (
                <div
                  key={arrival.id}
                  className="rounded-md border bg-background px-3 py-2 text-sm space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Package className="h-3.5 w-3.5 text-muted-foreground" />
                    <span>{formatReturnArrivalUnitType(arrival.unitType)}</span>
                    <Badge variant={statusBadgeVariant(arrival.status)} className="text-xs">
                      {returnArrivalStatusLabel(arrival.status)}
                    </Badge>
                    {arrival.arrivedAt ? (
                      <span className="text-xs text-muted-foreground">
                        Arrived {formatTs(arrival.arrivedAt)}
                      </span>
                    ) : null}
                  </div>
                  {arrival.status === "received" ? (
                    <div className="text-xs text-muted-foreground pl-5">
                      Good: <span className="font-medium text-foreground">{arrival.goodQty ?? 0}</span>
                      {" · "}
                      Damaged:{" "}
                      <span className="font-medium text-foreground">{arrival.damagedQty ?? 0}</span>
                      {arrival.receivedAt ? (
                        <span> · Counted {formatTs(arrival.receivedAt)}</span>
                      ) : null}
                    </div>
                  ) : null}
                  {arrival.receivePhotoUrls && arrival.receivePhotoUrls.length > 0 ? (
                    <div className="flex flex-wrap gap-2 pl-5 pt-1">
                      {arrival.receivePhotoUrls.map((url) => (
                        <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                          <img
                            src={url}
                            alt="Return receive"
                            className="h-14 w-14 rounded border object-cover"
                          />
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {arrival.videoUrls && arrival.videoUrls.length > 0 ? (
                    <div className="pl-5 pt-1 space-y-1">
                      {arrival.videoUrls.map((url) => (
                        <a
                          key={url}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                        >
                          <Video className="h-3.5 w-3.5" />
                          Watch receive video
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
