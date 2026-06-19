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
import { useToast } from "@/hooks/use-toast";
import { useCollection } from "@/hooks/use-collection";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import { ScanCameraButton } from "@/components/warehouse-ops/scan-camera-button";
import type { UserProfile, WarehouseDoc } from "@/types";
import {
  searchInventory,
  type InventorySearchFilters,
  type InventorySearchRow,
} from "@/lib/warehouse-allocate";
import type { ProductLocationKind } from "@/lib/warehouse-product-location";
import { Loader2, MapPin, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  warehouse: WarehouseDoc;
};

const LOCATION_KIND_BADGE: Record<
  ProductLocationKind,
  { label: string; className: string }
> = {
  bin: { label: "In bin", className: "bg-emerald-100 border-emerald-300 text-emerald-900" },
  area: { label: "Floor area", className: "bg-sky-100 border-sky-300 text-sky-900" },
  receiving: { label: "Receiving", className: "bg-orange-100 border-orange-300 text-orange-900" },
  picked: { label: "Picked", className: "bg-violet-100 border-violet-300 text-violet-900" },
  quarantine: { label: "Quarantine", className: "bg-red-100 border-red-300 text-red-900" },
  pack: { label: "Pack / dispatch", className: "bg-indigo-100 border-indigo-300 text-indigo-900" },
  other: { label: "Other", className: "bg-slate-100 border-slate-300 text-slate-800" },
};

function clientsForWarehouse(clients: UserProfile[], warehouse: WarehouseDoc): UserProfile[] {
  const linked = String(warehouse.linkedLocationId ?? "").trim();
  if (!linked) return clients;
  return clients.filter((c) => {
    const locs = Array.isArray(c.locations) ? c.locations : [];
    return locs.map(String).includes(linked);
  });
}

function clientLabel(c: UserProfile | undefined, id: string | null | undefined): string {
  if (!id) return "—";
  if (!c) return id.slice(0, 8);
  const name = c.name || c.email || id;
  return c.clientId ? `${name} (${c.clientId})` : name;
}

const EMPTY_FILTERS: InventorySearchFilters = {
  query: "",
  sku: "",
  clientId: "",
  cartonCode: "",
  binPath: "",
  condition: "all",
  status: "any",
  locationStage: "all",
};

