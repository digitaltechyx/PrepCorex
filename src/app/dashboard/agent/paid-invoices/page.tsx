"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAffiliateData } from "@/components/dashboard/agent/use-affiliate-data";
import { AffiliatePageBanner } from "@/components/dashboard/agent/affiliate-page-banner";
import { FileText, Search, X } from "lucide-react";

function toJsDate(date: any): Date | null {
  if (!date) return null;
  if (date?.seconds) return new Date(date.seconds * 1000);
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(date: any) {
  const d = toJsDate(date);
  return d ? format(d, "MMM dd, yyyy") : "N/A";
}

function withinDateFilter(date: any, filter: string): boolean {
  if (filter === "all") return true;
  const d = toJsDate(date);
  if (!d) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filter === "today") return d >= startOfToday;
  if (filter === "week") {
    const weekAgo = new Date(startOfToday);
    weekAgo.setDate(weekAgo.getDate() - 7);
    return d >= weekAgo;
  }
  if (filter === "month") {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    return d >= monthStart;
  }
  if (filter === "year") {
    const yearStart = new Date(now.getFullYear(), 0, 1);
    return d >= yearStart;
  }
  return true;
}

export default function PaidInvoicesPage() {
  const { loading, paidInvoices, referredClients } = useAffiliateData();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");

  const clientOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const inv of paidInvoices) {
      const client = referredClients.find((c) => c.uid === inv.userId);
      if (client?.uid) map.set(client.uid, client.name || client.email || "Unknown");
    }
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [paidInvoices, referredClients]);

  const filteredInvoices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return paidInvoices.filter((inv) => {
      const client = referredClients.find((c) => c.uid === inv.userId);
      const status = inv.commissionStatus === "paid" ? "paid" : "pending";
      if (statusFilter !== "all" && status !== statusFilter) return false;
      if (clientFilter !== "all" && inv.userId !== clientFilter) return false;
      if (!withinDateFilter(inv.date, dateFilter)) return false;
      if (!q) return true;
      const hay = [
        inv.invoiceNumber || "",
        client?.name || "",
        client?.email || "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [paidInvoices, referredClients, search, statusFilter, clientFilter, dateFilter]);

  if (loading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <AffiliatePageBanner
        title="Paid Invoices"
        description="Invoices paid by your referred clients. These are the source of your commission earnings."
        icon={FileText}
        gradient="bg-gradient-to-r from-blue-500 to-indigo-600"
      />

      <Card className="border-slate-200 shadow-sm">
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <h3 className="text-base font-semibold text-slate-900">
              Paid Invoices ({filteredInvoices.length})
            </h3>
            <div className="flex flex-1 flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
              <div className="relative flex-1 lg:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  placeholder="Search by invoice # or client..."
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
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full lg:w-44">
                  <SelectValue placeholder="Commission status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
              {clientOptions.length > 0 && (
                <Select value={clientFilter} onValueChange={setClientFilter}>
                  <SelectTrigger className="w-full lg:w-52">
                    <SelectValue placeholder="Filter by client" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All clients</SelectItem>
                    {clientOptions.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={dateFilter} onValueChange={setDateFilter}>
                <SelectTrigger className="w-full lg:w-40">
                  <SelectValue placeholder="Date range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 days</SelectItem>
                  <SelectItem value="month">This month</SelectItem>
                  <SelectItem value="year">This year</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {filteredInvoices.length > 0 ? (
            <Table containerClassName="overflow-x-auto mouse-h-scroll">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice #</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Total</TableHead>
                  <TableHead>Commission Status</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInvoices.map((invoice) => {
                  const client = referredClients.find((c) => c.uid === invoice.userId);
                  return (
                    <TableRow key={invoice.id}>
                      <TableCell className="font-mono">{invoice.invoiceNumber || "-"}</TableCell>
                      <TableCell>{client?.name || "Unknown"}</TableCell>
                      <TableCell className="font-semibold text-emerald-600">${(invoice.grandTotal || 0).toFixed(2)}</TableCell>
                      <TableCell>
                        {invoice.commissionStatus === "paid" ? (
                          <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100">Paid</Badge>
                        ) : (
                          <Badge className="bg-amber-100 text-amber-700 hover:bg-amber-100">Pending</Badge>
                        )}
                      </TableCell>
                      <TableCell>{formatDate(invoice.date)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <p className="py-10 text-center text-sm text-muted-foreground">No invoices match your filters.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
