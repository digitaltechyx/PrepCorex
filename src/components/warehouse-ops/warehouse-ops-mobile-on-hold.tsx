"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Archive, Check, Loader2, PauseCircle } from "lucide-react";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import { buildPutawayQueueLabels, type PutawayQueueLabel } from "@/lib/warehouse-putaway-queue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function labelKey(label: PutawayQueueLabel): string {
  return `${label.kind}:${label.id}`;
}

export function WarehouseOpsMobileOnHold() {
  const router = useRouter();
  const { cartons, pallets, liveLoading, stats } = useWarehouseOpsLive();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const onHoldItems = useMemo(
    () => buildPutawayQueueLabels(cartons, pallets),
    [cartons, pallets]
  );

  const selected = onHoldItems.find((item) => labelKey(item) === selectedKey) ?? null;

  function openPutaway(label: PutawayQueueLabel) {
    router.push(`/warehouse-ops/putaway?label=${encodeURIComponent(label.code)}`);
  }

  return (
    <div className="pb-24 md:pb-0">
      <WarehouseOpsHeader
        title="On hold"
        description={`${stats.awaitingPutaway} label${stats.awaitingPutaway === 1 ? "" : "s"} awaiting putaway`}
      />

      <div className="overflow-hidden rounded-2xl border bg-card shadow-sm">
        {liveLoading ? (
          <div className="flex min-h-[160px] items-center justify-center px-4">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : onHoldItems.length > 0 ? (
          onHoldItems.map((item, index) => {
            const key = labelKey(item);
            const isSelected = selectedKey === key;
            return (
              <div
                key={key}
                className={cn(
                  "flex min-h-[76px] items-center gap-3 px-4 py-3",
                  index > 0 && "border-t",
                  isSelected && "bg-orange-50/80 dark:bg-orange-950/20"
                )}
              >
                <button
                  type="button"
                  aria-pressed={isSelected}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => setSelectedKey(isSelected ? null : key)}
                >
                  <span
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2",
                      isSelected
                        ? "border-orange-600 bg-orange-600 text-white"
                        : "border-muted-foreground/30 bg-muted/40 text-amber-700"
                    )}
                  >
                    {isSelected ? (
                      <Check className="h-4 w-4" />
                    ) : (
                      <PauseCircle className="h-4 w-4" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{item.code}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {item.badge}
                      </Badge>
                    </span>
                    {item.subtitle ? (
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {item.subtitle}
                      </span>
                    ) : null}
                  </span>
                </button>
                <Button
                  type="button"
                  size="sm"
                  variant={isSelected ? "default" : "outline"}
                  className={cn(!isSelected && "border-orange-200 text-orange-700")}
                  onClick={() => openPutaway(item)}
                >
                  Putaway
                </Button>
              </div>
            );
          })
        ) : (
          <div className="flex min-h-[160px] flex-col items-center justify-center px-4 text-center">
            <Archive className="mb-2 h-6 w-6 text-emerald-600" />
            <p className="text-sm font-semibold">Nothing on hold</p>
            <p className="mt-1 text-xs text-muted-foreground">
              All received cartons and pallets are put away.
            </p>
          </div>
        )}
      </div>

      {selected ? (
        <div className="fixed inset-x-0 bottom-[72px] z-40 border-t bg-background/95 p-3 shadow-[0_-8px_24px_rgba(15,23,42,0.08)] backdrop-blur md:hidden">
          <p className="mb-2 truncate text-center text-xs text-muted-foreground">
            Selected <span className="font-mono font-semibold text-foreground">{selected.code}</span>
          </p>
          <Button className="w-full bg-orange-600 hover:bg-orange-700" onClick={() => openPutaway(selected)}>
            Putaway now
          </Button>
        </div>
      ) : null}
    </div>
  );
}