export function WarehouseOpsLocate({ warehouse }: Props) {
  const { toast } = useToast();
  const { data: allUsers } = useCollection<UserProfile>("users");
  const clients = useMemo(() => {
    const base = allUsers.filter(
      (u) => u.role === "user" || (u.roles ?? []).includes("user")
    );
    return clientsForWarehouse(base, warehouse);
  }, [allUsers, warehouse]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.uid, c])), [clients]);

  const [filters, setFilters] = useState<InventorySearchFilters>(EMPTY_FILTERS);
  const [results, setResults] = useState<InventorySearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    try {
      const rows = await searchInventory(warehouse, filters);
      setResults(rows);
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
    void runSearch();
  }, [warehouse.id]);

  const hasFilters =
    Boolean(filters.query?.trim()) ||
    Boolean(filters.sku?.trim()) ||
    Boolean(filters.cartonCode?.trim()) ||
    Boolean(filters.binPath?.trim()) ||
    Boolean(filters.clientId) ||
    (filters.condition ?? "all") !== "all" ||
    (filters.status ?? "any") !== "any" ||
    (filters.locationStage ?? "all") !== "all";

  function clearFilters() {
    setFilters(EMPTY_FILTERS);
  }

  function applyScanToQuery(raw: string) {
    const v = raw.trim();
    if (!v) return;
    setFilters((f) => ({ ...f, query: v }));
  }

  return (
    <div className="max-w-4xl space-y-4">
      <WarehouseOpsHeader title="Find product" />

      <p className="text-sm text-muted-foreground -mt-2">
        Where stock lives in <span className="font-mono font-medium">{warehouse.code}</span> —
        bin, floor area, receiving, picked, quarantine, or pack staging.
      </p>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4" />
            Search &amp; filters
          </CardTitle>
          <CardDescription className="text-xs">
            Scan or type SKU, product name, carton code, or bin path.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={filters.query ?? ""}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Search SKU, product, carton, location…"
              className="flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") void runSearch();
              }}
            />
            <ScanCameraButton
              onScan={applyScanToQuery}
              scannerTitle="Scan product or bin"
              scannerDescription="Scan SKU, carton label, or bin QR."
            />
            <Button onClick={() => void runSearch()} disabled={loading}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Client</Label>
              <Select
                value={filters.clientId || "__all__"}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, clientId: v === "__all__" ? "" : v }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="All clients" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All clients</SelectItem>
                  {clients.map((c) => (
                    <SelectItem key={c.uid} value={c.uid}>
                      {clientLabel(c, c.uid)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Where (stage)</Label>
              <Select
                value={filters.locationStage ?? "all"}
                onValueChange={(v) =>
                  setFilters((f) => ({
                    ...f,
                    locationStage: v as InventorySearchFilters["locationStage"],
                  }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All locations</SelectItem>
                  <SelectItem value="bin">In storage bin</SelectItem>
                  <SelectItem value="area">Floor area only</SelectItem>
                  <SelectItem value="receiving">Receiving / dock</SelectItem>
                  <SelectItem value="picked">Picked → pack</SelectItem>
                  <SelectItem value="quarantine">Quarantine / damaged</SelectItem>
                  <SelectItem value="pack">Pack / dispatch</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Line status</Label>
              <Select
                value={filters.status ?? "any"}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, status: v as InventorySearchFilters["status"] }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any allocation</SelectItem>
                  <SelectItem value="allocated">Allocated to client</SelectItem>
                  <SelectItem value="unallocated">Unallocated</SelectItem>
                  <SelectItem value="picked">Picked (outbound)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-xs">SKU contains</Label>
              <Input
                className="h-9"
                value={filters.sku ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, sku: e.target.value }))}
                placeholder="Optional"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Carton code</Label>
              <Input
                className="h-9"
                value={filters.cartonCode ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, cartonCode: e.target.value }))}
                placeholder="CTN-…"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Bin / area contains</Label>
              <Input
                className="h-9"
                value={filters.binPath ?? ""}
                onChange={(e) => setFilters((f) => ({ ...f, binPath: e.target.value }))}
                placeholder="NJ01-A-… or RCV"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs">Condition</Label>
              <Select
                value={filters.condition ?? "all"}
                onValueChange={(v) =>
                  setFilters((f) => ({ ...f, condition: v as InventorySearchFilters["condition"] }))
                }
              >
                <SelectTrigger className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Good + damaged</SelectItem>
                  <SelectItem value="good">Good only</SelectItem>
                  <SelectItem value="damaged">Damaged only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {hasFilters ? (
            <Button type="button" variant="ghost" size="sm" className="h-8 text-xs" onClick={clearFilters}>
              <X className="h-3.5 w-3.5 mr-1" />
              Clear filters
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {loading ? "Searching…" : `${results.length} location${results.length === 1 ? "" : "s"}`}
        </p>
        {searched && !loading ? (
          <Badge variant="outline" className="text-xs">
            {warehouse.code}
          </Badge>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-8 w-8 animate-spin mr-2" />
          Loading…
        </div>
      ) : results.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {searched
              ? "No stock matches these filters in this warehouse."
              : "Run a search to see where products are."}
          </CardContent>
        </Card>
      ) : (
        <ul className="space-y-3">
          {results.map((r) => {
            const kindMeta = LOCATION_KIND_BADGE[r.locationKind];
            return (
              <li key={`${r.cartonId}:${r.line.lineId}`}>
                <Card className="overflow-hidden">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-semibold">{r.line.sku}</p>
                        {r.productTitle ? (
                          <p className="text-xs text-muted-foreground line-clamp-2">{r.productTitle}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-1.5 justify-end">
                        <Badge variant="outline" className={cn("text-[10px]", kindMeta.className)}>
                          {kindMeta.label}
                        </Badge>
                        {r.line.condition === "damaged" ? (
                          <Badge variant="outline" className="text-[10px] bg-red-50 border-red-200">
                            DMG
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2">
                      <MapPin className="h-4 w-4 shrink-0 mt-0.5 text-orange-600" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium break-all">{r.locationLabel}</p>
                        {r.binPath && r.locationKind !== "bin" ? (
                          <p className="text-[10px] text-muted-foreground font-mono">{r.binPath}</p>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Qty</p>
                        <p className="font-semibold tabular-nums">{r.line.quantity}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Carton</p>
                        <p className="font-mono font-medium truncate">{r.cartonCode}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Client</p>
                        <p className="truncate">{clientLabel(clientById.get(r.line.clientId ?? ""), r.line.clientId)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Age</p>
                        <p className="tabular-nums">{r.ageDays != null ? `${r.ageDays}d` : "—"}</p>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Badge variant="secondary" className="text-[10px] capitalize">
                        Carton: {r.cartonStatus.replace(/_/g, " ")}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] capitalize">
                        Line: {r.line.allocationStatus ?? "unallocated"}
                      </Badge>
                      {r.line.lot ? (
                        <Badge variant="outline" className="text-[10px] font-mono">
                          Lot {r.line.lot}
                        </Badge>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
