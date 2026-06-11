"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { loadDispatchQueue, type OutboundPackOrder } from "@/lib/warehouse-pack";
import type { UserProfile, WarehouseDoc } from "@/types";
import { Loader2, Package, Truck } from "lucide-react";
import { format } from "date-fns";

type Props = {
  warehouse: WarehouseDoc;
};

function formatWhen(date: Date | null): string {
  if (!date) return "—";
  return format(date, "MMM d, yyyy h:mm a");
}

export function WarehouseOpsDispatch({ warehouse }: Props) {
  const { toast } = useToast();

  const { data: allUsers } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () => allUsers.filter((u) => u.role === "user" && u.status === "approved"),
    [allUsers]
  );

  const [orders, setOrders] = useState<OutboundPackOrder[]>([]);
  const [loading, setLoading] = useState(true);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    try {
      const list = await loadDispatchQueue({ warehouse, clients });
      setOrders(list);
    } catch (e) {
      toast({
        title: "Could not load dispatch queue",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setOrders([]);
    } finally {
      setLoading(false);
    }
  }, [warehouse, clients, toast]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  return (
    <div className="space-y-4">
      <WarehouseOpsHeader title="Dispatch" />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Ready to dispatch
          </CardTitle>
          <CardDescription className="text-xs">
            Packed orders awaiting carrier pickup. Attach courier labels on the pack bench — no
            scan required here.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Dispatch queue ({orders.length})</CardTitle>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadQueue()}>
            Refresh
          </Button>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : orders.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No orders ready to dispatch.
            </p>
          ) : (
            <div className="space-y-2">
              {orders.map((order) => (
                <div
                  key={`${order.clientUserId}:${order.id}`}
                  className="rounded-lg border px-3 py-3 bg-card"
                >
                  <div className="flex justify-between gap-2 items-start">
                    <div>
                      <p className="font-semibold text-sm">{order.clientDisplayName}</p>
                      {order.shipTo ? (
                        <p className="text-xs text-muted-foreground mt-0.5">{order.shipTo}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground mt-1">
                        {order.lines.map((l) => `${l.quantityUnits}× ${l.sku}`).join(" · ")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Ready: {formatWhen(order.readyToDispatchAt ?? null)}
                      </p>
                    </div>
                    <Badge className="shrink-0 bg-emerald-600">Ready</Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Button variant="outline" asChild>
        <Link href="/warehouse-ops/pack">
          <Package className="h-4 w-4 mr-2" />
          Back to pack
        </Link>
      </Button>
    </div>
  );
}
