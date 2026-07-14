"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCollection } from "@/hooks/use-collection";
import { useToast } from "@/hooks/use-toast";
import {
  loadCycleCountTasksForReport,
  type CycleCountTaskReportRow,
} from "@/lib/warehouse-cycle-count";
import { CycleCountTaskDetail } from "@/components/warehouse-ops/cycle-count-task-detail";
import type { UserProfile, WarehouseCycleCountTaskDoc, WarehouseDoc } from "@/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ClipboardList, Eye, Loader2, RefreshCw, Search } from "lucide-react";

function localDateKey(date: Date | null | undefined): string | null {
  if (!date || Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

type StatusFilter = "all" | "completed" | "in_progress" | "open" | "cancelled" | "variance";

export function CycleCountReport() {
  const { toast } = useToast();
  const { data: warehouses = [], loading: warehousesLoading } =
    useCollection<WarehouseDoc>("warehouses");
  const { data: users = [] } = useCollection<UserProfile>("users");

  const activeWarehouses = useMemo(
    () => warehouses.filter((w) => w.active !== false),
    [warehouses]
  );

  const [warehouseId, setWarehouseId] = useState("");
  const [rows, setRows] = useState<CycleCountTaskReportRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("completed");
  const [dateFilter, setDateFilter] = useState("");
  const [selectedTask, setSelectedTask] = useState<WarehouseCycleCountTaskDoc | null>(null);

  const operatorNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const u of users) {
      const uid = String(u.uid || (u as UserProfile & { id?: string }).id || "").trim();
      if (!uid) continue;
      map.set(uid, u.name?.trim() || u.email?.trim() || uid.slice(0, 8));
    }
    return map;
  }, [users]);

  useEffect(() => {
    if (!warehouseId && activeWarehouses.length > 0) {
      setWarehouseId(activeWarehouses[0]!.id);
    }
  }, [activeWarehouses, warehouseId]);

  const refresh = useCallback(async () => {
    if (!warehouseId) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const next = await loadCycleCountTasksForReport(warehouseId, 150);
      setRows(next);
    } catch (e) {
      toast({
        title: "Could not load cycle counts",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [warehouseId, toast]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter === "variance") {
        if (row.varianceLineCount < 1) return false;
      } else if (statusFilter !== "all" && row.task.status !== statusFilter) {
        return false;
      }
      const day = localDateKey(row.completedAt ?? row.createdAt);
      if (dateFilter && day !== dateFilter) return false;
      if (!q) return true;
      const haystack = [
        row.task.title,
        row.task.type,
        row.task.status,
        row.task.notes,
        ...row.task.binPaths,
        ...row.task.binResults.flatMap((b) => [
          b.binPath,
          b.notes,
          ...b.countedLines.map(
            (l) => `${l.sku} ${l.varianceReason ?? ""} ${l.varianceNotes ?? ""}`
          ),
        ]),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, statusFilter, dateFilter]);

  const summary = useMemo(() => {
    const withVariance = filtered.filter((r) => r.varianceLineCount > 0).length;
    const completed = filtered.filter((r) => r.task.status === "completed").length;
    return { total: filtered.length, completed, withVariance };
  }, [filtered]);

  const selectedWarehouse = activeWarehouses.find((w) => w.id === warehouseId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <ClipboardList className="h-6 w-6 text-teal-600" />
          Cycle count reports
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Review completed warehouse cycle counts, variances, and operator remarks.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription className="text-xs">
            Select a warehouse, then open a task to see bin-by-bin expected vs counted, variance
            reasons, and remarks.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>Warehouse</Label>
              <Select
                value={warehouseId || undefined}
                onValueChange={setWarehouseId}
                disabled={warehousesLoading || activeWarehouses.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={warehousesLoading ? "Loading…" : "Select warehouse"} />
                </SelectTrigger>
                <SelectContent>
                  {activeWarehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.code || w.name || w.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as StatusFilter)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="variance">Has variance</SelectItem>
                  <SelectItem value="in_progress">In progress</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="all">All statuses</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Search</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Title, bin, SKU, remarks…"
                  className="pl-8"
                />
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1" />
              )}
              Refresh
            </Button>
            {dateFilter ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDateFilter("")}>
                Clear date
              </Button>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {selectedWarehouse
                ? `${selectedWarehouse.code || selectedWarehouse.name}: `
                : ""}
              {summary.total} shown · {summary.completed} completed · {summary.withVariance} with
              variance
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Count tasks</CardTitle>
        </CardHeader>
        <CardContent>
          {loading && rows.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading cycle counts…
            </div>
          ) : !warehouseId ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              Select a warehouse to view reports.
            </p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">
              No cycle count tasks match these filters.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Task</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Bins</TableHead>
                    <TableHead>Variances</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead className="w-[1%]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((row) => (
                    <TableRow key={row.task.id}>
                      <TableCell>
                        <div className="font-medium text-sm">{row.task.title}</div>
                        <div className="text-xs text-muted-foreground capitalize">
                          {row.task.type}
                          {row.task.notes ? ` · ${row.task.notes}` : ""}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {row.task.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm">
                        {row.binsCounted}/{row.binsTotal}
                      </TableCell>
                      <TableCell>
                        {row.varianceLineCount > 0 ? (
                          <Badge className="bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100">
                            {row.varianceLineCount} line
                            {row.varianceLineCount === 1 ? "" : "s"} · {row.varianceBinCount} bin
                            {row.varianceBinCount === 1 ? "" : "s"}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                        {formatShortDate(row.completedAt ?? row.createdAt)}
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedTask(row.task)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!selectedTask} onOpenChange={(open) => !open && setSelectedTask(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Cycle count detail</DialogTitle>
            <DialogDescription>
              Expected vs counted quantities, variance reasons, and remarks.
            </DialogDescription>
          </DialogHeader>
          {selectedTask ? (
            <CycleCountTaskDetail
              task={selectedTask}
              operatorNameById={operatorNameById}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
