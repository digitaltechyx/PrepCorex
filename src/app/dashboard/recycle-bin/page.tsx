"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem, DisposeRequest } from "@/types";
import { db } from "@/lib/firebase";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { RotateCcw, Search, X, Calendar, Plus, Loader2, Clock, CheckCircle, XCircle, FileStack } from "lucide-react";
import { format } from "date-fns";
import { useState } from "react";

export default function RecycleBinPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const [recycleDateFilter, setRecycleDateFilter] = useState<string>("all");
  const [recycleStatusFilter, setRecycleStatusFilter] = useState<"all" | "pending" | "approved" | "rejected">("all");
  const [recycleSearch, setRecycleSearch] = useState("");
  const [recyclePage, setRecyclePage] = useState(1);
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<string>("");
  const [disposeQuantity, setDisposeQuantity] = useState<string>("");
  const [disposeReason, setDisposeReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const itemsPerPage = 10;

  const { data: inventory } = useCollection<InventoryItem>(
    userProfile ? `users/${userProfile.uid}/inventory` : ""
  );

  const { data: disposeRequests = [], loading: requestsLoading } = useCollection<DisposeRequest & { id: string }>(
    userProfile ? `users/${userProfile.uid}/disposeRequests` : ""
  );

  const inStockInventory = inventory.filter((item) => item.quantity > 0);
  const selectedProduct = inStockInventory.find((p) => p.id === selectedProductId);
  const maxQty = selectedProduct?.quantity ?? 0;

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    if (typeof date === 'string') return format(new Date(date), "MMM dd, yyyy");
    if (date.seconds) return format(new Date(date.seconds * 1000), "MMM dd, yyyy");
    return "N/A";
  };

  const getRequestDate = (req: DisposeRequest) => {
    const raw = req.requestedAt;
    if (!raw) return null;
    if (typeof raw === 'string') return new Date(raw).getTime();
    if (raw.seconds) return raw.seconds * 1000;
    return null;
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

  const pendingCount = disposeRequests.filter((r) => r.status === "pending").length;
  const approvedCount = disposeRequests.filter((r) => r.status === "approved").length;
  const rejectedCount = disposeRequests.filter((r) => r.status === "rejected").length;
  const totalCount = disposeRequests.length;

  const filteredDisposeRequests = disposeRequests.filter((req) => {
    const searchLower = recycleSearch.toLowerCase();
    const matchesSearch =
      !recycleSearch.trim() ||
      (req.productName && req.productName.toLowerCase().includes(searchLower)) ||
      (req.reason && req.reason.toLowerCase().includes(searchLower));
    const reqDateMs = getRequestDate(req);
    const matchesDate = !reqDateMs ? true : matchesDateFilter({ seconds: reqDateMs / 1000 }, recycleDateFilter);
    const matchesStatus =
      recycleStatusFilter === "all" || req.status === recycleStatusFilter;
    return matchesSearch && matchesDate && matchesStatus;
  });

  const sortedRequests = [...filteredDisposeRequests].sort((a, b) => (getRequestDate(b) ?? 0) - (getRequestDate(a) ?? 0));
  const totalRecords = sortedRequests.length;
  const totalRecyclePages = Math.ceil(totalRecords / itemsPerPage);
  const startRecycleIndex = (recyclePage - 1) * itemsPerPage;
  const endRecycleIndex = startRecycleIndex + itemsPerPage;
  const paginatedList = sortedRequests.slice(startRecycleIndex, endRecycleIndex);
  const resetRecyclePagination = () => setRecyclePage(1);

  const handleSubmitDisposeRequest = async () => {
    if (!userProfile || !selectedProduct) return;
    const qty = parseInt(disposeQuantity, 10);
    if (!Number.isFinite(qty) || qty < 1 || qty > maxQty) {
      toast({ variant: "destructive", title: "Invalid quantity", description: `Enter a quantity between 1 and ${maxQty}.` });
      return;
    }
    if (!disposeReason.trim()) {
      toast({ variant: "destructive", title: "Reason required", description: "Please enter why you want to dispose this quantity." });
      return;
    }
    setSubmitting(true);
    try {
      const ref = collection(db, `users/${userProfile.uid}/disposeRequests`);
      await addDoc(ref, {
        productId: selectedProduct.id,
        productName: selectedProduct.productName,
        quantity: qty,
        reason: disposeReason.trim(),
        status: "pending",
        requestedAt: serverTimestamp(),
      });
      toast({ title: "Request submitted", description: "Your dispose request has been sent. An admin will review it." });
      setRequestDialogOpen(false);
      setSelectedProductId("");
      setDisposeQuantity("");
      setDisposeReason("");
    } catch (err: unknown) {
      toast({ variant: "destructive", title: "Failed to submit", description: err instanceof Error ? err.message : "Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-orange-500 to-amber-600 text-white pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <RotateCcw className="h-6 w-6" />
                Disposed Inventory
              </CardTitle>
              <CardDescription className="text-orange-100 mt-2">
                View disposed items or request to dispose inventory ({totalRecords} records)
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="bg-white text-orange-600 hover:bg-orange-50 shadow-md">
                    <Plus className="h-4 w-4 mr-2" />
                    Request dispose
                  </Button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-md">
                  <DialogHeader>
                    <DialogTitle>Request to dispose inventory</DialogTitle>
                    <DialogDescription>
                      Select a product, quantity, and reason. An admin will approve or reject your request.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label>Product</Label>
                      <Select value={selectedProductId} onValueChange={(v) => { setSelectedProductId(v); setDisposeQuantity(""); }}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select product" />
                        </SelectTrigger>
                        <SelectContent>
                          {inStockInventory.map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.productName} (available: {p.quantity})
                            </SelectItem>
                          ))}
                          {inStockInventory.length === 0 && (
                            <SelectItem value="_none" disabled>No products in stock</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                    {selectedProduct && (
                      <>
                        <div className="space-y-2">
                          <Label>Quantity (max {maxQty})</Label>
                          <Input
                            type="number"
                            min={1}
                            max={maxQty}
                            value={disposeQuantity}
                            onChange={(e) => setDisposeQuantity(e.target.value)}
                            placeholder="e.g. 5"
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Reason</Label>
                          <Textarea
                            value={disposeReason}
                            onChange={(e) => setDisposeReason(e.target.value)}
                            placeholder="Why do you want to dispose this quantity?"
                            rows={3}
                          />
                        </div>
                      </>
                    )}
                    <div className="flex justify-end gap-2 pt-2">
                      <Button variant="outline" onClick={() => setRequestDialogOpen(false)}>Cancel</Button>
                      <Button
                        onClick={handleSubmitDisposeRequest}
                        disabled={!selectedProduct || !disposeQuantity || !disposeReason.trim() || submitting}
                      >
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        Submit request
                      </Button>
                    </div>
                  </div>
                </DialogContent>
              </Dialog>
              <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0">
                <RotateCcw className="h-7 w-7 text-white" />
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          {/* Stat cards */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
            <Card
              role="button"
              tabIndex={0}
              onClick={() => { setRecycleStatusFilter("pending"); setRecyclePage(1); }}
              onKeyDown={(e) => e.key === "Enter" && (setRecycleStatusFilter("pending"), setRecyclePage(1))}
              className="border-2 border-amber-200/50 bg-gradient-to-br from-amber-50 to-orange-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-amber-900">Pending</CardTitle>
                <div className="h-10 w-10 rounded-full bg-amber-500 flex items-center justify-center shadow-md">
                  <Clock className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {requestsLoading ? (
                  <div className="h-8 w-12 bg-muted animate-pulse rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-amber-900">{pendingCount}</div>
                    <p className="text-xs text-amber-700 mt-1">Awaiting review</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => { setRecycleStatusFilter("approved"); setRecyclePage(1); }}
              onKeyDown={(e) => e.key === "Enter" && (setRecycleStatusFilter("approved"), setRecyclePage(1))}
              className="border-2 border-green-200/50 bg-gradient-to-br from-green-50 to-green-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-green-900">Approved</CardTitle>
                <div className="h-10 w-10 rounded-full bg-green-500 flex items-center justify-center shadow-md">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {requestsLoading ? (
                  <div className="h-8 w-12 bg-muted animate-pulse rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-green-900">{approvedCount}</div>
                    <p className="text-xs text-green-700 mt-1">Disposed</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => { setRecycleStatusFilter("rejected"); setRecyclePage(1); }}
              onKeyDown={(e) => e.key === "Enter" && (setRecycleStatusFilter("rejected"), setRecyclePage(1))}
              className="border-2 border-red-200/50 bg-gradient-to-br from-red-50 to-red-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-red-900">Rejected</CardTitle>
                <div className="h-10 w-10 rounded-full bg-red-500 flex items-center justify-center shadow-md">
                  <XCircle className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {requestsLoading ? (
                  <div className="h-8 w-12 bg-muted animate-pulse rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-red-900">{rejectedCount}</div>
                    <p className="text-xs text-red-700 mt-1">Not approved</p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card
              role="button"
              tabIndex={0}
              onClick={() => { setRecycleStatusFilter("all"); setRecyclePage(1); }}
              onKeyDown={(e) => e.key === "Enter" && (setRecycleStatusFilter("all"), setRecyclePage(1))}
              className="border-2 border-slate-200/50 bg-gradient-to-br from-slate-50 to-slate-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-slate-900">Total</CardTitle>
                <div className="h-10 w-10 rounded-full bg-slate-500 flex items-center justify-center shadow-md">
                  <FileStack className="h-5 w-5 text-white" />
                </div>
              </CardHeader>
              <CardContent>
                {requestsLoading ? (
                  <div className="h-8 w-12 bg-muted animate-pulse rounded" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-slate-900">{totalCount}</div>
                    <p className="text-xs text-slate-700 mt-1">All requests</p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6 pb-6 border-b">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by product name or reason..."
                  value={recycleSearch}
                  onChange={(e) => setRecycleSearch(e.target.value)}
                  className="pl-10 h-11 shadow-sm"
                />
                {recycleSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setRecycleSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground" />
              <Select value={recycleDateFilter} onValueChange={(value) => {
                setRecycleDateFilter(value);
                resetRecyclePagination();
              }}>
                <SelectTrigger className="w-full sm:w-[200px] h-11 shadow-sm">
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
          </div>

          {/* Content */}
          {requestsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-32 bg-muted animate-pulse rounded-xl" />
              ))}
            </div>
          ) : totalRecords > 0 ? (
            <div className="space-y-2">
              {paginatedList.map((item) => (
                <div
                  key={`request-${item.id}`}
                  className="rounded-lg border border-amber-200 bg-amber-50/40 px-3 py-2 sm:px-4"
                >
                  <div className="flex items-center gap-2 sm:gap-3 min-w-0 text-xs sm:text-sm">
                    <h3 className="font-semibold text-gray-900 truncate min-w-0 max-w-[180px] sm:max-w-[240px] lg:max-w-[300px] shrink-0">
                      {item.productName}
                    </h3>
                    <p className="text-amber-800 truncate min-w-0 flex-1">
                      <span className="font-semibold text-amber-700">Reason:</span> {item.reason || "—"}
                      {item.adminFeedback ? ` | Admin: ${item.adminFeedback}` : ""}
                    </p>
                    <Badge className="bg-amber-500 text-white text-[10px] sm:text-xs shrink-0">
                      Qty: {item.quantity}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={`text-[10px] sm:text-xs shrink-0 ${
                        item.status === "pending"
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : item.status === "approved"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                            : "bg-red-100 text-red-800 border-red-300"
                      }`}
                    >
                      {item.status.charAt(0).toUpperCase() + item.status.slice(1)}
                    </Badge>
                    <span className="text-xs text-gray-600 shrink-0">
                      {formatDate(item.requestedAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-16">
              <div className="mx-auto h-20 w-20 rounded-full bg-orange-100 flex items-center justify-center mb-4">
                <RotateCcw className="h-10 w-10 text-orange-600" />
              </div>
              <h3 className="text-xl font-bold mb-2">No dispose requests</h3>
              <p className="text-muted-foreground">
                {disposeRequests.length === 0
                  ? "Use \"Request dispose\" to submit a request. An admin will review it."
                  : "No requests match your filters."}
              </p>
            </div>
          )}
          
          {/* Pagination */}
          {totalRecords > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-6 pt-6 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {startRecycleIndex + 1} to {Math.min(endRecycleIndex, totalRecords)} of {totalRecords} records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecyclePage(p => Math.max(1, p - 1))}
                  disabled={recyclePage === 1}
                  className="shadow-sm"
                >
                  Previous
                </Button>
                <span className="text-sm font-medium px-3">
                  Page {recyclePage} of {totalRecyclePages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecyclePage(p => Math.min(totalRecyclePages, p + 1))}
                  disabled={recyclePage === totalRecyclePages}
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
