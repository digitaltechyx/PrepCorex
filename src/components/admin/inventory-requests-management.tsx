"use client";

import { useState, useMemo } from "react";
import React from "react";
import type { UserProfile } from "@/types";

// Define InventoryRequest locally since it's not exported from @/types
interface InventoryRequest {
  id: string;
  userId?: string;
  userName?: string;
  inventoryType: "product" | "box" | "pallet" | "container";
  productName: string;
  quantity: number;
  addDate?: any;
  requestedAt?: any;
  receivingDate?: any;
  status: "pending" | "approved" | "rejected";
  requestedBy?: string;
  approvedBy?: string;
  approvedAt?: any;
  rejectedBy?: string;
  rejectedAt?: any;
  rejectionReason?: string;
  remarks?: string;
  imageUrl?: string;
  imageUrls?: string[];
  [key: string]: any;
}

type InventoryRequestProcessOpts = {
  quiet?: boolean;
  skipBatchSync?: boolean;
};

interface InventoryItemLite {
  id: string;
  productName?: string;
  sku?: string;
  locationId?: string;
}
import type { InboundBatch, InboundBatchLine } from "@/types";
import {
  ensureInventoryRequestForBatchLine,
  batchLineToInventoryRequest,
  formatLoadContentsLabel,
  formatShipmentTypeLabel,
  inboundBatchesPath,
  inboundBatchLinesPath,
  refreshInboundBatchCounts,
  syncBatchLineStatus,
} from "@/lib/inbound-batch";
import { InboundBatchAdminDialog } from "@/components/admin/inbound-batch-admin-dialog";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
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
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/ui/date-picker";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { db, storage } from "@/lib/firebase";
import { doc, updateDoc, addDoc, collection, Timestamp, runTransaction, query, where, getDocs } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";
import { format } from "date-fns";
import { Archive, Boxes, Check, Clock, Eye, Filter, Loader2, Package, Search, Truck, Upload, X, ImageOff } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import imageCompression from "browser-image-compression";
import { formatInboundQuantityDisplay, getRequestedQuantity } from "@/lib/inventory-qty-display";
import { closeInventoryRequest } from "@/lib/client-inventory-inbound-sync";

function formatDate(date: InventoryRequest["addDate"] | InventoryRequest["requestedAt"] | InventoryRequest["receivingDate"]) {
  if (!date) return "N/A";
  if (typeof date === 'string') {
    return format(new Date(date), "PPP");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "PPP");
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
  if (date && typeof date === "object" && "seconds" in (date as any)) {
    return format(new Date((date as any).seconds * 1000), "MMM d, yyyy");
  }
  return "N/A";
}

function getImageUrls(data: { imageUrl?: string; imageUrls?: string[] } | undefined): string[] {
  if (!data) return [];
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) return data.imageUrls;
  if (typeof data.imageUrl === "string" && data.imageUrl.length > 0) return [data.imageUrl];
  return [];
}

function InventoryTypePill({ type }: { type: InventoryRequest["inventoryType"] }) {
  const icon =
    type === "box" ? <Archive className="h-3.5 w-3.5" /> :
    type === "pallet" ? <Boxes className="h-3.5 w-3.5" /> :
    type === "container" ? <Truck className="h-3.5 w-3.5" /> :
    <Package className="h-3.5 w-3.5" />;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs capitalize">
      {icon}
      {type}
    </span>
  );
}

function InventoryAvatar({ request }: { request: InventoryRequest }) {
  const imageUrl = getImageUrls(request as any)[0];
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={request.productName}
        className="h-8 w-8 rounded-md border object-cover"
      />
    );
  }

  if (request.inventoryType === "box") return <Archive className="h-8 w-8 rounded-md border p-2 text-muted-foreground" />;
  if (request.inventoryType === "pallet") return <Boxes className="h-8 w-8 rounded-md border p-2 text-muted-foreground" />;
  if (request.inventoryType === "container") return <Truck className="h-8 w-8 rounded-md border p-2 text-muted-foreground" />;
  return <ImageOff className="h-8 w-8 rounded-md border p-2 text-muted-foreground" />;
}

