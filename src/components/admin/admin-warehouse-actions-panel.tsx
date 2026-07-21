"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, PackageCheck, Truck, Warehouse } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import {
  adminCompleteInboundReceiveAndPutaway,
  hasAdminWarehouseOverride,
} from "@/lib/admin-warehouse-override";
import {
  fallbackAreas,
  listWarehouseAreas,
} from "@/lib/warehouse-putaway-disposition";
import { completeDispatchHandoff } from "@/lib/warehouse-pack";
import type { InventoryRequest, ShipmentRequest, UserProfile, WarehouseAreaDoc, WarehouseDoc } from "@/types";

type InboundProps = {
  mode: "inbound";
  clientUserId: string;
  clientDisplayName?: string | null;
  request: InventoryRequest;
  onComplete?: () => void;
};

type OutboundProps = {
  mode: "outbound";
  clientUserId: string;
  request: ShipmentRequest & { id: string };
  onComplete?: () => void;
};

type AdminWarehouseActionsPanelProps = InboundProps | OutboundProps;

function remainingInboundQty(req: InventoryRequest): number {
  const expected =
    typeof req.receivedQuantity === "number" && req.receivedQuantity > 0
      ? req.receivedQuantity
      : typeof req.requestedQuantity === "number" && req.requestedQuantity > 0
        ? req.requestedQuantity
        : Math.max(0, req.quantity ?? 0);
  const received = Math.max(0, Number(req.warehouseGoodReceivedQty ?? 0));
  return Math.max(0, expected - received);
}

