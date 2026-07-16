"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { InventoryItem, ShippedItem, ShipmentRequest, RestockHistory, FbaMasterCase } from "@/types";
import { formatServiceLabel } from "@/types";
import {
  formatFbaMasterCaseSummary,
  recordFbaLabelUpload,
} from "@/lib/fba-shipment-workflow";
import { getShipmentSummary } from "@/lib/shipment-utils";
import { doc, updateDoc, Timestamp } from "firebase/firestore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Search, Filter, ListFilter, X, Eye, Clock, XCircle, Trash2 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { format } from "date-fns";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";

function formatDate(date: ShippedItem["date"]) {
    if (typeof date === 'string') {
      return format(new Date(date), "PPP");
    }
    if (date && typeof date === 'object' && 'seconds' in date) {
      return format(new Date(date.seconds * 1000), "PPP");
    }
    return "N/A";
  }

function formatRestockDate(restockedAt: RestockHistory["restockedAt"]) {
  if (typeof restockedAt === "string") {
    return format(new Date(restockedAt), "d MMM yyyy");
  }
  if (restockedAt && typeof restockedAt === "object" && "seconds" in restockedAt) {
    return format(new Date(restockedAt.seconds * 1000), "d MMM yyyy");
  }
  return "N/A";
  }

type ShippedRowStatus = "Pending" | "Shipped" | "Rejected" | "Cancelled";

const STATUS_FILTER_ALL = "all";
const STATUS_URL_PENDING = "pending";
const STATUS_URL_SHIPPED = "shipped";
const STATUS_URL_CANCELLED = "cancelled";

const DATE_FILTER_KEYS = new Set(["all", "today", "week", "month", "year"]);

function rowMatchesStatusFilter(
  item: { status?: string },
  statusFilter: string
): boolean {
  if (statusFilter === STATUS_FILTER_ALL) return true;
  const s = (item.status || "") as ShippedRowStatus;
  if (statusFilter === STATUS_URL_PENDING) return s === "Pending";
  if (statusFilter === STATUS_URL_SHIPPED) return s === "Shipped";
  if (statusFilter === STATUS_URL_CANCELLED) return s === "Cancelled";
  return true;
}

