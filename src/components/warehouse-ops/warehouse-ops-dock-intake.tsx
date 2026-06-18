"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import {
  loadReturnRequestQueue,
  scanDockIntake,
  type ReturnRequestRow,
} from "@/lib/warehouse-returns";
import { loadInboundRequestQueue, type InboundRequestRow } from "@/lib/warehouse-inbound-requests";
import type { UserProfile, WarehouseDoc } from "@/types";
import { Loader2, Package, RotateCcw, ScanLine, Truck } from "lucide-react";

type Props = {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  onInbound: (row: InboundRequestRow, tracking: string) => void;
  onReturn: (row: ReturnRequestRow, tracking: string) => void;
  onWalkIn: (tracking: string) => void;
  onSkip?: () => void;
};

export function WarehouseOpsDockIntake({
  warehouse,
  clients,
  onInbound,
  onReturn,
  onWalkIn,
  onSkip,
}: Props) {
  const { toast } = useToast();
  const [tracking, setTracking] = useState("");
  const [scanning, setScanning] = useState(false);
  const [inboundOpen, setInboundOpen] = useState<InboundRequestRow[]>([]);
  const [returnOpen, setReturnOpen] = useState<ReturnRequestRow[]>([]);
  const [lastScan, setLastScan] = useState<{
    tracking: string;
    inbound: InboundRequestRow[];
    returns: ReturnRequestRow[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const loadLists = useCallback(async () => {
    const [inbound, returns] = await Promise.all([
      loadInboundRequestQueue({ warehouse, clients, includePending: true }),
      loadReturnRequestQueue({ warehouse, clients }),
    ]);
    setInboundOpen(inbound.filter((r) => r.remainingQty > 0));
    setReturnOpen(returns.filter((r) => r.remainingQty > 0));
  }, [warehouse, clients]);

  useEffect(() => {
    void loadLists();
    inputRef.current?.focus();
  }, [loadLists]);

  async function handleScan(pathOverride?: string) {
    const v = (pathOverride ?? tracking).trim();
    if (!v) return;
    if (pathOverride != null) setTracking(pathOverride);
    setScanning(true);
    try {
      const result = await scanDockIntake({ warehouse, clients, trackingRaw: v });
      setLastScan(result);
      if (result.inbound.length === 0 && result.returns.length === 0) {
        toast({
          title: "No match",
          description: "Not on inbound or return tracking — use walk-in receive.",
        });
      }
    } catch (e) {
      toast({
        title: "Scan failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setScanning(false);
    }
  }

  const scanInbound = lastScan?.inbound ?? [];
  const scanReturns = lastScan?.returns ?? [];

  return (
    <div className="space-y-4">
      <Card className="border-orange-200/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Dock intake — scan tracking
          </CardTitle>
          <CardDescription>
            Same dock for inbound and returns. Scan the carrier label first — we check inbound,
            then return. If nothing matches, receive as walk-in.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            ref={inputRef}
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleScan();
            }}
            placeholder="Carrier tracking number"
            className="font-mono"
            disabled={scanning}
          />
          <ScanCameraButton onScan={(v) => void handleScan(v)} disabled={scanning} />
          <Button onClick={() => void handleScan()} disabled={scanning || !tracking.trim()}>
            {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : "Look up"}
          </Button>
        </CardContent>
      </Card>

      {lastScan ? (
        <div className="space-y-3">
          {scanInbound.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Truck className="h-4 w-4 text-blue-600" />
                  Inbound match
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {scanInbound.map((row) => (
                  <Button
                    key={`${row.clientUserId}-${row.id}`}
                    variant="outline"
                    className="w-full h-auto py-3 flex flex-col items-start"
                    onClick={() => onInbound(row, lastScan.tracking)}
                  >
                    <span className="font-medium">{row.clientDisplayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.productName} · {row.remainingQty} remaining
                    </span>
                  </Button>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {scanReturns.length > 0 ? (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <RotateCcw className="h-4 w-4 text-orange-600" />
                  Return (RMA) match
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {scanReturns.map((row) => (
                  <Button
                    key={`${row.clientUserId}-${row.id}`}
                    variant="outline"
                    className="w-full h-auto py-3 flex flex-col items-start border-orange-200"
                    onClick={() => onReturn(row, lastScan.tracking)}
                  >
                    <span className="font-medium">{row.clientDisplayName}</span>
                    <span className="text-xs text-muted-foreground">
                      {row.productLabel}
                      {row.skuLabel ? ` · ${row.skuLabel}` : ""} · {row.remainingQty} remaining
                    </span>
                  </Button>
                ))}
              </CardContent>
            </Card>
          ) : null}

          {scanInbound.length === 0 && scanReturns.length === 0 ? (
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  No inbound or return request uses tracking{" "}
                  <span className="font-mono">{lastScan.tracking}</span>. Pick from open lists below
                  or walk-in receive.
                </p>
                <Button className="w-full" onClick={() => onWalkIn(lastScan.tracking)}>
                  Walk-in receive (unallocated)
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <OpenListCard
          title="Open inbound (no scan)"
          icon={<Package className="h-4 w-4" />}
          empty="No open inbound requests awaiting dock receive."
          rows={inboundOpen.slice(0, 8)}
          renderRow={(row) => (
            <button
              key={`${row.clientUserId}-${row.id}`}
              type="button"
              className="w-full text-left rounded-md border px-3 py-2 text-sm hover:bg-muted/60"
              onClick={() => onInbound(row, "")}
            >
              <div className="font-medium">{row.clientDisplayName}</div>
              <div className="text-xs text-muted-foreground">
                {row.productName} · {row.remainingQty} left
              </div>
            </button>
          )}
        />
        <OpenListCard
          title="Open returns (no scan)"
          icon={<RotateCcw className="h-4 w-4" />}
          empty="No open return requests."
          rows={returnOpen.slice(0, 8)}
          renderRow={(row) => (
            <button
              key={`${row.clientUserId}-${row.id}`}
              type="button"
              className="w-full text-left rounded-md border border-orange-100 px-3 py-2 text-sm hover:bg-orange-50/50"
              onClick={() => onReturn(row, "")}
            >
              <div className="font-medium">{row.clientDisplayName}</div>
              <div className="text-xs text-muted-foreground">
                {row.productLabel} · {row.remainingQty} left
              </div>
            </button>
          )}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onWalkIn(tracking.trim())}>
          Skip scan — walk-in receive
        </Button>
        {onSkip ? (
          <Button variant="ghost" onClick={onSkip}>
            Continue without intake
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function OpenListCard<T>({
  title,
  icon,
  empty,
  rows,
  renderRow,
}: {
  title: string;
  icon: React.ReactNode;
  empty: string;
  rows: T[];
  renderRow: (row: T) => React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {rows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{empty}</p>
        ) : (
          rows.map((row) => renderRow(row))
        )}
      </CardContent>
    </Card>
  );
}
