"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Download, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { auth } from "@/lib/firebase";
import type { AffiliateAuditEvent } from "@/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
};

export function AffiliateAuditTrailPanel({ agentId, agentName }: AffiliateAuditTrailPanelProps) {
  const { toast } = useToast();
  const [events, setEvents] = useState<AffiliateAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const params = new URLSearchParams();
      if (agentId) params.set("agentId", agentId);
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
  }, [agentId, toast]);

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
        description: "CSV export saved to your downloads folder.",
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            Affiliate Audit Trail
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            {agentId
              ? `Commission events, approvals, and referrals for ${agentName || "this agent"}.`
              : "Network-wide affiliate program activity."}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadEvents()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span className="ml-2 hidden sm:inline">Refresh</span>
          </Button>
          <Button type="button" size="sm" onClick={() => void handleDownload()} disabled={downloading || loading}>
            {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            <span className="ml-2">Download CSV</span>
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading audit events…
        </div>
      ) : events.length === 0 ? (
        <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
          No affiliate audit events recorded yet.
        </div>
      ) : (
        <div className="rounded-md border max-h-[420px] overflow-auto">
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
                  <TableCell className="text-xs whitespace-nowrap">
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
                  <TableCell className="text-sm max-w-[280px]">
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
      )}
    </div>
  );
}
