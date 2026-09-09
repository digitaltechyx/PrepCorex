"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { hasRole } from "@/lib/permissions";
import { useRouter } from "next/navigation";
import type { InboundTrackerEntry } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  formatInboundTrackerDate,
  filterInboundTrackerEntries,
  normalizeTrackingNumber,
  getInboundTrackerDefaultFilters,
  inboundTrackerAddedDate,
  inboundTrackerAddedViaLabel,
  inboundTrackerFilterOptions,
  inboundTrackerHasActiveFilters,
  buildInboundTrackerReport,
  statusBadgeVariant,
  type InboundTrackerFilters,
  type InboundTrackerStatusFilter,
} from "@/lib/inbound-tracker";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import { detectCarrier } from "@/lib/carrier-detect";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Loader2,
  PackageSearch,
  RefreshCw,
  ScanLine,
  Truck,
  CheckCircle2,
  Clock,
  Trash2,
  Search,
  X,
  BarChart3,
  AlertCircle,
  Keyboard,
} from "lucide-react";

const STATUS_FILTER_LABELS: Record<InboundTrackerStatusFilter, string> = {
  all: "All statuses",
  active: "Active (open)",
  delivered: "Delivered",
  in_transit: "In transit",
  pending: "Label / pre-transit",
  not_found: "Not found",
  error: "Error",
};

const BADGE_CLASS = {
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  transit: "bg-blue-50 text-blue-800 border-blue-200",
  delivered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  error: "bg-red-50 text-red-800 border-red-200",
  unknown: "bg-slate-100 text-slate-600 border-slate-200",
};

async function readApiError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    if (data.error) return data.error;
  } catch {
    // ignore
  }
  return fallback;
}

function ReportBar({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate font-medium">{label}</span>
        <span className="shrink-0 text-muted-foreground">
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary/70 transition-all"
          style={{ width: `${Math.max(pct, count > 0 ? 4 : 0)}%` }}
        />
      </div>
    </div>
  );
}

