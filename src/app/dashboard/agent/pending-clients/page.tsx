"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAffiliateData } from "@/components/dashboard/agent/use-affiliate-data";
import { AffiliatePageBanner } from "@/components/dashboard/agent/affiliate-page-banner";
import { Clock, Search, X } from "lucide-react";

export default function PendingClientsPage() {
  const { loading, pendingClients } = useAffiliateData();
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of pendingClients) if (c.companyName) set.add(c.companyName);
    return Array.from(set).sort();
  }, [pendingClients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pendingClients.filter((c) => {
      if (companyFilter !== "all" && c.companyName !== companyFilter) return false;
      if (!q) return true;
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.companyName || "").toLowerCase().includes(q)
      );
    });
  }, [pendingClients, search, companyFilter]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <AffiliatePageBanner
        title="Pending Clients"
        description="Track referred clients waiting for admin approval before they become active."
        icon={Clock}
        gradient="bg-gradient-to-r from-amber-500 to-orange-600"
      />

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              Pending Clients ({filteredClients.length})
            </h3>
            <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
              <div className="relative flex-1 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search by name, email, or company..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 pr-9"
                />
                {search && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 h-7 w-7 -translate-y-1/2 p-0"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {companyOptions.length > 0 && (
                <Select value={companyFilter} onValueChange={setCompanyFilter}>
                  <SelectTrigger className="w-full sm:w-56">
                    <SelectValue placeholder="Filter by company" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All companies</SelectItem>
                    {companyOptions.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {filteredClients.length > 0 ? (
            <Table containerClassName="overflow-x-auto mouse-h-scroll">
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredClients.map((client) => (
                  <TableRow key={client.uid}>
                    <TableCell className="font-medium">{client.name || "-"}</TableCell>
                    <TableCell>{client.email || "-"}</TableCell>
                    <TableCell>{client.companyName || "-"}</TableCell>
                    <TableCell>
                      <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pending</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No pending clients match your filters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
