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
    <Card className="min-w-0 overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl sm:border-2">
      <CardHeader className="border-b bg-muted/20 p-3 sm:p-6 sm:pb-4">
        <CardTitle className="flex items-center gap-2 text-base sm:gap-3 sm:text-xl">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-500/15 text-slate-700 dark:text-slate-300 sm:h-10 sm:w-10 sm:rounded-xl">
            <ScrollText className="h-4 w-4 sm:h-5 sm:w-5" />
          </span>
          Roles &amp; Permissions logs
        </CardTitle>
        <CardDescription className="text-xs sm:text-sm">
          Audit trail for roles, features, and location changes.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 p-3 pt-3 sm:space-y-5 sm:p-6 sm:pt-4">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <div className="col-span-2 space-y-1 sm:col-span-1 sm:space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground sm:text-xs">Action</Label>
            <Select value={actionFilter} onValueChange={setActionFilter}>
              <SelectTrigger className="h-9 rounded-lg sm:h-10 sm:rounded-xl">
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
          <div className="space-y-1 sm:space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground sm:text-xs">Admin / actor</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={actorSearch}
                onChange={(e) => setActorSearch(e.target.value)}
                placeholder="Name, email…"
                className="h-9 rounded-lg pl-9 sm:h-10 sm:rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1 sm:space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground sm:text-xs">Target user</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={targetSearch}
                onChange={(e) => setTargetSearch(e.target.value)}
                placeholder="Client id…"
                className="h-9 rounded-lg pl-9 sm:h-10 sm:rounded-xl"
              />
            </div>
          </div>
          <div className="col-span-2 space-y-1 sm:col-span-1 sm:space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground sm:text-xs">Location</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={locationSearch}
                onChange={(e) => setLocationSearch(e.target.value)}
                placeholder="Warehouse…"
                className="h-9 rounded-lg pl-9 sm:h-10 sm:rounded-xl"
              />
            </div>
          </div>
          <div className="space-y-1 sm:space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground sm:text-xs">From</Label>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="h-9 rounded-lg sm:h-10 sm:rounded-xl"
            />
          </div>
          <div className="space-y-1 sm:space-y-1.5">
            <Label className="text-[10px] font-medium text-muted-foreground sm:text-xs">To</Label>
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="h-9 rounded-lg sm:h-10 sm:rounded-xl"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground sm:text-sm">
            {filtered.length} of {sorted.length} event{sorted.length !== 1 ? "s" : ""}
          </p>
          {hasFilters ? (
            <Button type="button" variant="outline" size="sm" className="h-8 rounded-lg sm:rounded-xl" onClick={clearFilters}>
              <FilterX className="mr-1.5 h-4 w-4" />
              Clear
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading logs…
          </div>
        ) : filtered.length === 0 ? (
          <p className="rounded-lg border border-dashed border-muted-foreground/30 bg-muted/10 py-8 text-center text-xs text-muted-foreground sm:rounded-xl sm:border-2 sm:py-10 sm:text-sm">
            {sorted.length === 0
              ? "No roles & permissions activity logged yet."
              : "No events match the current filters."}
          </p>
        ) : (
          <ul className="max-h-[min(560px,60dvh)] space-y-1.5 overflow-y-auto overscroll-contain pr-1 sm:space-y-2">
            {filtered.map((ev) => (
              <li
                key={ev.id}
                className="rounded-lg border border-border/60 bg-card px-2.5 py-2 shadow-sm sm:rounded-xl sm:px-4 sm:py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-0.5 sm:space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                      <Badge variant="secondary" className="h-5 px-1.5 text-[10px] font-medium sm:h-6 sm:text-xs">
                        {ROLES_PERMISSIONS_AUDIT_ACTION_LABELS[ev.action] ?? ev.action}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground sm:text-xs">{formatWhen(ev.createdAt)}</span>
                    </div>
                    <p className="text-xs font-medium text-foreground sm:text-sm">{ev.description}</p>
                    <p className="text-[11px] text-muted-foreground sm:text-xs">
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
