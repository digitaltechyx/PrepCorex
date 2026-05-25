"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile, WarehouseDoc } from "@/types";
import {
  agingBucket,
  searchInventory,
  type InventorySearchFilters,
  type InventorySearchRow,
} from "@/lib/warehouse-allocate";
import { Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

export function WarehouseInventorySearch({ warehouse }: Props) {
  const { toast } = useToast();
  const { data: allUsers } = useCollection<UserProfile>("users");
  const clients = useMemo(
    () => allUsers.filter((u) => u.role === "user" || (u.roles ?? []).includes("user")),
    [allUsers]
  );
  const clientById = useMemo(() => new Map(clients.map((c) => [c.uid, c])), [clients]);

  const [filters, setFilters] = useState<InventorySearchFilters>({
    sku: "",
    clientId: "",
    cartonCode: "",
    binPath: "",
    condition: "all",
    status: "any",
  });
  const [results, setResults] = useState<InventorySearchRow[]>([]);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    try {
      const r = await searchInventory(warehouse, filters);
      setResults(r);
    } catch (e) {
      toast({
        title: "Search failed",
        description: e instanceof Error ? e.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [warehouse, filters, toast]);

  useEffect(() => {
    void run();
  }, [run]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Inventory search</h1>
        <p className="text-sm text-muted-foreground">
          Find any line: by SKU, client, carton, bin, or status. Scoped to{" "}
          <span className="font-mono">{warehouse.code}</span>.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="space-y-1">
            <Label className="text-xs">SKU</Label>
            <Input
              value={filters.sku ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, sku: e.target.value }))}
              placeholder="contains"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Carton</Label>
            <Input
              value={filters.cartonCode ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, cartonCode: e.target.value }))}
              placeholder="CTN-2026-…"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Bin</Label>
            <Input
              value={filters.binPath ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, binPath: e.target.value }))}
              placeholder="contains"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Client</Label>
            <Select
              value={filters.clientId || "__all__"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, clientId: v === "__all__" ? "" : v }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All clients</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.uid} value={c.uid}>
                    {c.name || c.email || c.uid}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Condition</Label>
            <Select
              value={filters.condition ?? "all"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, condition: v as InventorySearchFilters["condition"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="good">Good</SelectItem>
                <SelectItem value="damaged">Damaged</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Allocation</Label>
            <Select
              value={filters.status ?? "any"}
              onValueChange={(v) =>
                setFilters((f) => ({ ...f, status: v as InventorySearchFilters["status"] }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any</SelectItem>
                <SelectItem value="unallocated">Unallocated</SelectItem>
                <SelectItem value="allocated">Allocated</SelectItem>
                <SelectItem value="picked">Picked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4" />
            Results ({results.length})
          </CardTitle>
          <CardDescription className="text-xs">
            {loading ? "Searching…" : null}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-2">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No matches.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">SKU</TableHead>
                  <TableHead className="text-xs">Qty</TableHead>
                  <TableHead className="text-xs">Carton</TableHead>
                  <TableHead className="text-xs">Bin</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                  <TableHead className="text-xs">Client</TableHead>
                  <TableHead className="text-xs">Age</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => {
                  const bucket = agingBucket(r.ageDays);
                  return (
                    <TableRow key={`${r.cartonId}:${r.line.lineId}`}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {r.line.sku}
                        {r.line.condition === "damaged" ? (
                          <Badge variant="outline" className="ml-2 bg-red-100 border-red-300 text-red-800">
                            DMG
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{r.line.quantity}</TableCell>
                      <TableCell className="font-mono text-xs">{r.cartonCode}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {r.binPath ?? (
                          <span className="text-orange-700">staging</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge variant="outline">
                          {r.line.allocationStatus ?? "unallocated"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {r.line.clientId ? (
                          clientById.get(r.line.clientId)?.name ?? r.line.clientId.slice(0, 8)
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs">
                        <Badge
                          variant="outline"
                          className={cn(
                            bucket === "fresh" && "bg-green-100 border-green-300 text-green-800",
                            bucket === "aging" && "bg-yellow-100 border-yellow-300 text-yellow-800",
                            bucket === "stale" && "bg-red-100 border-red-300 text-red-800"
                          )}
                        >
                          {r.ageDays != null ? `${r.ageDays}d` : "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
