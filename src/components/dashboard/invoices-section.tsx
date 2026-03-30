"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Download, CheckCircle, Clock, X, Eye, DollarSign, Receipt } from "lucide-react";
import { format } from "date-fns";
import { generateInvoicePDF } from "@/lib/invoice-generator";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import type { Invoice } from "@/types";
import { createCommissionForInvoice } from "@/lib/commission-utils";

interface InvoicesSectionProps {
  invoices: Invoice[];
  loading: boolean;
  /** When set with `onActiveStatusTabChange`, the Pending/Paid tab is controlled by the parent (e.g. stat cards). */
  activeStatusTab?: "pending" | "paid";
  onActiveStatusTabChange?: (tab: "pending" | "paid") => void;
}

export function InvoicesSection({
  invoices,
  loading,
  activeStatusTab,
  onActiveStatusTabChange,
}: InvoicesSectionProps) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [internalActiveTab, setInternalActiveTab] = useState<"pending" | "paid">("pending");
  const isControlled = activeStatusTab !== undefined && onActiveStatusTabChange !== undefined;
  const activeTab = isControlled ? activeStatusTab! : internalActiveTab;
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  const pendingInvoices = invoices.filter(inv => inv.status === 'pending');
  const paidInvoices = invoices.filter(inv => inv.status === 'paid');
  
  // Enhanced filtering with search, date range, and preset filters
  const filteredInvoices = invoices.filter(inv => {
    // Search filter
    const matchesSearch = searchTerm === "" || 
      inv.invoiceNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
      inv.soldTo.name.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Date range filter
    let matchesDateRange = true;
    if (startDate || endDate) {
      const invoiceDate = new Date(inv.date);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      
      if (start && end) {
        matchesDateRange = invoiceDate >= start && invoiceDate <= end;
      } else if (start) {
        matchesDateRange = invoiceDate >= start;
      } else if (end) {
        matchesDateRange = invoiceDate <= end;
      }
    }
    
    // Preset date filter
    let matchesPresetDate = true;
    if (dateFilter !== "all") {
      const invoiceDate = typeof inv.createdAt === 'string' 
        ? new Date(inv.createdAt) 
        : new Date(inv.createdAt.seconds * 1000);
      const now = new Date();
      const daysDiff = Math.floor((now.getTime() - invoiceDate.getTime()) / (1000 * 60 * 60 * 24));
      
      switch (dateFilter) {
        case "today":
          matchesPresetDate = daysDiff === 0;
          break;
        case "week":
          matchesPresetDate = daysDiff <= 7;
          break;
        case "month":
          matchesPresetDate = daysDiff <= 30;
          break;
        case "year":
          matchesPresetDate = daysDiff <= 365;
          break;
        default:
          matchesPresetDate = true;
      }
    }
    
    return matchesSearch && matchesDateRange && matchesPresetDate;
  });

  const filteredPendingInvoices = filteredInvoices.filter(inv => inv.status === 'pending');
  const filteredPaidInvoices = filteredInvoices.filter(inv => inv.status === 'paid');
  
  // Get current tab invoices
  const getCurrentTabInvoices = () => {
    return activeTab === "pending" ? filteredPendingInvoices : filteredPaidInvoices;
  };

  const currentTabInvoices = getCurrentTabInvoices();
  
  // Pagination calculations
  const totalPages = Math.ceil(currentTabInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;

  const paginatedInvoices = currentTabInvoices
    .sort((a, b) => {
      const dateA = typeof a.createdAt === 'string' ? new Date(a.createdAt) : new Date(a.createdAt.seconds * 1000);
      const dateB = typeof b.createdAt === 'string' ? new Date(b.createdAt) : new Date(b.createdAt.seconds * 1000);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(startIndex, endIndex);

  // Reset pagination when filters or tab changes
  const resetPagination = () => {
    setCurrentPage(1);
  };

  // Reset to page 1 when tab changes
  const handleTabChange = (value: string) => {
    const next = value as "pending" | "paid";
    if (isControlled) {
      onActiveStatusTabChange!(next);
    } else {
      setInternalActiveTab(next);
    }
    setCurrentPage(1);
  };

  // Reset pagination when search or date filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, dateFilter, startDate, endDate]);

  useEffect(() => {
    if (!isControlled) return;
    setCurrentPage(1);
  }, [activeStatusTab, isControlled]);
  
  const handleViewInvoice = async (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsViewDialogOpen(true);
  };

  const handleDownloadInvoice = async (invoice: Invoice) => {
    try {
      console.log("Starting PDF generation for invoice:", invoice.invoiceNumber);
      console.log("Invoice type:", (invoice as any).type);
      console.log("Items count:", invoice.items?.length);
      
      await generateInvoicePDF({
        invoiceNumber: invoice.invoiceNumber,
        date: invoice.date,
        orderNumber: invoice.orderNumber,
        soldTo: invoice.soldTo,
        fbm: invoice.fbm,
        items: invoice.items,
        isContainerHandling: (invoice as any).isContainerHandling,
        type: (invoice as any).type,
        storageType: (invoice as any).storageType,
        additionalServices: (invoice as any).additionalServices,
        subtotal: invoice.subtotal,
        grandTotal: invoice.grandTotal,
        grossTotal: (invoice as any).grossTotal,
        discountType: (invoice as any).discountType,
        discountValue: (invoice as any).discountValue,
        discountAmount: (invoice as any).discountAmount,
      });
      
      toast({
        title: "Invoice Downloaded",
        description: `${invoice.invoiceNumber} has been downloaded.`,
      });
    } catch (error) {
      console.error("Error downloading invoice:", error);
      const errorMessage = error instanceof Error ? error.message : "Unknown error occurred";
      console.error("Full error details:", {
        error,
        invoiceNumber: invoice.invoiceNumber,
        invoiceType: (invoice as any).type,
        itemsCount: invoice.items?.length,
      });
      toast({
        variant: "destructive",
        title: "Error",
        description: `Failed to download invoice: ${errorMessage}`,
      });
    }
  };

  const handleMarkAsPaid = async (invoiceId: string, invoice: Invoice) => {
    try {
      // Update invoice in user's invoices collection
      await updateDoc(doc(db, `users/${invoice.userId}/invoices/${invoiceId}`), {
        status: 'paid',
      });
      
      // Create commission if user was referred by an agent
      if (userProfile && invoice.status === 'pending') {
        try {
          await createCommissionForInvoice(invoice, userProfile);
        } catch (commissionError) {
          console.error("Error creating commission:", commissionError);
          // Don't fail the whole operation if commission creation fails
        }
      }
      
      toast({
        title: "Invoice Marked as Paid",
        description: "Invoice status has been updated.",
      });
    } catch (error) {
      console.error("Error updating invoice:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update invoice status.",
      });
    }
  };

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    if (typeof date === 'string') return format(new Date(date), "MMM dd, yyyy");
    return format(new Date(date.seconds * 1000), "MMM dd, yyyy");
  };

  return (
    <div className="space-y-6">
      {/* Professional Search and Filter Bar */}
      {invoices.length > 0 && (
        <Card>
          <CardContent className="pt-6 space-y-4">
            {/* First Row: Search, Status, Date Filters */}
            <div className="flex flex-col sm:flex-row gap-4">
              {/* Search Input */}
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by invoice number or customer name..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    resetPagination();
                  }}
                  className="pl-10"
                />
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => {
                      setSearchTerm("");
                      resetPagination();
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              
              {/* Date Filter */}
              <div className="sm:w-48">
                <Select value={dateFilter} onValueChange={(value) => {
                  setDateFilter(value);
                  resetPagination();
                }}>
                  <SelectTrigger>
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
            
            {/* Second Row: Date Range Filter */}
            <div className="border-t pt-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">From Date</label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      resetPagination();
                    }}
                    className="w-full"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">To Date</label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => {
                      setEndDate(e.target.value);
                      resetPagination();
                    }}
                    className="w-full"
                  />
                </div>
              </div>
              {(startDate || endDate) && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                    resetPagination();
                  }}
                  className="mt-3 w-full sm:w-auto"
                >
                  Clear Date Range Filter
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Invoices with Tabs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Receipt className="h-5 w-5" />
            Invoices
          </CardTitle>
          <CardDescription>View and manage your invoices</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-12 p-1 rounded-xl bg-slate-100/90 border">
              <TabsTrigger
                value="pending"
                className="rounded-lg font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-amber-700 data-[state=active]:shadow-sm"
              >
                <div className="flex items-center justify-center gap-2">
                  <Clock className="h-4 w-4" />
                  <span>Pending</span>
                  <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                    {filteredPendingInvoices.length}
                  </span>
                </div>
              </TabsTrigger>
              <TabsTrigger
                value="paid"
                className="rounded-lg font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
              >
                <div className="flex items-center justify-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  <span>Paid</span>
                  <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                    {filteredPaidInvoices.length}
                  </span>
                </div>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="mt-6">
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : currentTabInvoices.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {paginatedInvoices.map((invoice) => (
                      <div key={invoice.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border rounded-lg bg-yellow-50">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 sm:mb-2">
                            <h3 className="font-semibold text-sm sm:text-base truncate">{invoice.invoiceNumber}</h3>
                            <Badge variant="secondary" className="text-[10px] sm:text-xs">Pending</Badge>
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
                            <p>Date: {invoice.date}</p>
                            <p className="font-semibold text-sm sm:text-lg">Total: ${invoice.grandTotal.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex sm:flex-row sm:flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-9"
                            onClick={() => handleViewInvoice(invoice)}
                          >
                            <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                            <span>View</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-9"
                            onClick={() => handleDownloadInvoice(invoice)}
                          >
                            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                            <span>Download</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Pagination */}
                  {currentTabInvoices.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-6 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">
                        Showing {startIndex + 1} to {Math.min(endIndex, currentTabInvoices.length)} of {currentTabInvoices.length} invoices
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-sm">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <Clock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No pending invoices</h3>
                  <p className="text-muted-foreground">
                    {pendingInvoices.length === 0 ? "You don't have any pending invoices." : "No pending invoices match your search."}
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="paid" className="mt-6">
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : currentTabInvoices.length > 0 ? (
                <>
                  <div className="space-y-3">
                    {paginatedInvoices.map((invoice) => (
                      <div key={invoice.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3 sm:p-4 border rounded-lg bg-green-50">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1 sm:mb-2">
                            <h3 className="font-semibold text-sm sm:text-base truncate">{invoice.invoiceNumber}</h3>
                            <Badge variant="outline" className="bg-green-100 text-green-800 border-green-300 text-[10px] sm:text-xs">Paid</Badge>
                          </div>
                          <div className="text-xs sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
                            <p>Date: {invoice.date}</p>
                            <p className="font-semibold text-sm sm:text-lg">Total: ${invoice.grandTotal.toFixed(2)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2 w-full sm:w-auto sm:flex sm:flex-row sm:flex-wrap">
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-9"
                            onClick={() => handleViewInvoice(invoice)}
                          >
                            <Eye className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                            <span>View</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full sm:w-auto text-xs sm:text-sm h-9 sm:h-9"
                            onClick={() => handleDownloadInvoice(invoice)}
                          >
                            <Download className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1.5 sm:mr-2" />
                            <span>Download</span>
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Pagination */}
                  {currentTabInvoices.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-6 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">
                        Showing {startIndex + 1} to {Math.min(endIndex, currentTabInvoices.length)} of {currentTabInvoices.length} invoices
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-sm">
                          Page {currentPage} of {totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                          disabled={currentPage === totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8">
                  <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No paid invoices</h3>
                  <p className="text-muted-foreground">
                    {paidInvoices.length === 0 ? "You don't have any paid invoices yet." : "No paid invoices match your search."}
                  </p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* View Invoice Dialog */}
      <Dialog open={isViewDialogOpen} onOpenChange={setIsViewDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-4xl h-[100dvh] sm:h-auto sm:max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="pb-2 sm:pb-4">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Receipt className="h-4 w-4 sm:h-5 sm:w-5" />
              Invoice Details
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              View complete invoice information
            </DialogDescription>
          </DialogHeader>
          
          {selectedInvoice && (
            <div className="space-y-4 sm:space-y-6 mt-2 sm:mt-4">
              {(() => {
                const type = (selectedInvoice as any).type;
                const isStorage = type === "storage";
                if (!isStorage) return null;

                const storageType = (selectedInvoice as any).storageType as string | undefined;
                const invoiceMonth = (selectedInvoice as any).invoiceMonth as string | undefined;
                const palletCount = (selectedInvoice as any).palletCount as number | undefined;
                const itemCount = (selectedInvoice as any).itemCount as number | undefined;

                const firstItem = selectedInvoice.items?.[0] as any;
                const unitPrice = Number(firstItem?.unitPrice || 0);

                return (
                  <div className="p-3 sm:p-4 border rounded-lg">
                    <h4 className="font-semibold text-sm sm:text-base mb-2">Storage Details</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs sm:text-sm">
                      <div>
                        <p className="text-muted-foreground">Storage Type</p>
                        <p className="font-medium">{storageType || "-"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Invoice Month</p>
                        <p className="font-medium">{invoiceMonth || "-"}</p>
                      </div>
                      {storageType === "pallet_base" ? (
                        <>
                          <div>
                            <p className="text-muted-foreground">Pallet Count</p>
                            <p className="font-medium">{typeof palletCount === "number" ? palletCount : (typeof itemCount === "number" ? itemCount : "-")}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Price Per Pallet</p>
                            <p className="font-medium">${unitPrice.toFixed(2)}</p>
                          </div>
                        </>
                      ) : (
                        <>
                          <div>
                            <p className="text-muted-foreground">Item Count</p>
                            <p className="font-medium">{typeof itemCount === "number" ? itemCount : "-"}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Price Per Item</p>
                            <p className="font-medium">${unitPrice.toFixed(2)}</p>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Invoice Header */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 p-3 sm:p-4 bg-muted rounded-lg">
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Invoice Number</p>
                  <p className="font-semibold text-sm sm:text-base break-all">{selectedInvoice.invoiceNumber}</p>
                </div>
                <div>
                  <p className="text-xs sm:text-sm text-muted-foreground">Date</p>
                  <p className="font-semibold text-sm sm:text-base">{selectedInvoice.date}</p>
                </div>
                <div className="sm:col-span-2">
                  <p className="text-xs sm:text-sm text-muted-foreground">Status</p>
                  <Badge variant={selectedInvoice.status === 'paid' ? 'default' : 'secondary'} className="text-xs sm:text-sm mt-1">
                    {selectedInvoice.status.toUpperCase()}
                  </Badge>
                </div>
              </div>

              {/* Sold To and FBM */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
                <div className="p-3 sm:p-4 border rounded-lg">
                  <h4 className="font-semibold text-sm sm:text-base mb-1.5 sm:mb-2">Sold To</h4>
                  <p className="text-xs sm:text-sm">{selectedInvoice.soldTo.name}</p>
                  {selectedInvoice.soldTo.address && <p className="text-xs sm:text-sm text-muted-foreground break-words">{selectedInvoice.soldTo.address}</p>}
                  {selectedInvoice.soldTo.phone && <p className="text-xs sm:text-sm text-muted-foreground">{selectedInvoice.soldTo.phone}</p>}
                  <p className="text-xs sm:text-sm text-muted-foreground break-all">{selectedInvoice.soldTo.email}</p>
                </div>
                <div className="p-3 sm:p-4 border rounded-lg">
                  <h4 className="font-semibold text-sm sm:text-base mb-1.5 sm:mb-2">Service</h4>
                  <p className="text-xs sm:text-sm text-muted-foreground">{selectedInvoice.fbm}</p>
                </div>
              </div>

              {/* Items Table - Desktop */}
              <div className="hidden sm:block border rounded-lg overflow-hidden">
                {(() => {
                  const isStorageInvoice = (selectedInvoice as any).type === 'storage';
                  const isContainerHandling = (selectedInvoice as any).isContainerHandling || (selectedInvoice as any).type === 'container_handling';
                  const storageType = (selectedInvoice as any).storageType as string | undefined;
                  const isProductBaseStorage = storageType === 'product_base';
                  
                  // Use explicit grid template columns for better control
                  const gridTemplateCols = isStorageInvoice 
                    ? 'grid-cols-[60px_1fr_100px_120px_100px]' 
                    : (isContainerHandling 
                      ? 'grid-cols-[60px_1fr_120px_120px_100px_100px]' 
                      : 'grid-cols-[60px_1fr_100px_120px_100px_100px_100px_100px]');
                  
                  return (
                    <>
                      <div className={`bg-muted p-2 grid ${gridTemplateCols} gap-2 text-sm font-semibold`}>
                        <div>Qty</div>
                        <div>Product</div>
                        <div>{isStorageInvoice ? 'Date' : (isContainerHandling ? 'Receiving Date' : 'Ship Date')}</div>
                        {!isStorageInvoice && !isContainerHandling && (
                          <>
                            <div>SKU</div>
                            <div>Packaging</div>
                          </>
                        )}
                        <div>{isStorageInvoice ? (isProductBaseStorage ? 'Price per Item' : 'Price per Pallet') : 'Unit Price'}</div>
                        <div>Amount</div>
                      </div>
                      {selectedInvoice.items.map((item, idx) => {
                        const dateValue = isContainerHandling && (item as any).receivingDate 
                          ? (item as any).receivingDate 
                          : ((item as any).shipDate || '-');
                        const productName = (item as any).productName || (item as any).description || "—";
                        const sku = (item as any).sku || "—";
                        const packaging = (item as any).packaging || "—";
                        return (
                          <div key={`${productName}-${idx}`} className={`p-2 grid ${gridTemplateCols} gap-2 text-sm border-t`}>
                            <div>{(item as any).quantity}</div>
                            <div className="truncate" title={productName}>{productName}</div>
                            <div>{dateValue}</div>
                            {!isStorageInvoice && !isContainerHandling && (
                              <>
                                <div className="truncate" title={sku}>{sku}</div>
                                <div>{packaging}</div>
                              </>
                            )}
                            <div className="text-right">${Number((item as any).unitPrice || 0).toFixed(2)}</div>
                            <div className="font-semibold text-right">${Number((item as any).amount || 0).toFixed(2)}</div>
                          </div>
                        );
                      })}
                    </>
                  );
                })()}
              </div>

              {/* Items Cards - Mobile */}
              <div className="sm:hidden space-y-3">
                <h4 className="font-semibold text-sm mb-2">Items</h4>
                {selectedInvoice.items.map((item, idx) => {
                  const isStorageInvoice = (selectedInvoice as any).type === 'storage';
                  const isContainerHandling = (selectedInvoice as any).isContainerHandling || (selectedInvoice as any).type === 'container_handling';
                  const baseProductName = (item as any).productName || (item as any).description || "—";
                  // For shipment invoices, append SKU if available
                  const productName = !isStorageInvoice && !isContainerHandling && (item as any).sku
                    ? `${baseProductName} (SKU: ${(item as any).sku})`
                    : baseProductName;
                  return (
                  <div key={`${productName}-${idx}`} className="border rounded-lg p-3 bg-muted/30 space-y-2">
                    <div className="flex justify-between items-start">
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm truncate">{productName}</p>
                        <p className="text-xs text-muted-foreground">Qty: {(item as any).quantity}</p>
                      </div>
                      <div className="text-right ml-2">
                        <p className="font-semibold text-sm">${Number((item as any).amount || 0).toFixed(2)}</p>
                        <p className="text-xs text-muted-foreground">
                          {(() => {
                            const invoiceType = (selectedInvoice as any).type;
                            const storageType = (selectedInvoice as any).storageType;
                            if (invoiceType === 'storage') {
                              return storageType === 'product_base' ? 'Price per Item' : 'Price per Pallet';
                            }
                            return 'Unit Price';
                          })()}: ${Number((item as any).unitPrice || 0).toFixed(2)}
                        </p>
                      </div>
                    </div>
                    {(() => {
                      const isStorageInvoice = (selectedInvoice as any).type === 'storage';
                      const isContainerHandling = (selectedInvoice as any).isContainerHandling || (selectedInvoice as any).type === 'container_handling';
                      return (
                        <div className={`grid ${isStorageInvoice || isContainerHandling ? 'grid-cols-1' : 'grid-cols-2'} gap-2 pt-2 border-t text-xs`}>
                          <div>
                            <p className="text-muted-foreground">{isStorageInvoice ? 'Date' : (isContainerHandling ? 'Receiving Date' : 'Ship Date')}</p>
                            <p className="font-medium">
                              {isContainerHandling && (item as any).receivingDate
                                ? (item as any).receivingDate
                                : (((item as any).shipDate) || '-')}
                            </p>
                          </div>
                          {!isStorageInvoice && !isContainerHandling && (
                            <>
                              <div>
                                <p className="text-muted-foreground">SKU</p>
                                <p className="font-medium">{(item as any).sku || "—"}</p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Packaging</p>
                                <p className="font-medium">{(item as any).packaging || "—"}</p>
                              </div>
                            </>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                  );
                })}
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-full sm:w-64 space-y-2">
                  {(() => {
                    const additionalTotal = Number((selectedInvoice as any)?.additionalServices?.total || 0);
                    const itemsSubtotal = selectedInvoice.items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
                    const grossTotal =
                      typeof (selectedInvoice as any).grossTotal === "number"
                        ? (selectedInvoice as any).grossTotal
                        : itemsSubtotal + (Number.isFinite(additionalTotal) ? additionalTotal : 0);
                    const discountType = (selectedInvoice as any).discountType as ("amount" | "percent" | undefined);
                    const discountValue = (selectedInvoice as any).discountValue as (number | undefined);
                    const storedDiscountAmount = (selectedInvoice as any).discountAmount as (number | undefined);

                    let discountAmount = 0;
                    if (typeof storedDiscountAmount === "number") {
                      discountAmount = storedDiscountAmount;
                    } else if (discountType === "percent" && typeof discountValue === "number") {
                      discountAmount = grossTotal * (discountValue / 100);
                    } else if (discountType === "amount" && typeof discountValue === "number") {
                      discountAmount = discountValue;
                    }
                    discountAmount = Math.max(0, Math.min(grossTotal, discountAmount || 0));
                    const hasDiscount = discountAmount > 0.009;
                    const discountLabel =
                      discountType === "percent" && typeof discountValue === "number"
                        ? `Discount (${discountValue.toFixed(2)}%)`
                        : "Discount";

                    return (
                      <>
                        {additionalTotal > 0.0001 && (
                          <>
                            <div className="flex justify-between text-xs sm:text-sm">
                              <span>Items Subtotal:</span>
                              <span className="font-semibold">${itemsSubtotal.toFixed(2)}</span>
                            </div>
                            <div className="flex justify-between text-xs sm:text-sm">
                              <span>Additional Services:</span>
                              <span className="font-semibold">${additionalTotal.toFixed(2)}</span>
                            </div>
                          </>
                        )}
                        <div className="flex justify-between text-xs sm:text-sm">
                          <span>Gross Total:</span>
                          <span className="font-semibold">${grossTotal.toFixed(2)}</span>
                        </div>
                        {hasDiscount && (
                          <div className="flex justify-between text-xs sm:text-sm">
                            <span>{discountLabel}:</span>
                            <span className="font-semibold">-${discountAmount.toFixed(2)}</span>
                          </div>
                        )}
                      </>
                    );
                  })()}
                  <div className="flex justify-between text-xs sm:text-sm text-muted-foreground">
                    <span>NJ Sales Tax 6.625% - Excluded</span>
                    <span>-</span>
                  </div>
                  <div className="flex justify-between pt-2 border-t font-bold text-base sm:text-lg">
                    <span>Grand Total:</span>
                    <span>${selectedInvoice.grandTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col sm:flex-row justify-end gap-2 pt-3 sm:pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs sm:text-sm h-8 sm:h-9 w-full sm:w-auto"
                  onClick={() => selectedInvoice && handleDownloadInvoice(selectedInvoice)}
                >
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  Download PDF
                </Button>
                {/* PDF upload/view buttons moved to PDF section */}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
