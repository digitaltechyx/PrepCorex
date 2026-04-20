"use client";

import { useEffect, useState, useMemo } from "react";
import type { ShipmentRequest, UserProfile, InventoryItem, UserAdditionalServicesPricing, UserPricing, UserBoxForwardingPricing, UserPalletForwardingPricing } from "@/types";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { calculatePrepUnitPrice } from "@/lib/pricing-utils";
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
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import { doc, updateDoc, collection, Timestamp, runTransaction, addDoc } from "firebase/firestore";
import { format } from "date-fns";
import { Check, X, Eye, Loader2, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker } from "@/components/ui/date-picker";

function formatDate(date: ShipmentRequest["date"] | ShipmentRequest["requestedAt"]) {
  if (typeof date === 'string') {
    return format(new Date(date), "PPP");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "PPP");
  }
  return "N/A";
}

export function ShipmentRequestsManagement({ 
  selectedUser,
  inventory,
  initialRequestId,
}: { 
  selectedUser: UserProfile | null;
  inventory: InventoryItem[];
  initialRequestId?: string;
}) {
  const { toast } = useToast();
  const { user: authUser, userProfile: adminProfile } = useAuth();
  const [selectedRequest, setSelectedRequest] = useState<ShipmentRequest | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedRemarks, setSelectedRemarks] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  // Normalize user ID (handle both id and uid fields) - ensure it's a valid string
  const userId = selectedUser?.uid || selectedUser?.id;
  const isValidUserId = userId && typeof userId === 'string' && userId.trim() !== '';
  
  const { data: requests, loading } = useCollection<ShipmentRequest>(
    isValidUserId ? `users/${userId}/shipmentRequests` : ""
  );

  // Auto-open a request when coming from Notifications
  const [didAutoOpen, setDidAutoOpen] = useState(false);
  useEffect(() => {
    if (didAutoOpen) return;
    if (!initialRequestId) return;
    if (!requests || requests.length === 0) return;
    const match = requests.find((r: any) => r.id === initialRequestId);
    if (match) {
      setSelectedRequest(match);
      setDidAutoOpen(true);
    }
  }, [didAutoOpen, initialRequestId, requests]);

  const { data: additionalServicesPricing } = useCollection<UserAdditionalServicesPricing>(
    isValidUserId ? `users/${userId}/additionalServicesPricing` : ""
  );

  const { data: pricingRules } = useCollection<UserPricing>(
    isValidUserId ? `users/${userId}/pricing` : ""
  );
  
  // Get box and pallet forwarding pricing
  const { data: boxForwardingPricing } = useCollection<UserBoxForwardingPricing>(
    isValidUserId ? `users/${userId}/boxForwardingPricing` : ""
  );
  
  const { data: palletForwardingPricing } = useCollection<UserPalletForwardingPricing>(
    isValidUserId ? `users/${userId}/palletForwardingPricing` : ""
  );
  
  const filteredRequests = useMemo(() => {
    let filtered =
      statusFilter === "all"
        ? requests
        : statusFilter === "pending"
          ? requests.filter(
              (req) =>
                req.status === "pending" || req.status === "awaiting_label_upload"
            )
          : requests.filter((req) => req.status === statusFilter);
    
    // Sort by requestedAt (most recent first), fallback to date if requestedAt is not available
    filtered = [...filtered].sort((a, b) => {
      const getDate = (req: ShipmentRequest) => {
        if (req.requestedAt) {
          if (typeof req.requestedAt === 'string') {
            return new Date(req.requestedAt).getTime();
          }
          if (req.requestedAt && typeof req.requestedAt === 'object' && 'seconds' in req.requestedAt) {
            return req.requestedAt.seconds * 1000;
          }
        }
        if (req.date) {
          if (typeof req.date === 'string') {
            return new Date(req.date).getTime();
          }
          if (req.date && typeof req.date === 'object' && 'seconds' in req.date) {
            return req.date.seconds * 1000;
          }
        }
        return 0;
      };
      
      const dateA = getDate(a);
      const dateB = getDate(b);
      return dateB - dateA; // Descending order (newest first)
    });
    
    return filtered;
  }, [requests, statusFilter]);

  const pendingCount = requests.filter(
    (req) => req.status === "pending" || req.status === "awaiting_label_upload"
  ).length;
  const confirmedCount = requests.filter(req => req.status === "confirmed").length;
  const rejectedCount = requests.filter(req => req.status === "rejected").length;

  // Helper function to remove undefined values from objects (Firestore doesn't allow undefined)
  const removeUndefined = (obj: any): any => {
    if (obj === null || obj === undefined) {
      return null;
    }
    // Preserve Firestore Timestamp objects
    if (obj && typeof obj === 'object' && ('seconds' in obj || 'toDate' in obj || obj.constructor?.name === 'Timestamp')) {
      return obj;
    }
    // Preserve Date objects
    if (obj instanceof Date) {
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map(removeUndefined).filter(item => item !== undefined);
    }
    if (typeof obj === 'object') {
      const cleaned: any = {};
      for (const key in obj) {
        if (obj[key] !== undefined) {
          cleaned[key] = removeUndefined(obj[key]);
        }
      }
      return cleaned;
    }
    return obj;
  };

  const handleConfirm = async (
    request: ShipmentRequest,
    adminRemarks?: string,
    shippingDate?: Date,
    additionalServices?: {
      bubbleWrapFeet?: number;
      stickerRemovalItems?: number;
      warningLabels?: number;
      pricePerFoot?: number;
      pricePerItem?: number;
      pricePerLabel?: number;
      totalAdditionalCost?: number;
      customProductPricing?: Record<number, { unitPrice: number; packOf: number; packOfPrice: number }>;
    }
  ) => {
    if (!selectedUser || !adminProfile) return;
    const targetUserId = selectedUser?.uid || (selectedUser as any)?.id;
    if (!targetUserId || typeof targetUserId !== "string" || targetUserId.trim() === "") return;

    setIsProcessing(true);
    try {
      const bubbleWrapFeet = additionalServices?.bubbleWrapFeet || 0;
      const stickerRemovalItems = additionalServices?.stickerRemovalItems || 0;
      const warningLabels = additionalServices?.warningLabels || 0;
      const pricePerFoot = additionalServices?.pricePerFoot || 0;
      const pricePerItem = additionalServices?.pricePerItem || 0;
      const pricePerLabel = additionalServices?.pricePerLabel || 0;
      const additionalServicesTotal = additionalServices?.totalAdditionalCost || 0;

      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, `users/${targetUserId}/shipmentRequests`, request.id);
        const shippedCollectionRef = collection(db, `users/${targetUserId}/shipped`);
        const confirmedAt = Timestamp.now();
        const createdAt = Timestamp.now();

        // STEP 1: Read all inventory documents first (all reads must happen before writes)
        const isCustomProduct =
          String(request.productType || "").toLowerCase() === "custom" &&
          String(request.shipmentType || "").toLowerCase() === "product";

        const inventoryData = await Promise.all(
          request.shipments.map(async (shipment, index) => {
            const inventoryDocRef = doc(db, `users/${targetUserId}/inventory`, shipment.productId);
            const inventoryDoc = await transaction.get(inventoryDocRef);

            if (!inventoryDoc.exists()) {
              throw new Error(`Product ${shipment.productId} not found in inventory.`);
            }

            const currentInventory = inventoryDoc.data() as Omit<InventoryItem, "id">;
            const effectivePackOf =
              isCustomProduct && additionalServices?.customProductPricing?.[index]?.packOf
                ? additionalServices.customProductPricing[index].packOf
                : shipment.packOf;
            const totalUnitsShipped = shipment.quantity * effectivePackOf;

            if (currentInventory.quantity < totalUnitsShipped) {
              throw new Error(
                `Not enough stock for ${currentInventory.productName}. Available: ${currentInventory.quantity}, Requested: ${totalUnitsShipped}.`
              );
            }

            return {
              shipment,
              effectivePackOf,
              inventoryDocRef,
              currentInventory,
              totalUnitsShipped,
            };
          })
        );

        // STEP 2: Now perform all writes (after all reads are complete)
        // Update request status
        transaction.update(requestRef, {
          status: "confirmed",
          confirmedBy: adminProfile.uid,
          confirmedAt,
          adminRemarks: adminRemarks || "",
          adminAdditionalServices: {
            bubbleWrapFeet,
            stickerRemovalItems,
            warningLabels,
            pricePerFoot,
            pricePerItem,
            pricePerLabel,
            total: additionalServicesTotal,
          },
        });

        // Collect all items and calculate totals for a single combined shipped record
        const allItems: any[] = [];
        let totalBoxes = 0;
        let totalUnits = 0;
        let totalSkus = 0;
        const firstProduct = inventoryData[0]?.currentInventory;

        // Process each shipment item - update inventory and collect data
        for (let i = 0; i < inventoryData.length; i++) {
          const { shipment, effectivePackOf, inventoryDocRef, currentInventory, totalUnitsShipped } = inventoryData[i];
          const newQuantity = currentInventory.quantity - totalUnitsShipped;
          const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";

          // Update inventory
          transaction.update(inventoryDocRef, {
            quantity: newQuantity,
            status: newStatus,
          });

          // Use admin-set pricing for custom products, otherwise use shipment pricing
          let finalUnitPrice = shipment.unitPrice;
          if (isCustomProduct && additionalServices?.customProductPricing) {
            const customPricing = additionalServices.customProductPricing[i];
            if (customPricing && customPricing.unitPrice > 0) {
              finalUnitPrice = customPricing.unitPrice;
            }
          }
          const finalPackOfPrice =
            isCustomProduct && additionalServices?.customProductPricing?.[i]
              ? (additionalServices.customProductPricing[i].packOfPrice || 0)
              : 0;

          // Collect item data for the combined shipped record
          allItems.push({
            productId: shipment.productId,
            productName: currentInventory.productName,
            boxesShipped: shipment.quantity,
            shippedQty: totalUnitsShipped,
            packOf: effectivePackOf,
            unitPrice: finalUnitPrice,
            packOfPrice: finalPackOfPrice,
            remainingQty: newQuantity,
          });

          // Accumulate totals
          totalBoxes += shipment.quantity;
          totalUnits += totalUnitsShipped;
          totalSkus += 1;
        }

        // Create a SINGLE combined shipped record with all products
        const shipmentDocRef = doc(shippedCollectionRef);
        const shipmentDoc: any = {
          productName: firstProduct?.productName || "Multiple Products",
          date: shippingDate ? Timestamp.fromDate(shippingDate) : (typeof request.date === 'string' ? Timestamp.fromDate(new Date(request.date)) : request.date),
          createdAt,
          shippedQty: totalUnits,
          boxesShipped: totalBoxes,
          unitsForPricing: totalBoxes,
          remainingQty: inventoryData[inventoryData.length - 1]?.currentInventory.quantity - inventoryData[inventoryData.length - 1]?.totalUnitsShipped || 0,
          packOf: inventoryData[0]?.effectivePackOf || inventoryData[0]?.shipment.packOf || 1, // Use first product's packOf for display
          unitPrice: (() => {
            // Unit price is per-box (qty), not per-unit (qty*packOf).
            // For custom products, use admin-set unitPrice and weight by boxes shipped.
            if (isCustomProduct && additionalServices?.customProductPricing) {
              let totalPrice = 0;
              inventoryData.forEach((d, index) => {
                const customPricing = additionalServices.customProductPricing?.[index];
                const price = customPricing && customPricing.unitPrice > 0 ? customPricing.unitPrice : d.shipment.unitPrice;
                totalPrice += price * (d.shipment.quantity || 0);
              });
              return totalPrice / totalBoxes || 0;
            }
            // For non-custom, we keep the existing behavior (weighted by total units shipped)
            return inventoryData.reduce((sum, d) => sum + (d.shipment.unitPrice * d.totalUnitsShipped), 0) / totalUnits || 0;
          })(),
          packOfPrice: (() => {
            // For custom products, store the packOfPrice from the first item (or 0). Invoices use item-level pricing too.
            if (isCustomProduct && additionalServices?.customProductPricing?.[0]) {
              return additionalServices.customProductPricing[0].packOfPrice || 0;
            }
            return 0;
          })(),
          remarks: request.remarks,
          // Map service based on shipmentType
          service: (() => {
            if (request.shipmentType === 'box') {
              return 'Box Forwarding';
            } else if (request.shipmentType === 'pallet') {
              if (request.palletSubType === 'forwarding') {
                return 'Pallet Forwarding';
              } else if (request.palletSubType === 'existing_inventory') {
                return 'Pallet Existing Inventory';
              }
              return 'Pallet Forwarding';
            }
            return request.service || "FBA/WFS/TFS";
          })(),
          productType: request.productType || "Standard",
          shipmentType: request.shipmentType || "product", // Store shipmentType for invoice service mapping
          remarks: adminRemarks || "", // Use admin remarks instead of user remarks
          labelUrl: request.labelUrl || "",
          customDimensions: request.customDimensions || undefined, // Store custom dimensions if present
          customProductPricing: (isCustomProduct && additionalServices?.customProductPricing)
            ? additionalServices.customProductPricing
            : undefined, // Store admin-set pricing for custom products
          additionalServices: {
            bubbleWrapFeet,
            stickerRemovalItems,
            warningLabels,
            pricePerFoot,
            pricePerItem,
            pricePerLabel,
            total: additionalServicesTotal,
          },
          additionalServicesTotal,
          items: allItems, // All products in this shipment
          totalBoxes: totalBoxes,
          totalUnits: totalUnits,
          totalSkus: totalSkus,
          requestedBy: request.requestedBy,
          confirmedBy: adminProfile.uid,
          confirmedAt,
        };
        
        // Only include palletSubType if it has a value
        if (request.palletSubType) {
          shipmentDoc.palletSubType = request.palletSubType;
        }
        
        // Remove undefined values before saving
        const cleanedDoc = removeUndefined(shipmentDoc);
        transaction.set(shipmentDocRef, cleanedDoc);

      });

      if (authUser && targetUserId) {
        for (const shipment of request.shipments || []) {
          if (!shipment.productId) continue;
          const invItem = inventory.find((i) => i.id === shipment.productId) as (InventoryItem & { source?: string; shop?: string; shopifyVariantId?: string; shopifyInventoryItemId?: string }) | undefined;
          if (invItem?.source === "shopify" && invItem.shop && invItem.shopifyVariantId) {
            const totalUnitsShipped = (shipment.quantity || 0) * (shipment.packOf || 1);
            const newQty = Math.max(0, invItem.quantity - totalUnitsShipped);
            try {
              const token = await authUser.getIdToken();
              const res = await fetch("/api/shopify/sync-inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  userId: targetUserId,
                  shop: invItem.shop,
                  shopifyVariantId: invItem.shopifyVariantId,
                  shopifyInventoryItemId: invItem.shopifyInventoryItemId,
                  newQuantity: newQty,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                toast({
                  variant: "destructive",
                  title: "Shipment processed; Shopify inventory did not update",
                  description: typeof data.error === "string" ? data.error : "Add write_inventory scope and re-connect the store.",
                });
              }
            } catch (e) {
              toast({
                variant: "destructive",
                title: "Shipment processed; Shopify inventory did not update",
                description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
              });
            }
          }
        }
      }

      await addDoc(collection(db, `users/${targetUserId}/notifications`), {
        type: "shipment_request",
        title: "Outbound shipment request approved",
        message: "Your outbound shipment request has been approved and processed.",
        isRead: false,
        targetUrl: "/dashboard/create-shipment-with-labels",
        relatedRequestId: request.id,
        createdAt: Timestamp.now(),
        createdBy: adminProfile.uid,
      });

      toast({
        title: "Success",
        description: "Shipment request confirmed and processed.",
      });
      setSelectedRequest(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to confirm shipment request.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async (request: ShipmentRequest, reason: string) => {
    if (!selectedUser || !adminProfile) return;
    const targetUserId = selectedUser?.uid || (selectedUser as any)?.id;
    if (!targetUserId || typeof targetUserId !== "string" || targetUserId.trim() === "") return;

    setIsProcessing(true);
    try {
      // Use transaction to ensure atomicity when restoring quantities
      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, `users/${targetUserId}/shipmentRequests`, request.id);
        
        // Update request status
        transaction.update(requestRef, {
          status: "rejected",
          rejectedBy: adminProfile.uid,
          rejectedAt: Timestamp.now(),
          rejectionReason: reason,
        });

        // Restore inventory quantities if request was confirmed (edge case)
        // Normally quantities are only deducted on confirmation, but we check to be safe
        if (request.status === "confirmed" && request.shipments) {
          // Read all inventory documents first
          const inventoryData = await Promise.all(
            request.shipments.map(async (shipment) => {
              if (!shipment.productId) return null;
              const inventoryDocRef = doc(db, `users/${targetUserId}/inventory`, shipment.productId);
              const inventoryDoc = await transaction.get(inventoryDocRef);
              
              if (!inventoryDoc.exists()) {
                return null;
              }

              const currentInventory = inventoryDoc.data() as InventoryItem;
              const totalUnitsToRestore = shipment.quantity * (shipment.packOf || 1);

              return {
                shipment,
                inventoryDocRef,
                currentInventory,
                totalUnitsToRestore,
              };
            })
          );

          // Filter out null entries and restore quantities
          const validInventoryData = inventoryData.filter((item): item is NonNullable<typeof item> => item !== null);
          
          for (const { inventoryDocRef, currentInventory, totalUnitsToRestore } of validInventoryData) {
            const newQuantity = currentInventory.quantity + totalUnitsToRestore;
            const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";

            transaction.update(inventoryDocRef, {
              quantity: newQuantity,
              status: newStatus,
            });
          }
        }
      });

      if (request.status === "confirmed" && request.shipments && authUser && targetUserId) {
        for (const shipment of request.shipments) {
          if (!shipment.productId) continue;
          const invItem = inventory.find((i) => i.id === shipment.productId) as (InventoryItem & { source?: string; shop?: string; shopifyVariantId?: string; shopifyInventoryItemId?: string }) | undefined;
          if (invItem?.source === "shopify" && invItem.shop && invItem.shopifyVariantId) {
            const totalRestore = (shipment.quantity || 0) * (shipment.packOf || 1);
            const newQty = invItem.quantity + totalRestore;
            try {
              const token = await authUser.getIdToken();
              const res = await fetch("/api/shopify/sync-inventory", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                  userId: targetUserId,
                  shop: invItem.shop,
                  shopifyVariantId: invItem.shopifyVariantId,
                  shopifyInventoryItemId: invItem.shopifyInventoryItemId,
                  newQuantity: newQty,
                }),
              });
              const data = await res.json().catch(() => ({}));
              if (!res.ok) {
                toast({
                  variant: "destructive",
                  title: "Quantities restored in PrepCorex; Shopify did not update",
                  description: typeof data.error === "string" ? data.error : "Add write_inventory scope and re-connect the store.",
                });
              }
            } catch (e) {
              toast({
                variant: "destructive",
                title: "Quantities restored in PrepCorex; Shopify did not update",
                description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
              });
            }
          }
        }
      }

      await addDoc(collection(db, `users/${targetUserId}/notifications`), {
        type: "shipment_request",
        title: "Outbound shipment request rejected",
        message: `Your outbound shipment request was rejected. Reason: ${reason}`,
        isRead: false,
        targetUrl: "/dashboard/create-shipment-with-labels",
        relatedRequestId: request.id,
        createdAt: Timestamp.now(),
        createdBy: adminProfile.uid,
      });

      toast({
        title: "Success",
        description: "Shipment request rejected and quantities restored if needed.",
      });
      setSelectedRequest(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to reject shipment request.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleApproveForLabelUpload = async (
    request: ShipmentRequest,
    adminRemarks: string
  ) => {
    if (!selectedUser || !adminProfile) return;
    const targetUserId = selectedUser?.uid || (selectedUser as any)?.id;
    if (!targetUserId || typeof targetUserId !== "string" || targetUserId.trim() === "") return;
    if (!adminRemarks.trim()) {
      toast({
        variant: "destructive",
        title: "Admin remarks required",
        description: "Please add admin remarks before approving custom request for label upload.",
      });
      return;
    }

    setIsProcessing(true);
    try {
      await updateDoc(doc(db, `users/${targetUserId}/shipmentRequests`, request.id), {
        status: "awaiting_label_upload",
        approvedForLabelBy: adminProfile.uid,
        approvedForLabelAt: Timestamp.now(),
        adminRemarks: adminRemarks.trim(),
      });

      await addDoc(collection(db, `users/${targetUserId}/notifications`), {
        type: "shipment_request",
        title: "Label upload needed",
        message:
          "Your custom shipment was reviewed. Please upload your shipping label so admin can complete this request.",
        isRead: false,
        targetUrl: "/dashboard/create-shipment-with-labels",
        relatedRequestId: request.id,
        createdAt: Timestamp.now(),
        createdBy: adminProfile.uid,
      });

      toast({
        title: "Approved for label upload",
        description: "Custom request moved to waiting-label stage.",
      });
      setSelectedRequest(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to approve request for label upload.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  if (!selectedUser) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-muted-foreground text-center">Select a user to manage their shipment requests.</p>
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
            <CardTitle className="text-sm font-medium">Confirmed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{confirmedCount}</div>
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

      {/* Filter */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Requests Table */}
      <Card>
        <CardHeader>
          <CardTitle>Shipment Requests</CardTitle>
          <CardDescription>
            Review and confirm shipment requests from {selectedUser.name}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : filteredRequests.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No shipment requests found.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Remarks</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead>Requested Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell>{formatDate(request.date)}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <span className="truncate max-w-[200px]">{request.remarks || "—"}</span>
                        {request.remarks && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => setSelectedRemarks(request.remarks || null)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{request.shipments.length} product(s)</TableCell>
                    <TableCell>{formatDate(request.requestedAt)}</TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          request.status === "confirmed"
                            ? "default"
                            : request.status === "rejected"
                            ? "destructive"
                            : "secondary"
                        }
                      >
                        {request.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {request.status === "pending" || request.status === "awaiting_label_upload" ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedRequest(request)}
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          Review
                        </Button>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          {request.status === "confirmed"
                            ? `Confirmed ${request.confirmedAt ? formatDate(request.confirmedAt) : ""}`
                            : `Rejected ${request.rejectedAt ? formatDate(request.rejectedAt) : ""}`}
                        </span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Review Dialog */}
      {selectedRequest && (
        <ReviewShipmentDialog
          request={selectedRequest}
          inventory={inventory}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onApproveForLabelUpload={handleApproveForLabelUpload}
          onClose={() => setSelectedRequest(null)}
          isProcessing={isProcessing}
          additionalServicesPricing={additionalServicesPricing || []}
          pricingRules={pricingRules || []}
          boxForwardingPricing={boxForwardingPricing}
          palletForwardingPricing={palletForwardingPricing}
        />
      )}

      {/* Remarks Dialog */}
      <Dialog open={selectedRemarks !== null} onOpenChange={(open) => !open && setSelectedRemarks(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Remarks</DialogTitle>
            <DialogDescription>
              Additional remarks or notes for this shipment
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 overflow-y-auto flex-1 min-h-0">
            <p className="text-sm font-medium break-words break-all overflow-wrap-anywhere whitespace-pre-wrap">{selectedRemarks}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReviewShipmentDialog({
  request,
  inventory,
  onConfirm,
  onReject,
  onApproveForLabelUpload,
  onClose,
  isProcessing,
  additionalServicesPricing,
  pricingRules,
  boxForwardingPricing,
  palletForwardingPricing,
}: {
  request: ShipmentRequest;
  inventory: InventoryItem[];
  onConfirm: (
    request: ShipmentRequest,
    adminRemarks?: string,
    shippingDate?: Date,
    additionalServices?: {
      bubbleWrapFeet?: number;
      stickerRemovalItems?: number;
      warningLabels?: number;
      pricePerFoot?: number;
      pricePerItem?: number;
      pricePerLabel?: number;
      totalAdditionalCost?: number;
      customProductPricing?: Record<number, { unitPrice: number; packOf: number; packOfPrice: number }>;
    }
  ) => void;
  onReject: (request: ShipmentRequest, reason: string) => void;
  onApproveForLabelUpload: (request: ShipmentRequest, adminRemarks: string) => void;
  onClose: () => void;
  isProcessing: boolean;
  additionalServicesPricing: UserAdditionalServicesPricing[] | null;
  pricingRules: UserPricing[] | null;
  boxForwardingPricing?: UserBoxForwardingPricing[] | null;
  palletForwardingPricing?: UserPalletForwardingPricing[] | null;
}) {
  const { toast } = useToast();
  const [adminRemarks, setAdminRemarks] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [action, setAction] = useState<"confirm" | "reject" | "approve_for_label" | null>(null);
  const [shippingDate, setShippingDate] = useState<Date | undefined>(() => {
    // Initialize with request date if available
    if (request.date) {
      if (typeof request.date === 'string') {
        return new Date(request.date);
      } else if (request.date && typeof request.date === 'object' && 'seconds' in request.date) {
        return new Date(request.date.seconds * 1000);
      }
    }
    return new Date(); // Default to today
  });
  
  // Support both per-shipment format (selectedAdditionalServices array in each shipment) and old format (request-level)
  // Check if we have per-shipment services (new format)
  const hasPerShipmentServices = request.shipments.some((shipment: any) => 
    shipment.selectedAdditionalServices && Array.isArray(shipment.selectedAdditionalServices)
  );
  
  // For old format, check request-level services
  const requestLevelServices = (request as any).selectedAdditionalServices || [];
  const hasOldFormat = !hasPerShipmentServices && (
    (request as any).bubbleWrapFeet !== undefined || 
    (request as any).stickerRemovalItems !== undefined || 
    (request as any).warningLabels !== undefined ||
    requestLevelServices.length > 0
  );
  
  // Initialize per-shipment admin quantities
  const [perShipmentQuantities, setPerShipmentQuantities] = useState<Record<number, {
    bubbleWrapFeet: number;
    stickerRemovalItems: number;
    warningLabels: number;
  }>>(() => {
    const initial: Record<number, { bubbleWrapFeet: number; stickerRemovalItems: number; warningLabels: number }> = {};
    request.shipments.forEach((shipment: any, index: number) => {
      if (hasPerShipmentServices && shipment.selectedAdditionalServices) {
        // New format: start at 0
        initial[index] = { bubbleWrapFeet: 0, stickerRemovalItems: 0, warningLabels: 0 };
      } else if (hasOldFormat && index === 0) {
        // Old format: use existing values for first shipment only
        initial[index] = {
          bubbleWrapFeet: (request as any).bubbleWrapFeet || 0,
          stickerRemovalItems: (request as any).stickerRemovalItems || 0,
          warningLabels: (request as any).warningLabels || 0,
        };
      } else {
        initial[index] = { bubbleWrapFeet: 0, stickerRemovalItems: 0, warningLabels: 0 };
      }
    });
    return initial;
  });
  
  // For backward compatibility: old format request-level services
  const userSelectedBubbleWrap = hasOldFormat && (
    requestLevelServices.includes("bubbleWrap") || 
    ((request as any).bubbleWrapFeet || 0) > 0
  );
  const userSelectedStickerRemoval = hasOldFormat && (
    requestLevelServices.includes("stickerRemoval") || 
    ((request as any).stickerRemovalItems || 0) > 0
  );
  const userSelectedWarningLabels = hasOldFormat && (
    requestLevelServices.includes("warningLabels") || 
    ((request as any).warningLabels || 0) > 0
  );
  
  // Old format: single set of quantities (for backward compatibility)
  const [adminBubbleWrapFeet, setAdminBubbleWrapFeet] = useState(
    hasOldFormat ? ((request as any).bubbleWrapFeet || 0) : 0
  );
  const [adminStickerRemovalItems, setAdminStickerRemovalItems] = useState(
    hasOldFormat ? ((request as any).stickerRemovalItems || 0) : 0
  );
  const [adminWarningLabels, setAdminWarningLabels] = useState(
    hasOldFormat ? ((request as any).warningLabels || 0) : 0
  );

  const isCustomProduct =
    String(request.productType || "").toLowerCase() === "custom" &&
    String(request.shipmentType || "").toLowerCase() === "product";
  const hasLabelUploaded =
    typeof request.labelUrl === "string" && request.labelUrl.trim().length > 0;

  const isPalletExistingInventory =
    String(request.shipmentType || "").toLowerCase() === "pallet" &&
    String(request.palletSubType || "").toLowerCase() === "existing_inventory";

  // Admin-set pricing + packOf + packOfPrice for custom products (per shipment)
  const [customProductPricing, setCustomProductPricing] = useState<Record<number, {
    unitPrice: number;
    packOf: number;
    packOfPrice: number;
  }>>(() => {
    const initial: Record<number, { unitPrice: number; packOf: number; packOfPrice: number }> = {};
    request.shipments.forEach((shipment: any, index: number) => {
      // For custom products, initialize with stored values or 0
      if (isCustomProduct) {
        const stored = (request as any)?.customProductPricing?.[index];
        initial[index] = {
          unitPrice: shipment.unitPrice || 0,
          packOf: shipment.packOf || 1,
          packOfPrice: stored?.packOfPrice || 0,
        };
      }
    });
    return initial;
  });

  // Admin-set unit pricing for Pallet Existing Inventory (manual at approval time)
  const [palletExistingUnitPrice, setPalletExistingUnitPrice] = useState<Record<number, number>>(() => {
    const initial: Record<number, number> = {};
    if (!isPalletExistingInventory) return initial;
    request.shipments.forEach((shipment: any, index: number) => {
      initial[index] = typeof shipment.unitPrice === "number" ? shipment.unitPrice : (parseFloat(String(shipment.unitPrice || 0)) || 0);
    });
    return initial;
  });

  const latestAdditionalPricing = useMemo(() => {
    if (!additionalServicesPricing || additionalServicesPricing.length === 0) return null;
    return [...additionalServicesPricing].sort((a, b) => {
      const aUpdated = typeof a.updatedAt === "string" ? new Date(a.updatedAt).getTime() : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
      const bUpdated = typeof b.updatedAt === "string" ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (bUpdated as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    })[0];
  }, [additionalServicesPricing]);

  const pricePerFoot = latestAdditionalPricing?.bubbleWrapPrice || 0;
  const pricePerItem = latestAdditionalPricing?.stickerRemovalPrice || 0;
  const pricePerLabel = latestAdditionalPricing?.warningLabelPrice || 0;
  
  // Calculate totals: per-shipment (new format) or request-level (old format)
  let additionalServicesTotal = 0;
  if (hasPerShipmentServices) {
    // New format: sum up all per-shipment quantities
    request.shipments.forEach((shipment: any, index: number) => {
      const quantities = perShipmentQuantities[index] || { bubbleWrapFeet: 0, stickerRemovalItems: 0, warningLabels: 0 };
      additionalServicesTotal += 
        (quantities.bubbleWrapFeet || 0) * pricePerFoot +
        (quantities.stickerRemovalItems || 0) * pricePerItem +
        (quantities.warningLabels || 0) * pricePerLabel;
    });
  } else {
    // Old format: request-level quantities
    additionalServicesTotal =
      (adminBubbleWrapFeet || 0) * pricePerFoot +
      (adminStickerRemovalItems || 0) * pricePerItem +
      (adminWarningLabels || 0) * pricePerLabel;
  }

  const handleConfirmClick = () => {
    if (!shippingDate) {
      toast({
        variant: "destructive",
        title: "Shipping Date Required",
        description: "Please select a shipping date before confirming.",
      });
      return;
    }

    // Validate custom product pricing if applicable
    if (isCustomProduct) {
      if (!adminRemarks.trim()) {
        toast({
          variant: "destructive",
          title: "Admin Remarks Required",
          description: "Please add admin remarks before confirming custom shipment requests.",
        });
        return;
      }
      const hasInvalidPricing = request.shipments.some((shipment: any, index: number) => {
        const pricing = customProductPricing[index];
        return !pricing || pricing.unitPrice <= 0 || pricing.packOf <= 0 || pricing.packOfPrice < 0;
      });
      
      if (hasInvalidPricing) {
        toast({
          variant: "destructive",
          title: "Pricing Required",
          description: "Please set unit price, pack of, and pack-of price for all custom products before confirming.",
        });
        return;
      }
    }

    // Validate pallet existing inventory pricing if applicable
    if (isPalletExistingInventory) {
      const hasMissingPrice = request.shipments.some((shipment: any, index: number) => {
        const price = palletExistingUnitPrice[index] ?? shipment.unitPrice ?? 0;
        return !price || price <= 0;
      });
      if (hasMissingPrice) {
        toast({
          variant: "destructive",
          title: "Pricing Required",
          description: "Please set unit price for all pallet existing-inventory items before confirming.",
        });
        return;
      }
    }
    
    // Apply manual pallet existing inventory unit prices (if applicable)
    const requestForConfirm: ShipmentRequest = isPalletExistingInventory
      ? ({
          ...request,
          shipments: request.shipments.map((s: any, idx: number) => ({
            ...s,
            unitPrice: palletExistingUnitPrice[idx] ?? s.unitPrice ?? 0,
          })),
        } as any)
      : request;

    if (hasPerShipmentServices) {
      // New format: combine all per-shipment quantities
      let totalBubbleWrapFeet = 0;
      let totalStickerRemovalItems = 0;
      let totalWarningLabels = 0;
      
      request.shipments.forEach((shipment: any, index: number) => {
        const quantities = perShipmentQuantities[index] || { bubbleWrapFeet: 0, stickerRemovalItems: 0, warningLabels: 0 };
        totalBubbleWrapFeet += quantities.bubbleWrapFeet || 0;
        totalStickerRemovalItems += quantities.stickerRemovalItems || 0;
        totalWarningLabels += quantities.warningLabels || 0;
      });
      
      onConfirm(requestForConfirm, adminRemarks, shippingDate, {
        bubbleWrapFeet: totalBubbleWrapFeet,
        stickerRemovalItems: totalStickerRemovalItems,
        warningLabels: totalWarningLabels,
        pricePerFoot,
        pricePerItem,
        pricePerLabel,
        totalAdditionalCost: additionalServicesTotal,
        customProductPricing: isCustomProduct ? customProductPricing : undefined,
      });
    } else {
      // Old format: use request-level quantities
      onConfirm(requestForConfirm, adminRemarks, shippingDate, {
        bubbleWrapFeet: adminBubbleWrapFeet,
        stickerRemovalItems: adminStickerRemovalItems,
        warningLabels: adminWarningLabels,
        pricePerFoot,
        pricePerItem,
        pricePerLabel,
        totalAdditionalCost: additionalServicesTotal,
        customProductPricing: isCustomProduct ? customProductPricing : undefined,
      });
    }
  };

  const handleRejectClick = () => {
    if (!rejectionReason.trim()) {
      return;
    }
    onReject(request, rejectionReason);
  };

  return (
    <Dialog open={true} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Review Shipment Request</DialogTitle>
          <DialogDescription>
            Review the shipment request and confirm or reject it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Request Details */}
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Shipping Date</label>
                <p className="text-sm font-medium">{formatDate(request.date)}</p>
              </div>
              <div>
                <label className="text-sm font-medium">Requested Date</label>
                <p className="text-sm font-medium">{formatDate(request.requestedAt)}</p>
              </div>
            </div>
            {request.remarks && (
              <div>
                <label className="text-sm font-medium">Remarks</label>
                <p className="text-sm font-medium">{request.remarks}</p>
              </div>
            )}
            {/* Show Custom Dimensions if productType is Custom */}
            {request.productType === "Custom" && request.customDimensions && (
              <div>
                <label className="text-sm font-medium">Custom Dimensions</label>
                <div className="mt-1 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm whitespace-pre-wrap">{request.customDimensions}</p>
                </div>
              </div>
            )}
            {(() => {
              // Debug: Log labelUrl to console
              console.log('Label URL for request:', request.id, request.labelUrl, typeof request.labelUrl);
              const hasLabel = request.labelUrl && typeof request.labelUrl === 'string' && request.labelUrl.trim() !== "";
              
              // Helper function to get proper view URL (for viewing, not downloading)
              const getViewUrl = (url: string): string => {
                // If it's a Google Drive link, use preview URL for PDFs or view URL for images
                if (url.includes('drive.google.com/file/d/')) {
                  const fileIdMatch = url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
                  if (fileIdMatch && fileIdMatch[1]) {
                    const fileId = fileIdMatch[1];
                    const isPDF = url.toLowerCase().includes('.pdf') || url.toLowerCase().includes('pdf');
                    // Use preview for PDFs (opens in Google Drive viewer), view for images
                    return isPDF 
                      ? `https://drive.google.com/file/d/${fileId}/preview`
                      : `https://drive.google.com/file/d/${fileId}/view`;
                  }
                }
                // For direct URLs (PDFs or images), return as is - browser will handle viewing
                return url;
              };

              // Support single URL or comma-separated multiple label URLs
              const labelUrls = String(request.labelUrl ?? "")
                .split(",")
                .map((u) => u.trim())
                .filter(Boolean);
              const handleView = (url?: string) => {
                const toOpen = url ?? labelUrls[0];
                if (!toOpen) return;
                window.open(getViewUrl(toOpen), "_blank", "noopener,noreferrer");
              };

              return hasLabel ? (
              <div>
                <label className="text-sm font-medium mb-2 block">Shipping Label{labelUrls.length > 1 ? "s" : ""}</label>
                <div className="border rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-8 w-8 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium mb-1">
                        {String(request.labelUrl).trim().includes("drive.google.com")
                          ? "Label(s) stored in Google Drive"
                          : "Shipping Label(s)"}
                      </p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        {labelUrls.map((url, idx) => (
                          <Button
                            key={idx}
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleView(url)}
                            className="flex items-center gap-2"
                          >
                            <Eye className="h-4 w-4" />
                            {labelUrls.length > 1 ? `View ${idx + 1}` : "View"}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <label className="text-sm font-medium mb-2 block">Shipping Label</label>
                <div className="border rounded-lg p-2 bg-gray-50">
                  <div className="flex items-center gap-2 p-4">
                    <FileText className="h-8 w-8 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">No label uploaded</p>
                      <p className="text-xs text-muted-foreground">This shipment request does not have a shipping label.</p>
                    </div>
                  </div>
                </div>
              </div>
            );
            })()}
          </div>

          {/* Shipment Items */}
          <div>
            <label className="text-sm font-medium mb-2 block">Products to Ship</label>
            <div className="space-y-4 border rounded-lg p-4">
              {request.shipments.map((shipment: any, index: number) => {
                const product = inventory.find(item => item.id === shipment.productId);
                const effectivePackOf = isCustomProduct
                  ? (customProductPricing[index]?.packOf || shipment.packOf || 1)
                  : shipment.packOf;
                const totalUnits = shipment.quantity * effectivePackOf;
                const hasEnoughStock = product ? product.quantity >= totalUnits : false;
                
                // Get selected services for this shipment (new format) or use request-level (old format)
                const shipmentSelectedServices = hasPerShipmentServices 
                  ? (shipment.selectedAdditionalServices || [])
                  : (index === 0 ? requestLevelServices : []);
                
                const hasBubbleWrap = shipmentSelectedServices.includes("bubbleWrap");
                const hasStickerRemoval = shipmentSelectedServices.includes("stickerRemoval");
                const hasWarningLabels = shipmentSelectedServices.includes("warningLabels");
                const hasAnyService = hasBubbleWrap || hasStickerRemoval || hasWarningLabels;
                
                // Get quantities for this shipment
                const quantities = perShipmentQuantities[index] || { bubbleWrapFeet: 0, stickerRemovalItems: 0, warningLabels: 0 };
                const shipmentTotal = hasPerShipmentServices
                  ? (quantities.bubbleWrapFeet || 0) * pricePerFoot +
                    (quantities.stickerRemovalItems || 0) * pricePerItem +
                    (quantities.warningLabels || 0) * pricePerLabel
                  : (index === 0 ? additionalServicesTotal : 0);

                // Calculate unit price and packOfPrice from pricing rules
                let unitPrice = shipment.unitPrice || 0; // Fallback to stored value
                let packOfPrice = 0;
                
                // Use box/pallet forwarding pricing for box and pallet shipments
                if (request.shipmentType === "box" && boxForwardingPricing && boxForwardingPricing.length > 0) {
                  // Get the most recent box forwarding pricing
                  const latestBoxPricing = [...boxForwardingPricing].sort((a, b) => {
                    const aUpdated = typeof a.updatedAt === 'string' 
                      ? new Date(a.updatedAt).getTime() 
                      : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
                    const bUpdated = typeof b.updatedAt === 'string' 
                      ? new Date(b.updatedAt).getTime() 
                      : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
                    return bUpdated - aUpdated;
                  })[0];
                  if (latestBoxPricing) {
                    unitPrice = latestBoxPricing.price;
                  }
                } else if (request.shipmentType === "pallet") {
                  const palletSubType = request.palletSubType;
                  if (palletSubType === "forwarding" && palletForwardingPricing && palletForwardingPricing.length > 0) {
                    // Get the most recent pallet forwarding pricing
                    const latestPalletForwarding = [...palletForwardingPricing].sort((a, b) => {
                      const aUpdated = typeof a.updatedAt === 'string' 
                        ? new Date(a.updatedAt).getTime() 
                        : (a.updatedAt as any)?.seconds ? (a.updatedAt as any).seconds * 1000 : 0;
                      const bUpdated = typeof b.updatedAt === 'string' 
                        ? new Date(b.updatedAt).getTime() 
                        : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
                      return bUpdated - aUpdated;
                    })[0];
                    if (latestPalletForwarding) {
                      unitPrice = latestPalletForwarding.price;
                    }
                  }
                } else if (String(request.shipmentType || "").toLowerCase() === "product" && request.service && request.productType && pricingRules && pricingRules.length > 0) {
                  // For custom products, use admin-set pricing if available
                  if (String(request.productType || "").toLowerCase() === "custom") {
                    const customPricing = customProductPricing[index];
                    if (customPricing) {
                      unitPrice = customPricing.unitPrice || 0;
                      packOfPrice = customPricing.packOfPrice || 0;
                    } else {
                      // Fallback to stored value
                      unitPrice = shipment.unitPrice || 0;
                      packOfPrice = 0;
                    }
                  } else {
                    const calculatedPrice = calculatePrepUnitPrice(
                      pricingRules,
                      request.service,
                      request.productType,
                      shipment.quantity, // Use quantity to get correct pricing tier
                      shipment.packOf || 1
                    );
                    if (calculatedPrice) {
                      // Use the calculated rate from pricing rules (this is the correct unit price)
                      unitPrice = calculatedPrice.rate || shipment.unitPrice || 0;
                      packOfPrice = calculatedPrice.packOf || 0;
                    }
                  }
                }

                // Pallet Existing Inventory is priced manually by admin at approval time
                if (isPalletExistingInventory) {
                  unitPrice = palletExistingUnitPrice[index] ?? shipment.unitPrice ?? 0;
                }
                
                // Calculate pricing breakdown
                // Formula: (Unit Price Ã— Quantity) + (Pack Of Price Ã— (Pack Of - 1))
                // Custom: use the same formula as shipment form:
                // total = (unitPrice Ã— quantity) + (packOfPrice Ã— (packOf - 1))
                const isCustom = String(request.productType || "").toLowerCase() === "custom";
                const baseTotal = isCustom ? unitPrice * shipment.quantity : unitPrice * shipment.quantity; // unitPrice is per-box
                const packCharge = isCustom
                  ? (packOfPrice * Math.max(0, effectivePackOf - 1))
                  : (packOfPrice * Math.max(0, shipment.packOf - 1));
                // Always recalculate total - don't use stored shipment.totalPrice as it may be incorrect
                const productTotal = baseTotal + packCharge;

                return (
                  <div key={index} className="border-b last:border-b-0 pb-4 last:pb-0 space-y-3">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <p className="font-medium text-base">{product?.productName || "Unknown Product"}</p>
                        
                        {/* Product Details */}
                        <div className="mt-2 space-y-1">
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                            <div>
                              <span className="text-muted-foreground">Product Type:</span>
                              <span className="ml-1 font-medium">{request.productType || "N/A"}</span>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Service:</span>
                              <span className="ml-1 font-medium">{request.service || "N/A"}</span>
                            </div>
                            {((product as any)?.dimension || (product as any)?.dimensions) && (
                              <div>
                                <span className="text-muted-foreground">Dimension:</span>
                                <span className="ml-1 font-medium">{(product as any).dimension || (product as any).dimensions}</span>
                              </div>
                            )}
                            {request.productType === "Custom" && request.customDimensions && (
                              <div className="col-span-2">
                                <span className="text-muted-foreground">Custom Dimensions:</span>
                                <div className="mt-1 p-2 bg-blue-50 border border-blue-200 rounded text-xs">
                                  <p className="whitespace-pre-wrap font-medium">{request.customDimensions}</p>
                                </div>
                              </div>
                            )}
                            <div>
                              <span className="text-muted-foreground">Total Quantity (Quantity x Packs):</span>
                              <span className="ml-1 font-medium">{shipment.quantity} × {shipment.packOf} = {totalUnits} units</span>
                            </div>
                          </div>
                        </div>

                        {/* Pricing Breakdown - Editable for Custom Products / Manual for Pallet Existing Inventory */}
                        {isCustomProduct ? (
                          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg space-y-3">
                            <div className="text-xs font-medium text-yellow-800 mb-2">
                              Custom Product - Set Pricing:
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Unit Price ($)</label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={customProductPricing[index]?.unitPrice || 0}
                                  onChange={(e) => {
                                    setCustomProductPricing(prev => ({
                                      ...prev,
                                      [index]: {
                                        ...prev[index] || { unitPrice: 0, packOf: shipment.packOf || 1 },
                                        unitPrice: parseFloat(e.target.value) || 0,
                                      }
                                    }));
                                  }}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Pack Of</label>
                                <Input
                                  type="number"
                                  min="1"
                                  step="1"
                                  value={customProductPricing[index]?.packOf || shipment.packOf || 1}
                                  onChange={(e) => {
                                    setCustomProductPricing(prev => ({
                                      ...prev,
                                      [index]: {
                                        ...prev[index] || { unitPrice: shipment.unitPrice || 0, packOf: shipment.packOf || 1 },
                                        packOf: parseInt(e.target.value) || 1,
                                      }
                                    }));
                                  }}
                                />
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Pack Of Price ($)</label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={customProductPricing[index]?.packOfPrice || 0}
                                  onChange={(e) => {
                                    setCustomProductPricing(prev => ({
                                      ...prev,
                                      [index]: {
                                        ...prev[index] || { unitPrice: shipment.unitPrice || 0, packOf: shipment.packOf || 1, packOfPrice: 0 },
                                        packOfPrice: parseFloat(e.target.value) || 0,
                                      }
                                    }));
                                  }}
                                />
                              </div>
                              <div />
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Total units: {shipment.quantity} × {(customProductPricing[index]?.packOf || shipment.packOf || 1)} = {shipment.quantity * (customProductPricing[index]?.packOf || shipment.packOf || 1)}
                            </div>
                            <div className="flex justify-between text-sm font-semibold border-t pt-2 mt-2">
                              <span>Total:</span>
                              <span>${productTotal.toFixed(2)}</span>
                            </div>
                          </div>
                        ) : isPalletExistingInventory ? (
                          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
                            <div className="text-xs font-medium text-blue-800 mb-2">
                              Pallet Existing Inventory - Set Pricing (manual):
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Unit Price ($) per pallet</label>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={palletExistingUnitPrice[index] ?? shipment.unitPrice ?? 0}
                                  onChange={(e) => {
                                    const v = parseFloat(e.target.value);
                                    setPalletExistingUnitPrice((prev) => ({
                                      ...prev,
                                      [index]: Number.isFinite(v) ? v : 0,
                                    }));
                                  }}
                                />
                              </div>
                              <div className="space-y-1">
                                <label className="text-xs text-muted-foreground">Total</label>
                                <Input
                                  readOnly
                                  value={`$${( (palletExistingUnitPrice[index] ?? shipment.unitPrice ?? 0) * shipment.quantity ).toFixed(2)}`}
                                />
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Total: (Unit Price × Quantity) = ${(palletExistingUnitPrice[index] ?? shipment.unitPrice ?? 0).toFixed(2)} × {shipment.quantity}
                            </div>
                          </div>
                        ) : (
                          <div className="mt-3 p-3 bg-muted/50 rounded-lg space-y-1">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Unit Price:</span>
                              <span className="font-medium">${unitPrice.toFixed(2)} × {shipment.quantity}</span>
                            </div>
                            {packOfPrice > 0 && shipment.packOf > 1 && (
                              <div className="flex justify-between text-xs">
                                <span className="text-muted-foreground">Pack Of Price:</span>
                                <span className="font-medium">${packOfPrice.toFixed(2)} × {shipment.packOf - 1} (packs)</span>
                              </div>
                            )}
                            <div className="flex justify-between text-sm font-semibold border-t pt-1 mt-1">
                              <span>Total:</span>
                              <span>${productTotal.toFixed(2)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                      <div className="text-right ml-4">
                        {product ? (
                          <>
                            <p className="text-sm">Stock: {product.quantity}</p>
                            {hasEnoughStock ? (
                              <Badge variant="default" className="mt-1">Available</Badge>
                            ) : (
                              <Badge variant="destructive" className="mt-1">Insufficient</Badge>
                            )}
                          </>
                        ) : (
                          <Badge variant="destructive">Not Found</Badge>
                        )}
                      </div>
                    </div>
                    
                    {/* Additional Services per shipment */}
                    {hasAnyService && (
                      <div className="border rounded-lg p-3 bg-muted/30 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium">Additional Services for this product</label>
                          <span className="text-xs text-muted-foreground">
                            User selected: {[
                              hasBubbleWrap && "Bubble Wrap",
                              hasStickerRemoval && "Sticker Removal",
                              hasWarningLabels && "Warning Labels"
                            ].filter(Boolean).join(", ")}
                          </span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {hasBubbleWrap && (
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Bubble Wrap (feet)</label>
                              <Input
                                type="number"
                                min={0}
                                value={hasPerShipmentServices ? quantities.bubbleWrapFeet : (index === 0 ? adminBubbleWrapFeet : 0)}
                                onChange={(e) => {
                                  if (hasPerShipmentServices) {
                                    setPerShipmentQuantities(prev => ({
                                      ...prev,
                                      [index]: {
                                        ...prev[index],
                                        bubbleWrapFeet: parseInt(e.target.value) || 0,
                                      }
                                    }));
                                  } else if (index === 0) {
                                    setAdminBubbleWrapFeet(parseInt(e.target.value) || 0);
                                  }
                                }}
                              />
                              <p className="text-xs text-muted-foreground">
                                ${pricePerFoot.toFixed(2)} per foot
                              </p>
                            </div>
                          )}
                          {hasStickerRemoval && (
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Sticker Removal (items)</label>
                              <Input
                                type="number"
                                min={0}
                                value={hasPerShipmentServices ? quantities.stickerRemovalItems : (index === 0 ? adminStickerRemovalItems : 0)}
                                onChange={(e) => {
                                  if (hasPerShipmentServices) {
                                    setPerShipmentQuantities(prev => ({
                                      ...prev,
                                      [index]: {
                                        ...prev[index],
                                        stickerRemovalItems: parseInt(e.target.value) || 0,
                                      }
                                    }));
                                  } else if (index === 0) {
                                    setAdminStickerRemovalItems(parseInt(e.target.value) || 0);
                                  }
                                }}
                              />
                              <p className="text-xs text-muted-foreground">
                                ${pricePerItem.toFixed(2)} per item
                              </p>
                            </div>
                          )}
                          {hasWarningLabels && (
                            <div className="space-y-1">
                              <label className="text-xs text-muted-foreground">Warning Labels (count)</label>
                              <Input
                                type="number"
                                min={0}
                                value={hasPerShipmentServices ? quantities.warningLabels : (index === 0 ? adminWarningLabels : 0)}
                                onChange={(e) => {
                                  if (hasPerShipmentServices) {
                                    setPerShipmentQuantities(prev => ({
                                      ...prev,
                                      [index]: {
                                        ...prev[index],
                                        warningLabels: parseInt(e.target.value) || 0,
                                      }
                                    }));
                                  } else if (index === 0) {
                                    setAdminWarningLabels(parseInt(e.target.value) || 0);
                                  }
                                }}
                              />
                              <p className="text-xs text-muted-foreground">
                                ${pricePerLabel.toFixed(2)} per label
                              </p>
                            </div>
                          )}
                        </div>
                        {shipmentTotal > 0 && (
                          <div className="flex items-center justify-between text-xs font-semibold border-t pt-2">
                            <span>Subtotal for this product</span>
                            <span>${shipmentTotal.toFixed(2)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Calculate Grand Total */}
          {(() => {
            const totalProductCost = request.shipments.reduce((sum: number, shipment: any, index: number) => {
              let unitPrice = shipment.unitPrice || 0;
              let packOfPrice = 0;
              
              // Pallet Existing Inventory is priced manually by admin at approval time
              if (isPalletExistingInventory) {
                unitPrice = palletExistingUnitPrice[index] ?? shipment.unitPrice ?? 0;
                packOfPrice = 0;
              }

              // For custom products, use admin-set pricing
              if (!isPalletExistingInventory && request.productType === "Custom" && request.shipmentType === "product") {
                const customPricing = customProductPricing[index];
                if (customPricing) {
                  unitPrice = customPricing.unitPrice || 0;
                  packOfPrice = customPricing.packOfPrice || 0;
                }
              } else if (!isPalletExistingInventory && request.shipmentType === "product" && request.service && request.productType && pricingRules && pricingRules.length > 0) {
                const calculatedPrice = calculatePrepUnitPrice(
                  pricingRules,
                  request.service,
                  request.productType,
                  shipment.quantity,
                  shipment.packOf || 1
                );
                if (calculatedPrice) {
                  unitPrice = calculatedPrice.rate || shipment.unitPrice || 0;
                  packOfPrice = calculatedPrice.packOf || 0;
                }
              }
              // Formula: (Unit Price Ã— Quantity) + (Pack Of Price Ã— (Pack Of - 1))
              const baseTotal = unitPrice * shipment.quantity; // unitPrice Ã— quantity (not totalUnits)
              const packCharge = packOfPrice;
              return sum + (baseTotal + packCharge);
            }, 0);
            const grandTotal = totalProductCost + additionalServicesTotal;
            
            return (
              <>
                {/* Total Additional Services (only show if we have services) */}
                {additionalServicesTotal > 0 && (
                  <div className="border rounded-lg p-4 bg-primary/5">
                    <div className="flex items-center justify-between text-sm font-semibold">
                      <span>Total Additional Services Cost</span>
                      <span>${additionalServicesTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )}
                
                {/* Grand Total */}
                <div className="border-2 rounded-lg p-4 bg-primary/10 border-primary">
                  <div className="flex items-center justify-between text-lg font-bold">
                    <span>Grand Total</span>
                    <span>${grandTotal.toFixed(2)}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Product Total: ${totalProductCost.toFixed(2)} + Additional Services: ${additionalServicesTotal.toFixed(2)}
                  </div>
                </div>
              </>
            );
          })()}

          {/* Action Buttons */}
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => setAction("confirm")}
              className="flex-1"
            >
              <Check className="h-4 w-4 mr-2" />
              Confirm
            </Button>
            {isCustomProduct && !hasLabelUploaded && (
              <Button
                variant="outline"
                onClick={() => setAction("approve_for_label")}
                className="flex-1"
              >
                Approve for Label Upload
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setAction("reject")}
              className="flex-1"
            >
              <X className="h-4 w-4 mr-2" />
              Reject
            </Button>
          </div>

          {/* Confirm Form */}
          {action === "confirm" && (
            <div className="space-y-4 border-t pt-4">
              <h3 className="font-semibold">Confirm Shipment</h3>
              {(!request.labelUrl || request.labelUrl.trim() === "") && (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
                  <p className="text-sm text-yellow-800">
                    âš ï¸ Warning: No shipping label uploaded for this shipment request.
                  </p>
                </div>
              )}
              <div>
                <label className="text-sm font-medium">Shipping Date *</label>
                <DatePicker
                  date={shippingDate}
                  setDate={(date) => setShippingDate(date)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Select the date when this shipment will be shipped.
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">
                  Admin Remarks{isCustomProduct ? " *" : ""}
                </label>
                <Textarea
                  placeholder="Add remarks about this shipment..."
                  value={adminRemarks}
                  onChange={(e) => setAdminRemarks(e.target.value)}
                  className="mt-1"
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {isCustomProduct
                    ? "Required for custom requests. Explain corrected dimensions/pricing decisions."
                    : "Optional remarks about this shipment."}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={handleConfirmClick}
                  disabled={
                    isProcessing ||
                    !shippingDate ||
                    (isCustomProduct && (!adminRemarks.trim() || !hasLabelUploaded))
                  }
                  className="flex-1"
                >
                  {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {isCustomProduct ? "Complete Shipment" : "Confirm Shipment"}
                </Button>
                <Button variant="outline" onClick={() => setAction(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {action === "approve_for_label" && (
            <div className="space-y-4 border-t pt-4">
              <h3 className="font-semibold">Approve For Label Upload</h3>
              <p className="text-sm text-muted-foreground">
                Use this when custom dimensions/pricing were reviewed but label is missing.
              </p>
              <div>
                <label className="text-sm font-medium">Admin Remarks *</label>
                <Textarea
                  placeholder="Explain what was corrected and ask user to upload labels."
                  value={adminRemarks}
                  onChange={(e) => setAdminRemarks(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() => onApproveForLabelUpload(request, adminRemarks)}
                  disabled={isProcessing || !adminRemarks.trim()}
                  className="flex-1"
                >
                  {isProcessing && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Save & Notify User
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
              <h3 className="font-semibold">Reject Shipment</h3>
              <div>
                <label className="text-sm font-medium">Rejection Reason *</label>
                <Textarea
                  placeholder="Enter reason for rejection..."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  required
                  className="mt-1"
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
        </div>
      </DialogContent>
    </Dialog>
  );
}

