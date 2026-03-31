"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { RestockHistory } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { History, TrendingUp, Calendar, Search, X } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export default function RestockHistoryPage() {
  const { userProfile } = useAuth();
  const [restockDateFilter, setRestockDateFilter] = useState<string>("all");
  const [restockFromDate, setRestockFromDate] = useState<Date | undefined>(undefined);
  const [restockToDate, setRestockToDate] = useState<Date | undefined>(undefined);
  const [restockSearch, setRestockSearch] = useState("");
  const [restockPage, setRestockPage] = useState(1);
  const itemsPerPage = 10;

  const { 
    data: restockHistory, 
    loading: restockHistoryLoading 
  } = useCollection<RestockHistory>(
    userProfile ? `users/${userProfile.uid}/restockHistory` : ""
  );

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    if (typeof date === 'string') return format(new Date(date), "MMM dd, yyyy");
    if (date.seconds) return format(new Date(date.seconds * 1000), "MMM dd, yyyy");
    return "N/A";
  };

  const matchesDateFilter = (date: any, filter: string) => {
    if (filter === "all") return true;
    
    let itemDate: Date;
    if (typeof date === 'string') {
      itemDate = new Date(date);
    } else if (date && typeof date === 'object' && date.seconds) {
      itemDate = new Date(date.seconds * 1000);
    } else {
      return false;
    }
    
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
    
    switch (filter) {
      case "today":
        return daysDiff === 0;
      case "week":
        return daysDiff <= 7;
      case "month":
        return daysDiff <= 30;
      case "year":
        return daysDiff <= 365;
      default:
        return true;
    }
  };

  const matchesDatePickerFilter = (date: any, from?: Date, to?: Date) => {
    if (!from && !to) return true;
    let itemDate: Date | null = null;
    if (typeof date === "string") itemDate = new Date(date);
    else if (date && typeof date === "object" && date.seconds) itemDate = new Date(date.seconds * 1000);
    if (!itemDate || Number.isNaN(itemDate.getTime())) return false;
    const itemMs = itemDate.getTime();
    const fromMs = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0).getTime() : null;
    const toMs = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1, 0, 0, 0, 0).getTime() - 1 : null;
    if (fromMs !== null && itemMs < fromMs) return false;
    if (toMs !== null && itemMs > toMs) return false;
    return true;
  };

  const filteredRestockHistory = restockHistory.filter((item) => {
    const q = restockSearch.trim().toLowerCase();
    const matchesSearch =
      q.length === 0 ||
      (item.productName || "").toLowerCase().includes(q) ||
      (item.restockedBy || "").toLowerCase().includes(q);
    return matchesDateFilter(item.restockedAt, restockDateFilter) && matchesDatePickerFilter(item.restockedAt, restockFromDate, restockToDate) && matchesSearch;
  });

  const totalRestockPages = Math.ceil(filteredRestockHistory.length / itemsPerPage);
  const startRestockIndex = (restockPage - 1) * itemsPerPage;
  const endRestockIndex = startRestockIndex + itemsPerPage;
  const paginatedRestockHistory = filteredRestockHistory
    .sort((a, b) => {
      const dateA = typeof a.restockedAt === 'string' ? new Date(a.restockedAt) : new Date(a.restockedAt?.seconds ? a.restockedAt.seconds * 1000 : 0);
      const dateB = typeof b.restockedAt === 'string' ? new Date(b.restockedAt) : new Date(b.restockedAt?.seconds ? b.restockedAt.seconds * 1000 : 0);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(startRestockIndex, endRestockIndex);

  const resetRestockPagination = () => setRestockPage(1);

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-green-500 to-emerald-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <History className="h-6 w-6" />
                Restock Summary
              </CardTitle>
              <CardDescription className="text-green-100 mt-2">
                View when your products were restocked by admins ({filteredRestockHistory.length} records)
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <TrendingUp className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* Filter Section */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6 pb-6 border-b">
            <div className="relative w-full sm:w-[320px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={restockSearch}
                onChange={(e) => {
                  setRestockSearch(e.target.value);
                  resetRestockPagination();
                }}
                placeholder="Search product or restocked by..."
                className="pl-9 pr-8"
              />
              {restockSearch && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-1 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
                  onClick={() => {
                    setRestockSearch("");
                    resetRestockPagination();
                  }}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Calendar className="h-4 w-4" />
              <span>Filter by date:</span>
            </div>
            <Select value={restockDateFilter} onValueChange={(value) => {
              setRestockDateFilter(value);
              resetRestockPagination();
            }}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue placeholder="Filter by date" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="year">This Year</SelectItem>
              </SelectContent>
            </Select>
            <DateRangePicker
              fromDate={restockFromDate}
              toDate={restockToDate}
              setFromDate={(d) => {
                setRestockFromDate(d);
                resetRestockPagination();
              }}
              setToDate={(d) => {
                setRestockToDate(d);
                resetRestockPagination();
              }}
              className="w-full sm:w-[260px]"
            />
          </div>

          {/* Content */}
          {restockHistoryLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : filteredRestockHistory.length > 0 ? (
            <div className="space-y-2">
              {paginatedRestockHistory.map((item) => (
                <div 
                  key={item.id}
                  className="rounded-lg border border-green-200 bg-green-50/40 px-3 py-3 sm:px-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm">
                    <span className="font-semibold text-slate-900">{item.productName}</span>
                    <Badge className="bg-green-500 text-white text-[10px]">+{item.restockedQuantity}</Badge>
                    <span className="text-slate-600 ml-2">Previous: <span className="text-slate-800">{item.previousQuantity}</span></span>
                    <span className="text-slate-600">New Total: <span className="font-semibold text-green-700">{item.newQuantity}</span></span>
                    <span className="text-slate-600">By: <span className="text-slate-800">{item.restockedBy}</span></span>
                    <span className="inline-flex items-center gap-1 text-slate-600"><Calendar className="h-3 w-3" /> {formatDate(item.restockedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="mx-auto h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mb-4">
                <History className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-xl font-bold mb-2">No restock history</h3>
              <p className="text-muted-foreground">
                {restockHistory.length === 0 ? "No products have been restocked yet." : "No restocks match your search or date filter."}
              </p>
            </div>
          )}
          
          {/* Pagination */}
          {filteredRestockHistory.length > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {startRestockIndex + 1} to {Math.min(endRestockIndex, filteredRestockHistory.length)} of {filteredRestockHistory.length} records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRestockPage(p => Math.max(1, p - 1))}
                  disabled={restockPage === 1}
                  className="shadow-sm"
                >
                  Previous
                </Button>
                <span className="text-sm font-medium px-3">
                  Page {restockPage} of {totalRestockPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRestockPage(p => Math.min(totalRestockPages, p + 1))}
                  disabled={restockPage === totalRestockPages}
                  className="shadow-sm"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
