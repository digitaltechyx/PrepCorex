"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import {
  eventTypesForModule,
  loadOpsActivityLog,
  type OpsActivityLogEntry,
  type OpsLogModule,
} from "@/lib/warehouse-ops-activity-log";
import type { UserProfile, WarehouseDoc } from "@/types";
import {
  ChevronRight,
  ClipboardList,
  Loader2,
  RefreshCw,
  Search,
  User as UserIcon,
} from "lucide-react";
import { format } from "date-fns";

type Props = {
  warehouse: WarehouseDoc;
  module: OpsLogModule;
  title?: string;
  description?: string;
  /** Scope log to a single product return (per-entry log). */
  productReturnId?: string | null;
  /** Hide outer card chrome when embedded in a dialog. */
  embedded?: boolean;
};

type RangeFilter = "today" | "7d" | "30d" | "all" | "custom";

function formatWhen(date: Date | null): string {
  if (!date) return "—";
  return format(date, "MMM d, yyyy h:mm a");
}

function startOfLocalDay(isoDate: string): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function endOfLocalDay(isoDate: string): number | null {
  if (!isoDate) return null;
  const d = new Date(`${isoDate}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

const MODULE_COPY: Record<
  OpsLogModule,
  { title: string; description: string }
> = {
  putaway: {
    title: "Putaway log",
    description: "What was stowed, where, when, and by whom.",
  },
  pick: {
    title: "Pick log",
    description: "What was picked from bins, when, and by whom.",
  },
  pack: {
    title: "Pack log",
    description: "Pack completes, QC returns, and cross-dock pack events.",
  },
  quarantine: {
    title: "Quarantine log",
    description: "Releases, returns to putaway, and sends to pack.",
  },
  returns: {
    title: "Returns log",
    description: "Return receives and QC outcomes — who, what, when.",
  },
  move: {
    title: "Move log",
    description: "Bin and area moves — stock relocated on the floor.",
  },
  cycle_count: {
    title: "Cycle count log",
    description: "Bin counts and variance resolutions.",
  },
};

export function WarehouseOpsActivityLog({
  warehouse,
  module,
  title,
  description,
  productReturnId,
  embedded = false,
}: Props) {
  const { toast } = useToast();
  const { data: allUsers } = useCollection<UserProfile>("users");
  const copy = MODULE_COPY[module];

  const [entries, setEntries] = useState<OpsActivityLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryText, setQueryText] = useState("");
  const [range, setRange] = useState<RangeFilter>("7d");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [operatorFilter, setOperatorFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");
  const [selected, setSelected] = useState<OpsActivityLogEntry | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await loadOpsActivityLog({
        warehouse,
        eventTypes: eventTypesForModule(module),
        users: allUsers,
        max: productReturnId ? 500 : 250,
        productReturnId,
      });
      setEntries(rows);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to load log",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setLoading(false);
    }
  }, [warehouse, module, allUsers, toast, productReturnId]);

  useEffect(() => {
    void load();
  }, [load]);

  const typeOptions = useMemo(() => {
    const set = new Set(entries.map((e) => e.typeLabel));
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const operatorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.operatorLabel) map.set(e.operatorLabel, e.operatorLabel);
    }
    return ["all", ...Array.from(map.keys()).sort()];
  }, [entries]);

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of entries) {
      if (e.clientLabel) map.set(e.clientLabel, e.clientLabel);
    }
    return ["all", ...Array.from(map.keys()).sort()];
  }, [entries]);

  const conditionOptions = useMemo(() => {
    const set = new Set(
      entries.map((e) => e.condition).filter(Boolean) as string[]
    );
    return ["all", ...Array.from(set).sort()];
  }, [entries]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const rangeMs =
      range === "today"
        ? 24 * 60 * 60 * 1000
        : range === "7d"
          ? 7 * 24 * 60 * 60 * 1000
          : range === "30d"
            ? 30 * 24 * 60 * 60 * 1000
            : null;
    const fromMs = range === "custom" ? startOfLocalDay(fromDate) : null;
    const toMs = range === "custom" ? endOfLocalDay(toDate) : null;
    const q = queryText.trim().toLowerCase();

    return entries.filter((e) => {
      if (typeFilter !== "all" && e.typeLabel !== typeFilter) return false;
      if (operatorFilter !== "all" && e.operatorLabel !== operatorFilter) return false;
      if (clientFilter !== "all" && e.clientLabel !== clientFilter) return false;
      if (conditionFilter !== "all" && e.condition !== conditionFilter) return false;

      const t = e.at?.getTime();
      if (range === "custom") {
        if (fromMs != null && (t == null || t < fromMs)) return false;
        if (toMs != null && (t == null || t > toMs)) return false;
      } else if (rangeMs != null) {
        if (t == null || now - t > rangeMs) return false;
      }

      if (q && !e.searchText.includes(q)) return false;
      return true;
    });
  }, [
    entries,
    queryText,
    range,
    fromDate,
    toDate,
    typeFilter,
    operatorFilter,
    clientFilter,
    conditionFilter,
  ]);

  const totals = useMemo(() => {
    const operators = new Set(
      filtered.map((e) => e.operatorLabel).filter(Boolean) as string[]
    );
    const units = filtered.reduce((s, e) => s + (e.quantity ?? 0), 0);
    return { count: filtered.length, operators: operators.size, units };
  }, [filtered]);

  const body = (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {embedded ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        ) : null}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={queryText}
            onChange={(e) => setQueryText(e.target.value)}
            placeholder="Search SKU, carton, client, operator, tracking…"
            className="pl-8"
          />
        </div>
        <Select value={range} onValueChange={(v) => setRange(v as RangeFilter)}>
          <SelectTrigger className="w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="all">All time</SelectItem>
            <SelectItem value="custom">Custom dates</SelectItem>
          </SelectContent>
        </Select>
        {range === "custom" ? (
          <>
            <Input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="w-[140px]"
              aria-label="From date"
            />
            <Input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="w-[140px]"
              aria-label="To date"
            />
          </>
        ) : null}
        {typeOptions.length > 2 ? (
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Action" />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "all" ? "All actions" : t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {operatorOptions.length > 2 ? (
          <Select value={operatorFilter} onValueChange={setOperatorFilter}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Operator" />
            </SelectTrigger>
            <SelectContent>
              {operatorOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "all" ? "All operators" : t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {clientOptions.length > 2 ? (
          <Select value={clientFilter} onValueChange={setClientFilter}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Client" />
            </SelectTrigger>
            <SelectContent>
              {clientOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "all" ? "All clients" : t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        {conditionOptions.length > 2 ? (
          <Select value={conditionFilter} onValueChange={setConditionFilter}>
            <SelectTrigger className="w-[130px]">
              <SelectValue placeholder="Condition" />
            </SelectTrigger>
            <SelectContent>
              {conditionOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t === "all" ? "All conditions" : t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary">{totals.count} events</Badge>
        {totals.units > 0 ? (
          <Badge variant="secondary">{totals.units} units</Badge>
        ) : null}
        <Badge variant="secondary">{totals.operators} operators</Badge>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading log…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed py-12 text-center text-sm text-muted-foreground">
          No events match your filters.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((e) => (
            <button
              key={e.id}
              type="button"
              onClick={() => setSelected(e)}
              className="w-full rounded-lg border p-3 text-left text-sm transition-colors hover:bg-muted/40"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 font-medium min-w-0">
                  <ClipboardList className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Badge variant="outline">{e.typeLabel}</Badge>
                  <span className="line-clamp-1">{e.summary}</span>
                </div>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {formatWhen(e.at)}
                  <ChevronRight className="h-3.5 w-3.5" />
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <UserIcon className="h-3.5 w-3.5" />
                  {e.operatorLabel ?? "Unknown operator"}
                </span>
                {e.clientLabel ? <span>{e.clientLabel}</span> : null}
                {e.sku ? <span className="font-mono">{e.sku}</span> : null}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      {embedded ? (
        body
      ) : (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{title ?? copy.title}</CardTitle>
                <CardDescription>
                  {description ?? copy.description}
                </CardDescription>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void load()}
                disabled={loading}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-2 h-4 w-4" />
                )}
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>{body}</CardContent>
        </Card>
      )}

      <Dialog
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {selected ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <ClipboardList className="h-4 w-4" />
                  {selected.typeLabel}
                </DialogTitle>
                <DialogDescription>
                  {formatWhen(selected.at)}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4 text-sm">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Operator
                    </p>
                    <p className="mt-1 font-medium">
                      {selected.operatorLabel ?? "Unknown"}
                    </p>
                  </div>
                  <div className="rounded-md border p-3">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Client
                    </p>
                    <p className="mt-1 font-medium">
                      {selected.clientLabel ?? "—"}
                    </p>
                  </div>
                </div>

                <div className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Summary
                  </p>
                  <p className="mt-1 font-medium">{selected.summary}</p>
                </div>

                {selected.details.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Details
                    </p>
                    <div className="space-y-1">
                      {selected.details.map((d) => (
                        <div
                          key={`${selected.id}-${d.label}`}
                          className="flex flex-wrap justify-between gap-2 rounded bg-muted/40 px-2 py-1.5 text-xs"
                        >
                          <span className="text-muted-foreground">{d.label}</span>
                          <span className="font-medium text-right">{d.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