export function InventoryRequestsManagement({ 
  selectedUser,
  initialRequestId,
}: { 
  selectedUser: UserProfile | null;
  initialRequestId?: string;
}) {
  const { toast } = useToast();
  const { userProfile: adminProfile } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState<InventoryRequest | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<InboundBatch | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Normalize user ID - use uid
  const userId = selectedUser?.uid;
  const isValidUserId = userId && typeof userId === 'string' && userId.trim() !== '';
  
  const { data: requests, loading, error } = useCollection<InventoryRequest>(
    isValidUserId ? `users/${userId}/inventoryRequests` : ""
  );
  const { data: inboundBatches, loading: batchesLoading } = useCollection<InboundBatch>(
    isValidUserId ? inboundBatchesPath(userId) : ""
  );
  const { data: currentInventory } = useCollection<InventoryItemLite>(
    isValidUserId ? `users/${userId}/inventory` : ""
  );

  // Auto-open a request when coming from Notifications
  const [didAutoOpen, setDidAutoOpen] = useState(false);
  React.useEffect(() => {
    if (didAutoOpen) return;
    if (!initialRequestId) return;
    const match = requests.find((r: any) => r.id === initialRequestId);
    if (match) {
      setSelectedRequest(match);
      setDidAutoOpen(true);
      return;
    }
    const batchMatch = inboundBatches.find((b: any) => b.id === initialRequestId);
    if (batchMatch) {
      setSelectedBatch(batchMatch);
      setDidAutoOpen(true);
    }
  }, [didAutoOpen, inboundBatches, initialRequestId, requests]);

  // Debug logging
  React.useEffect(() => {
    if (selectedUser) {
      console.log("Inventory Requests Debug:", {
        selectedUser: userId,
        selectedUserName: selectedUser.name,
        requestsCount: requests.length,
        requests: requests,
        loading,
        error: error?.message,
      });
    }
  }, [selectedUser, requests, loading, error]);

  // Sort and filter requests - latest first
  const filteredRequests = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    let filtered = statusFilter === "all" ? requests : requests.filter(req => req.status === statusFilter);
    // Hide legacy rows that belong to a batch mirror (shown via batch preview).
    filtered = filtered.filter((req) => !(req as InventoryRequest & { batchId?: string }).batchId);
    filtered = filtered.filter((req) => {
      if (!query) return true;
      const productName = (req.productName || "").toLowerCase();
      const sku = String((req as any).sku || "").toLowerCase();
      const variantLabel = String((req as any).variantLabel || "").toLowerCase();
      const retailIdentifier = String((req as any).retailIdentifier || "").toLowerCase();
      return (
        productName.includes(query) ||
        sku.includes(query) ||
        variantLabel.includes(query) ||
        retailIdentifier.includes(query)
      );
    });
    
    // Sort by requestedAt (most recent first), fallback to addDate if requestedAt is not available
    filtered = [...filtered].sort((a, b) => {
      const getDate = (req: InventoryRequest) => {
        if (req.requestedAt) {
          if (typeof req.requestedAt === 'string') {
            return new Date(req.requestedAt).getTime();
          }
          if (req.requestedAt && typeof req.requestedAt === 'object' && 'seconds' in req.requestedAt) {
            return req.requestedAt.seconds * 1000;
          }
        }
        if (req.addDate) {
          if (typeof req.addDate === 'string') {
            return new Date(req.addDate).getTime();
          }
          if (req.addDate && typeof req.addDate === 'object' && 'seconds' in req.addDate) {
            return req.addDate.seconds * 1000;
          }
        }
        return 0;
      };
      
      const dateA = getDate(a);
      const dateB = getDate(b);
      return dateB - dateA; // Descending order (newest first)
    });
    
    return filtered;
  }, [requests, statusFilter, searchTerm]);

  // Pagination
  const totalPages = Math.ceil(filteredRequests.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedRequests = filteredRequests.slice(startIndex, endIndex);

  // Reset to page 1 when filter changes
  React.useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, searchTerm]);

  const filteredBatches = useMemo(() => {
    let batches = [...inboundBatches];
    if (statusFilter === "pending") {
      batches = batches.filter((b) => b.status === "pending" || b.status === "partial");
    } else if (statusFilter !== "all") {
      batches = batches.filter((b) => b.status === statusFilter);
    }
    return batches.sort((a, b) => {
      const ta = a.requestedAt && typeof a.requestedAt === "object" && "seconds" in a.requestedAt
        ? a.requestedAt.seconds * 1000
        : 0;
      const tb = b.requestedAt && typeof b.requestedAt === "object" && "seconds" in b.requestedAt
        ? b.requestedAt.seconds * 1000
        : 0;
      return tb - ta;
    });
  }, [inboundBatches, statusFilter]);

  const pendingCount =
    requests.filter((req) => req.status === "pending" && !(req as InventoryRequest & { batchId?: string }).batchId).length +
    inboundBatches.filter((b) => b.status === "pending" || b.status === "partial").length;
  const approvedCount = requests.filter(req => req.status === "approved").length;
  const rejectedCount = requests.filter(req => req.status === "rejected").length;
  const cancelledCount = requests.filter(req => req.status === "cancelled").length;

  const getCurrentLocation = (request: InventoryRequest): string => {
    const requestSku = String((request as any).sku || "").trim().toLowerCase();
    if (requestSku) {
      const bySku = currentInventory.find((inv) => String(inv.sku || "").trim().toLowerCase() === requestSku);
      if (bySku?.locationId) return bySku.locationId;
    }
    const byName = currentInventory.find(
      (inv) => String(inv.productName || "").trim().toLowerCase() === String(request.productName || "").trim().toLowerCase()
    );
    return byName?.locationId || "N/A";
  };

  const refreshBatchCounts = async (batchId: string) => {
    if (!userId) return;
    const linesSnap = await getDocs(collection(db, inboundBatchLinesPath(userId, batchId)));
    const counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: linesSnap.size };
    linesSnap.forEach((snap) => {
      const lineStatus = String(snap.data().status || "pending");
      if (lineStatus === "approved") counts.approved++;
      else if (lineStatus === "rejected") counts.rejected++;
      else if (lineStatus === "cancelled") counts.cancelled++;
      else counts.pending++;
    });
    await refreshInboundBatchCounts(userId, batchId, counts);
  };

  const handleReviewBatchLine = async (request: InventoryRequest) => {
    if (!selectedBatch || !userId) {
      setSelectedRequest(request);
      return;
    }
    const batchLineId = (request as InventoryRequest & { batchLineId?: string }).batchLineId;
    if (!batchLineId) {
      setSelectedRequest(request);
      return;
    }
    try {
      const requestId = await ensureInventoryRequestForBatchLine(userId, selectedBatch, {
        id: batchLineId,
        batchId: selectedBatch.id,
        lineNumber: 0,
        inventoryType: request.inventoryType,
        productName: request.productName,
        quantity: request.quantity,
        requestedQuantity: request.requestedQuantity ?? request.quantity,
        sku: (request as InventoryRequest & { sku?: string }).sku,
        retailIdentifier: (request as InventoryRequest & { retailIdentifier?: string }).retailIdentifier,
        expiryDate: (request as InventoryRequest & { expiryDate?: InventoryRequest["expiryDate"] }).expiryDate,
        productSubType: (request as InventoryRequest & { productSubType?: "new" | "restock" }).productSubType,
        productId: (request as InventoryRequest & { productId?: string }).productId,
        productEntryMode: (request as InventoryRequest & { productEntryMode?: "single" | "variants" }).productEntryMode,
        color: (request as InventoryRequest & { color?: string }).color,
        size: (request as InventoryRequest & { size?: string }).size,
        variantLabel: (request as InventoryRequest & { variantLabel?: string }).variantLabel,
        parentProductName: (request as InventoryRequest & { parentProductName?: string }).parentProductName,
        status: "pending",
        remarks: request.remarks,
        imageUrl: request.imageUrl,
        imageUrls: request.imageUrls,
      });
      setSelectedRequest({ ...request, id: requestId, batchId: selectedBatch.id, batchLineId });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Could not open review",
        description: error instanceof Error ? error.message : "Failed to prepare line for review.",
      });
    }
  };

  const handleApprove = async (
    request: InventoryRequest,
    receivingDate: Date,
    status: "In Stock" | "Out of Stock",
    remarks?: string,
    editedQuantity?: number,
    editedProductName?: string,
    editedSku?: string,
    imageUrls?: string[],
    opts?: InventoryRequestProcessOpts
  ) => {
    if (!selectedUser || !adminProfile) return;
    if (request.status !== "pending") {
      if (!opts?.quiet) {
        toast({
          variant: "destructive",
          title: "Request unavailable",
          description: "This request is no longer pending and cannot be approved.",
        });
      }
      throw new Error("Request is not pending.");
    }

    if (!opts?.quiet) setIsProcessing(true);
    try {
      // Prepare remarks - trim whitespace
      const remarksToSave = remarks ? remarks.trim() : "";
      console.log("=== APPROVAL DEBUG ===");
      console.log("Original remarks parameter:", remarks);
      console.log("Remarks type:", typeof remarks);
      console.log("Remarks value:", remarks);
      console.log("Remarks trimmed:", remarksToSave);
      console.log("Remarks length:", remarksToSave.length);
      
      // Calculate final values outside transaction for use in invoice generation
      const requestedQty = getRequestedQuantity(request as any);
      const finalQuantity = editedQuantity !== undefined ? editedQuantity : requestedQty;
      const finalProductName = editedProductName && editedProductName.trim() ? editedProductName.trim() : request.productName;
      const finalSku = request.inventoryType === "product" 
        ? (editedSku && editedSku.trim() ? editedSku.trim() : ((request as any).sku || ""))
        : undefined;
      
      // Normalize imageUrls - preserve request image if admin does not upload a new one
      const requestImageUrls = getImageUrls(request as any);
      const finalImageUrls = imageUrls && imageUrls.length > 0 ? imageUrls : requestImageUrls;
      
      let createdInventoryDocId: string | null = null;
      await runTransaction(db, async (transaction) => {
        // STEP 1: ALL READS FIRST (before any writes)
        const requestRef = doc(db, `users/${userId}/inventoryRequests`, request.id);
        const approvedAt = Timestamp.now();
        const receivingDateTimestamp = Timestamp.fromDate(receivingDate);
        
        // Check if this is a restock request
        const isRestock = (request as any).productSubType === "restock" && (request as any).productId;
        
        // Read existing product if restock (MUST BE BEFORE ANY WRITES)
        let existingProductDoc = null;
        let existingProductRef = null;
        if (isRestock) {
          existingProductRef = doc(db, `users/${userId}/inventory`, (request as any).productId);
          existingProductDoc = await transaction.get(existingProductRef);
        }

        // STEP 2: ALL WRITES AFTER ALL READS
        // Prepare request update data (combine all updates into one)
        const requestUpdateData: any = {
          status: "approved",
          approvedBy: adminProfile.uid,
          approvedAt,
          receivingDate: receivingDateTimestamp,
          remarks: remarksToSave,
          imageUrls: finalImageUrls,
        };
        
        requestUpdateData.requestedQuantity = requestedQty;
        requestUpdateData.receivedQuantity = finalQuantity;
        if (editedProductName && editedProductName.trim()) {
          requestUpdateData.productName = finalProductName;
        }
        if (request.inventoryType === "product" && editedSku && editedSku.trim()) {
          requestUpdateData.sku = finalSku;
        }

        const warehouseInboundV2 = request.inventoryType === "product";
        if (warehouseInboundV2) {
          requestUpdateData.fulfillmentStatus = "open";
          requestUpdateData.warehouseGoodReceivedQty = 0;
          requestUpdateData.warehouseDamagedReceivedQty = 0;
        }
        
        // Update request status (single update with all changes)
        transaction.update(requestRef, requestUpdateData);
        
        // Handle inventory update/create (legacy: box/pallet/container; products use warehouse putaway)
        if (!warehouseInboundV2) {
        if (isRestock && existingProductDoc && existingProductDoc.exists()) {
          // For restock: Update existing inventory item
          const existingData = existingProductDoc.data();
          const currentQuantity = existingData.quantity || 0;
          const newQuantity = currentQuantity + finalQuantity;
          
          // Update existing product with new quantity
          const restockUpdate: Record<string, unknown> = {
            quantity: newQuantity,
            requestedQuantity: requestedQty,
            receivedQuantity: finalQuantity,
            receivingDate: receivingDateTimestamp,
            approvedBy: adminProfile.uid,
            approvedAt,
            remarks: remarksToSave,
            imageUrls: finalImageUrls,
            sourceRequestId: request.id,
          };
          if (Array.isArray((request as any).inboundTrackings) && (request as any).inboundTrackings.length > 0) {
            restockUpdate.inboundTrackings = (request as any).inboundTrackings;
          }
          transaction.update(existingProductRef!, restockUpdate);
        } else {
          // For new product/box/pallet OR restock with product not found: Create new inventory item
          const inventoryRef = collection(db, `users/${userId}/inventory`);
          const addDate = request.addDate && typeof request.addDate === 'object' && 'seconds' in request.addDate
            ? Timestamp.fromMillis(request.addDate.seconds * 1000)
            : Timestamp.now();
          
          const finalData: any = {
            productName: finalProductName,
            quantity: finalQuantity,
            requestedQuantity: requestedQty,
            receivedQuantity: finalQuantity,
            sourceRequestId: request.id,
            dateAdded: addDate,
            receivingDate: receivingDateTimestamp,
            status,
            inventoryType: request.inventoryType,
            requestedBy: request.requestedBy,
            approvedBy: adminProfile.uid,
            approvedAt,
            remarks: remarksToSave,
            imageUrls: finalImageUrls,
          };
          if (Array.isArray((request as any).inboundTrackings) && (request as any).inboundTrackings.length > 0) {
            finalData.inboundTrackings = (request as any).inboundTrackings;
          }
          
          // Only include SKU for product type
          if (request.inventoryType === "product" && finalSku) {
            finalData.sku = finalSku;
          }
          
          const newInventoryDocRef = doc(inventoryRef);
          createdInventoryDocId = newInventoryDocRef.id;
          transaction.set(newInventoryDocRef, finalData);
        }
        }
      });

      // Track pallet storage lifecycle as individual 30-day billing cycles.
      if (request.inventoryType === "pallet" && status === "In Stock" && finalQuantity > 0) {
        const assignedAt = Timestamp.fromDate(receivingDate);
        const freeUntil = Timestamp.fromDate(
          new Date(receivingDate.getTime() + 7 * 24 * 60 * 60 * 1000)
        );
        const nextInvoiceDate = Timestamp.fromDate(
          new Date(receivingDate.getTime() + 7 * 24 * 60 * 60 * 1000)
        );
        for (let i = 0; i < finalQuantity; i += 1) {
          await addDoc(collection(db, `users/${userId}/palletStorageCycles`), {
            status: "active",
            source: "inventory_request_approval",
            sourceRequestId: request.id,
            sourceInventoryId: createdInventoryDocId,
            palletSequence: i + 1,
            assignedAt,
            freeUntil,
            nextInvoiceDate,
            paidCycleCount: 0,
            createdAt: Timestamp.now(),
            updatedAt: Timestamp.now(),
            assignedBy: adminProfile.uid,
            note: `Pallet approved from request ${request.id}`,
          });
        }
      }

      // Generate invoice for container handling requests
      if (request.inventoryType === "container") {
        try {
          const containerSize = (request as any).containerSize as string;
          if (containerSize) {
            // Fetch container handling pricing
            const containerPricingRef = collection(db, `users/${userId}/containerHandlingPricing`);
            const containerPricingQuery = query(
              containerPricingRef,
              where("containerSize", "==", containerSize)
            );
            const containerPricingSnapshot = await getDocs(containerPricingQuery);
            
            if (!containerPricingSnapshot.empty) {
              const latestPricing = containerPricingSnapshot.docs
                .sort((a, b) => {
                  const aUpdated = a.data().updatedAt?.seconds || 0;
                  const bUpdated = b.data().updatedAt?.seconds || 0;
                  return bUpdated - aUpdated;
                })[0];
              
              const pricing = latestPricing.data();
              const unitPrice = pricing.price;
              const totalAmount = unitPrice * finalQuantity;
              
              // Generate invoice number
              const today = new Date();
              const invoiceNumber = `INV-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-8)}`;
              const orderNumber = `ORD-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-4)}`;
              
              // Create invoice with standard format
              const invoiceData = {
                invoiceNumber,
                date: format(today, 'dd/MM/yyyy'),
                orderNumber,
                soldTo: {
                  name: selectedUser.name || 'Unknown User',
                  email: selectedUser.email || '',
                  phone: selectedUser.phone || '',
                  address: selectedUser.address || '',
                },
                fbm: 'Container Handling',
                items: [{
                  quantity: finalQuantity,
                  productName: `Container Handling - ${containerSize}`,
                  receivingDate: format(receivingDate, 'dd/MM/yyyy'),
                  shipDate: format(receivingDate, 'dd/MM/yyyy'), // Keep for backward compatibility
                  packaging: 'N/A',
                  shipTo: '',
                  unitPrice: unitPrice,
                  amount: totalAmount,
                }],
                isContainerHandling: true, // Flag to identify container handling invoices
                subtotal: totalAmount,
                grandTotal: totalAmount,
                status: 'pending' as const,
                createdAt: new Date(),
                userId: userId,
                type: "container_handling", // Keep for reference
                containerSize: containerSize, // Keep for reference
              };
              
              await addDoc(collection(db, `users/${userId}/invoices`), invoiceData);
              
              console.log("Container handling invoice generated:", invoiceNumber);
            } else {
              console.warn("No container handling pricing found for size:", containerSize);
            }
          }
        } catch (error: any) {
          console.error("Error generating container handling invoice:", error);
          // Log detailed error information
          console.error("Error details:", {
            message: error?.message,
            code: error?.code,
            stack: error?.stack,
            userId: userId,
            containerSize: (request as any).containerSize,
            finalQuantity: finalQuantity,
          });
          // Don't fail the approval if invoice generation fails
          toast({
            variant: "destructive",
            title: "Warning",
            description: `Container handling request approved, but invoice generation failed: ${error?.message || "Unknown error"}. Please generate invoice manually.`,
          });
        }
      }

      if (!opts?.quiet) {
        await addDoc(collection(db, `users/${userId}/notifications`), {
          type: "inventory_request",
          title: "Inventory request approved",
          message:
            request.inventoryType === "container"
              ? "Your container handling request has been approved."
              : request.inventoryType === "product"
              ? "Your inventory request has been approved. Stock will appear after warehouse receiving and putaway."
              : "Your inventory request has been approved and added to inventory.",
          isRead: false,
          targetUrl: "/dashboard/inventory",
          relatedRequestId: request.id,
          createdAt: Timestamp.now(),
          createdBy: adminProfile.uid,
        });
      }

      const isRestock = (request as any).productSubType === "restock";
      const batchId = (request as InventoryRequest & { batchId?: string }).batchId;
      const batchLineId = (request as InventoryRequest & { batchLineId?: string }).batchLineId;
      if (!opts?.skipBatchSync && batchId && batchLineId) {
        await syncBatchLineStatus(userId, batchId, batchLineId, "approved");
        await refreshBatchCounts(batchId);
      }
      if (!opts?.quiet) {
        toast({
          title: "Success",
          description: isRestock
            ? request.inventoryType === "product"
              ? "Restock request approved. Stock will update after warehouse putaway."
              : "Restock request approved. Quantity added to existing product."
            : request.inventoryType === "container"
            ? "Container handling request approved and invoice generated."
            : request.inventoryType === "product"
            ? "Product request approved. Awaiting warehouse receive."
            : "Inventory request approved and added to inventory.",
        });
        setSelectedRequest(null);
      }
    } catch (error: unknown) {
      if (!opts?.quiet) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to approve inventory request.",
        });
      }
      throw error;
    } finally {
      if (!opts?.quiet) setIsProcessing(false);
    }
  };

  const handleCloseInbound = async (request: InventoryRequest) => {
    if (!selectedUser || !adminProfile) return;
    const reason =
      window.prompt(
        "Close this inbound request? Optional reason (e.g. short ship, client cancelled remainder):"
      ) ?? "";
    setIsProcessing(true);
    try {
      await closeInventoryRequest({
        clientUserId: selectedUser.uid,
        requestId: request.id,
        closedBy: adminProfile.uid,
        closeReason: reason.trim() || "Closed by admin",
      });
      toast({
        title: "Request closed",
        description: "Inbound request marked closed. Dock queue will no longer show it.",
      });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to close request.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (
    request: InventoryRequest,
    reason: string,
    opts?: InventoryRequestProcessOpts
  ) => {
    if (!selectedUser || !adminProfile) return;

    if (!opts?.quiet) setIsProcessing(true);
    try {
      const requestRef = doc(db, `users/${selectedUser.uid}/inventoryRequests`, request.id);
      await updateDoc(requestRef, {
        status: "rejected",
        rejectedBy: adminProfile.uid,
        rejectedAt: Timestamp.now(),
        rejectionReason: reason,
        remarks: reason,
      });

      if (!opts?.quiet) {
        await addDoc(collection(db, `users/${selectedUser.uid}/notifications`), {
          type: "inventory_request",
          title: "Inventory request rejected",
          message: `Your inventory request was rejected. Reason: ${reason}`,
          isRead: false,
          targetUrl: "/dashboard/inventory",
          relatedRequestId: request.id,
          createdAt: Timestamp.now(),
          createdBy: adminProfile.uid,
        });
      }

      const batchId = (request as InventoryRequest & { batchId?: string }).batchId;
      const batchLineId = (request as InventoryRequest & { batchLineId?: string }).batchLineId;
      if (!opts?.skipBatchSync && batchId && batchLineId) {
        await syncBatchLineStatus(selectedUser.uid, batchId, batchLineId, "rejected", {
          rejectionReason: reason,
        });
        await refreshBatchCounts(batchId);
      }

      if (!opts?.quiet) {
        toast({
          title: "Success",
          description: "Inventory request rejected.",
        });
        setSelectedRequest(null);
      }
    } catch (error: unknown) {
      if (!opts?.quiet) {
        toast({
          variant: "destructive",
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to reject inventory request.",
        });
      }
      throw error;
    } finally {
      if (!opts?.quiet) setIsProcessing(false);
    }
  };

  const runBulkBatchAction = async (
    lines: InboundBatchLine[],
    action: "approve" | "reject",
    options: { reason?: string; receivingDate?: Date }
  ) => {
    if (!selectedBatch || !userId || !adminProfile) return;
    const pendingLines = lines.filter((line) => line.status === "pending");
    if (pendingLines.length === 0) {
      toast({
        variant: "destructive",
        title: "No pending lines",
        description: "Select pending lines to approve or reject.",
      });
      return;
    }

    setIsProcessing(true);
    let succeeded = 0;
    let failed = 0;

    try {
      for (const line of pendingLines) {
        try {
          const requestId = await ensureInventoryRequestForBatchLine(userId, selectedBatch, line);
          const request = batchLineToInventoryRequest(selectedBatch, {
            ...line,
            inventoryRequestId: requestId,
          });
          request.id = requestId;
          request.status = "pending";

          if (action === "approve") {
            await handleApprove(
              request,
              options.receivingDate ?? new Date(),
              "In Stock",
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              { quiet: true, skipBatchSync: true }
            );
          } else {
            await handleReject(request, options.reason?.trim() || "Rejected in bulk", {
              quiet: true,
              skipBatchSync: true,
            });
          }
          succeeded += 1;
        } catch {
          failed += 1;
        }
      }

      await refreshBatchCounts(selectedBatch.id);

      if (succeeded > 0) {
        await addDoc(collection(db, `users/${userId}/notifications`), {
          type: "inventory_request",
          title:
            action === "approve"
              ? "Inbound batch lines approved"
              : "Inbound batch lines rejected",
          message:
            action === "approve"
              ? `${succeeded} line(s) from your inbound batch were approved.`
              : `${succeeded} line(s) from your inbound batch were rejected.`,
          isRead: false,
          targetUrl: "/dashboard/inventory",
          createdAt: Timestamp.now(),
          createdBy: adminProfile.uid,
        });
      }

      toast({
        title: action === "approve" ? "Bulk approve complete" : "Bulk reject complete",
        description: `${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ""}.`,
        variant: failed > 0 && succeeded === 0 ? "destructive" : "default",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!selectedUser) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-center">Select a user to manage their inventory requests.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Pending Requests</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Approved</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{approvedCount}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Rejected</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{rejectedCount}</div>
          </CardContent>
        </Card>
      </div>

      {/* Search + Filter */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
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
                className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 p-0"
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
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="approved">Approved</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Requests Table */}
      <Card>
        <CardHeader>
          <CardTitle>Inventory Requests</CardTitle>
          <CardDescription>
            Review and manage inventory requests from {selectedUser.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="mb-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
              <p className="text-sm text-destructive font-medium">Error loading requests:</p>
              <p className="text-xs text-destructive/80 mt-1">{error.message}</p>
            </div>
          )}
          {loading || batchesLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredRequests.length === 0 && filteredBatches.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground">No inventory requests found.</p>
              {selectedUser && requests.length === 0 && (
                <p className="text-xs text-muted-foreground mt-2">
                  User: {selectedUser.name} ({userId})
                </p>
              )}
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>SKU</TableHead>
                    <TableHead className="hidden md:table-cell">Identifier</TableHead>
                    <TableHead className="hidden lg:table-cell">Expiry</TableHead>
                    <TableHead>Quantity</TableHead>
                    <TableHead>Requested Date</TableHead>
                    <TableHead>Receiving Date</TableHead>
                    <TableHead className="hidden lg:table-cell">Current Location</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBatches.map((batch) => (
                    <TableRow key={`batch-${batch.id}`} className="bg-primary/5">
                      <TableCell>
                        <Badge variant="outline">Batch</Badge>
                      </TableCell>
                      <TableCell className="font-medium" colSpan={2}>
                        Inbound batch · {batch.totalLines} items
                        <span className="block text-xs text-muted-foreground">
                          Shipment: {formatShipmentTypeLabel(batch.shipmentType)}
                          {batch.loadContents
                            ? ` · Inside: ${formatLoadContentsLabel(batch.loadContents)}`
                            : ""}
                        </span>
                        {batch.productNotes?.trim() ? (
                          <span className="block text-xs text-muted-foreground line-clamp-2">
                            Description: {batch.productNotes.trim()}
                          </span>
                        ) : null}
                      </TableCell>
                      <TableCell className="hidden md:table-cell">—</TableCell>
                      <TableCell className="hidden lg:table-cell">—</TableCell>
                      <TableCell className="font-medium tabular-nums">{batch.totalLines}</TableCell>
                      <TableCell>{formatDate(batch.requestedAt)}</TableCell>
                      <TableCell>—</TableCell>
                      <TableCell className="hidden lg:table-cell">—</TableCell>
                      <TableCell>
                        <Badge variant={batch.status === "partial" ? "secondary" : "secondary"}>
                          {batch.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button type="button" size="sm" variant="outline" onClick={() => setSelectedBatch(batch)}>
                          Preview
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {paginatedRequests.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell><InventoryTypePill type={request.inventoryType} /></TableCell>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-2">
                          <InventoryAvatar request={request} />
                          <div className="flex flex-col">
                            <span>{request.productName}</span>
                            {(request as any).variantLabel && (
                              <span className="text-xs text-muted-foreground">
                                {(request as any).variantLabel}
                              </span>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>{(request as any).sku || "N/A"}</TableCell>
                      <TableCell className="hidden md:table-cell">
                        {(request as any).retailIdentifier || "N/A"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {(request as any).expiryDate ? formatOptionalDate((request as any).expiryDate) : "N/A"}
                      </TableCell>
                      <TableCell className="font-medium tabular-nums">
                        {formatInboundQuantityDisplay({
                          quantity: request.quantity,
                          requestedQuantity: (request as any).requestedQuantity,
                          receivedQuantity: (request as any).receivedQuantity,
                          status: request.status,
                        })}
                      </TableCell>
                      <TableCell>{formatDate(request.requestedAt)}</TableCell>
                      <TableCell>
                        {request.receivingDate ? formatDate(request.receivingDate) : "N/A"}
                      </TableCell>
                      <TableCell className="hidden lg:table-cell">
                        {getCurrentLocation(request)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            request.status === "approved"
                              ? "default"
                              : request.status === "rejected"
                              ? "destructive"
                              : request.status === "cancelled"
                              ? "secondary"
                              : "secondary"
                          }
                        >
                          {request.status === "pending" ? (
                            <span className="inline-flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Pending
                            </span>
                          ) : request.status === "cancelled" ? (
                            "Cancelled"
                          ) : (
                            request.status
                          )}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {request.status === "pending" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setSelectedRequest(request)}
                          >
                            <Eye className="h-4 w-4 mr-1" />
                            Review
                          </Button>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <span className="text-muted-foreground text-sm">
                              {request.status === "approved"
                                ? `Approved ${request.approvedAt ? formatDate(request.approvedAt) : ""}`
                                : request.status === "cancelled"
                                ? `Cancelled ${(request as any).cancelledAt ? formatDate((request as any).cancelledAt) : ""}${
                                    (request as any).cancellationReason
                                      ? ` — ${(request as any).cancellationReason}`
                                      : ""
                                  }`
                                : `Rejected ${request.rejectedAt ? formatDate(request.rejectedAt) : ""}`}
                            </span>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-fit px-2 text-xs"
                              onClick={() => setSelectedRequest(request)}
                            >
                              <Eye className="h-3.5 w-3.5 mr-1" />
                              View
                            </Button>
                            {request.status === "approved" &&
                            request.inventoryType === "product" &&
                            (request as any).fulfillmentStatus !== "closed" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 text-xs"
                                disabled={isProcessing}
                                onClick={() => void handleCloseInbound(request)}
                              >
                                Close inbound
                              </Button>
                            ) : null}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              
              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4 pt-4 border-t">
                  <div className="text-sm text-muted-foreground">
                    Showing {startIndex + 1} to {Math.min(endIndex, filteredRequests.length)} of {filteredRequests.length} requests
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
          )}
        </CardContent>
      </Card>

      {selectedBatch && userId && (
        <InboundBatchAdminDialog
          batch={selectedBatch}
          userId={userId}
          isProcessing={isProcessing}
          onClose={() => setSelectedBatch(null)}
          onReviewLine={(request) => void handleReviewBatchLine(request)}
          onBulkApprove={(lines, receivingDate) => runBulkBatchAction(lines, "approve", { receivingDate })}
          onBulkReject={(lines, reason) => runBulkBatchAction(lines, "reject", { reason })}
        />
      )}

      {/* Review Dialog */}
      {selectedRequest && (
        <ReviewRequestDialog
          request={selectedRequest}
          onApprove={handleApprove}
          onReject={handleReject}
          onClose={() => setSelectedRequest(null)}
          isProcessing={isProcessing}
        />
      )}
    </div>
  );
}

function ReviewRequestDialog({
  request,
  onApprove,
  onReject,
  onClose,
  isProcessing,
}: {
  request: InventoryRequest;
  onApprove: (request: InventoryRequest, receivingDate: Date, status: "In Stock" | "Out of Stock", remarks?: string, editedQuantity?: number, editedProductName?: string, editedSku?: string, imageUrls?: string[]) => void;
  onReject: (request: InventoryRequest, reason: string) => void;
  onClose: () => void;
  isProcessing: boolean;
}) {
  const { toast } = useToast();
  const { userProfile: adminProfile } = useAuth();
  const [receivingDate, setReceivingDate] = useState<Date>(new Date());
  const [status, setStatus] = useState<"In Stock" | "Out of Stock">("In Stock");
  const [remarks, setRemarks] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
  const requestedQty = getRequestedQuantity(request as any);
  const [editedQuantity, setEditedQuantity] = useState<number>(
    (request as any).receivedQuantity ?? requestedQty
  );
  const [editedProductName, setEditedProductName] = useState<string>(request.productName);
  const [editedSku, setEditedSku] = useState<string>((request as any).sku || "");
  const [selectedImages, setSelectedImages] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<{ file: File; preview: string }[]>([]);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>(getImageUrls(request as any));
  const readOnly = request.status !== "pending";

  const compressImage = async (file: File): Promise<File> => {
    const options = {
      maxSizeMB: 1, // Maximum file size in MB
      maxWidthOrHeight: 1920, // Maximum width or height
      useWebWorker: true,
      fileType: file.type,
    };

    try {
      const compressedFile = await imageCompression(file, options);
      return compressedFile;
    } catch (error) {
      console.error("Error compressing image:", error);
      throw error;
    }
  };

  const handleImageSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const validFiles: File[] = [];
    const newPreviews: { file: File; preview: string }[] = [];

    // Validate all selected files
    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Validate file type
      if (!file.type.startsWith("image/")) {
        toast({
          variant: "destructive",
          title: "Invalid File",
          description: `${file.name} is not an image file. Skipping.`,
        });
        continue;
      }

      // Check initial file size (before compression)
      const maxSizeBytes = 10 * 1024 * 1024; // 10 MB initial limit
      if (file.size > maxSizeBytes) {
        toast({
          variant: "destructive",
          title: "File Too Large",
          description: `${file.name} is too large (max 10 MB). It will be compressed automatically.`,
        });
        continue;
      }

      validFiles.push(file);
      
      // Create preview
      const reader = new FileReader();
      reader.onloadend = () => {
        newPreviews.push({ file, preview: reader.result as string });
        if (newPreviews.length === validFiles.length) {
          setSelectedImages(prev => [...prev, ...validFiles]);
          setImagePreviews(prev => [...prev, ...newPreviews]);
        }
      };
      reader.readAsDataURL(file);
    }

    // Reset input
    event.target.value = "";
  };

  const handleImageUpload = async (): Promise<string[]> => {
    if (selectedImages.length === 0 || !adminProfile) return uploadedImageUrls;

    try {
      setIsUploadingImage(true);
      const userId = (request as any).requestedBy || adminProfile.uid;
      const uploadedUrls: string[] = [...uploadedImageUrls];

      // Upload all selected images
      for (const file of selectedImages) {
        try {
          // Compress the image
          const compressedFile = await compressImage(file);

          // Check if compressed file is still over 1 MB
          if (compressedFile.size > 1024 * 1024) {
            toast({
              variant: "destructive",
              title: "Compression Failed",
              description: `Unable to compress ${file.name} below 1 MB. Skipping.`,
            });
            continue;
          }

          // Upload to Firebase Storage
          const storagePath = `inventory-images/${userId}/${Date.now()}_${compressedFile.name}`;
          const storageRef = ref(storage, storagePath);
          await uploadBytes(storageRef, compressedFile);

          // Get download URL
          const downloadURL = await getDownloadURL(storageRef);
          uploadedUrls.push(downloadURL);
        } catch (error: any) {
          console.error(`Error uploading ${file.name}:`, error);
          toast({
            variant: "destructive",
            title: "Upload Failed",
            description: `Failed to upload ${file.name}: ${error.message || "Unknown error"}`,
          });
        }
      }

      setUploadedImageUrls(uploadedUrls);
      setSelectedImages([]);
      setImagePreviews([]);
      
      if (uploadedUrls.length > uploadedImageUrls.length) {
        toast({
          title: "Success",
          description: `${uploadedUrls.length - uploadedImageUrls.length} image(s) uploaded successfully!`,
        });
      }

      return uploadedUrls;
    } catch (error: any) {
      console.error("Error uploading images:", error);
      toast({
        variant: "destructive",
        title: "Upload Failed",
        description: error.message || "Failed to upload images. Please try again.",
      });
      return uploadedImageUrls;
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleRemoveImage = (index: number, isUploaded: boolean) => {
    if (isUploaded) {
      setUploadedImageUrls(prev => prev.filter((_, i) => i !== index));
    } else {
      setSelectedImages(prev => prev.filter((_, i) => i !== index));
      setImagePreviews(prev => prev.filter((_, i) => i !== index));
    }
  };

  const handleApproveClick = async () => {
    // Validate edited quantity
    if (editedQuantity <= 0) {
      return;
    }

    // Upload images if selected
    let imageUrls = uploadedImageUrls;
    if (selectedImages.length > 0) {
      const uploaded = await handleImageUpload();
      imageUrls = uploaded;
    }

    // Pass remarks, edited quantity, edited product name, edited SKU, and image URLs
    onApprove(request, receivingDate, status, remarks, editedQuantity, editedProductName, editedSku, imageUrls.length > 0 ? imageUrls : undefined);
  };

  const handleRejectClick = () => {
    if (!rejectionReason.trim()) {
      return;
    }
    onReject(request, rejectionReason);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{readOnly ? "Request Details" : "Review Inventory Request"}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? "Read-only view of this inventory request and how it was processed."
              : "Review the inventory request and approve or reject it."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Request Details */}
          <div className="grid gap-4 py-4">
            {readOnly && (
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Label className="text-xs uppercase text-muted-foreground">Status</Label>
                  <Badge variant="outline" className="capitalize">
                    {request.status}
                  </Badge>
                </div>
                {request.status === "approved" && (
                  <div className="mt-2 grid gap-1 text-sm">
                    {(request as any).receivedQuantity != null && (
                      <p>
                        <span className="text-muted-foreground">Received qty:</span>{" "}
                        <span className="font-medium tabular-nums">{(request as any).receivedQuantity}</span>
                      </p>
                    )}
                    {request.receivingDate && (
                      <p>
                        <span className="text-muted-foreground">Receiving date:</span>{" "}
                        {formatDate(request.receivingDate)}
                      </p>
                    )}
                    {request.approvedAt && (
                      <p>
                        <span className="text-muted-foreground">Approved:</span> {formatDate(request.approvedAt)}
                      </p>
                    )}
                  </div>
                )}
                {request.status === "rejected" && (request.rejectionReason || request.remarks) && (
                  <div className="mt-2">
                    <p className="text-muted-foreground text-xs uppercase">Rejection reason</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {request.rejectionReason || request.remarks}
                    </p>
                  </div>
                )}
                {request.status === "cancelled" && (request as any).cancellationReason && (
                  <div className="mt-2">
                    <p className="text-muted-foreground text-xs uppercase">Cancellation reason</p>
                    <p className="mt-1 whitespace-pre-wrap break-words">
                      {(request as any).cancellationReason}
                    </p>
                  </div>
                )}
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Type</Label>
                <p className="text-sm font-medium capitalize">{request.inventoryType}</p>
              </div>
              <div>
                <Label>Requested Quantity</Label>
                <p className="text-sm font-medium tabular-nums">{requestedQty}</p>
              </div>
            </div>
            <div>
              <Label>Requested Product Name</Label>
              <p className="text-sm font-medium">{request.productName}</p>
            </div>
            <div>
              <Label>Requested Date</Label>
              <p className="text-sm font-medium">{formatDate(request.requestedAt)}</p>
            </div>
            <div>
              <Label>Add Date (User Submitted)</Label>
              <p className="text-sm font-medium">{formatDate(request.addDate)}</p>
            </div>
            {(request as any).remarks && (request as any).remarks.trim() && (
              <div>
                <Label>User Remarks</Label>
                <div className="p-3 bg-gray-50 border rounded-lg mt-1">
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {(request as any).remarks}
                  </p>
                </div>
              </div>
            )}
            {uploadedImageUrls.length > 0 && (
              <div>
                <Label>Product Pictures</Label>
                <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {uploadedImageUrls.map((url, index) => (
                    <img
                      key={`request-img-${index}`}
                      src={url}
                      alt={`Requested inventory ${index + 1}`}
                      className="h-24 w-full rounded-md border object-cover"
                    />
                  ))}
                </div>
              </div>
            )}
            {(request as any).sku && (
              <div>
                <Label>SKU</Label>
                <p className="text-sm font-medium">{(request as any).sku}</p>
              </div>
            )}
          </div>

          {!readOnly && (
          <>
          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setAction("approve")}
              className="flex-1"
            >
              <Check className="h-4 w-4 mr-2" />
              Approve
            </Button>
            <Button
              variant="outline"
              onClick={() => setAction("reject")}
              className="flex-1"
            >
              <X className="h-4 w-4 mr-2" />
              Reject
            </Button>
          </div>

          {/* Approve Form */}
          {action === "approve" && (
            <div className="space-y-4 border-t pt-4">
              <h3 className="font-semibold">Approve Request</h3>
              
              {/* Show restock indicator */}
              {(request as any).productSubType === "restock" && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg mb-4">
                  <p className="text-sm font-medium text-blue-900">Restock Request</p>
                  <p className="text-xs text-blue-700 mt-1">
                    This will add quantity to the existing product: <strong>{request.productName}</strong>
                  </p>
                </div>
              )}
              
              {/* Editable Product Name - Hide for restock */}
              {(request as any).productSubType !== "restock" && (
                <div>
                  <Label>Product Name *</Label>
                  <Input
                    value={editedProductName}
                    onChange={(e) => setEditedProductName(e.target.value)}
                    placeholder="Enter product name"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Original: {request.productName}
                  </p>
                </div>
              )}
              
              {/* Show product name as read-only for restock */}
              {(request as any).productSubType === "restock" && (
                <div>
                  <Label>Product Name</Label>
                  <Input
                    value={request.productName}
                    readOnly
                    className="bg-muted"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Restock request - Product name cannot be changed
                  </p>
                </div>
              )}

              {/* Editable SKU - Only for product type */}
              {request.inventoryType === "product" && (
                <div>
                  <Label>SKU *</Label>
                  <Input
                    value={editedSku}
                    onChange={(e) => setEditedSku(e.target.value)}
                    placeholder="Enter SKU"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Original: {(request as any).sku || "N/A"}
                  </p>
                </div>
              )}

              {/* Editable Quantity */}
              <div>
                <Label>Received Quantity *</Label>
                <Input
                  type="number"
                  min="1"
                  value={editedQuantity}
                  onChange={(e) => setEditedQuantity(parseInt(e.target.value) || 0)}
                  placeholder="Enter received quantity"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Requested: {requestedQty} | Difference: {editedQuantity - requestedQty}
                </p>
              </div>

              <div>
                <Label>Receiving Date</Label>
                <DatePicker date={receivingDate} setDate={(date) => date && setReceivingDate(date)} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(value: "In Stock" | "Out of Stock") => setStatus(value)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="In Stock">In Stock</SelectItem>
                    <SelectItem value="Out of Stock">Out of Stock</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Admin Remarks (Optional)</Label>
                <Textarea
                  placeholder="Enter remarks (e.g., 10 units damaged, received 90 instead of 100)..."
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                />
              </div>
              
              {/* Image Upload */}
              <div>
                <Label>Upload Inventory Pictures (Optional)</Label>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleImageSelect}
                      className="flex-1"
                      disabled={isUploadingImage}
                    />
                  </div>
                  
                  {/* Display uploaded images */}
                  {uploadedImageUrls.length > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {uploadedImageUrls.map((url, index) => (
                        <div key={`uploaded-${index}`} className="relative border rounded-lg p-2">
                          <img
                            src={url}
                            alt={`Inventory ${index + 1}`}
                            className="max-w-full h-auto max-h-32 rounded"
                          />
                          <Button
                            type="button"
                            variant="destructive"
                            size="sm"
                            className="absolute top-1 right-1 h-6 w-6 p-0"
                            onClick={() => handleRemoveImage(index, true)}
                            disabled={isUploadingImage}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  
                  {/* Display selected images (not yet uploaded) */}
                  {imagePreviews.length > 0 && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {imagePreviews.map((preview, index) => (
                          <div key={`preview-${index}`} className="relative border rounded-lg p-2">
                            <img
                              src={preview.preview}
                              alt={`Preview ${index + 1}`}
                              className="max-w-full h-auto max-h-32 rounded"
                            />
                            <Button
                              type="button"
                              variant="destructive"
                              size="sm"
                              className="absolute top-1 right-1 h-6 w-6 p-0"
                              onClick={() => handleRemoveImage(index, false)}
                              disabled={isUploadingImage}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {imagePreviews.length} image(s) will be uploaded when you confirm approval.
                      </div>
                    </div>
                  )}
                  
                  {isUploadingImage && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Uploading images...
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload pictures of the received inventory. Images will be shown in remarks. You can upload multiple images.
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleApproveClick}
                  disabled={
                    isProcessing || 
                    editedQuantity <= 0 || 
                    !editedProductName.trim() || 
                    (request.inventoryType === "product" && !editedSku.trim())
                  }
                  className="flex-1"
                >
                  {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Approval
                </Button>
                <Button variant="outline" onClick={() => setAction(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Reject Form */}
          {action === "reject" && (
            <div className="space-y-4 border-t pt-4">
              <h3 className="font-semibold">Reject Request</h3>
              <div>
                <Label>Rejection Reason *</Label>
                <Textarea
                  placeholder="Enter reason for rejection..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  required
                />
              </div>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  onClick={handleRejectClick}
                  disabled={isProcessing || !rejectionReason.trim()}
                  className="flex-1"
                >
                  {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Confirm Rejection
                </Button>
                <Button variant="outline" onClick={() => setAction(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          </>
          )}

          {readOnly && (
            <div className="flex justify-end border-t pt-4">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

