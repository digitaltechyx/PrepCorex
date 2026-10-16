"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Calendar, Download, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { auth } from "@/lib/firebase";
import type { AffiliateAuditEvent } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import {
  getAffiliateAuditEventBadgeVariant,
  getAffiliateAuditEventLabel,
} from "@/lib/affiliate-audit-trail-display";

type AffiliateAuditTrailPanelProps = {
  agentId?: string;
  agentName?: string | null;
  fromDate?: Date;
  toDate?: Date;
  onFromDateChange?: (date?: Date) => void;
  onToDateChange?: (date?: Date) => void;
  showDatePicker?: boolean;
};

export function AffiliateAuditTrailPanel({
  agentId,
  agentName,
  fromDate: controlledFrom,
  toDate: controlledTo,
  onFromDateChange,
  onToDateChange,
  showDatePicker = true,
}: AffiliateAuditTrailPanelProps) {
  const { toast } = useToast();
  const [events, setEvents] = useState<AffiliateAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [internalFrom, setInternalFrom] = useState<Date | undefined>();
  const [internalTo, setInternalTo] = useState<Date | undefined>();

  const isControlled = onFromDateChange !== undefined && onToDateChange !== undefined;
  const fromDate = isControlled ? controlledFrom : internalFrom;
  const toDate = isControlled ? controlledTo : internalTo;
  const setFromDate = isControlled ? onFromDateChange! : setInternalFrom;
  const setToDate = isControlled ? onToDateChange! : setInternalTo;
  const hasDateRange = Boolean(fromDate && toDate);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const params = new URLSearchParams();
      if (agentId) params.set("agentId", agentId);
      if (agentName) params.set("agentName", agentName);
      if (hasDateRange && fromDate && toDate) {
        params.set("from", fromDate.toISOString());
        params.set("to", toDate.toISOString());
      }
      params.set("limit", "500");

      const res = await fetch(`/api/admin/affiliate-management/audit-trail?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load audit trail");

      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not load audit trail",
        description: err instanceof Error ? err.message : "Unknown error",
      });
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }, [agentId, agentName, fromDate, toDate, hasDateRange, toast]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const params = new URLSearchParams();
      if (agentId) params.set("agentId", agentId);
      if (agentName) params.set("agentName", agentName);
      if (hasDateRange && fromDate && toDate) {
        params.set("from", fromDate.toISOString());
        params.set("to", toDate.toISOString());
      }
      params.set("limit", "2000");

      const res = await fetch(
        `/api/admin/affiliate-management/audit-trail/download?${params}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Download failed");
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `affiliate-audit${agentId ? `_${agentId}` : ""}.csv`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast({
        title: "Audit trail downloaded",
        description: hasDateRange
          ? "CSV export for the selected date range saved."
          : "All-time CSV export saved.",
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Download failed",
        description: err instanceof Error ? err.message : "Unknown error",
      });
    } finally {
      setDownloading(false);
    }
  };

  const formatDateTime = (iso: string) => {
    try {
      return format(new Date(iso), "MMM dd, yyyy HH:mm:ss");
    } catch {
      return iso;
    }
  };

  return (
    <div className="min-w-0 space-y-3 sm:space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold">
            <ScrollText className="h-4 w-4 shrink-0" />
            Affiliate Audit Trail
          </h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground sm:mt-1 sm:text-xs">
            {agentId
              ? `Events for ${agentName || "this agent"}.`
              : "Network-wide affiliate activity."}
            {hasDateRange ? " Filtered range." : " All time."}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {showDatePicker && (
            <DateRangePicker
              fromDate={fromDate}
              toDate={toDate}
              setFromDate={setFromDate}
              setToDate={setToDate}
              className="h-9 w-full min-w-0 text-sm sm:min-w-[200px] sm:w-auto"
            />
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 flex-1 sm:flex-none"
              onClick={() => void loadEvents()}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2 sm:inline">Refresh</span>
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8 flex-1 sm:flex-none"
              onClick={() => void handleDownload()}
              disabled={downloading || loading}
            >
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              <span className="ml-2">CSV</span>
            </Button>
          </div>
        </div>
      </div>

      {!showDatePicker && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground sm:text-xs">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          {hasDateRange && fromDate && toDate
            ? `Filtered: ${format(fromDate, "MMM d, yyyy")} – ${format(toDate, "MMM d, yyyy")}`
            : "All time (use the date picker above to filter)"}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading audit events…
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
          No affiliate audit events for this period.
        </div>
      ) : (
        <>
          <div className="max-h-[min(420px,55dvh)] space-y-1.5 overflow-y-auto sm:hidden">
            {events.map((event) => (
              <div key={event.id} className="rounded-md border px-2.5 py-2">
                <div className="flex items-start justify-between gap-2">
                  <Badge
                    variant={getAffiliateAuditEventBadgeVariant(event.type)}
                    className="h-5 shrink-0 px-1.5 text-[10px]"
                  >
                    {getAffiliateAuditEventLabel(event.type)}
                  </Badge>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {formatDateTime(event.occurredAt)}
                  </span>
                </div>
                {!agentId && (
                  <p className="mt-1 truncate text-xs font-medium">
                    {event.agentName || event.agentId}
                  </p>
                )}
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {event.description || event.action || "—"}
                </p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">
                  By {event.performedByName || event.performedByUid || "System"}
                </p>
              </div>
            ))}
          </div>
          <div className="hidden max-h-[420px] overflow-auto rounded-md border sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  {!agentId && <TableHead>Agent</TableHead>}
                  <TableHead>Event</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Performed By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell className="whitespace-nowrap text-xs">
                      {formatDateTime(event.occurredAt)}
                    </TableCell>
                    {!agentId && (
                      <TableCell className="text-sm font-medium">
                        {event.agentName || event.agentId}
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant={getAffiliateAuditEventBadgeVariant(event.type)}>
                        {getAffiliateAuditEventLabel(event.type)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] text-sm">
                      <p>{event.description || event.action || "—"}</p>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {event.performedByName || event.performedByUid || "System"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
