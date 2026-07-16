"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { useWarehouseOpsLive } from "@/components/warehouse-ops/warehouse-ops-live-provider";
import {
  scanDockIntake,
} from "@/lib/warehouse-returns";
import { resolveInboundTrackings } from "@/lib/inbound-tracking";
import type { InboundRequestRow } from "@/lib/warehouse-inbound-requests";
import {
  approveInboundRequestAtDock,
  rejectInboundRequestAtDock,
} from "@/lib/warehouse-inbound-receive";
import type { UserProfile, WarehouseDoc } from "@/types";
import { Check, Loader2, Package, ScanLine, Search, Truck, X } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

function inboundKey(row: InboundRequestRow): string {
  return `${row.clientUserId}:${row.id}`;
}

function normInboundStatus(status: unknown): string {
  return String(status ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function isPendingInboundStatus(status: unknown): boolean {
  const s = normInboundStatus(status);
  return s === "pending" || s === "pending_approval";
}

function isApprovedInboundStatus(status: unknown): boolean {
  return normInboundStatus(status) === "approved";
}

type RequestStatusTab = "pending" | "approved" | "all";

function firstTrackingOnRow(row: InboundRequestRow): string {
  const list = resolveInboundTrackings(row);
  for (const t of list) {
    const n = String(t.trackingNumber ?? "").trim();
    if (n) return n;
  }
  return "";
}

function firstTrackingFromRows(rows: InboundRequestRow[]): string {
  for (const row of rows) {
    const t = firstTrackingOnRow(row);
    if (t) return t;
  }
  return "";
}

type Props = {
  warehouse: WarehouseDoc;
  clients: UserProfile[];
  clientsLoading?: boolean;
  onInbound: (rows: InboundRequestRow[], tracking: string) => void;
  onWalkIn: (tracking: string) => void;
};

export function WarehouseOpsDockIntake({
  warehouse,
  clients,
  clientsLoading = false,
  onInbound,
  onWalkIn,
}: Props) {
  const { toast } = useToast();
  const { user } = useAuth();
  const operatorId = user?.uid ?? "";
  const { inboundDockQueue, liveLoading } = useWarehouseOpsLive();
  const [tracking, setTracking] = useState("");
  const [scanning, setScanning] = useState(false);
  const [managingKey, setManagingKey] = useState<string | null>(null);
  const [listFilter, setListFilter] = useState("");
  const [requestStatusTab, setRequestStatusTab] = useState<RequestStatusTab>("pending");
  const [lastScan, setLastScan] = useState<{
    tracking: string;
    inbound: InboundRequestRow[];
  } | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Show full dock queue (pending + approved awaiting receive). Do not drop pending with 0 remaining.
  const inboundOpen = inboundDockQueue;
  const listsLoading = clientsLoading || liveLoading;

  const pendingCount = useMemo(
    () => inboundOpen.filter((r) => isPendingInboundStatus(r.status)).length,
    [inboundOpen]
  );
  const approvedCount = useMemo(
    () => inboundOpen.filter((r) => isApprovedInboundStatus(r.status)).length,
    [inboundOpen]
  );

  const filteredInboundOpen = useMemo(() => {
    const q = listFilter.trim().toLowerCase();
    return inboundOpen.filter((r) => {
      if (requestStatusTab === "pending" && !isPendingInboundStatus(r.status)) return false;
      if (requestStatusTab === "approved" && !isApprovedInboundStatus(r.status)) return false;
      if (!q) return true;
      const trackings = resolveInboundTrackings(r)
        .map((t) => String(t.trackingNumber ?? ""))
        .join(" ");
      const hay =
        `${r.clientDisplayName} ${r.productName} ${r.sku ?? ""} ${trackings}`.toLowerCase();
      return hay.includes(q);
    });
  }, [inboundOpen, listFilter, requestStatusTab]);

  const scanInbound = lastScan?.inbound ?? [];

  const rowByKey = useMemo(() => {
    const map = new Map<string, InboundRequestRow>();
    for (const r of inboundOpen) map.set(inboundKey(r), r);
    for (const r of scanInbound) map.set(inboundKey(r), r);
    return map;
  }, [inboundOpen, scanInbound]);

  const selectedRows = useMemo(
    () =>
      [...selectedKeys]
        .map((k) => rowByKey.get(k))
        .filter((r): r is InboundRequestRow => Boolean(r)),
    [selectedKeys, rowByKey]
  );
  const selectedPending = useMemo(
    () => selectedRows.filter((r) => isPendingInboundStatus(r.status)),
    [selectedRows]
  );

  useEffect(() => {
    if (!clientsLoading) {
      inputRef.current?.focus();
    }
  }, [clientsLoading]);

  async function approveRows(rows: InboundRequestRow[]) {
    const pending = rows.filter((r) => isPendingInboundStatus(r.status));
    if (pending.length === 0) return;
    if (!operatorId) throw new Error("Sign in required to approve requests.");
    for (const row of pending) {
      await approveInboundRequestAtDock({
        clientUserId: row.clientUserId,
        requestId: row.id,
        approvedBy: operatorId,
      });
    }
  }

  async function handleApproveRow(row: InboundRequestRow) {
    const key = inboundKey(row);
    setManagingKey(key);
    try {
      await approveRows([row]);
      toast({
        title: "Request approved",
        description: `${row.productName} is ready to receive.`,
      });
    } catch (e) {
      toast({
        title: "Approve failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setManagingKey(null);
    }
  }

  async function handleRejectRow(row: InboundRequestRow) {
    if (!isPendingInboundStatus(row.status)) return;
    const reason = window.prompt("Reject reason (optional):", "");
    if (reason === null) return;
    const key = inboundKey(row);
    setManagingKey(key);
    try {
      if (!operatorId) throw new Error("Sign in required to reject requests.");
      await rejectInboundRequestAtDock({
        clientUserId: row.clientUserId,
        requestId: row.id,
        rejectedBy: operatorId,
        reason,
      });
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      toast({
        title: "Request rejected",
        description: row.productName,
      });
    } catch (e) {
      toast({
        title: "Reject failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setManagingKey(null);
    }
  }

  async function handleApproveSelected() {
    if (selectedPending.length === 0) return;
    setManagingKey("__bulk__");
    try {
      await approveRows(selectedPending);
      toast({
        title: `${selectedPending.length} request${selectedPending.length === 1 ? "" : "s"} approved`,
        description: "Ready to receive.",
      });
    } catch (e) {
      toast({
        title: "Approve failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setManagingKey(null);
    }
  }

  async function handleScan(pathOverride?: string) {
    const v = (pathOverride ?? tracking).trim();
    if (!v) return;
    if (pathOverride != null) setTracking(pathOverride);
    setScanning(true);
    try {
      const result = await scanDockIntake({ warehouse, clients, trackingRaw: v });
      setLastScan({ tracking: result.tracking, inbound: result.inbound });
      setSelectedKeys(new Set(result.inbound.map(inboundKey)));
      if (result.inbound.length === 0) {
        toast({
          title: "No match",
          description: "Not on inbound tracking — search by client name below, or walk-in.",
        });
        searchRef.current?.focus();
      } else if (result.inbound.length > 1) {
        toast({
          title: `${result.inbound.length} requests on this tracking`,
          description: "Select the SKUs in this carton/pallet, then start receive.",
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

  function toggleKey(key: string, checked: boolean) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectAllFiltered() {
    setSelectedKeys(new Set(filteredInboundOpen.map(inboundKey)));
  }

  function selectAllScanInbound() {
    setSelectedKeys(new Set(scanInbound.map(inboundKey)));
  }

  function clearSelection() {
    setSelectedKeys(new Set());
  }

  function startReceiveSelected(trackingOverride?: string) {
    if (selectedRows.length === 0) return;
    void (async () => {
      setManagingKey("__start__");
      try {
        if (selectedPending.length > 0) {
          await approveRows(selectedPending);
          toast({
            title: `Approved ${selectedPending.length} pending request${selectedPending.length === 1 ? "" : "s"}`,
            description: "Continuing to receive…",
          });
        }
        const receivable = selectedRows.filter((r) => r.remainingQty > 0);
        if (receivable.length === 0) {
          toast({
            title: "Nothing left to receive",
            description: "Selected requests have no remaining quantity.",
          });
          return;
        }
        const track =
          trackingOverride?.trim() ||
          lastScan?.tracking?.trim() ||
          firstTrackingFromRows(receivable) ||
          "";
        onInbound(
          receivable.map((r) =>
            r.status === "pending" ? { ...r, status: "approved" as const } : r
          ),
          track
        );
      } catch (e) {
        toast({
          title: "Could not start receive",
          description: e instanceof Error ? e.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setManagingKey(null);
      }
    })();
  }

  return (
    <div className="space-y-4">
      <Card className="border-orange-200/60">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Scan tracking (optional)
          </CardTitle>
          <CardDescription>
            If the box/pallet has a carrier label, scan it to auto-find matching requests. If there
            is no tracking, search by client name in the list below.
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
              <CardHeader className="pb-2 space-y-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Truck className="h-4 w-4 text-blue-600" />
                  Tracking match — {scanInbound.length} request
                  {scanInbound.length === 1 ? "" : "s"} on{" "}
                  <span className="font-mono text-xs">{lastScan.tracking}</span>
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={selectAllScanInbound}>
                    Select all matches
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                    Clear
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={selectedRows.length === 0}
                    onClick={() => startReceiveSelected(lastScan.tracking)}
                  >
                    Start receive ({selectedRows.length})
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                {scanInbound.map((row) => (
                  <InboundSelectRow
                    key={inboundKey(row)}
                    row={row}
                    checked={selectedKeys.has(inboundKey(row))}
                    onCheckedChange={(v) => toggleKey(inboundKey(row), v)}
                    managing={managingKey === inboundKey(row)}
                    onApprove={() => void handleApproveRow(row)}
                    onReject={() => void handleRejectRow(row)}
                  />
                ))}
              </CardContent>
            </Card>
          ) : null}

          {scanInbound.length === 0 ? (
            <Card>
              <CardContent className="py-4 space-y-3">
                <p className="text-sm text-muted-foreground">
                  No request uses tracking{" "}
                  <span className="font-mono">{lastScan.tracking}</span>. Search by client name
                  below, or walk-in receive.
                </p>
                <Button className="w-full" onClick={() => onWalkIn(lastScan.tracking)}>
                  Walk-in receive (unallocated)
                </Button>
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : null}

      <Card className="border-blue-200/70">
        <CardHeader className="pb-3 space-y-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" />
              Find requests (always available)
            </CardTitle>
            <CardDescription className="mt-1">
              Search by client name, product, or SKU. Use <strong>Pending</strong> to review and
              approve, then <strong>Approved</strong> to start receive.
              {pendingCount > 0 ? (
                <>
                  {" "}
                  <strong>{pendingCount} pending</strong> need review.
                </>
              ) : null}
            </CardDescription>
          </div>
          <Tabs
            value={requestStatusTab}
            onValueChange={(v) => {
              setRequestStatusTab(v as RequestStatusTab);
              setSelectedKeys(new Set());
            }}
          >
            <TabsList className="grid w-full grid-cols-3 sm:w-auto sm:inline-grid">
              <TabsTrigger value="pending">Pending ({pendingCount})</TabsTrigger>
              <TabsTrigger value="approved">Approved ({approvedCount})</TabsTrigger>
              <TabsTrigger value="all">All ({inboundOpen.length})</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              ref={searchRef}
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder="Search client / user name, product, SKU…"
              className="sm:max-w-md"
            />
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={selectAllFiltered}>
                Select all shown
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearSelection}>
                Clear
              </Button>
              {requestStatusTab !== "approved" ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={selectedPending.length === 0 || managingKey != null}
                  onClick={() => void handleApproveSelected()}
                >
                  {managingKey === "__bulk__" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Check className="h-3.5 w-3.5 mr-1" />
                  )}
                  Approve selected ({selectedPending.length})
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                disabled={selectedRows.length === 0 || managingKey != null}
                onClick={() => startReceiveSelected()}
              >
                {managingKey === "__start__" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                ) : null}
                Start receive ({selectedRows.length})
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing {filteredInboundOpen.length} of{" "}
            {requestStatusTab === "pending"
              ? pendingCount
              : requestStatusTab === "approved"
                ? approvedCount
                : inboundOpen.length}{" "}
            {requestStatusTab === "pending"
              ? "pending"
              : requestStatusTab === "approved"
                ? "approved"
                : "open"}{" "}
            request
            {(requestStatusTab === "pending"
              ? pendingCount
              : requestStatusTab === "approved"
                ? approvedCount
                : inboundOpen.length) === 1
              ? ""
              : "s"}
            {selectedRows.length > 0 ? ` · ${selectedRows.length} selected` : ""}
          </p>
        </CardHeader>
        <CardContent>
          {listsLoading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-2 py-4">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading requests…
            </p>
          ) : filteredInboundOpen.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">
              {listFilter.trim()
                ? "No requests match that search."
                : requestStatusTab === "pending"
                  ? "No pending requests to review."
                  : requestStatusTab === "approved"
                    ? "No approved requests awaiting receive."
                    : "No open inbound requests for this warehouse."}
            </p>
          ) : (
            <div className="max-h-[360px] overflow-y-scroll overscroll-contain space-y-2 pr-1">
              {filteredInboundOpen.map((row) => (
                <InboundSelectRow
                  key={inboundKey(row)}
                  row={row}
                  checked={selectedKeys.has(inboundKey(row))}
                  onCheckedChange={(v) => toggleKey(inboundKey(row), v)}
                  managing={managingKey === inboundKey(row)}
                  onApprove={() => void handleApproveRow(row)}
                  onReject={() => void handleRejectRow(row)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => onWalkIn(tracking.trim())}>
          <Package className="h-4 w-4 mr-1" />
          Walk-in receive (no request)
        </Button>
      </div>
    </div>
  );
}

function InboundSelectRow({
  row,
  checked,
  onCheckedChange,
  managing,
  onApprove,
  onReject,
}: {
  row: InboundRequestRow;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  managing?: boolean;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const tracking = firstTrackingOnRow(row);
  const pending = isPendingInboundStatus(row.status);
  return (
    <div className="flex w-full items-start gap-3 rounded-md border px-3 py-3 text-sm">
      <label className="flex items-start gap-3 min-w-0 flex-1 cursor-pointer">
        <Checkbox
          checked={checked}
          onCheckedChange={(v) => onCheckedChange(v === true)}
          className="mt-0.5"
          aria-label={`Select ${row.productName}`}
        />
        <span className="min-w-0 flex-1 text-left space-y-1">
          <span className="font-medium block">{row.clientDisplayName}</span>
          <span className="text-xs text-muted-foreground block">
            {row.productName}
            {row.sku ? ` · ${row.sku}` : ""} · {row.remainingQty} remaining
          </span>
          <span className="flex flex-wrap gap-1">
            {pending ? (
              <Badge className="bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100 text-[10px] px-1.5 py-0">
                Pending
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-emerald-800 border-emerald-300">
                Approved
              </Badge>
            )}
            {row.inventoryType === "container" ? (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-sky-900 border-sky-300">
                Container
              </Badge>
            ) : null}
            {tracking ? (
              <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0">
                {tracking}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                No tracking
              </Badge>
            )}
          </span>
        </span>
      </label>
      {pending ? (
        <div className="flex flex-col gap-1 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 px-2 text-xs"
            disabled={managing}
            onClick={(e) => {
              e.preventDefault();
              onApprove?.();
            }}
          >
            {managing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3 mr-1" />}
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-destructive"
            disabled={managing}
            onClick={(e) => {
              e.preventDefault();
              onReject?.();
            }}
          >
            <X className="h-3 w-3 mr-1" />
            Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}