export function AdminWarehouseActionsPanel(props: AdminWarehouseActionsPanelProps) {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const canOverride = hasAdminWarehouseOverride(userProfile);
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [stagingArea, setStagingArea] = useState("");
  const [areas, setAreas] = useState<WarehouseAreaDoc[]>([]);
  const [qty, setQty] = useState(0);
  const [trackingScan, setTrackingScan] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      setWarehouseId(activeWarehouses[0].id);
    }
  }, [activeWarehouses, warehouseId]);

  useEffect(() => {
    if (!warehouseId) {
      setAreas([]);
      setStagingArea("");
      return;
    }
    let cancelled = false;
    void listWarehouseAreas(warehouseId).then((loaded) => {
      if (cancelled) return;
      setAreas(loaded);
      const eligible = fallbackAreas(loaded);
      if (eligible.length > 0) {
        setStagingArea((prev) => prev || eligible[0].code);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [warehouseId]);

  useEffect(() => {
    if (props.mode === "inbound") {
      setQty(remainingInboundQty(props.request));
    }
  }, [props]);

  if (!canOverride) return null;

  const eligibleAreas = fallbackAreas(areas);

  if (props.mode === "inbound") {
    const { request, clientUserId, clientDisplayName, onComplete } = props;
    const isProduct = request.inventoryType === "product";
    const isApproved = request.status === "approved";
    const isOpen = String(request.fulfillmentStatus ?? "").toLowerCase() !== "closed";
    const remaining = remainingInboundQty(request);

    if (!isProduct || !isApproved || !isOpen || remaining <= 0) return null;

    const handleReceive = async () => {
      if (!warehouseId) {
        toast({ variant: "destructive", title: "Select a warehouse" });
        return;
      }
      if (!stagingArea.trim()) {
        toast({ variant: "destructive", title: "Select a putaway area" });
        return;
      }
      setBusy(true);
      try {
        const result = await adminCompleteInboundReceiveAndPutaway({
          clientUserId,
          requestId: request.id,
          warehouseId,
          stagingArea,
          quantity: qty,
          operatorId: userProfile?.uid ?? null,
          clientDisplayName,
        });
        toast({
          title: "Stock added to client inventory",
          description: `${result.quantityReceived} unit(s) received on ${result.cartonCode} → ${result.stagingArea}.`,
        });
        onComplete?.();
      } catch (error: unknown) {
        toast({
          variant: "destructive",
          title: "Receive failed",
          description: error instanceof Error ? error.message : "Could not complete receive.",
        });
      } finally {
        setBusy(false);
      }
    };

    return (
      <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Warehouse className="h-4 w-4 text-primary" />
          Admin warehouse override — receive &amp; add stock
        </div>
        <p className="text-xs text-muted-foreground">
          Complete receiving and putaway from here. No need to open Warehouse Ops. {remaining} unit(s)
          remaining on this request.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Warehouse</Label>
            <Select value={warehouseId} onValueChange={setWarehouseId}>
              <SelectTrigger>
                <SelectValue placeholder="Select warehouse" />
              </SelectTrigger>
              <SelectContent>
                {activeWarehouses.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name || w.code || w.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Putaway area</Label>
            <Select value={stagingArea} onValueChange={setStagingArea}>
              <SelectTrigger>
                <SelectValue placeholder="Select area" />
              </SelectTrigger>
              <SelectContent>
                {eligibleAreas.map((a) => (
                  <SelectItem key={a.id} value={a.code}>
                    {a.name ? `${a.code} — ${a.name}` : a.code}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Quantity to receive</Label>
            <Input
              type="number"
              min={1}
              max={remaining}
              value={qty}
              onChange={(e) => setQty(Math.max(1, Math.min(remaining, parseInt(e.target.value, 10) || 0)))}
            />
          </div>
        </div>
        <Button type="button" disabled={busy || !warehouseId || !stagingArea} onClick={() => void handleReceive()}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-2 h-4 w-4" />}
          Receive &amp; add to client inventory
        </Button>
      </div>
    );
  }

  const { request, clientUserId, onComplete } = props;
  const packStatus = String((request as unknown as Record<string, unknown>).warehousePackStatus ?? "")
    .trim()
    .toLowerCase();
  const dispatchStatus = String((request as unknown as Record<string, unknown>).warehouseDispatchStatus ?? "")
    .trim()
    .toLowerCase();
  const pickStatus = String((request as unknown as Record<string, unknown>).warehousePickStatus ?? "")
    .trim()
    .toLowerCase();
  const status = String(request.status ?? "").trim().toLowerCase();
  const readyToDispatch = packStatus === "ready_to_dispatch" && dispatchStatus !== "dispatched";
  const isConfirmed = status === "confirmed" || pickStatus === "ready" || pickStatus === "in_progress" || pickStatus === "picked";

  return (
    <div className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Truck className="h-4 w-4 text-primary" />
        Admin warehouse override — outbound
      </div>
      <p className="text-xs text-muted-foreground">
        Pick and pack still use scan workflows. Dispatch ready orders here, or open Warehouse Ops for
        pick/pack.
      </p>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-md border bg-background px-2 py-1">Status: {status || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Pick: {pickStatus || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Pack: {packStatus || "—"}</span>
        <span className="rounded-md border bg-background px-2 py-1">Dispatch: {dispatchStatus || "—"}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {isConfirmed && !readyToDispatch ? (
          <>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/warehouse-ops/pick">Open pick</Link>
            </Button>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/warehouse-ops/pack">Open pack</Link>
            </Button>
          </>
        ) : null}
        <Button type="button" variant="outline" size="sm" asChild>
          <Link href="/warehouse-ops/dispatch">Open dispatch queue</Link>
        </Button>
      </div>
      {readyToDispatch ? (
        <div className="space-y-2 border-t pt-3">
          <Label>Scan / enter courier tracking to dispatch</Label>
          <div className="flex flex-wrap gap-2">
            <Input
              className="max-w-xs"
              value={trackingScan}
              onChange={(e) => setTrackingScan(e.target.value)}
              placeholder="Tracking barcode or number"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !trackingScan.trim() || !warehouseId}
              onClick={async () => {
                if (!warehouseId && activeWarehouses[0]) setWarehouseId(activeWarehouses[0].id);
                const wh = warehouseId || activeWarehouses[0]?.id;
                if (!wh) {
                  toast({ variant: "destructive", title: "No warehouse configured" });
                  return;
                }
                setBusy(true);
                try {
                  await completeDispatchHandoff({
                    warehouseId: wh,
                    clientUserId,
                    shipmentRequestId: request.id,
                    scannedValue: trackingScan.trim(),
                    qcUnitType: "package",
                    operatorId: userProfile?.uid ?? null,
                  });
                  toast({ title: "Order dispatched", description: "Client inventory updated." });
                  setTrackingScan("");
                  onComplete?.();
                } catch (error: unknown) {
                  toast({
                    variant: "destructive",
                    title: "Dispatch failed",
                    description: error instanceof Error ? error.message : "Could not dispatch.",
                  });
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Confirm dispatch
            </Button>
          </div>
          {activeWarehouses.length > 1 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">Warehouse (for activity log)</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger className="h-8 max-w-xs">
                  <SelectValue placeholder="Warehouse" />
                </SelectTrigger>
                <SelectContent>
                  {activeWarehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.name || w.code || w.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