export function ShippedTable({ data, inventory }: { data: ShippedItem[], inventory: InventoryItem[] }) {
  const searchParams = useSearchParams();
  const { user, userProfile } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>(STATUS_FILTER_ALL);
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedUploadRequest, setSelectedUploadRequest] = useState<ShipmentRequest | null>(null);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [isUploadingLabel, setIsUploadingLabel] = useState(false);
  const [cancellingRequest, setCancellingRequest] = useState<ShipmentRequest | null>(null);
  const [cancellationReason, setCancellationReason] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  useEffect(() => {
    const raw = searchParams.get("status")?.toLowerCase();
    if (raw === STATUS_URL_PENDING || raw === STATUS_URL_SHIPPED) {
      setStatusFilter(raw);
    }
    const dateRaw = searchParams.get("date")?.toLowerCase();
    if (dateRaw && DATE_FILTER_KEYS.has(dateRaw)) {
      setDateFilter(dateRaw);
    }
  }, [searchParams]);
  const itemsPerPage = 10;
  const [selectedRemarks, setSelectedRemarks] = useState<string>("");
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = useState(false);
  const [selectedShipTo, setSelectedShipTo] = useState<string>("");
  const [isShipToDialogOpen, setIsShipToDialogOpen] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Array<{productName: string, quantity: number, packOf: number, shippedQty: number, unitPrice: number}>>([]);
  const [isProductsDialogOpen, setIsProductsDialogOpen] = useState(false);
  const [selectedAdditionalServices, setSelectedAdditionalServices] = useState<any>(null);
  const [isAdditionalServicesDialogOpen, setIsAdditionalServicesDialogOpen] = useState(false);

  // Fetch pending shipment requests
  const { data: pendingShipmentRequests } = useCollection<ShipmentRequest>(
    userProfile ? `users/${userProfile.uid}/shipmentRequests` : ""
  );

  const { data: restockHistory } = useCollection<RestockHistory>(
    userProfile ? `users/${userProfile.uid}/restockHistory` : ""
  );

  // Latest restock per product (by productName) for "Last restocked" column
  const latestRestockByProduct = useMemo(() => {
    const map = new Map<
      string,
      { restockedAt: RestockHistory["restockedAt"]; restockedQuantity: number; restockedBy: string }
    >();
    for (const r of restockHistory) {
      const at =
        typeof r.restockedAt === "string"
          ? new Date(r.restockedAt).getTime()
          : r.restockedAt?.seconds != null
            ? r.restockedAt.seconds * 1000
            : 0;
      const existing = map.get(r.productName);
      const existingAt = existing
        ? typeof existing.restockedAt === "string"
          ? new Date(existing.restockedAt).getTime()
          : existing.restockedAt?.seconds != null
            ? existing.restockedAt.seconds * 1000
            : 0
        : 0;
      if (at > existingAt) {
        map.set(r.productName, {
          restockedAt: r.restockedAt,
          restockedQuantity: r.restockedQuantity,
          restockedBy: r.restockedBy,
        });
      }
    }
    return map;
  }, [restockHistory]);

  const pendingCount = pendingShipmentRequests.filter(
    (req) => req.status === "pending" || req.status === "awaiting_label_upload"
  ).length;
  const rejectedCount = pendingShipmentRequests.filter(req => req.status?.toLowerCase() === "rejected").length;
  const cancelledCount = pendingShipmentRequests.filter(req => req.status === "cancelled").length;

  const handleCancelShipmentRequest = async () => {
    if (!cancellingRequest?.id || !userProfile?.uid) return;
    if (cancellingRequest.status !== "pending") {
      toast({
        variant: "destructive",
        title: "Cannot cancel",
        description: "Only pending outbound requests can be cancelled.",
      });
      setCancellingRequest(null);
      return;
    }

    const reason = cancellationReason.trim();
    if (!reason) {
      toast({
        variant: "destructive",
        title: "Reason required",
        description: "Please tell us why you are cancelling this request.",
      });
      return;
    }

    setIsCancelling(true);
    try {
      await updateDoc(doc(db, `users/${userProfile.uid}/shipmentRequests`, cancellingRequest.id), {
        status: "cancelled",
        cancelledAt: Timestamp.now(),
        cancelledBy: user?.uid || userProfile.uid,
        cancellationReason: reason,
      });
      toast({
        title: "Request cancelled",
        description: "Your outbound shipment request was cancelled.",
      });
      setCancellingRequest(null);
      setCancellationReason("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to cancel shipment request.",
      });
    } finally {
      setIsCancelling(false);
    }
  };

  const handleRemarksClick = (remarks: string) => {
    setSelectedRemarks(remarks);
    setIsRemarksDialogOpen(true);
  };

  const handleShipToClick = (shipTo: string) => {
    setSelectedShipTo(shipTo);
    setIsShipToDialogOpen(true);
  };

  const handleProductsClick = (products: Array<{productName: string, quantity: number, packOf: number, shippedQty: number, unitPrice: number}>) => {
    setSelectedProducts(products);
    setIsProductsDialogOpen(true);
  };

  const handleAdditionalServicesClick = (additionalServices: any) => {
    setSelectedAdditionalServices(additionalServices);
    setIsAdditionalServicesDialogOpen(true);
  };

  const uploadOneLabelForRequest = async (file: File): Promise<string> => {
    if (!userProfile?.uid) throw new Error("User profile is missing.");
    const currentDate = new Date();
    const clientName =
      String(userProfile.name || userProfile.email || userProfile.uid || "client")
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim() || "client";
    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientName", clientName);
    if (file.name) {
      formData.append("fileName", file.name);
    }
    const year = currentDate.getFullYear().toString();
    const month = currentDate.toLocaleString("en-US", { month: "long" });
    const dateStr = currentDate.toISOString().split("T")[0];
    formData.append("folderPath", `${year}/${month}/${clientName}/${dateStr}`);

    const response = await fetch("/api/onedrive/upload", { method: "POST", body: formData });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Label upload failed.");
    }
    const result = await response.json();
    const urlToStore = result.webUrl || result.downloadURL;
    if (!urlToStore) throw new Error("Label upload failed.");
    return urlToStore;
  };

  const handleDirectLabelUpload = async () => {
    if (!selectedUploadRequest?.id || !userProfile?.uid) return;
    if (uploadFiles.length === 0) {
      toast({
        variant: "destructive",
        title: "No files selected",
        description: "Please choose one or more label files.",
      });
      return;
    }
    setIsUploadingLabel(true);
    try {
      const uploadedUrls: string[] = [];
      for (const file of uploadFiles) {
        const uploadedUrl = await uploadOneLabelForRequest(file);
        uploadedUrls.push(uploadedUrl);
      }
      const existingUrls = String(selectedUploadRequest.labelUrl || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const allUrls = Array.from(new Set([...existingUrls, ...uploadedUrls]));

      if (
        selectedUploadRequest.fbaLabelWorkflow &&
        selectedUploadRequest.service === "FBA/WFS/TFS"
      ) {
        await recordFbaLabelUpload({
          clientUserId: userProfile.uid,
          shipmentRequestId: selectedUploadRequest.id,
          labelUrls: uploadedUrls,
          uploadedBy: "client",
          warehouseId: String((selectedUploadRequest as ShipmentRequest).warehouseId ?? ""),
        });
      } else {
        await updateDoc(doc(db, `users/${userProfile.uid}/shipmentRequests`, selectedUploadRequest.id), {
          labelUrl: allUrls.join(","),
          labelUploadedAt: Timestamp.now(),
        });
      }

      toast({
        title: "Label uploaded",
        description: uploadedUrls.length === 1
          ? "Label uploaded successfully."
          : `${uploadedUrls.length} labels uploaded successfully.`,
      });
      setSelectedUploadRequest(null);
      setUploadFiles([]);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: error?.message || "Failed to upload label.",
      });
    } finally {
      setIsUploadingLabel(false);
    }
  };

  // Combine shipped items, pending, and rejected shipment requests into one list
  const combinedData = useMemo(() => {
    // Helper function to convert a single shipment from request to display format
    const convertShipmentToDisplay = (
      req: ShipmentRequest,
      shipment: any,
      status: "Pending" | "Rejected" | "Cancelled",
      index: number
    ) => {
      const inventoryItem = inventory.find(item => item.id === shipment.productId);
      const productUnits = (shipment.quantity || 0) * (shipment.packOf || 1);
      
      return {
        id: `request-${req.id}-${index}`,
        productName: inventoryItem?.productName || "Unknown Product",
        date: req.date,
        shippedQty: productUnits,
        boxesShipped: shipment.quantity || 0,
        packOf: shipment.packOf || 1,
        unitPrice: shipment.unitPrice || 0,
        shipTo: req.shipTo || "",
        service: req.service || "FBA/WFS/TFS",
        productType: req.productType || "Standard",
        remarks:
          status === "Rejected"
            ? ((req as any).rejectionReason || req.remarks || "")
            : status === "Cancelled"
              ? ((req as any).cancellationReason || req.remarks || "")
              : (req.remarks || ""),
        status: status as ShippedRowStatus,
        isRequest: true,
        requestId: req.id,
        requestStatus: req.status || "pending",
        rawRequest: req,
        createdAt: req.requestedAt,
        additionalServices: shipment.selectedAdditionalServices || (req as any).additionalServices,
        canCancelRequest: status === "Pending" && (req.status || "pending") === "pending" && index === 0,
      };
    };

    // Convert pending shipment requests - expand each shipment into separate row
    const pendingItems: any[] = [];
    pendingShipmentRequests
      .filter(req => req.status === "pending" || req.status === "awaiting_label_upload")
      .forEach(req => {
        req.shipments.forEach((shipment, index) => {
          pendingItems.push(convertShipmentToDisplay(req, shipment, "Pending", index));
        });
      });

    // Convert rejected shipment requests - expand each shipment into separate row
    const rejectedItems: any[] = [];
    pendingShipmentRequests
      .filter(req => req.status?.toLowerCase() === "rejected")
      .forEach(req => {
        req.shipments.forEach((shipment, index) => {
          rejectedItems.push(convertShipmentToDisplay(req, shipment, "Rejected", index));
        });
      });

    const cancelledItems: any[] = [];
    pendingShipmentRequests
      .filter(req => req.status === "cancelled")
      .forEach(req => {
        req.shipments.forEach((shipment, index) => {
          cancelledItems.push(convertShipmentToDisplay(req, shipment, "Cancelled", index));
        });
      });

    // Convert shipped items - expand items array into separate rows
    const shippedItems: any[] = [];
    data.forEach(item => {
      // Check if item has an items array (multiple products)
      if (item.items && Array.isArray(item.items) && item.items.length > 0) {
        item.items.forEach((it: any) => {
          shippedItems.push({
            ...item,
            id: `${item.id}-${it.productId || Math.random()}`,
            productName: it.productName || item.productName,
            shippedQty: it.shippedQty || 0,
            boxesShipped: it.boxesShipped || 0,
            packOf: it.packOf || item.packOf || 1,
            unitPrice: it.unitPrice || item.unitPrice || 0,
            status: "Shipped" as "Pending" | "Shipped" | "Rejected",
            isRequest: false,
            additionalServices: it.additionalServices || item.additionalServices || (item as any).selectedAdditionalServices,
          });
        });
      } else {
        // Single product
        shippedItems.push({
          ...item,
          status: "Shipped" as "Pending" | "Shipped" | "Rejected",
          isRequest: false,
          additionalServices: item.additionalServices || (item as any).selectedAdditionalServices,
        });
      }
    });

    // Combine and sort (most recent first)
    const allItems = [...pendingItems, ...rejectedItems, ...cancelledItems, ...shippedItems];

    const sortedItems = allItems.sort((a, b) => {
      const aCreated = a.createdAt
        ? (typeof a.createdAt === 'string' ? new Date(a.createdAt) : new Date(a.createdAt.seconds * 1000))
        : (typeof a.date === 'string' ? new Date(a.date) : new Date(a.date.seconds * 1000));
      const bCreated = b.createdAt
        ? (typeof b.createdAt === 'string' ? new Date(b.createdAt) : new Date(b.createdAt.seconds * 1000))
        : (typeof b.date === 'string' ? new Date(b.date) : new Date(b.date.seconds * 1000));
      return bCreated.getTime() - aCreated.getTime();
    });

    // Show "Last restocked" only once per product (on the first/latest row)
    const seenProducts = new Set<string>();
    return sortedItems.map((item) => {
      const productKey = String(item.productName || "").trim().toLowerCase();
      const showLastRestock = productKey ? !seenProducts.has(productKey) : false;
      if (productKey && showLastRestock) {
        seenProducts.add(productKey);
      }
      return { ...item, showLastRestock };
    });
  }, [data, pendingShipmentRequests, inventory]);

  // Filtered and sorted shipped data (most recent first)
  const filteredData = useMemo(() => {
    const filtered = combinedData.filter((item) => {
      const matchesSearch = item.productName.toLowerCase().includes(searchTerm.toLowerCase());
      const matchesStatus = rowMatchesStatusFilter(item, statusFilter);

      let matchesDate = true;
      if (dateFilter !== "all") {
        const itemDate = typeof item.date === 'string' 
          ? new Date(item.date) 
          : new Date(item.date.seconds * 1000);
        const now = new Date();
        const daysDiff = Math.floor((now.getTime() - itemDate.getTime()) / (1000 * 60 * 60 * 24));
        
        switch (dateFilter) {
          case "today":
            matchesDate = daysDiff === 0;
            break;
          case "week":
            matchesDate = daysDiff <= 7;
            break;
          case "month":
            matchesDate = daysDiff <= 30;
            break;
          case "year":
            matchesDate = daysDiff <= 365;
            break;
        }
      }
      
      return matchesSearch && matchesDate && matchesStatus;
    });

    return filtered;
  }, [combinedData, searchTerm, dateFilter, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, dateFilter, statusFilter]);

  return (
    <TooltipProvider>
    <Card className="w-full">
      <CardHeader className="pb-2 sm:pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base sm:text-lg lg:text-xl">
              Order Shipped ({filteredData.filter((item: any) => !item.isRequest || (item.status !== "Pending" && item.status !== "Rejected")).length})
              {pendingCount > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({pendingCount} Pending)
                </span>
              )}
              {rejectedCount > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({rejectedCount} Rejected)
                </span>
              )}
              {cancelledCount > 0 && (
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({cancelledCount} Cancelled)
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Details of products that have been shipped.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {pendingCount > 0 && (
              <Badge variant="outline" className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {pendingCount} Pending
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">
        {/* Search and Filter Controls */}
        <div className="flex flex-col gap-4 mb-6 px-6 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search shipped orders..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-10"
              />
              {searchTerm && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                  onClick={() => setSearchTerm("")}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:max-w-md lg:max-w-none lg:shrink-0">
            <div className="w-full sm:min-w-[11rem]">
              <Select
                value={statusFilter}
                onValueChange={(value) => {
                  setStatusFilter(value);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <ListFilter className="h-4 w-4 mr-2 shrink-0" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={STATUS_FILTER_ALL}>All statuses</SelectItem>
                  <SelectItem value={STATUS_URL_PENDING}>Pending</SelectItem>
                  <SelectItem value={STATUS_URL_SHIPPED}>Shipped</SelectItem>
                  <SelectItem value={STATUS_URL_CANCELLED}>Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-full sm:min-w-[11rem]">
              <Select value={dateFilter} onValueChange={(value) => {
                setDateFilter(value);
                setCurrentPage(1);
              }}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2 shrink-0" />
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
        </div>

        {/* Mobile Card List */}
        <div className="block sm:hidden px-4 space-y-3">
          {filteredData.length > 0 ? (
            paginatedData.map((item) => (
              <div key={item.id} className="border rounded-lg p-3 bg-white">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-semibold text-sm">{item.productName}</div>
                    <div className="text-xs text-muted-foreground mt-1">{formatDate(item.date)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs">Shipped Units</div>
                    <div className="font-semibold text-sm">{(item as any).boxesShipped ?? item.shippedQty}</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-muted-foreground">Pack</div>
                    <div className="font-medium">{item.packOf}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground">Ship To</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-left justify-start text-xs"
                      onClick={() => handleShipToClick(item.shipTo || "")}
                    >
                      <span className="truncate max-w-[140px] inline-block align-middle">{item.shipTo || '-'}</span>
                      <Eye className="h-3 w-3 ml-1 inline-block align-middle" />
                    </Button>
                  </div>
                </div>
                {item.remarks && (
                  <div className="mt-2">
                    <div className="text-xs text-muted-foreground">Remarks</div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-auto p-0 text-left justify-start text-xs"
                      onClick={() => handleRemarksClick(item.remarks || "")}
                    >
                      <span className="truncate max-w-[200px] inline-block align-middle">{item.remarks}</span>
                      <Eye className="h-3 w-3 ml-1 inline-block align-middle" />
                    </Button>
                  </div>
                )}
                {(() => {
                  if (!(item as any).showLastRestock) return null;
                  const latest = latestRestockByProduct.get(item.productName);
                  if (!latest) return null;
                  const text = `${formatRestockDate(latest.restockedAt)} (+${latest.restockedQuantity})`;
                  return (
                    <div className="mt-2">
                      <div className="text-xs text-muted-foreground">Last restocked</div>
                      {latest.restockedBy ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="text-xs cursor-default">{text}</span>
                          </TooltipTrigger>
                          <TooltipContent>Restocked by {latest.restockedBy}</TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-xs">{text}</span>
                      )}
                    </div>
                  );
                })()}
                <div className="mt-2">
                  <div className="text-xs text-muted-foreground">Status</div>
                  {(item as any).status === "Pending" ? (
                    <Badge variant="outline" className="flex items-center gap-1 w-fit mt-1">
                      <Clock className="h-3 w-3" />
                      Pending
                    </Badge>
                  ) : (item as any).status === "Rejected" ? (
                    <Badge variant="destructive" className="flex items-center gap-1 w-fit mt-1">
                      <XCircle className="h-3 w-3" />
                      Rejected
                    </Badge>
                  ) : (item as any).status === "Cancelled" ? (
                    <Badge variant="secondary" className="flex items-center gap-1 w-fit mt-1">
                      <Trash2 className="h-3 w-3" />
                      Cancelled
                    </Badge>
                  ) : (
                    <Badge variant="default" className="w-fit mt-1">Shipped</Badge>
                  )}
                  {(item as any).canCancelRequest && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-xs text-destructive border-destructive/40 hover:text-destructive"
                      onClick={() => {
                        setCancellingRequest((item as any).rawRequest as ShipmentRequest);
                        setCancellationReason("");
                      }}
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      Cancel request
                    </Button>
                  )}
                  {(item as any).isRequest &&
                    ((item as any).requestStatus === "awaiting_label_upload" ||
                      ((item as any).rawRequest?.fbaMasterCases?.length > 0 &&
                        (item as any).rawRequest?.fbaLabelWorkflow)) && (
                  {(item as any).isRequest && (item as any).requestStatus === "awaiting_label_upload" && (
                    <Button
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => {
                        setSelectedUploadRequest((item as any).rawRequest as ShipmentRequest);
                        setUploadFiles([]);
                      }}
                    >
                      {(item as any).rawRequest?.fbaMasterCases?.length
                        ? "Upload label (master case ready)"
                        : "Upload Label"}
                    </Button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-xs text-gray-500">
              {combinedData.length === 0 ? "No shipped orders or pending requests found." : "No orders match your search criteria."}
            </div>
          )}
        </div>

        {/* Desktop/Table View */}
        <div className="hidden sm:block">
        <Table containerClassName="overflow-x-auto overflow-y-hidden mouse-h-scroll">
          <TableHeader>
            <TableRow>
                  <TableHead className="text-xs sm:text-sm">Product</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Date</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Shipped</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Pack</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Service</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Product Type</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Ship To</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Remarks</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Additional Services</TableHead>
                  <TableHead className="text-xs sm:text-sm hidden md:table-cell">Last restocked</TableHead>
                  <TableHead className="text-xs sm:text-sm">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
                {filteredData.length > 0 ? (
                  paginatedData.map((item) => (
                    <TableRow key={item.id} className="text-xs sm:text-sm">
                      <TableCell className="font-medium max-w-32 sm:max-w-none truncate">
                        <div className="flex flex-col sm:block">
                          <span className="font-medium">{item.productName}</span>
                          <div className="sm:hidden mt-1 space-y-0.5 text-xs text-gray-500">
                            <span>{formatDate(item.date)}</span>
                            <br />
                            <span>Shipped Units: {(item as any).boxesShipped ?? item.shippedQty}</span>
                            <br />
                            <span>Pack: {item.packOf}</span>
                            <br />
                            <span>Service: {formatServiceLabel((item as any).service)}</span>
                            <br />
                            <span>Product Type: {(item as any).productType === "Standard"
                              ? "Standard (6x6x6)"
                              : (item as any).productType === "Large"
                              ? "Large (10x10x10)"
                              : (item as any).productType || "N/A"}</span>
                            {(() => {
                              const additionalServices = (item as any).additionalServices;
                              const hasServices = additionalServices && (
                                (Array.isArray(additionalServices) && additionalServices.length > 0) ||
                                (typeof additionalServices === 'object' && (
                                  additionalServices.bubbleWrapFeet > 0 ||
                                  additionalServices.stickerRemovalItems > 0 ||
                                  additionalServices.warningLabels > 0
                                ))
                              );
                              return hasServices ? (
                                <>
                                  <br />
                                  <div className="flex items-center gap-1">
                                    <span className="font-semibold">Additional Services:</span>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-auto p-0 text-xs text-gray-500"
                                      onClick={() => handleAdditionalServicesClick(additionalServices)}
                                    >
                                      <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                                    </Button>
                                  </div>
                                </>
                              ) : null;
                            })()}
                            <br />
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-0 text-left justify-start text-xs text-gray-500"
                              onClick={() => handleShipToClick(item.shipTo || "")}
                            >
                              <span>Ship To: {item.shipTo}</span>
                              <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                            </Button>
                            {item.remarks && (
                              <>
                                <br />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-auto p-0 text-left justify-start text-xs text-gray-500"
                                  onClick={() => handleRemarksClick(item.remarks || "")}
                                >
                                  <span>Remarks: {item.remarks}</span>
                                  <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                                </Button>
                              </>
                            )}
                            <br />
                            <span>
                              Status: {(item as any).status === "Pending" ? (
                                <Badge variant="outline" className="ml-1">
                                  <Clock className="h-3 w-3 mr-1" />
                                  Pending
                                </Badge>
                              ) : (item as any).status === "Rejected" ? (
                                <Badge variant="destructive" className="ml-1">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  Rejected
                                </Badge>
                              ) : (
                                <Badge variant="default" className="ml-1">Shipped</Badge>
                              )}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <span className="text-xs">{formatDate(item.date)}</span>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{(item as any).boxesShipped ?? item.shippedQty}</TableCell>
                      <TableCell className="hidden md:table-cell">{item.packOf}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {formatServiceLabel((item as any).service)}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        {(item as any).productType === "Standard"
                          ? "Standard (6x6x6)"
                          : (item as any).productType === "Large"
                          ? "Large (10x10x10)"
                          : (item as any).productType || "N/A"}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 text-left justify-start max-w-20 truncate"
                          onClick={() => handleShipToClick(item.shipTo || "")}
                        >
                          <span className="truncate">{item.shipTo}</span>
                          <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {item.remarks ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-auto p-1 text-left justify-start max-w-20 truncate"
                            onClick={() => handleRemarksClick(item.remarks || "")}
                          >
                            <span className="truncate">{item.remarks}</span>
                            <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                          </Button>
                        ) : (
                          <span className="text-muted-foreground">-</span>
                        )}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {(() => {
                          const additionalServices = (item as any).additionalServices;
                          const hasServices = additionalServices && (
                            (Array.isArray(additionalServices) && additionalServices.length > 0) ||
                            (typeof additionalServices === 'object' && (
                              additionalServices.bubbleWrapFeet > 0 ||
                              additionalServices.stickerRemovalItems > 0 ||
                              additionalServices.warningLabels > 0
                            ))
                          );
                          return hasServices ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1"
                              onClick={() => handleAdditionalServicesClick(additionalServices)}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-muted-foreground">
                        {(() => {
                          if (!(item as any).showLastRestock) return <span>—</span>;
                          const latest = latestRestockByProduct.get(item.productName);
                          if (!latest) return <span>—</span>;
                          const text = `${formatRestockDate(latest.restockedAt)} (+${latest.restockedQuantity})`;
                          return latest.restockedBy ? (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="cursor-default">{text}</span>
                              </TooltipTrigger>
                              <TooltipContent>Restocked by {latest.restockedBy}</TooltipContent>
                            </Tooltip>
                          ) : (
                            <span>{text}</span>
                          );
                        })()}
                      </TableCell>
                      <TableCell>
                        {(item as any).status === "Pending" ? (
                          <div className="space-y-2">
                            <Badge variant="outline" className="flex items-center gap-1 w-fit">
                              <Clock className="h-3 w-3" />
                              Pending
                            </Badge>
                            {(item as any).isRequest &&
                              ((item as any).requestStatus === "awaiting_label_upload" ||
                                ((item as any).rawRequest?.fbaMasterCases?.length > 0 &&
                                  (item as any).rawRequest?.fbaLabelWorkflow)) && (
                              <Button
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => {
                                  setSelectedUploadRequest((item as any).rawRequest as ShipmentRequest);
                                  setUploadFiles([]);
                                }}
                              >
                                Upload Label
                              </Button>
                            )}
                          </div>
                        ) : (item as any).status === "Rejected" ? (
                          <Badge variant="destructive" className="flex items-center gap-1 w-fit">
                            <XCircle className="h-3 w-3" />
                            Rejected
                          </Badge>
                        ) : (item as any).status === "Cancelled" ? (
                          <Badge variant="secondary" className="flex items-center gap-1 w-fit">
                            <Trash2 className="h-3 w-3" />
                            Cancelled
                          </Badge>
                        ) : (
                          <Badge variant="default" className="w-fit">Shipped</Badge>
                        )}
                        {(item as any).canCancelRequest && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="mt-1 h-7 px-2 text-xs text-destructive hover:text-destructive"
                            onClick={() => {
                              setCancellingRequest((item as any).rawRequest as ShipmentRequest);
                              setCancellationReason("");
                            }}
                          >
                            <Trash2 className="h-3 w-3 mr-1" />
                            Cancel
                          </Button>
                        )}
                      </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                    <TableCell colSpan={11} className="text-center py-8">
                      <div className="text-xs sm:text-sm text-gray-500">
                        {combinedData.length === 0 ? "No shipped orders or pending requests found." : "No orders match your search criteria."}
                      </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>

        {/* Pagination Controls */}
        {filteredData.length > itemsPerPage && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t px-6">
            <div className="text-sm text-muted-foreground">
              Showing {startIndex + 1} to {Math.min(endIndex, filteredData.length)} of {filteredData.length} items
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
      </CardContent>

      {/* Remarks Dialog */}
      <Dialog open={isRemarksDialogOpen} onOpenChange={setIsRemarksDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Full Remarks</DialogTitle>
            <DialogDescription>Complete remarks for this shipment</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">
                {selectedRemarks || "No remarks available"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Ship To Dialog */}
      <Dialog open={isShipToDialogOpen} onOpenChange={setIsShipToDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Ship To Details</DialogTitle>
            <DialogDescription>Complete shipping address for this shipment</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">
                {selectedShipTo || "No shipping address available"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Products Dialog */}
      <Dialog open={isProductsDialogOpen} onOpenChange={setIsProductsDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>All Products in Shipment</DialogTitle>
            <DialogDescription>Complete list of products in this shipment order</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="space-y-4">
              {selectedProducts.map((product, index) => (
                <div key={index} className="bg-gray-50 p-4 rounded-lg border">
                  <div className="font-semibold text-sm mb-2">{product.productName}</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Quantity (Boxes):</span>
                      <span className="ml-2 font-medium">{product.quantity}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Pack Of:</span>
                      <span className="ml-2 font-medium">{product.packOf}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Units:</span>
                      <span className="ml-2 font-medium">{product.shippedQty}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Unit Price:</span>
                      <span className="ml-2 font-medium">${product.unitPrice.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Additional Services Dialog */}
      <Dialog open={isAdditionalServicesDialogOpen} onOpenChange={setIsAdditionalServicesDialogOpen}>
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Additional Services</DialogTitle>
            <DialogDescription>Complete list of additional services for this shipment</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh]">
            <div className="bg-gray-50 p-4 rounded-lg">
              {selectedAdditionalServices ? (
                <div className="space-y-3">
                  {Array.isArray(selectedAdditionalServices) ? (
                    // New array format
                    selectedAdditionalServices.length > 0 ? (
                      selectedAdditionalServices.map((service: string, index: number) => (
                        <div key={index} className="text-sm">
                          <span className="font-medium">• </span>
                          <span className="capitalize">
                            {service === "bubbleWrap" ? "Bubble Wrap" :
                             service === "stickerRemoval" ? "Sticker Removal" :
                             service === "warningLabels" ? "Warning Labels" :
                             service}
                          </span>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">No additional services selected</p>
                    )
                  ) : (
                    // Old object format
                    <>
                      {selectedAdditionalServices.bubbleWrapFeet > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">• Bubble Wrap:</span>
                          <span className="ml-2">{selectedAdditionalServices.bubbleWrapFeet} feet</span>
                        </div>
                      )}
                      {selectedAdditionalServices.stickerRemovalItems > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">• Sticker Removal:</span>
                          <span className="ml-2">{selectedAdditionalServices.stickerRemovalItems} items</span>
                        </div>
                      )}
                      {selectedAdditionalServices.warningLabels > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">• Warning Labels:</span>
                          <span className="ml-2">{selectedAdditionalServices.warningLabels} labels</span>
                        </div>
                      )}
                      {(!selectedAdditionalServices.bubbleWrapFeet || selectedAdditionalServices.bubbleWrapFeet === 0) &&
                       (!selectedAdditionalServices.stickerRemovalItems || selectedAdditionalServices.stickerRemovalItems === 0) &&
                       (!selectedAdditionalServices.warningLabels || selectedAdditionalServices.warningLabels === 0) && (
                        <p className="text-sm text-muted-foreground">No additional services selected</p>
                      )}
                    </>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No additional services available</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={cancellingRequest !== null}
        onOpenChange={(open) => {
          if (!open && !isCancelling) {
            setCancellingRequest(null);
            setCancellationReason("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel outbound request?</DialogTitle>
            <DialogDescription>
              This will mark your pending shipment request as cancelled. You cannot undo this action.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="outbound-cancellation-reason">
              Why are you cancelling? <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="outbound-cancellation-reason"
              value={cancellationReason}
              onChange={(e) => setCancellationReason(e.target.value)}
              placeholder="e.g. wrong products selected, shipment no longer needed, incorrect ship-to address..."
              rows={4}
              maxLength={500}
              disabled={isCancelling}
            />
            <p className="text-xs text-muted-foreground">{cancellationReason.length}/500</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              disabled={isCancelling}
              onClick={() => {
                setCancellingRequest(null);
                setCancellationReason("");
              }}
            >
              Keep request
            </Button>
            <Button
              variant="destructive"
              disabled={isCancelling || !cancellationReason.trim()}
              onClick={() => void handleCancelShipmentRequest()}
            >
              {isCancelling ? "Cancelling..." : "Cancel request"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Direct Upload Label Dialog */}
      <Dialog
        open={!!selectedUploadRequest}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedUploadRequest(null);
            setUploadFiles([]);
          }
        }}
      >
        <DialogContent className="max-w-full sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[80vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle>Upload Shipping Label</DialogTitle>
            <DialogDescription>
              {selectedUploadRequest?.fbaMasterCases?.length
                ? "Use the master case details below to generate your label, then upload it here."
                : "Upload label directly for this approved request. No need to submit a new request."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            {selectedUploadRequest?.fbaMasterCases?.length ? (
              <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
                <p className="text-sm font-medium">Master case details</p>
                {selectedUploadRequest.fbaMasterCases.map((mc: FbaMasterCase) => (
                  <p key={mc.id} className="text-xs text-muted-foreground">
                    {formatFbaMasterCaseSummary(mc)}
                    {mc.notes ? ` · ${mc.notes}` : ""}
                  </p>
                ))}
              </div>
            ) : null}
            <Input
              type="file"
              accept="image/*,application/pdf"
              multiple
              onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
              disabled={isUploadingLabel}
            />
            <p className="text-xs text-muted-foreground">
              {uploadFiles.length > 0 ? `${uploadFiles.length} file(s) selected` : "No files selected"}
            </p>
            <div className="flex gap-2">
              <Button
                onClick={handleDirectLabelUpload}
                disabled={isUploadingLabel || uploadFiles.length === 0}
                className="flex-1"
              >
                {isUploadingLabel ? "Uploading..." : "Upload Label"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedUploadRequest(null);
                  setUploadFiles([]);
                }}
                disabled={isUploadingLabel}
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
    </TooltipProvider>
  );
}

