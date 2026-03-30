"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { RestockHistory } from "@/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { History, TrendingUp, Calendar, Search, X } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export default function RestockHistoryPage() {
  const { userProfile } = useAuth();
  const [restockDateFilter, setRestockDateFilter] = useState<string>("all");
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

  const filteredRestockHistory = restockHistory.filter((item) => {
    const q = restockSearch.trim().toLowerCase();
    const matchesSearch =
      q.length === 0 ||
      (item.productName || "").toLowerCase().includes(q) ||
      (item.restockedBy || "").toLowerCase().includes(q);
    return matchesDateFilter(item.restockedAt, restockDateFilter) && matchesSearch;
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
          </div>

          {/* Content */}
          {restockHistoryLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : filteredRestockHistory.length > 0 ? (
            <div className="space-y-4">
              {paginatedRestockHistory.map((item) => (
                <div 
                  key={item.id}
                  className="group relative overflow-hidden rounded-xl border-2 border-green-100 bg-gradient-to-r from-green-50 to-emerald-50/50 p-5 shadow-md hover:shadow-lg transition-all duration-200 hover:border-green-300"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-lg font-bold text-gray-900">{item.productName}</h3>
                        <Badge className="bg-green-500 text-white shadow-md px-3 py-1">
                          +{item.restockedQuantity}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
                        <div className="flex items-center gap-1">
                          <span className="font-medium">Previous:</span>
                          <span className="text-gray-800">{item.previousQuantity}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">New Total:</span>
                          <span className="text-green-700 font-bold">{item.newQuantity}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="font-medium">By:</span>
                          <span className="text-gray-800">{item.restockedBy}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          <span>{formatDate(item.restockedAt)}</span>
                        </div>
                      </div>
                    </div>
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
