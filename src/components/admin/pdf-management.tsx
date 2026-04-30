"use client";

import { useState, useMemo } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Search, FileText, X, Eye, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCollection } from "@/hooks/use-collection";
import type { UploadedPDF, InventoryItem } from "@/types";
import { ShipInventoryForm } from "@/components/admin/ship-inventory-form";
import { useToast } from "@/hooks/use-toast";
// Google Drive integration - no Firebase Storage imports needed

interface PDFManagementProps {
  pdfs: UploadedPDF[];
  loading: boolean;
}

export function PDFManagement({ pdfs, loading }: PDFManagementProps) {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [clientFilter, setClientFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedPDF, setSelectedPDF] = useState<UploadedPDF | null>(null);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [viewURL, setViewURL] = useState<string | null>(null);
  const [loadingViewURL, setLoadingViewURL] = useState(false);
  const [activeTab, setActiveTab] = useState<"pending" | "complete">("pending");
  const [selectedLabelForComplete, setSelectedLabelForComplete] = useState<UploadedPDF | null>(null);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const itemsPerPage = 10;

  // Helper function to check if PDF matches date filter
  const matchesDateFilter = (pdf: UploadedPDF, filter: string): boolean => {
    if (filter === "all") return true;
    
    if (!pdf.uploadedAt) return false;
    
    const pdfDate =
      typeof pdf.uploadedAt === "string"
        ? new Date(pdf.uploadedAt)
        : pdf.uploadedAt.seconds
        ? new Date(pdf.uploadedAt.seconds * 1000)
        : null;

    if (!pdfDate) return false;

    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - pdfDate.getTime()) / (1000 * 60 * 60 * 24));

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

  // Filter PDFs by status (pending/complete) - MUST be declared first
  const filteredPDFsByStatus = useMemo(() => {
    return pdfs.filter((pdf) => {
      const status = pdf.status || "pending";
      return status === activeTab;
    });
  }, [pdfs, activeTab]);

  // Get unique client names for filter based on date filter
  const clientNames = useMemo(() => {
    // First filter PDFs by status and date if date filter is active
    const dateFilteredPDFs = dateFilter === "all" 
      ? filteredPDFsByStatus 
      : filteredPDFsByStatus.filter((pdf) => matchesDateFilter(pdf, dateFilter));
    
    // Then get unique client names from filtered PDFs
    const names = new Set(dateFilteredPDFs.map((pdf) => pdf.uploadedByName).filter(Boolean));
    return Array.from(names).sort();
  }, [filteredPDFsByStatus, dateFilter]);

  // Filter PDFs
  const filteredPDFs = useMemo(() => {
    return filteredPDFsByStatus.filter((pdf) => {
      // Search filter
      const matchesSearch =
        searchTerm === "" ||
        pdf.fileName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        pdf.uploadedByName.toLowerCase().includes(searchTerm.toLowerCase());

      // Client filter
      const matchesClient = clientFilter === "all" || pdf.uploadedByName === clientFilter;

      // Date filter
      const matchesDate = matchesDateFilter(pdf, dateFilter);

      return matchesSearch && matchesClient && matchesDate;
    });
  }, [filteredPDFsByStatus, searchTerm, dateFilter, clientFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredPDFs.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;

  const paginatedPDFs = filteredPDFs
    .sort((a, b) => {
      // Handle null/undefined uploadedAt
      if (!a.uploadedAt) return 1;
      if (!b.uploadedAt) return -1;

      const dateA =
        typeof a.uploadedAt === "string"
          ? new Date(a.uploadedAt)
          : a.uploadedAt.seconds
          ? new Date(a.uploadedAt.seconds * 1000)
          : new Date(0);
      const dateB =
        typeof b.uploadedAt === "string"
          ? new Date(b.uploadedAt)
          : b.uploadedAt.seconds
          ? new Date(b.uploadedAt.seconds * 1000)
          : new Date(0);
      return dateB.getTime() - dateA.getTime();
    })
    .slice(startIndex, endIndex);

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    if (typeof date === "string") return format(new Date(date), "MMM dd, yyyy");
    if (date.seconds) return format(new Date(date.seconds * 1000), "MMM dd, yyyy");
    return "N/A";
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
  };

  const handleView = async (pdf: UploadedPDF) => {
    setIsViewDialogOpen(true);
    setViewURL(null);
    setLoadingViewURL(true);
    
    let hydratedPdf: UploadedPDF = pdf;

    try {
      // Fetch fresh data from Firestore to get latest product details
      if (pdf.id) {
        const docRef = doc(db, "uploadedPDFs", pdf.id);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          hydratedPdf = { id: pdf.id, ...(docSnap.data() as UploadedPDF) };
        }
      }

      setSelectedPDF(hydratedPdf);

      // Fetch viewable URL from API
      const response = await fetch(`/api/drive/download?filePath=${encodeURIComponent(hydratedPdf.storagePath)}`);
      if (response.ok) {
        const data = await response.json();
        setViewURL(data.viewURL || data.webUrl || hydratedPdf.downloadURL);
      } else {
        // Fallback to stored downloadURL if API fails
        setViewURL(hydratedPdf.downloadURL);
      }
    } catch (error) {
      console.error("Error fetching label details:", error);
      setViewURL(pdf.downloadURL);
      setSelectedPDF(pdf);
    } finally {
      setLoadingViewURL(false);
    }
  };


  // Get inventory for the user who uploaded the selected label
  const { data: userInventory, loading: inventoryLoading } = useCollection<InventoryItem>(
    selectedLabelForComplete?.uploadedBy ? `users/${selectedLabelForComplete.uploadedBy}/inventory` : ""
  );

  const handleComplete = (pdf: UploadedPDF) => {
    setSelectedLabelForComplete(pdf);
    setIsCompleteDialogOpen(true);
  };

  const handleShipmentSuccess = async () => {
    if (selectedLabelForComplete?.id) {
      try {
        const docRef = doc(db, "uploadedPDFs", selectedLabelForComplete.id);
        await updateDoc(docRef, {
          status: "complete",
        });
        toast({
          title: "Success",
          description: "Label marked as complete.",
        });
        setIsCompleteDialogOpen(false);
        setSelectedLabelForComplete(null);
      } catch (error: any) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error.message || "Failed to update label status.",
        });
      }
    }
  };

  const pendingCount = pdfs.filter((pdf) => (pdf.status || "pending") === "pending").length;
  const completeCount = pdfs.filter((pdf) => pdf.status === "complete").length;

  return (
    <>
      <Card className="w-full min-w-0">
        <CardHeader className="w-full min-w-0">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 w-full">
            <div>
              <CardTitle className="text-purple-600">
                Labels Management ({pendingCount} pending, {completeCount} complete)
              </CardTitle>
              <CardDescription>View and manage all uploaded labels from all users</CardDescription>
            </div>
            <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
              <div className="relative flex-1 sm:flex-initial">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by filename or client..."
                  value={searchTerm}
                  onChange={(e) => {
                    setSearchTerm(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="pl-10 w-full sm:w-64"
                />
                {searchTerm && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => {
                      setSearchTerm("");
                      setCurrentPage(1);
                    }}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
              <Select
                value={clientFilter}
                onValueChange={(value) => {
                  setClientFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="Filter by client" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Clients</SelectItem>
                  {clientNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={dateFilter}
                onValueChange={(value) => {
                  setDateFilter(value);
                  setCurrentPage(1);
                  // Reset client filter if selected client doesn't have uploads in new date range
                  if (clientFilter !== "all") {
                    const dateFilteredPDFs = value === "all" 
                      ? pdfs 
                      : pdfs.filter((pdf) => matchesDateFilter(pdf, value));
                    const hasClientInRange = dateFilteredPDFs.some(
                      (pdf) => pdf.uploadedByName === clientFilter
                    );
                    if (!hasClientInRange) {
                      setClientFilter("all");
                    }
                  }
                }}
              >
                <SelectTrigger className="w-full sm:w-[180px]">
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
        </CardHeader>
        <CardContent>
          <Tabs value={activeTab} onValueChange={(value) => {
            setActiveTab(value as "pending" | "complete");
            setCurrentPage(1);
          }} className="w-full">
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="pending">
                Pending Labels ({pendingCount})
              </TabsTrigger>
              <TabsTrigger value="complete">
                Complete Labels ({completeCount})
              </TabsTrigger>
            </TabsList>
            <TabsContent value="pending" className="mt-0">
              {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : paginatedPDFs.length > 0 ? (
            <div className="space-y-3">
              {paginatedPDFs.map((pdf) => (
                <div key={pdf.id}>
                  {/* Mobile: compact layout */}
                  <div className="block sm:hidden p-3 border rounded-lg bg-purple-50">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-purple-800 truncate">{pdf.fileName}</h3>
                        <p className="text-xs text-muted-foreground mt-1">
                          {pdf.uploadedByName} • {formatDate(pdf.uploadedAt)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {pdf.year}/{pdf.month}/{pdf.date}
                        </p>
                      </div>
                      <Badge variant="secondary" className="text-[10px] whitespace-nowrap bg-purple-100 text-purple-800">
                        {formatFileSize(pdf.size)}
                      </Badge>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-[10px] h-6 px-2"
                        onClick={() => handleView(pdf)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                      {activeTab === "pending" && (
                        <Button
                          variant="default"
                          size="sm"
                          className="text-[10px] h-6 px-2"
                          onClick={() => handleComplete(pdf)}
                        >
                          <CheckCircle2 className="h-3 w-3 mr-1" />
                          Complete
                        </Button>
                      )}
                    </div>
                  </div>
                  {/* Desktop: full layout */}
                  <div className="hidden md:block">
                    <div className="flex items-center justify-between p-4 border rounded-lg bg-purple-50">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-purple-800 truncate">{pdf.fileName}</h3>
                        <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                          <span className="truncate">Client: {pdf.uploadedByName}</span>
                          <span>Uploaded: {formatDate(pdf.uploadedAt)}</span>
                          <span className="hidden lg:inline">Path: {pdf.year}/{pdf.month}/{pdf.uploadedByName}/{pdf.date}</span>
                          <Badge variant="secondary" className="text-xs">
                            {formatFileSize(pdf.size)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-2"
                          onClick={() => handleView(pdf)}
                        >
                          <Eye className="h-4 w-4" />
                          View
                        </Button>
                        {activeTab === "pending" && (
                          <Button
                            variant="default"
                            size="sm"
                            className="flex items-center gap-2"
                            onClick={() => handleComplete(pdf)}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            Complete
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                  {/* Tablet: medium layout */}
                  <div className="hidden sm:block md:hidden">
                    <div className="flex items-center justify-between p-3 border rounded-lg bg-purple-50">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm text-purple-800 truncate">{pdf.fileName}</h3>
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span className="truncate">{pdf.uploadedByName}</span>
                          <span>•</span>
                          <span>{formatDate(pdf.uploadedAt)}</span>
                          <Badge variant="secondary" className="text-[10px] ml-auto">
                            {formatFileSize(pdf.size)}
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                        <Button
                          variant="outline"
                          size="sm"
                          className="flex items-center gap-1 text-xs"
                          onClick={() => handleView(pdf)}
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </Button>
                        {activeTab === "pending" && (
                          <Button
                            variant="default"
                            size="sm"
                            className="flex items-center gap-1 text-xs"
                            onClick={() => handleComplete(pdf)}
                          >
                            <CheckCircle2 className="h-3 w-3" />
                            Complete
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <p className="text-lg font-semibold">No PDFs found</p>
              <p className="text-sm mt-2">
                {pdfs.length === 0
                  ? "No PDFs have been uploaded yet."
                  : "No PDFs match your search or filter criteria."}
              </p>
            </div>
          )}

          {/* Pagination Controls */}
          {filteredPDFs.length > itemsPerPage && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
              <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                Showing {startIndex + 1} to {Math.min(endIndex, filteredPDFs.length)} of {filteredPDFs.length} records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="text-xs sm:text-sm"
                >
                  <span className="hidden sm:inline">Previous</span>
                  <span className="sm:hidden">Prev</span>
                </Button>
                <span className="text-xs sm:text-sm px-2">
                  {currentPage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="text-xs sm:text-sm"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
            </TabsContent>
            <TabsContent value="complete" className="mt-0">
              {loading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                  ))}
                </div>
              ) : paginatedPDFs.length > 0 ? (
                <div className="space-y-3">
                  {paginatedPDFs.map((pdf) => (
                    <div key={pdf.id}>
                      {/* Mobile: compact layout */}
                      <div className="block sm:hidden p-3 border rounded-lg bg-purple-50">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm text-purple-800 truncate">{pdf.fileName}</h3>
                            <p className="text-xs text-muted-foreground mt-1">
                              {pdf.uploadedByName} • {formatDate(pdf.uploadedAt)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {pdf.year}/{pdf.month}/{pdf.date}
                            </p>
                          </div>
                          <Badge variant="secondary" className="text-[10px] whitespace-nowrap bg-purple-100 text-purple-800">
                            {formatFileSize(pdf.size)}
                          </Badge>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-[10px] h-6 px-2"
                            onClick={() => handleView(pdf)}
                          >
                            <Eye className="h-3 w-3 mr-1" />
                            View
                          </Button>
                        </div>
                      </div>
                      {/* Desktop: full layout */}
                      <div className="hidden md:block">
                        <div className="flex items-center justify-between p-4 border rounded-lg bg-purple-50">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-purple-800 truncate">{pdf.fileName}</h3>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span className="truncate">Client: {pdf.uploadedByName}</span>
                              <span>Uploaded: {formatDate(pdf.uploadedAt)}</span>
                              <span className="hidden lg:inline">Path: {pdf.year}/{pdf.month}/{pdf.uploadedByName}/{pdf.date}</span>
                              <Badge variant="secondary" className="text-xs">
                                {formatFileSize(pdf.size)}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 ml-4 flex-shrink-0">
                            <Button
                              variant="outline"
                              size="sm"
                              className="flex items-center gap-2"
                              onClick={() => handleView(pdf)}
                            >
                              <Eye className="h-4 w-4" />
                              View
                            </Button>
                          </div>
                        </div>
                      </div>
                      {/* Tablet: medium layout */}
                      <div className="hidden sm:block md:hidden">
                        <div className="flex items-center justify-between p-3 border rounded-lg bg-purple-50">
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-sm text-purple-800 truncate">{pdf.fileName}</h3>
                            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                              <span className="truncate">{pdf.uploadedByName}</span>
                              <span>•</span>
                              <span>{formatDate(pdf.uploadedAt)}</span>
                              <Badge variant="secondary" className="text-[10px] ml-auto">
                                {formatFileSize(pdf.size)}
                              </Badge>
                            </div>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="flex items-center gap-1 ml-3 flex-shrink-0 text-xs"
                            onClick={() => handleView(pdf)}
                          >
                            <Eye className="h-3 w-3" />
                            View
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <p className="text-lg font-semibold">No completed labels found</p>
                  <p className="text-sm mt-2">
                    {filteredPDFsByStatus.length === 0
                      ? "No labels have been completed yet."
                      : "No completed labels match your search or filter criteria."}
                  </p>
                </div>
              )}

              {/* Pagination Controls for Complete Tab */}
              {filteredPDFs.length > itemsPerPage && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                  <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredPDFs.length)} of {filteredPDFs.length} records
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="text-xs sm:text-sm"
                    >
                      <span className="hidden sm:inline">Previous</span>
                      <span className="sm:hidden">Prev</span>
                    </Button>
                    <span className="text-xs sm:text-sm px-2">
                      {currentPage} / {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="text-xs sm:text-sm"
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* View PDF Dialog */}
      <Dialog 
        open={isViewDialogOpen} 
        onOpenChange={(open) => {
          setIsViewDialogOpen(open);
          if (!open) {
            setViewURL(null);
            setSelectedPDF(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg truncate">{selectedPDF?.fileName}</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              View PDF uploaded by {selectedPDF?.uploadedByName} on {formatDate(selectedPDF?.uploadedAt)}
            </DialogDescription>
          </DialogHeader>
          {selectedPDF && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 text-xs sm:text-sm">
                <div>
                  <span className="font-semibold">File Name:</span>
                  <p className="text-muted-foreground break-all">{selectedPDF.fileName}</p>
                </div>
                <div>
                  <span className="font-semibold">Client:</span>
                  <p className="text-muted-foreground">{selectedPDF.uploadedByName}</p>
                </div>
                <div>
                  <span className="font-semibold">File Size:</span>
                  <p className="text-muted-foreground">{formatFileSize(selectedPDF.size)}</p>
                </div>
                <div>
                  <span className="font-semibold">Upload Date:</span>
                  <p className="text-muted-foreground">{formatDate(selectedPDF.uploadedAt)}</p>
                </div>
                <div className="sm:col-span-2">
                  <span className="font-semibold">Storage Path:</span>
                  <p className="text-muted-foreground break-all text-xs">{selectedPDF.storagePath}</p>
                </div>
                <div>
                  <span className="font-semibold">Folder:</span>
                  <p className="text-muted-foreground">
                    {selectedPDF.year}/{selectedPDF.month}/{selectedPDF.date}
                  </p>
                </div>
              </div>

              {/* Products in Label Section */}
              {selectedPDF.labelProducts && Array.isArray(selectedPDF.labelProducts) && selectedPDF.labelProducts.length > 0 ? (
                <div className="border rounded-lg p-4 bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="font-semibold text-sm">Products in this Label</h3>
                    <Badge variant="secondary" className="text-xs">
                      {selectedPDF.labelProducts.length} product{selectedPDF.labelProducts.length > 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {selectedPDF.labelProducts.map((product: any, idx: number) => {
                      const shippedUnits = Number(product.shippedUnits) || 0;
                      const packOf = Number(product.packOf) || 1;
                      const total = shippedUnits * packOf;
                      return (
                        <div key={idx} className="bg-white border rounded p-3 text-sm">
                          <div className="font-medium mb-2">{product.name || "Product"}</div>
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground block text-[11px]">Shipped Units</span>
                              <span className="font-semibold text-base">{shippedUnits}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block text-[11px]">Pack Of</span>
                              <span className="font-semibold text-base">{packOf}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground block text-[11px]">Total Units</span>
                              <span className="font-semibold text-base text-primary">{total}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="border rounded-lg p-4 bg-muted/30 text-sm text-muted-foreground">
                  No product details were provided for this label.
                </div>
              )}

              {/* PDF Viewer */}
              <div className="border rounded-lg overflow-hidden">
                {loadingViewURL ? (
                  <div className="w-full h-[400px] sm:h-[600px] flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">Loading PDF viewer...</p>
                  </div>
                ) : viewURL ? (
                  <iframe
                    src={viewURL}
                    className="w-full h-[400px] sm:h-[600px]"
                    title={selectedPDF.fileName}
                  />
                ) : (
                  <div className="w-full h-[400px] sm:h-[600px] flex items-center justify-center">
                    <p className="text-muted-foreground text-sm">Unable to load PDF viewer</p>
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Complete Label Dialog with Ship Inventory Form */}
      <Dialog 
        open={isCompleteDialogOpen} 
        onOpenChange={(open) => {
          setIsCompleteDialogOpen(open);
          if (!open) {
            setSelectedLabelForComplete(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle className="text-base sm:text-lg">
              Complete Label: {selectedLabelForComplete?.fileName}
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Create shipment record for {selectedLabelForComplete?.uploadedByName}
            </DialogDescription>
          </DialogHeader>
          {selectedLabelForComplete && selectedLabelForComplete.uploadedBy && (
            <div className="mt-4">
              {inventoryLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Loading inventory...
                </div>
              ) : (
                <ShipInventoryForm 
                  userId={selectedLabelForComplete.uploadedBy}
                  inventory={userInventory}
                  prefillData={selectedLabelForComplete.labelProducts}
                  onSuccess={handleShipmentSuccess}
                />
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
