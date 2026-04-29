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
import { Search, X, XCircle } from "lucide-react";

export default function RejectedClientsPage() {
  const { loading, rejectedClients } = useAffiliateData();
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState<string>("all");

  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    for (const c of rejectedClients) if (c.companyName) set.add(c.companyName);
    return Array.from(set).sort();
  }, [rejectedClients]);

  const filteredClients = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rejectedClients.filter((c) => {
      if (companyFilter !== "all" && c.companyName !== companyFilter) return false;
      if (!q) return true;
      return (
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q) ||
        (c.companyName || "").toLowerCase().includes(q)
      );
    });
  }, [rejectedClients, search, companyFilter]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <AffiliatePageBanner
        title="Rejected Clients"
        description="Referred clients who did not pass approval. These are not commission-eligible."
        icon={XCircle}
        gradient="bg-gradient-to-r from-rose-500 to-red-600"
      />

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              Rejected Clients ({filteredClients.length})
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
                      <Badge variant="destructive">Rejected</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No rejected clients match your filters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
