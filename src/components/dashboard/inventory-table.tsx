"use client";

import { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { InventoryItem, InventoryRequest } from "@/types";
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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search, Filter, X, Clock, Eye, Edit, PlusCircle, Recycle, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { AddInventoryRequestForm } from "./add-inventory-request-form";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { doc, Timestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cn } from "@/lib/utils";
import { formatInboundQuantityDisplay } from "@/lib/inventory-qty-display";

function formatRowQuantity(item: {
  quantity?: number;
  requestedQuantity?: number;
  receivedQuantity?: number;
  isRequest?: boolean;
  status?: string;
  requestData?: { quantity?: number; requestedQuantity?: number; receivedQuantity?: number; status?: string };
}): string {
  const status =
    item.isRequest && item.status === "Pending"
      ? "pending"
      : item.isRequest && item.status === "Rejected"
        ? "rejected"
        : item.isRequest
          ? String(item.requestData?.status || item.status || "pending").toLowerCase()
          : "approved";
  return formatInboundQuantityDisplay({
    quantity: item.quantity,
    requestedQuantity:
      item.requestedQuantity ??
      item.requestData?.requestedQuantity ??
      item.requestData?.quantity ??
      item.quantity,
    receivedQuantity: item.receivedQuantity ?? item.requestData?.receivedQuantity,
    isRequest: item.isRequest && status === "pending",
    status,
  });
}

function formatDate(date: InventoryItem["dateAdded"]) {
  if (typeof date === 'string') {
    return format(new Date(date), "MMM d, yyyy");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "MMM d, yyyy");
  }
  return "N/A";
}

function formatReceivingDate(date: InventoryItem["receivingDate"]) {
  if (!date) return "N/A";
  if (typeof date === 'string') {
    return format(new Date(date), "MMM d, yyyy");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "MMM d, yyyy");
  }
  return "N/A";
}

function formatOptionalDate(date: unknown) {
  if (!date) return "N/A";
  if (typeof date === "string") {
    const d = new Date(date);
    if (Number.isNaN(d.getTime())) return "N/A";
    return format(d, "MMM d, yyyy");
  }
  if (typeof date === "object" && date !== null && "seconds" in (date as any)) {
    const sec = Number((date as any).seconds);
    if (!Number.isFinite(sec)) return "N/A";
    return format(new Date(sec * 1000), "MMM d, yyyy");
  }
  return "N/A";
}

function toDateInputValue(date: unknown): string {
  if (!date) return "";
  if (typeof date === "string") {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) return "";
    return parsed.toISOString().slice(0, 10);
  }
  if (typeof date === "object" && date !== null && "seconds" in (date as any)) {
    const sec = Number((date as any).seconds);
    if (!Number.isFinite(sec)) return "";
    return new Date(sec * 1000).toISOString().slice(0, 10);
  }
  return "";
}

function getImageUrls(data: { imageUrl?: string; imageUrls?: string[] } | undefined): string[] {
  if (!data) return [];
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) return data.imageUrls;
  if (typeof data.imageUrl === "string" && data.imageUrl.length > 0) return [data.imageUrl];
  return [];
}

const NO_IMAGE_PLACEHOLDER_SRC =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 160 160'%3E%3Crect width='160' height='160' fill='%23e5e7eb'/%3E%3Crect x='44' y='34' width='72' height='52' rx='6' ry='6' fill='none' stroke='%239ca3af' stroke-width='4'/%3E%3Ccircle cx='62' cy='52' r='5' fill='%239ca3af'/%3E%3Cpath d='M52 78l16-16 13 13 9-9 18 18H52z' fill='%239ca3af'/%3E%3Ctext x='80' y='116' text-anchor='middle' font-size='12' font-family='Arial, sans-serif' fill='%236b7280'%3ENO IMAGE%3C/text%3E%3Ctext x='80' y='132' text-anchor='middle' font-size='12' font-family='Arial, sans-serif' fill='%236b7280'%3EAVAILABLE%3C/text%3E%3C/svg%3E";