export function InboundTrackerPortal() {
  const { user, userProfile, loading: authLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [entries, setEntries] = useState<InboundTrackerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<InboundTrackerEntry | null>(null);
  const [manualTracking, setManualTracking] = useState("");
  const [filters, setFilters] = useState<InboundTrackerFilters>(() =>
    getInboundTrackerDefaultFilters()
  );

  const isAdmin = hasRole(userProfile, "admin");

  const setFilter = useCallback(
    <K extends keyof InboundTrackerFilters>(key: K, value: InboundTrackerFilters[K]) => {
      setFilters((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const clearFilters = useCallback(() => {
    setFilters(getInboundTrackerDefaultFilters());
  }, []);

  const hasActiveFilters = useMemo(() => inboundTrackerHasActiveFilters(filters), [filters]);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!user) throw new Error("Not signed in.");
    const token = await user.getIdToken();
    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    };
  }, [user]);

  const loadEntries = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const headers = await authHeaders();
      const res = await fetch("/api/inbound-tracker", { headers });
      if (!res.ok) throw new Error(await readApiError(res, "Failed to load trackings."));
      const data = (await res.json()) as { entries: InboundTrackerEntry[] };
      setEntries(data.entries || []);
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Load failed",
        description: e instanceof Error ? e.message : "Could not load Inbound Tracker.",
      });
    } finally {
      setLoading(false);
    }
  }, [authHeaders, toast, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !isAdmin) {
      router.replace("/admin/dashboard");
      return;
    }
    void loadEntries();
  }, [authLoading, user, isAdmin, router, loadEntries]);

  const filterOptions = useMemo(() => inboundTrackerFilterOptions(entries), [entries]);

  const filteredEntries = useMemo(
    () => filterInboundTrackerEntries(entries, filters),
    [entries, filters]
  );

  const report = useMemo(
    () => buildInboundTrackerReport(filteredEntries),
    [filteredEntries]
  );

  const addTracking = useCallback(
    async (raw: string, addedVia: "scan" | "manual" = "manual") => {
      const trackingNumber = normalizeTrackingNumber(raw);
      if (!trackingNumber) {
        toast({ variant: "destructive", title: "Enter a tracking number." });
        return;
      }
      setAdding(true);
      try {
        const headers = await authHeaders();
        const carrier = detectCarrier(trackingNumber) || null;
        const res = await fetch("/api/inbound-tracker", {
          method: "POST",
          headers,
          body: JSON.stringify({ trackingNumber, carrier, addedVia }),
        });
        if (!res.ok) throw new Error(await readApiError(res, "Failed to add tracking."));
        const data = (await res.json()) as { entry: InboundTrackerEntry };
        setEntries((prev) => [data.entry, ...prev.filter((e) => e.id !== data.entry.id)]);
        setManualTracking("");
        toast({
          title: "Tracking added",
          description: `${data.entry.trackingNumber} — ${data.entry.lastStatusLabel || "Status loaded"}`,
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Add failed",
          description: e instanceof Error ? e.message : "Could not add tracking.",
        });
      } finally {
        setAdding(false);
      }
    },
    [authHeaders, toast]
  );

  const refreshOne = useCallback(
    async (id: string) => {
      setRefreshingId(id);
      try {
        const headers = await authHeaders();
        const res = await fetch("/api/inbound-tracker", {
          method: "PATCH",
          headers,
          body: JSON.stringify({ id }),
        });
        if (!res.ok) throw new Error(await readApiError(res, "Refresh failed."));
        const data = (await res.json()) as { entry: InboundTrackerEntry };
        setEntries((prev) => prev.map((e) => (e.id === id ? data.entry : e)));
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Refresh failed",
          description: e instanceof Error ? e.message : "Could not refresh.",
        });
      } finally {
        setRefreshingId(null);
      }
    },
    [authHeaders, toast]
  );

  const deleteOne = useCallback(
    async (entry: InboundTrackerEntry) => {
      setDeletingId(entry.id);
      try {
        const headers = await authHeaders();
        const res = await fetch(`/api/inbound-tracker?id=${encodeURIComponent(entry.id)}`, {
          method: "DELETE",
          headers,
        });
        if (!res.ok) throw new Error(await readApiError(res, "Delete failed."));
        setEntries((prev) => prev.filter((e) => e.id !== entry.id));
        toast({
          title: "Tracking removed",
          description: entry.trackingNumber,
        });
      } catch (e) {
        toast({
          variant: "destructive",
          title: "Delete failed",
          description: e instanceof Error ? e.message : "Could not delete tracking.",
        });
      } finally {
        setDeletingId(null);
        setDeleteTarget(null);
      }
    },
    [authHeaders, toast]
  );

  if (authLoading || !isAdmin) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Inbound Tracker</h1>
        <p className="text-sm text-muted-foreground">
          Scan or enter client inbound tracking numbers. Status updates automatically every 6 hours
          until delivered. Use filters and date range to view reports on the dashboard below.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>
            Defaults to today&apos;s date. All dashboard stats and the table below reflect your
            current filters.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filters.search}
              onChange={(e) => setFilter("search", e.target.value)}
              placeholder="Search tracking, carrier, status, added by…"
              className="pl-9"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <DateRangePicker
              fromDate={filters.addedFrom}
              toDate={filters.addedTo}
              setFromDate={(d) => setFilter("addedFrom", d)}
              setToDate={(d) => setFilter("addedTo", d)}
              className="w-full sm:w-[260px]"
            />

            <Select
              value={filters.status}
              onValueChange={(v) => setFilter("status", v as InboundTrackerStatusFilter)}
            >
              <SelectTrigger className="w-full sm:w-[180px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(STATUS_FILTER_LABELS) as InboundTrackerStatusFilter[]).map(
                  (key) => (
                    <SelectItem key={key} value={key}>
                      {STATUS_FILTER_LABELS[key]}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>

            <Select value={filters.carrier} onValueChange={(v) => setFilter("carrier", v)}>
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="Carrier" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All carriers</SelectItem>
                {filterOptions.carriers.map((carrier) => (
                  <SelectItem key={carrier} value={carrier}>
                    {carrier}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select
              value={filters.addedVia}
              onValueChange={(v) =>
                setFilter("addedVia", v as InboundTrackerFilters["addedVia"])
              }
            >
              <SelectTrigger className="w-full sm:w-[140px]">
                <SelectValue placeholder="Added via" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Scan + manual</SelectItem>
                <SelectItem value="scan">Scanned only</SelectItem>
                <SelectItem value="manual">Manual only</SelectItem>
              </SelectContent>
            </Select>

            <Select value={filters.addedBy} onValueChange={(v) => setFilter("addedBy", v)}>
              <SelectTrigger className="w-full sm:w-[160px]">
                <SelectValue placeholder="Added by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                {filterOptions.addedByNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {hasActiveFilters ? (
              <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
                <X className="mr-1 h-4 w-4" />
                Clear filters
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="h-5 w-5" />
            Reports dashboard
          </CardTitle>
          <CardDescription>
            {hasActiveFilters
              ? `${report.total} trackings match filters (${entries.length} total in system)`
              : `${report.total} trackings tracked`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <Card
              className={cn(
                "cursor-pointer shadow-none transition-colors hover:border-primary/40",
                !hasActiveFilters && filters.status === "all" && "border-primary/30"
              )}
              onClick={() => setFilter("status", "all")}
            >
              <CardHeader className="p-4 pb-2">
                <CardDescription>Total</CardDescription>
                <CardTitle className="text-2xl">{report.total}</CardTitle>
              </CardHeader>
            </Card>
            <Card
              className={cn(
                "cursor-pointer shadow-none transition-colors hover:border-primary/40",
                filters.status === "active" && "border-primary ring-1 ring-primary/20"
              )}
              onClick={() => setFilter("status", "active")}
            >
              <CardHeader className="p-4 pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Truck className="h-3.5 w-3.5" /> Active
                </CardDescription>
                <CardTitle className="text-2xl">{report.active}</CardTitle>
              </CardHeader>
            </Card>
            <Card
              className={cn(
                "cursor-pointer shadow-none transition-colors hover:border-primary/40",
                filters.status === "in_transit" && "border-primary ring-1 ring-primary/20"
              )}
              onClick={() => setFilter("status", "in_transit")}
            >
              <CardHeader className="p-4 pb-2">
                <CardDescription className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5" /> In transit
                </CardDescription>
                <CardTitle className="text-2xl">{report.inTransit}</CardTitle>
              </CardHeader>
            </Card>
            <Card
              className={cn(
                "cursor-pointer shadow-none transition-colors hover:border-primary/40",
                filters.status === "delivered" && "border-primary ring-1 ring-primary/20"
              )}
              onClick={() => setFilter("status", "delivered")}
            >
              <CardHeader className="p-4 pb-2">
                <CardDescription className="flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Delivered
                </CardDescription>
                <CardTitle className="text-2xl">{report.delivered}</CardTitle>
              </CardHeader>
            </Card>
            <Card
              className={cn(
                "cursor-pointer shadow-none transition-colors hover:border-primary/40",
                filters.status === "pending" && "border-primary ring-1 ring-primary/20"
              )}
              onClick={() => setFilter("status", "pending")}
            >
              <CardHeader className="p-4 pb-2">
                <CardDescription>Pre-transit</CardDescription>
                <CardTitle className="text-2xl">{report.pending}</CardTitle>
              </CardHeader>
            </Card>
            <Card
              className={cn(
                "cursor-pointer shadow-none transition-colors hover:border-primary/40",
                filters.status === "error" && "border-primary ring-1 ring-primary/20"
              )}
              onClick={() => setFilter("status", "error")}
            >
              <CardHeader className="p-4 pb-2">
                <CardDescription className="flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" /> Errors
                </CardDescription>
                <CardTitle className="text-2xl">{report.error}</CardTitle>
              </CardHeader>
            </Card>
            <Card className="shadow-none">
              <CardHeader className="p-4 pb-2">
                <CardDescription>Scan / manual</CardDescription>
                <CardTitle className="text-lg">
                  {report.scanned} / {report.manual}
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          {report.total === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-4">
              No trackings match the current filters.
            </p>
          ) : (
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="space-y-3">
                <h3 className="text-sm font-medium">By carrier</h3>
                <div className="space-y-3">
                  {report.byCarrier.slice(0, 8).map((row) => (
                    <ReportBar
                      key={row.carrier}
                      label={row.carrier}
                      count={row.count}
                      pct={row.pct}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">By status</h3>
                <div className="space-y-3">
                  {report.byStatus.slice(0, 8).map((row) => (
                    <ReportBar
                      key={row.status}
                      label={row.status}
                      count={row.count}
                      pct={row.pct}
                    />
                  ))}
                </div>
              </div>
              <div className="space-y-3">
                <h3 className="text-sm font-medium">Added by</h3>
                <div className="space-y-3">
                  {report.byAddedBy.slice(0, 8).map((row) => (
                    <ReportBar key={row.name} label={row.name} count={row.count} pct={row.pct} />
                  ))}
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ScanLine className="h-5 w-5" />
            Add tracking
          </CardTitle>
          <CardDescription>Scan a label or type a tracking number manually.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center"
            onSubmit={(e) => {
              e.preventDefault();
              void addTracking(manualTracking, "manual");
            }}
          >
            <Input
              value={manualTracking}
              onChange={(e) => setManualTracking(e.target.value)}
              placeholder="Tracking number"
              className="w-full sm:min-w-[220px] sm:max-w-md sm:flex-1"
              disabled={adding}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={adding} className="shrink-0">
                {adding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                <Keyboard className="mr-2 h-4 w-4" />
                Add
              </Button>
              <ScanCameraButton
                onScan={(text) => void addTracking(text, "scan")}
                showLabel
                label="Scan"
                disabled={adding}
                scannerTitle="Scan inbound label"
                scannerDescription="Point at the courier barcode or QR on the shipping label."
              />
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void loadEntries()}
                disabled={loading}
              >
                <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
                Reload
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <PackageSearch className="h-5 w-5" />
              Inbound shipments
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              Showing {filteredEntries.length} of {entries.length}
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : entries.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No trackings yet. Scan or enter a label above.
            </p>
          ) : filteredEntries.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              No trackings match your filters.{" "}
              <button
                type="button"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={clearFilters}
              >
                Clear filters
              </button>
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tracking</TableHead>
                  <TableHead>Carrier</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead>Last checked</TableHead>
                  <TableHead>Added by</TableHead>
                  <TableHead className="w-[96px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEntries.map((entry) => {
                  const variant = statusBadgeVariant(entry);
                  return (
                    <TableRow key={entry.id}>
                      <TableCell className="font-mono text-xs sm:text-sm">
                        {entry.trackingNumber}
                      </TableCell>
                      <TableCell>{entry.carrier || "—"}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("whitespace-nowrap", BADGE_CLASS[variant])}
                        >
                          {entry.lastStatusLabel || entry.lastStatus || "—"}
                        </Badge>
                        {entry.lastStatusDetails ? (
                          <p className="mt-1 max-w-[220px] truncate text-[10px] text-muted-foreground">
                            {entry.lastStatusDetails}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <p>{inboundTrackerAddedDate(entry)}</p>
                        <p className="text-[10px] text-muted-foreground/80">
                          {inboundTrackerAddedViaLabel(entry.addedVia)}
                        </p>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {formatInboundTrackerDate(entry.lastCheckedAt)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {entry.addedByName || "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled={
                              entry.isClosed || refreshingId === entry.id || deletingId === entry.id
                            }
                            onClick={() => void refreshOne(entry.id)}
                            title="Refresh status"
                          >
                            <RefreshCw
                              className={cn(
                                "h-4 w-4",
                                refreshingId === entry.id && "animate-spin"
                              )}
                            />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            disabled={deletingId === entry.id}
                            onClick={() => setDeleteTarget(entry)}
                            title="Remove tracking"
                          >
                            {deletingId === entry.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="h-4 w-4" />
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove tracking?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove{" "}
              <span className="font-mono font-medium">{deleteTarget?.trackingNumber}</span> from
              Inbound Tracker? This stops automatic status polling.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={!!deletingId}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={!!deletingId}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) void deleteOne(deleteTarget);
              }}
            >
              {deletingId ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
