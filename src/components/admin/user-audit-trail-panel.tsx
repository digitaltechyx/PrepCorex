"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Download, Loader2, RefreshCw, ScrollText } from "lucide-react";
import { auth } from "@/lib/firebase";
import {
  formatSessionDuration,
  getAuditEventDisplayLabel,
} from "@/lib/user-audit-trail-display";
import type { UserAuditEvent } from "@/types";
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

type UserAuditTrailPanelProps = {
  userId: string;
  userName?: string | null;
};

export function UserAuditTrailPanel({ userId, userName }: UserAuditTrailPanelProps) {
  const { toast } = useToast();
  const [events, setEvents] = useState<UserAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);

  const loadEvents = useCallback(async () => {
    setLoading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(`/api/admin/users/${encodeURIComponent(userId)}/audit-trail`, {
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
  }, [toast, userId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) throw new Error("Not authenticated");

      const res = await fetch(
        `/api/admin/users/${encodeURIComponent(userId)}/audit-trail/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Download failed");
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const match = disposition.match(/filename="([^"]+)"/);
      const filename = match?.[1] || `audit-trail_${userId}.csv`;

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
            Audit Trail
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            Account lifecycle, sign-in activity, and user actions for {userName || "this user"}.
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
          No audit events recorded yet. Activity will appear here as the user uses the platform.
        </div>
      ) : (
        <div className="rounded-md border max-h-[420px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Date / Time</TableHead>
                <TableHead>Event</TableHead>
                <TableHead className="hidden md:table-cell">Details</TableHead>
                <TableHead className="hidden lg:table-cell">Region</TableHead>
                <TableHead className="hidden lg:table-cell">IP Address</TableHead>
                <TableHead className="hidden xl:table-cell">Session</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={`${event.id}-${event.occurredAt}`}>
                  <TableCell className="whitespace-nowrap text-xs">
                    {formatDateTime(event.occurredAt)}
                  </TableCell>
                  <TableCell className="text-sm">
                    <div className="flex flex-col gap-1">
                      <span>{getAuditEventDisplayLabel(event)}</span>
                      {event.synthetic && (
                        <Badge variant="secondary" className="w-fit text-[10px]">
                          Profile backfill
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-xs text-muted-foreground max-w-[200px] truncate">
                    {event.description || event.action || "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs">
                    {event.region || "—"}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell text-xs font-mono">
                    {event.ipAddress || "—"}
                  </TableCell>
                  <TableCell className="hidden xl:table-cell text-xs">
                    {formatSessionDuration(event.sessionDurationMs)}
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
