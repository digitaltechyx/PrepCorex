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
import { Search, Filter, X, Clock, Eye, Edit } from "lucide-react";
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
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Label } from "@/components/ui/label";

function formatDate(date: InventoryItem["dateAdded"]) {
  if (typeof date === 'string') {
    return format(new Date(date), "PPP");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "PPP");
  }
  return "N/A";
}

function formatReceivingDate(date: InventoryItem["receivingDate"]) {
  if (!date) return "N/A";
  if (typeof date === 'string') {
    return format(new Date(date), "PPP");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "PPP");
  }
  return "N/A";
}

/** Matches dashboard KPI "Low Stock SKUs" (qty 1–10, real inventory rows only). URL: ?status=low-stock */
const LOW_STOCK_STATUS_VALUE = "low-stock";

function rowIsLowStock(item: { quantity?: number; isRequest?: boolean }) {
  if (item.isRequest) return false;
  const q = Number(item.quantity) || 0;
  return q > 0 && q <= 10;
}

export function InventoryTable({ data }: { data: InventoryItem[] }) {
  const searchParams = useSearchParams();
  const { userProfile } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  useEffect(() => {
    if (searchParams.get("status") === LOW_STOCK_STATUS_VALUE) {
      setStatusFilter(LOW_STOCK_STATUS_VALUE);
    }
  }, [searchParams]);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedRemarks, setSelectedRemarks] = useState<string>("");
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = useState(false);
  const [editingRequest, setEditingRequest] = useState<InventoryRequest | null>(null);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editProductName, setEditProductName] = useState("");
  const [editQuantity, setEditQuantity] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);
  const { toast } = useToast();

  // Fetch inventory requests
  const { data: inventoryRequests } = useCollection<InventoryRequest>(
    userProfile ? `users/${userProfile.uid}/inventoryRequests` : ""
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
    setIsEditDialogOpen(true);
  };

  const [editSku, setEditSku] = useState("");

  const handleUpdateRequest = async () => {
    if (!editingRequest || !userProfile) return;
    
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
      const requestRef = doc(db, `users/${userProfile.uid}/inventoryRequests`, editingRequest.id);
      await updateDoc(requestRef, {
        productName: editProductName.trim(),
        sku: editSku.trim(),
        quantity: editQuantity,
      });

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
        quantity: req.quantity,
        dateAdded: req.addDate,
        receivingDate: undefined,
        status: "Pending" as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        inventoryType: req.inventoryType,
        requestedBy: req.requestedBy,
        remarks: req.remarks,
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
        imageUrl: (req as any)?.imageUrl || undefined,
      }));

    // Convert approved inventory items - get remarks from inventory item OR approved request
    const inventoryItems = data.map(item => {
      // Try to find matching approved request to get remarks
      const matchingRequest = approvedRequests.find(req => 
        req.productName === item.productName && 
        req.requestedBy === item.requestedBy &&
        req.quantity === item.quantity
      );
      
      // Use remarks from inventory item first, then from approved request
      const remarks = item.remarks || matchingRequest?.remarks;
      
      // Get imageUrls from inventory item or matching request
      // Handle both old single imageUrl and new imageUrls array
      let imageUrls: string[] | undefined = undefined;
      const itemImageUrls = (item as any).imageUrls;
      const itemImageUrl = (item as any).imageUrl;
      const requestImageUrls = (matchingRequest as any)?.imageUrls;
      const requestImageUrl = (matchingRequest as any)?.imageUrl;
      
      if (itemImageUrls && Array.isArray(itemImageUrls) && itemImageUrls.length > 0) {
        imageUrls = itemImageUrls;
      } else if (requestImageUrls && Array.isArray(requestImageUrls) && requestImageUrls.length > 0) {
        imageUrls = requestImageUrls;
      } else if (itemImageUrl && typeof itemImageUrl === 'string') {
        imageUrls = [itemImageUrl];
      } else if (requestImageUrl && typeof requestImageUrl === 'string') {
        imageUrls = [requestImageUrl];
      }
      
      return {
        ...item,
        status: item.status as "Pending" | "In Stock" | "Out of Stock" | "Rejected",
        isRequest: false,
        remarks: remarks && remarks.trim() ? remarks.trim() : undefined,
        imageUrls: imageUrls,
      };
    });

    // Combine and sort
    return [...pendingItems, ...rejectedItems, ...inventoryItems];
  }, [data, inventoryRequests]);

  // Filtered and sorted inventory data (newest first)
  const filteredData = useMemo(() => {
    const filtered = combinedData.filter((item) => {
      const matchesSearch = item.productName.toLowerCase().includes(searchTerm.toLowerCase());
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
    return filtered.sort((a, b) => {
      const dateA = typeof a.dateAdded === 'string' 
        ? new Date(a.dateAdded) 
        : new Date((a.dateAdded as { seconds: number; nanoseconds: number }).seconds * 1000);
      const dateB = typeof b.dateAdded === 'string' 
        ? new Date(b.dateAdded) 
        : new Date((b.dateAdded as { seconds: number; nanoseconds: number }).seconds * 1000);
      return dateB.getTime() - dateA.getTime(); // Newest first
    });
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
            <AddInventoryRequestForm />
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
                placeholder="Search products..."
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
            paginatedData.map((item) => (
              <div key={item.id} className="border rounded-lg p-3 bg-white">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold text-sm">{item.productName}</div>
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
                    <div className="text-xs">Qty</div>
                    <div className="font-semibold text-sm">{item.quantity}</div>
                  </div>
                </div>
                <div className="mt-2">
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
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-xs text-gray-500">
              {combinedData.length === 0 ? "No inventory items or requests found." : "No items match your search criteria."}
            </div>
          )}
        </div>

        {/* Desktop/Table View */}
        <div className="hidden sm:block overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs sm:text-sm">Product</TableHead>
                <TableHead className="text-xs sm:text-sm hidden md:table-cell">SKU</TableHead>
                <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Quantity</TableHead>
                <TableHead className="text-xs sm:text-sm hidden sm:table-cell">Date Added</TableHead>
                <TableHead className="text-xs sm:text-sm hidden md:table-cell">Receiving Date</TableHead>
                <TableHead className="text-xs sm:text-sm hidden lg:table-cell">Remarks</TableHead>
                <TableHead className="text-xs sm:text-sm">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredData.length > 0 ? (
                paginatedData.map((item) => (
               <TableRow key={item.id} className="text-xs sm:text-sm">
                    <TableCell className="font-medium max-w-32 sm:max-w-none truncate">
                      <div className="flex flex-col sm:block">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.productName}</span>
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
                        <div className="sm:hidden mt-1 space-y-0.5">
                          <span className="text-gray-500 text-xs">Qty: {item.quantity}</span>
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
                    <TableCell className="hidden md:table-cell">{(item as any).sku || "N/A"}</TableCell>
                    <TableCell className="hidden sm:table-cell">{item.quantity}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {formatDate(item.dateAdded)}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {formatReceivingDate(item.receivingDate)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell max-w-xs">
                      {item.remarks && item.remarks.trim() ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-auto p-1 text-left justify-start max-w-xs truncate"
                          onClick={() => handleRemarksClick(item.remarks || "", (item as any).imageUrls || (item as any).imageUrl)}
                        >
                          <span className="truncate text-xs">{item.remarks}</span>
                          <Eye className="h-3 w-3 ml-1 flex-shrink-0" />
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
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
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8">
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
                <Label className="text-sm font-semibold mb-2 block">
                  Inventory Pictures ({selectedImageUrls.length})
                </Label>
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
              <Label className="text-sm font-semibold mb-2 block">Remarks</Label>
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
              <Label htmlFor="edit-product-name">Product Name</Label>
              <Input
                id="edit-product-name"
                value={editProductName}
                onChange={(e) => setEditProductName(e.target.value)}
                placeholder="Enter product name"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-sku">SKU</Label>
              <Input
                id="edit-sku"
                value={editSku}
                onChange={(e) => setEditSku(e.target.value)}
                placeholder="Enter SKU"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="edit-quantity">Quantity</Label>
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
    </Card>
  );
}

