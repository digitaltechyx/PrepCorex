"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import {
  completeDispatchHandoff,
  loadDispatchQueue,
  resolveDispatchOrderByScan,
  type OutboundPackOrder,
} from "@/lib/warehouse-pack";
import type { UserProfile, WarehouseDoc } from "@/types";
import { CheckCircle2, Loader2, Package, ScanLine, Truck, XCircle } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

function formatWhen(date: Date | null): string {
  if (!date) return "—";
  return format(date, "MMM d, yyyy h:mm a");
}

export function WarehouseOpsDispatch({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const operatorId = user?.uid ?? userProfile?.name ?? userProfile?.email ?? null;

  const { data: allUsers } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () => allUsers.filter((u) => u.role === "user" && u.status === "approved"),
    [allUsers]
  );

  const [orders, setOrders] = useState<OutboundPackOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanValue, setScanValue] = useState("");
  const [scanning, setScanning] = useState(false);
  const [matchedOrder, setMatchedOrder] = useState<OutboundPackOrder | null>(null);
  const [lastScanValue, setLastScanValue] = useState("");
  const [scanError, setScanError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const scanInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    scanInputRef.current?.focus();
  }, []);

  async function handleScanSubmit(raw?: string) {
    const value = (raw ?? scanValue).trim();
    if (!value) return;

    setScanning(true);
    setScanError(null);
    setMatchedOrder(null);

    try {
      const order = await resolveDispatchOrderByScan({
        warehouse,
        clients,
        scannedValue: value,
      });

      if (!order) {
        setScanError("No matching parcel in the dispatch queue — check the label or pack bench.");
        toast({
          title: "Wrong or unknown parcel",
          description: "This label is not in the ready-to-dispatch queue.",
          variant: "destructive",
        });
        return;
      }

      setMatchedOrder(order);
      setLastScanValue(value);
      setScanValue("");
      toast({
        title: "Correct parcel",
        description: order.clientDisplayName,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Scan failed";
      setScanError(msg);
      toast({ title: "Scan failed", description: msg, variant: "destructive" });
    } finally {
      setScanning(false);
      scanInputRef.current?.focus();
    }
  }

  async function handleConfirmDispatch() {
    if (!matchedOrder || !lastScanValue) return;

    setConfirming(true);
    try {
      await completeDispatchHandoff({
        warehouseId: warehouse.id,
        clientUserId: matchedOrder.clientUserId,
        shipmentRequestId: matchedOrder.id,
        scannedValue: lastScanValue,
        operatorId,
      });
      toast({
        title: "Dispatched",
        description: `${matchedOrder.clientDisplayName} handed off to carrier.`,
      });
      setMatchedOrder(null);
      setLastScanValue("");
      setScanError(null);
      void loadQueue();
    } catch (e) {
      toast({
        title: "Could not confirm dispatch",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setConfirming(false);
      scanInputRef.current?.focus();
    }
  }

  function clearMatch() {
    setMatchedOrder(null);
    setLastScanValue("");
    setScanError(null);
    setScanValue("");
    scanInputRef.current?.focus();
  }

  return (
    <div className="space-y-4">
      <WarehouseOpsHeader title="Dispatch" />
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Truck className="h-4 w-4" />
            Carrier handoff
          </CardTitle>
          <CardDescription className="text-xs">
            Scan the courier label on each parcel. The system confirms it matches a packed order
            before you mark it dispatched.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="border-orange-300/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Scan courier label
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="dispatch-scan" className="text-xs">
              Tracking barcode
            </Label>
            <div className="flex gap-2">
              <Input
                id="dispatch-scan"
                ref={scanInputRef}
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleScanSubmit();
                }}
                placeholder="Scan label…"
                className="font-mono"
                disabled={scanning || confirming}
              />
              <ScanCameraButton
                onScan={(v) => {
                  setScanValue(v);
                  void handleScanSubmit(v);
                }}
              />
            </div>
          </div>
          <Button
            type="button"
            className="w-full"
            disabled={!scanValue.trim() || scanning || confirming}
            onClick={() => void handleScanSubmit()}
          >
            {scanning ? "Checking…" : "Verify parcel"}
          </Button>

          {scanError ? (
            <div className="flex items-start gap-2 rounded-lg border border-red-300/60 bg-red-50/80 dark:bg-red-950/20 px-3 py-2 text-sm text-red-700 dark:text-red-400">
              <XCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>{scanError}</p>
            </div>
          ) : null}

          {matchedOrder ? (
            <div className="rounded-lg border border-emerald-300/60 bg-emerald-50/50 dark:bg-emerald-950/20 px-3 py-3 space-y-3">
              <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <p className="font-semibold text-sm">Correct parcel</p>
              </div>
              <div className="text-sm space-y-1">
                <p className="font-medium">{matchedOrder.clientDisplayName}</p>
                {matchedOrder.courierTracking ? (
                  <p className="text-xs font-mono text-muted-foreground">
                    {matchedOrder.courierTracking}
                  </p>
                ) : null}
                {matchedOrder.shipFrom ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">From: </span>
                    {matchedOrder.shipFrom}
                  </p>
                ) : null}
                {matchedOrder.shipTo ? (
                  <p className="text-xs">
                    <span className="text-muted-foreground">To: </span>
                    {matchedOrder.shipTo}
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {matchedOrder.lines.map((l) => `${l.quantityUnits}× ${l.sku}`).join(" · ")}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  disabled={confirming}
                  onClick={clearMatch}
                >
                  Scan another
                </Button>
                <Button
                  type="button"
                  className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                  disabled={confirming}
                  onClick={() => void handleConfirmDispatch()}
                >
                  {confirming ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Confirm dispatched"
                  )}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-sm">Awaiting handoff ({orders.length})</CardTitle>
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
              {orders.map((order) => {
                const isMatched =
                  matchedOrder?.id === order.id &&
                  matchedOrder.clientUserId === order.clientUserId;
                return (
                  <div
                    key={`${order.clientUserId}:${order.id}`}
                    className={cn(
                      "rounded-lg border px-3 py-3 bg-card",
                      isMatched && "border-emerald-400 ring-1 ring-emerald-300/50"
                    )}
                  >
                    <div className="flex justify-between gap-2 items-start">
                      <div>
                        <p className="font-semibold text-sm">{order.clientDisplayName}</p>
                        {order.courierTracking ? (
                          <p className="text-xs font-mono text-muted-foreground mt-0.5">
                            {order.courierTracking}
                          </p>
                        ) : null}
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
                );
              })}
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