function InventoryAvatar({
  item,
  className,
  onImageClick,
}: {
  item: any;
  className: string;
  onImageClick?: (url: string, name?: string) => void;
}) {
  const imageUrl = getImageUrls(item)[0];
  const inventoryType = item?.inventoryType ?? "product";

  if (imageUrl) {
    return (
      <button
        type="button"
        className="rounded-md transition-opacity hover:opacity-90"
        onClick={() => onImageClick?.(imageUrl, item?.productName)}
        title="View picture"
      >
        <img
          src={imageUrl}
          alt={item?.productName || "Inventory item"}
          className={`${className} rounded-md border object-cover`}
        />
      </button>
    );
  }

  return (
    <img
      src={NO_IMAGE_PLACEHOLDER_SRC}
      alt={`No image available for ${item?.productName || inventoryType || "inventory item"}`}
      className={`${className} rounded-md border object-cover`}
    />
  );
}

function getTimestampMs(date: unknown): number {
  if (!date) return 0;
  if (typeof date === "string") {
    const ms = new Date(date).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  if (typeof date === "object" && date !== null && "seconds" in (date as any)) {
    const sec = Number((date as any).seconds);
    return Number.isFinite(sec) ? sec * 1000 : 0;
  }
  return 0;
}

/** Matches dashboard KPI "Low Stock SKUs" (qty 1–10, real inventory rows only). URL: ?status=low-stock */
const LOW_STOCK_STATUS_VALUE = "low-stock";

function rowIsLowStock(item: { quantity?: number; isRequest?: boolean }) {
  if (item.isRequest) return false;
  const q = Number(item.quantity) || 0;
  return q > 0 && q <= 10;
}

/** Red row styling (same classes as admin cards): low qty, exclude eBay like admin. Uses dashboard low-stock band qty 1–10. */
function inventoryRowIsLowStockStyled(item: {
  quantity?: number;
  isRequest?: boolean;
  source?: string;
}) {
  if (item.isRequest) return false;
  if (item.source === "ebay") return false;
  return rowIsLowStock(item);
}

const lowStockRowCardClass =
  "border-red-500 border-2 bg-red-50 dark:bg-red-950/20";
const lowStockTextClass = "text-red-700 dark:text-red-400";
const lowStockQtyClass = "text-red-800 dark:text-red-300";

export type AdminInventoryActions = {
  onRestock?: (item: InventoryItem) => void;
  onDispose?: (item: InventoryItem) => void;
  onEdit?: (item: InventoryItem) => void;
  onDelete?: (item: InventoryItem) => void;
};

export function InventoryTable({
  data,
  ownerUserId,
  ownerUserName,
  adminActions,
}: {
  data: InventoryItem[];
  ownerUserId?: string;
  ownerUserName?: string;
  adminActions?: AdminInventoryActions;
}) {
  const hasAdminActions = Boolean(
    adminActions && (adminActions.onRestock || adminActions.onDispose || adminActions.onEdit || adminActions.onDelete)
  );
  const searchParams = useSearchParams();
  const { userProfile } = useAuth();
  const effectiveUserId = ownerUserId || userProfile?.uid;
  const effectiveUserName = ownerUserName || userProfile?.name || "Unknown User";
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [openAddInventorySignal, setOpenAddInventorySignal] = useState(0);

  useEffect(() => {
    if (searchParams.get("status") === LOW_STOCK_STATUS_VALUE) {
      setStatusFilter(LOW_STOCK_STATUS_VALUE);
    }
  }, [searchParams]);
  useEffect(() => {
    if (searchParams.get("action") === "add-inventory") {
      setOpenAddInventorySignal((prev) => prev + 1);
    }
  }, [searchParams]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedRemarks, setSelectedRemarks] = useState<string>("");
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = useState(false);
  const [isImagePreviewOpen, setIsImagePreviewOpen] = useState(false);
  const [previewImageUrl, setPreviewImageUrl] = useState("");
  const [previewImageName, setPreviewImageName] = useState("");
  const [editingRequest, setEditingRequest] = useState<InventoryRequest | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editProductName, setEditProductName] = useState("");
  const [editQuantity, setEditQuantity] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();

  // Fetch inventory requests
  const { data: inventoryRequests } = useCollection<InventoryRequest>(
    effectiveUserId ? `users/${effectiveUserId}/inventoryRequests` : ""
  );

  const pendingCount = inventoryRequests.filter(req => req.status === "pending").length;
  const rejectedCount = inventoryRequests.filter(req => req.status === "rejected").length;

  const handleRemarksClick = (remarks: string, imageUrls?: string | string[]) => {
    setSelectedRemarks(remarks);
    // Handle both old single imageUrl and new imageUrls array
    if (Array.isArray(imageUrls)) {
      setSelectedImageUrls(imageUrls);
    } else if (typeof imageUrls === 'string') {
      setSelectedImageUrls([imageUrls]);
    } else {
      setSelectedImageUrls([]);
    }
    setIsRemarksDialogOpen(true);
  };

  const handleEditClick = (request: InventoryRequest) => {
    setEditingRequest(request);
    setEditProductName(request.productName || "");
    setEditSku((request as any).sku || "");
    setEditQuantity(request.quantity);
    setEditRetailIdentifier((request as any).retailIdentifier || "");
    setEditExpiryDate(toDateInputValue((request as any).expiryDate));
    setIsEditDialogOpen(true);
  };

  const handleImagePreview = (url: string, name?: string) => {
    setPreviewImageUrl(url);
    setPreviewImageName(name || "Inventory picture");
    setIsImagePreviewOpen(true);
  };

  const [editSku, setEditSku] = useState("");
  const [editRetailIdentifier, setEditRetailIdentifier] = useState("");
  const [editExpiryDate, setEditExpiryDate] = useState("");

  const handleUpdateRequest = async () => {
    if (!editingRequest || !effectiveUserId) return;
    
    if (!editProductName.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Product name is required.",
      });
      return;
    }

    if (!editSku.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "SKU is required.",
      });
      return;
    }

    if (editQuantity <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Quantity must be greater than 0.",
      });
      return;
    }

    setIsUpdating(true);
    try {
      const requestRef = doc(db, `users/${effectiveUserId}/inventoryRequests`, editingRequest.id);
      const updatePayload: Record<string, unknown> = {
        productName: editProductName.trim(),
        sku: editSku.trim(),
        quantity: editQuantity,
        retailIdentifier: editRetailIdentifier.trim(),
      };
      if (editExpiryDate.trim()) {
        const d = new Date(`${editExpiryDate.trim()}T12:00:00`);
        if (!Number.isNaN(d.getTime())) updatePayload.expiryDate = Timestamp.fromDate(d);
      } else {
        updatePayload.expiryDate = null;
      }
      await updateDoc(requestRef, updatePayload);

      toast({
        title: "Success",
        description: "Inventory request updated successfully.",
      });

      setIsEditDialogOpen(false);
      setEditingRequest(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update inventory request.",
      });
    } finally {
      setIsUpdating(false);
    }
  };

  // Combine inventory items and pending/rejected requests into one list
  const combinedData = useMemo(() => {
    // Get approved requests to match with inventory items for remarks
    const approvedRequests = inventoryRequests.filter(req => req.status === "approved");
    
    // Convert pending requests to display format
    const pendingItems = inventoryRequests
      .filter(req => req.status === "pending")
      .map(req => ({
        id: `request-${req.id}`,
        productName: req.productName,
        sku: (req as any).sku || "",
        variantLabel: (req as any).variantLabel,
        color: (req as any).color,
        size: (req as any).size,
        productEntryMode: (req as any).productEntryMode,
        retailIdentifier: (req as any).retailIdentifier,
        expiryDate: (req as any).expiryDate,
        quantity: req.quantity,
        dateAdded: req.addDate,
        receivingDate: undefined,
        status: "Pending" as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        inventoryType: req.inventoryType,
        requestedBy: req.requestedBy,
        remarks: req.remarks,
        imageUrls: getImageUrls(req as any),
        isRequest: true,
        requestId: req.id,
        requestData: req, // Store full request data for editing
      }));

    // Convert rejected requests to display format
    const rejectedItems = inventoryRequests
      .filter(req => req.status === "rejected")
      .map(req => ({
        id: `request-${req.id}`,
        productName: req.productName,
        sku: (req as any).sku || "",
        variantLabel: (req as any).variantLabel,
        color: (req as any).color,
        size: (req as any).size,
        productEntryMode: (req as any).productEntryMode,
        retailIdentifier: (req as any).retailIdentifier,
        expiryDate: (req as any).expiryDate,
        quantity: req.quantity,
        dateAdded: req.addDate,
        receivingDate: undefined,
        status: "Rejected" as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        inventoryType: req.inventoryType,
        requestedBy: req.requestedBy,
        remarks: req.rejectionReason || req.remarks, // Show rejection reason as remarks
        isRequest: true,
        requestId: req.id,
        requestData: req, // Store full request data
        imageUrls: getImageUrls(req as any),
      }));

    // Convert approved inventory items - get remarks from inventory item OR approved request
    const inventoryItems = data.map(item => {
      // Try to find matching approved request to get remarks
      const matchingRequest = approvedRequests.find((req) => {
        if ((item as any).sourceRequestId && req.id === (item as any).sourceRequestId) return true;
        const requestSku = ((req as any).sku || "").trim().toLowerCase();
        const itemSku = (((item as any).sku as string) || "").trim().toLowerCase();
        if (requestSku && itemSku) return requestSku === itemSku;
        const reqReceived = (req as any).receivedQuantity ?? req.quantity;
        return (
          req.productName === item.productName &&
          req.requestedBy === item.requestedBy &&
          (reqReceived === item.quantity || req.quantity === item.quantity)
        );
      });
      
      // Use remarks from inventory item first, then from approved request
      const remarks = item.remarks || matchingRequest?.remarks;
      
      const imageUrls = getImageUrls(item as any).length > 0
        ? getImageUrls(item as any)
        : getImageUrls(matchingRequest as any);
      
      return {
        ...item,
        status: item.status as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        isRequest: false,
        requestedQuantity:
          (item as any).requestedQuantity ??
          (matchingRequest as any)?.requestedQuantity ??
          (matchingRequest as any)?.quantity,
        receivedQuantity:
          (item as any).receivedQuantity ?? (matchingRequest as any)?.receivedQuantity ?? item.quantity,
        remarks: remarks && remarks.trim() ? remarks.trim() : undefined,
        imageUrls: imageUrls,
        retailIdentifier: (item as any).retailIdentifier || (matchingRequest as any)?.retailIdentifier,
        expiryDate: (item as any).expiryDate || (matchingRequest as any)?.expiryDate,
        variantLabel: (item as any).variantLabel || (matchingRequest as any)?.variantLabel,
        color: (item as any).color || (matchingRequest as any)?.color,
        size: (item as any).size || (matchingRequest as any)?.size,
        productEntryMode: (item as any).productEntryMode || (matchingRequest as any)?.productEntryMode,
      };
    });

    // Combine and sort
    return [...pendingItems, ...rejectedItems, ...inventoryItems];
  }, [data, inventoryRequests]);

  // Filtered and sorted inventory data (newest first)
  const filteredData = useMemo(() => {
    const filtered = combinedData.filter((item) => {
      const query = searchTerm.toLowerCase();
      const productName = (item.productName || "").toLowerCase();
      const sku = (((item as any).sku as string) || "").toLowerCase();
      const variantLabel = (((item as any).variantLabel as string) || "").toLowerCase();
      const retailIdentifier = (((item as any).retailIdentifier as string) || "").toLowerCase();
      const matchesSearch =
        productName.includes(query) ||
        sku.includes(query) ||
        variantLabel.includes(query) ||
        retailIdentifier.includes(query);
      const row = item as { status: string; isRequest?: boolean; quantity?: number };
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "Pending" && row.status === "Pending") ||
        (statusFilter === "In Stock" && row.status === "In Stock") ||
        (statusFilter === "Out of Stock" && row.status === "Out of Stock") ||
        (statusFilter === "Rejected" && row.status === "Rejected") ||
        (statusFilter === LOW_STOCK_STATUS_VALUE && rowIsLowStock(row));
      return matchesSearch && matchesStatus;
    });
    
    // Sort by dateAdded (newest first)
    return filtered.sort((a, b) => getTimestampMs(b.dateAdded) - getTimestampMs(a.dateAdded));
  }, [combinedData, searchTerm, statusFilter]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredData.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedData = filteredData.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, statusFilter]);

  return (
    <Card className="w-full">
      <CardHeader className="pb-2 sm:pb-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <CardTitle className="text-base sm:text-lg lg:text-xl">Your Inventory ({filteredData.length})</CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              A list of products currently in your inventory.
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {pendingCount} Pending
                </Badge>
              )}
              {rejectedCount > 0 && (
                <Badge variant="destructive" className="flex items-center gap-1">
                  <X className="h-3 w-3" />
                  {rejectedCount} Rejected
                </Badge>
              )}
            </div>
            <AddInventoryRequestForm
              targetUserId={effectiveUserId}
              targetUserName={effectiveUserName}
              openSignal={openAddInventorySignal}
            />
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:p-6">
        {/* Search and Filter Controls */}
        <div className="flex flex-col sm:flex-row gap-4 mb-6 px-6">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search product, SKU, variant, or identifier..."
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
          <div className="sm:w-56">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <Filter className="h-4 w-4 mr-2" />
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value={LOW_STOCK_STATUS_VALUE}>Low stock (qty 1–10)</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="In Stock">In Stock</SelectItem>
                <SelectItem value="Out of Stock">Out of Stock</SelectItem>
                <SelectItem value="Rejected">Rejected</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Mobile Card List */}
        <div className="block sm:hidden px-4 space-y-3">
          {filteredData.length > 0 ? (
            paginatedData.map((item) => {
              const isLowStockVisual = inventoryRowIsLowStockStyled(
                item as { quantity?: number; isRequest?: boolean; source?: string }
              );
              return (
              <div
                key={item.id}
                className={cn(
                  "rounded-lg border p-3 bg-white",
                  isLowStockVisual ? lowStockRowCardClass : "border-border"
                )}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <InventoryAvatar
                        item={item as any}
                        className="h-10 w-10"
                        onImageClick={handleImagePreview}
                      />
                      <div
                        className={cn(
                          "font-semibold text-sm",
                          isLowStockVisual && lowStockTextClass
                        )}
                      >
                        {item.productName}
                      </div>
                      {(item as any).isRequest && (item as any).requestData && item.status === "Pending" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1"
                          onClick={() => handleEditClick((item as any).requestData)}
                        >
                          <Edit className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">SKU: {(item as any).sku || "N/A"}</div>
                    {(item as any).variantLabel && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Variant: {(item as any).variantLabel}
                      </div>
                    )}
                    {(item as any).retailIdentifier && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Identifier: {(item as any).retailIdentifier}
                      </div>
                    )}
                    {(item as any).expiryDate && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        Expiry: {formatOptionalDate((item as any).expiryDate)}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground mt-1">Added: {formatDate(item.dateAdded)}</div>
                    {item.receivingDate && (
                      <div className="text-xs text-muted-foreground mt-0.5">Receiving: {formatReceivingDate(item.receivingDate)}</div>
                    )}
                    {item.remarks && item.remarks.trim() && (
                      <div className="mt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-0 text-left justify-start text-xs"
                          onClick={() => handleRemarksClick(item.remarks || "", (item as any).imageUrls || (item as any).imageUrl)}
                        >
                          <span className="text-blue-600 italic">{item.remarks}</span>
                          <Eye className="h-3 w-3 ml-1 inline-block align-middle" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="text-right ml-2">
                    <div className={cn("text-xs", isLowStockVisual && lowStockTextClass)}>Qty</div>
                    <div
                      className={cn(
                        "font-semibold text-sm",
                        isLowStockVisual && lowStockQtyClass
                      )}
                    >
                      {formatRowQuantity(item as any)}
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge 
                    variant={
                      item.status === "Pending" ? "outline" :
                      item.status === "Rejected" ? "destructive" :
                      item.status === "In Stock" ? "secondary" : "destructive"
                    }
                    className="text-[10px] px-2 py-1"
                  >
                    {item.status === "Pending" ? "Pending Approval" :
                     item.status === "Rejected" ? "Rejected" : item.status}
                  </Badge>
                  {hasAdminActions && !(item as any).isRequest && (
                    <div className="flex flex-wrap items-center gap-1 ml-auto">
                      {adminActions?.onRestock && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-emerald-300 text-emerald-700 hover:bg-emerald-50"
                          onClick={() => adminActions.onRestock?.(item as InventoryItem)}
                        >
                          <PlusCircle className="h-3 w-3 mr-1" /> Restock
                        </Button>
                      )}
                      {adminActions?.onEdit && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-blue-300 text-blue-700 hover:bg-blue-50"
                          onClick={() => adminActions.onEdit?.(item as InventoryItem)}
                        >
                          <Edit className="h-3 w-3 mr-1" /> Edit
                        </Button>
                      )}
                      {adminActions?.onDispose && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-orange-300 text-orange-700 hover:bg-orange-50"
                          onClick={() => adminActions.onDispose?.(item as InventoryItem)}
                        >
                          <Recycle className="h-3 w-3 mr-1" /> Dispose
                        </Button>
                      )}
                      {adminActions?.onDelete && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-[11px] border-red-300 text-red-700 hover:bg-red-50"
                          onClick={() => adminActions.onDelete?.(item as InventoryItem)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" /> Delete
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
            })
          ) : (
            <div className="text-center py-8 text-xs text-gray-500">
              {combinedData.length === 0 ? "No inventory items or requests found." : "No items match your search criteria."}
            </div>
          )}
        </div>

        {/* Desktop/Table View */}
        <div className="hidden sm:block">
          <Table containerClassName="overflow-x-auto overflow-y-hidden mouse-h-scroll">
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs sm:text-sm">Product</TableHead>
                <TableHead className="text-xs sm:text-sm hidden md:table-cell">SKU</TableHead>
                <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Identifier</TableHead>
                <TableHead className="text-xs sm:text-sm hidden xl:table-cell">Expiry</TableHead>
                <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Quantity</TableHead>
                <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Date Added</TableHead>
                <TableHead className="text-xs sm:text-sm hidden md:table-cell">Receiving Date</TableHead>
                <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Remarks</TableHead>
                <TableHead className="text-xs sm:text-sm">Status</TableHead>
                {hasAdminActions && (
                  <TableHead className="text-xs sm:text-sm text-right">Actions</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length > 0 ? (
                paginatedData.map((item) => {
                  const isLowStockVisual = inventoryRowIsLowStockStyled(
                    item as { quantity?: number; isRequest?: boolean; source?: string }
                  );
                  return (
               <TableRow
                 key={item.id}
                 className={cn(
                   "text-xs sm:text-sm [&>td]:py-2 [&>td]:align-middle",
                   isLowStockVisual && lowStockRowCardClass
                 )}
               >
                    <TableCell className="font-medium max-w-32 sm:max-w-none truncate whitespace-nowrap">
                      <div className="flex flex-col sm:block">
                        <div className="flex items-center gap-2">
                          <InventoryAvatar
                            item={item as any}
                            className="h-8 w-8"
                            onImageClick={handleImagePreview}
                          />
                          <span
                            className={cn(
                              "font-medium",
                              isLowStockVisual && lowStockTextClass
                            )}
                          >
                            {item.productName}
                          </span>
                          {(item as any).isRequest && (item as any).requestData && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-auto p-1"
                              onClick={() => handleEditClick((item as any).requestData)}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                        {(item as any).variantLabel && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {(item as any).variantLabel}
                          </p>
                        )}
                        <div className="sm:hidden mt-1 space-y-0.5">
                          <span
                            className={cn(
                              "text-xs",
                              isLowStockVisual ? lowStockQtyClass : "text-gray-500"
                            )}
                          >
                            Qty: {formatRowQuantity(item as any)}
                          </span>
                          <br />
                          <span className="text-gray-500 text-xs">Added: {formatDate(item.dateAdded)}</span>
                          {item.receivingDate && (
                            <>
                              <br />
                              <span className="text-gray-500 text-xs">Receiving: {formatReceivingDate(item.receivingDate)}</span>
                            </>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell whitespace-nowrap">{(item as any).sku || "N/A"}</TableCell>
                    <TableCell className="hidden lg:table-cell whitespace-nowrap">
                      {(item as any).retailIdentifier || "N/A"}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell whitespace-nowrap">
                      {(item as any).expiryDate ? formatOptionalDate((item as any).expiryDate) : "N/A"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "hidden sm:table-cell whitespace-nowrap",
                        isLowStockVisual && lowStockQtyClass
                      )}
                    >
                      {formatRowQuantity(item as any)}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell whitespace-nowrap">
                      {formatDate(item.dateAdded)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell whitespace-nowrap">
                      {formatReceivingDate(item.receivingDate)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell max-w-[180px]">
                      {item.remarks && item.remarks.trim() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 text-left justify-start w-full max-w-[180px] truncate"
                          onClick={() => handleRemarksClick(item.remarks || "", (item as any).imageUrls || (item as any).imageUrl)}
                        >
                          <span className="truncate text-xs">{item.remarks}</span>
                          <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge 
                        variant={
                          item.status === "Pending" ? "outline" :
                          item.status === "Rejected" ? "destructive" :
                          item.status === "In Stock" ? "secondary" : "destructive"
                        }
                        className="text-xs px-2 py-1"
                      >
                        {item.status === "Pending" ? "Pending Approval" :
                         item.status === "Rejected" ? "Rejected" : item.status}
                      </Badge>
                    </TableCell>
                    {hasAdminActions && (
                      <TableCell className="whitespace-nowrap text-right">
                        {!(item as any).isRequest ? (
                          <div className="inline-flex items-center gap-1">
                            {adminActions?.onRestock && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-emerald-700 hover:bg-emerald-50"
                                title="Restock"
                                onClick={() => adminActions.onRestock?.(item as InventoryItem)}
                              >
                                <PlusCircle className="h-4 w-4" />
                              </Button>
                            )}
                            {adminActions?.onEdit && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-blue-700 hover:bg-blue-50"
                                title="Edit (logged)"
                                onClick={() => adminActions.onEdit?.(item as InventoryItem)}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                            )}
                            {adminActions?.onDispose && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-orange-700 hover:bg-orange-50"
                                title="Dispose"
                                onClick={() => adminActions.onDispose?.(item as InventoryItem)}
                              >
                                <Recycle className="h-4 w-4" />
                              </Button>
                            )}
                            {adminActions?.onDelete && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-red-700 hover:bg-red-50"
                                title="Delete (logged)"
                                onClick={() => adminActions.onDelete?.(item as InventoryItem)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">-</span>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
                })
              ) : (
                <TableRow>
                  <TableCell colSpan={hasAdminActions ? 10 : 9} className="text-center py-8">
                    <div className="text-xs sm:text-sm text-gray-500">
                      {combinedData.length === 0 ? "No inventory items or requests found." : "No items match your search criteria."}
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
            <DialogTitle>Admin Remarks</DialogTitle>
            <DialogDescription>Remarks from admin for this inventory item</DialogDescription>
          </DialogHeader>
          <div className="mt-4 overflow-y-auto max-h-[60vh] space-y-4">
            {selectedImageUrls.length > 0 && (
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-semibold mb-2">
                  Inventory Pictures ({selectedImageUrls.length})
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedImageUrls.map((url, index) => (
                    <div key={index} className="relative">
                      <img
                        src={url}
                        alt={`Inventory ${index + 1}`}
                        className="max-w-full h-auto rounded-lg border"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="bg-gray-50 p-4 rounded-lg">
              <p className="text-sm font-semibold mb-2">Remarks</p>
              <p className="text-sm whitespace-pre-wrap break-words overflow-wrap-anywhere">
                {selectedRemarks || "No remarks available"}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Inventory Request Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Inventory Request</DialogTitle>
            <DialogDescription>
              Update the product name and quantity. You can only edit pending requests.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label htmlFor="edit-product-name" className="text-sm font-medium">Product Name</label>
              <Input
                id="edit-product-name"
                value={editProductName}
                onChange={(e) => setEditProductName(e.target.value)}
                placeholder="Enter product name"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-sku" className="text-sm font-medium">SKU</label>
              <Input
                id="edit-sku"
                value={editSku}
                onChange={(e) => setEditSku(e.target.value)}
                placeholder="Enter SKU"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-quantity" className="text-sm font-medium">Quantity</label>
              <Input
                id="edit-quantity"
                type="number"
                min="1"
                value={editQuantity}
                onChange={(e) => setEditQuantity(parseInt(e.target.value) || 0)}
                placeholder="Enter quantity"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-retail-identifier" className="text-sm font-medium">
                UPC / EAN / FNSKU / ASIN (optional)
              </label>
              <Input
                id="edit-retail-identifier"
                value={editRetailIdentifier}
                onChange={(e) => setEditRetailIdentifier(e.target.value)}
                placeholder="Identifier for this product"
                className="mt-1"
              />
            </div>
            <div>
              <label htmlFor="edit-expiry" className="text-sm font-medium">Expiry date (optional)</label>
              <Input
                id="edit-expiry"
                type="date"
                value={editExpiryDate}
                onChange={(e) => setEditExpiryDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button
                variant="outline"
                onClick={() => {
                  setIsEditDialogOpen(false);
                  setEditingRequest(null);
                }}
                disabled={isUpdating}
              >
                Cancel
              </Button>
              <Button
                onClick={handleUpdateRequest}
                disabled={isUpdating}
              >
                {isUpdating ? "Updating..." : "Update Request"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Preview Dialog */}
      <Dialog open={isImagePreviewOpen} onOpenChange={setIsImagePreviewOpen}>
        <DialogContent className="max-w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{previewImageName || "Inventory picture"}</DialogTitle>
            <DialogDescription>Image preview</DialogDescription>
          </DialogHeader>
          {previewImageUrl && (
            <div className="mt-2 flex items-center justify-center rounded-lg border bg-muted/20 p-3">
              <img
                src={previewImageUrl}
                alt={previewImageName || "Inventory picture"}
                className="max-h-[70vh] w-auto max-w-full rounded-md object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

