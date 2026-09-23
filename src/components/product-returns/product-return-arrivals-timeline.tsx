"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { warehouseCameraPlaybackUrl } from "@/lib/warehouse-camera-client";
import type { ProductReturn, ReturnArrival } from "@/types";
import {
  formatReturnArrivalUnitType,
  groupArrivalsByTracking,
  normalizeReturnArrivals,
  returnArrivalStatusLabel,
  countedReturnUnits,
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

function ReturnDriveVideos({ sessionIds }: { sessionIds: string[] }) {
  const { user } = useAuth();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const idKey = sessionIds.join("|");

  useEffect(() => {
    let cancelled = false;
    if (!user || !idKey) {
      setUrls({});
      return;
    }
    void user.getIdToken().then((token) => {
      if (cancelled) return;
      const next: Record<string, string> = {};
      for (const id of idKey.split("|")) {
        next[id] = warehouseCameraPlaybackUrl(id, token);
      }
      setUrls(next);
    });
    return () => {
      cancelled = true;
    };
  }, [user, idKey]);

  if (sessionIds.length === 0) return null;

  return (
    <div className="pl-5 pt-1 space-y-2">
      {sessionIds.map((id) =>
        urls[id] ? (
          <div key={id} className="space-y-1">
            <video
              src={urls[id]}
              controls
              playsInline
              className="w-full max-w-sm max-h-48 rounded-md border bg-black"
            />
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Video className="h-3.5 w-3.5" />
              Receive video
            </span>
          </div>
        ) : (
          <p key={id} className="text-xs text-muted-foreground">
            Loading receive video…
          </p>
        )
      )}
    </div>
  );
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
  const counted = countedReturnUnits({
    receivedQuantity: returnItem.receivedQuantity ?? summary.goodTotal,
    receivedGoodQuantity: returnItem.receivedGoodQuantity ?? summary.goodTotal,
    receivedDamagedQuantity: returnItem.receivedDamagedQuantity ?? summary.damagedTotal,
  });

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
          Counted / requested: {counted.total} / {returnItem.requestedQuantity}
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
                  {arrival.videoSessionIds && arrival.videoSessionIds.length > 0 ? (
                    <ReturnDriveVideos sessionIds={arrival.videoSessionIds} />
                  ) : null}
                  {arrival.videoUrls && arrival.videoUrls.length > 0 ? (
                    <div className="pl-5 pt-1 space-y-2">
                      {arrival.videoUrls.map((url) => (
                        <div key={url} className="space-y-1">
                          <video
                            src={url}
                            controls
                            playsInline
                            className="w-full max-w-sm max-h-48 rounded-md border bg-black"
                          />
                          <a
                            href={url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                          >
                            <Video className="h-3.5 w-3.5" />
                            Open receive video
                          </a>
                        </div>
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
