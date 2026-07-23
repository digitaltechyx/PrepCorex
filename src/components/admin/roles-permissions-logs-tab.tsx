"use client";

import { useMemo, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import {
  ROLES_PERMISSIONS_AUDIT_ACTION_LABELS,
  ROLES_PERMISSIONS_AUDIT_COLLECTION,
  rolesPermissionsAuditCreatedAtMs,
  type RolesPermissionsAuditAction,
  type RolesPermissionsAuditEvent,
} from "@/lib/roles-permissions-audit";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollText, Search, Loader2, FilterX } from "lucide-react";

const ACTION_OPTIONS = Object.entries(ROLES_PERMISSIONS_AUDIT_ACTION_LABELS) as [
  RolesPermissionsAuditAction,
  string,
][];

function formatWhen(createdAt: RolesPermissionsAuditEvent["createdAt"]): string {
  const ms = rolesPermissionsAuditCreatedAtMs(createdAt);
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function RolesPermissionsLogsTab() {
  const { data: events, loading } = useCollection<RolesPermissionsAuditEvent>(
    ROLES_PERMISSIONS_AUDIT_COLLECTION
  );

  const [actionFilter, setActionFilter] = useState<string>("all");
  const [actorSearch, setActorSearch] = useState("");
  const [targetSearch, setTargetSearch] = useState("");
  const [locationSearch, setLocationSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const sorted = useMemo(
    () =>
      [...events].sort(
        (a, b) =>
          rolesPermissionsAuditCreatedAtMs(b.createdAt) -
          rolesPermissionsAuditCreatedAtMs(a.createdAt)
      ),
    [events]
  );

  const filtered = useMemo(() => {
    const actorQ = actorSearch.trim().toLowerCase();
    const targetQ = targetSearch.trim().toLowerCase();
    const locQ = locationSearch.trim().toLowerCase();
    const fromMs = fromDate ? new Date(`${fromDate}T00:00:00`).getTime() : null;
    const toMs = toDate ? new Date(`${toDate}T23:59:59.999`).getTime() : null;

    return sorted.filter((ev) => {
      if (actionFilter !== "all" && ev.action !== actionFilter) return false;

      const when = rolesPermissionsAuditCreatedAtMs(ev.createdAt);
      if (fromMs != null && when < fromMs) return false;
      if (toMs != null && when > toMs) return false;

      if (actorQ) {
        const hay = `${ev.actorName ?? ""} ${ev.actorEmail ?? ""} ${ev.actorUid ?? ""}`.toLowerCase();
        if (!hay.includes(actorQ)) return false;
      }

      if (targetQ) {
        const hay = `${(ev.targetUserLabels ?? []).join(" ")} ${(ev.targetUserIds ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(targetQ)) return false;
      }

      if (locQ) {
        const hay = `${(ev.locationLabels ?? []).join(" ")} ${(ev.locationIds ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(locQ)) return false;
      }

      return true;
    });
  }, [sorted, actionFilter, actorSearch, targetSearch, locationSearch, fromDate, toDate]);

  const clearFilters = () => {
    setActionFilter("all");
    setActorSearch("");
    setTargetSearch("");
    setLocationSearch("");
    setFromDate("");
    setToDate("");
  };

  const hasFilters =
    actionFilter !== "all" ||
    actorSearch.trim() ||
    targetSearch.trim() ||
    locationSearch.trim() ||
    fromDate ||
    toDate;

  return (
    <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
      <CardHeader className="border-b bg-muted/20 pb-6">
        <CardTitle className="flex items-center gap-3 text-xl">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-500/15 text-slate-700 dark:text-slate-300">
            <ScrollText className="h-5 w-5" />
          </span>
          Roles &amp; Permissions logs
        </CardTitle>
        <CardDescription className="text-base">
          Audit trail for role/feature changes, location assign/remove, edits, and default warehouse changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Action</Label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-10 rounded-xl">
                <SelectValue placeholder="All actions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All actions</SelectItem>
                {ACTION_OPTIONS.map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Admin / actor</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={actorSearch}
                onChange={(e) => setActorSearch(e.target.value)}
                placeholder="Name, email, uid…"
                className="h-10 rounded-xl pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Target user</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                placeholder="Client id, name…"
                className="h-10 rounded-xl pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">Location</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                placeholder="Warehouse name…"
                className="h-10 rounded-xl pl-9"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-muted-foreground">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-10 rounded-xl"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">
            Showing {filtered.length} of {sorted.length} event{sorted.length !== 1 ? "s" : ""}
          </p>
          {hasFilters ? (
            <Button type="button" variant="outline" size="sm" className="rounded-xl" onClick={clearFilters}>
              <FilterX className="mr-1.5 h-4 w-4" />
              Clear filters
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading logs…
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/10 py-10 text-center text-sm text-muted-foreground">
            {sorted.length === 0
              ? "No roles & permissions activity logged yet."
              : "No events match the current filters."}
          </p>
        ) : (
          <ul className="max-h-[560px] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {filtered.map((ev) => (
              <li
                key={ev.id}
                className="rounded-xl border border-border/60 bg-card px-4 py-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="secondary" className="font-medium">
                        {ROLES_PERMISSIONS_AUDIT_ACTION_LABELS[ev.action] ?? ev.action}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{formatWhen(ev.createdAt)}</span>
                    </div>
                    <p className="text-sm font-medium text-foreground">{ev.description}</p>
                    <p className="text-xs text-muted-foreground">
                      By{" "}
                      {ev.actorName || ev.actorEmail || ev.actorUid || "Unknown admin"}
                      {ev.actorEmail && ev.actorName ? ` (${ev.actorEmail})` : ""}
                    </p>
                    {(ev.targetUserLabels?.length ?? 0) > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Users: {ev.targetUserLabels!.slice(0, 8).join(", ")}
                        {ev.targetUserLabels!.length > 8
                          ? ` +${ev.targetUserLabels!.length - 8} more`
                          : ""}
                      </p>
                    ) : null}
                    {(ev.locationLabels?.length ?? 0) > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        Locations: {ev.locationLabels!.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
