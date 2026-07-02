"use client";

import { useEffect, useState, useMemo } from "react";
import type { ShipmentRequest, UserProfile, InventoryItem, InventoryTransfer, UserPricing, UserBoxForwardingPricing, UserPalletForwardingPricing, UserAdditionalServicesPricing } from "@/types";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { useUserPricingCollections } from "@/hooks/use-user-pricing-collections";
import { calculatePrepUnitPrice } from "@/lib/pricing-utils";
import {
  catalogFromPricingDoc,
  unitPriceForServiceKey,
  isLegacyAdditionalServiceKey,
} from "@/lib/additional-services-catalog";
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
import { getCommittedOutboundUnits } from "@/lib/client-inventory-outbound-sync";
import { format } from "date-fns";
import { Check, X, Eye, Loader2, FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { DatePicker } from "@/components/ui/date-picker";
import { formatWarehouseDisplayName } from "@/lib/warehouse-display";

type LocationDoc = { id: string; name?: string; active?: boolean };

function formatDate(date: ShipmentRequest["date"] | ShipmentRequest["requestedAt"]) {
  if (typeof date === 'string') {
    return format(new Date(date), "PPP");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "PPP");
  }
  return "N/A";
}

type PerShipmentAdditionalQty = {
  bubbleWrapFeet: number;
  stickerRemovalItems: number;
  warningLabels: number;
  extra: Record<string, number>;
};

function emptyPerShipmentQty(): PerShipmentAdditionalQty {
  return { bubbleWrapFeet: 0, stickerRemovalItems: 0, warningLabels: 0, extra: {} };
}

function initExtraQtyForKeys(keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  keys.filter((k) => !isLegacyAdditionalServiceKey(k)).forEach((k) => {
    out[k] = 0;
  });
  return out;
}

function subtotalAdditionalForLine(
  q: PerShipmentAdditionalQty,
  catalog: ReturnType<typeof catalogFromPricingDoc>
): number {
  let sum =
    (q.bubbleWrapFeet || 0) * unitPriceForServiceKey("bubbleWrap", catalog) +
    (q.stickerRemovalItems || 0) * unitPriceForServiceKey("stickerRemoval", catalog) +
    (q.warningLabels || 0) * unitPriceForServiceKey("warningLabels", catalog);
  Object.entries(q.extra || {}).forEach(([key, qty]) => {
    sum += (Number(qty) || 0) * unitPriceForServiceKey(key, catalog);
  });
  return sum;
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
  const { data: locationDocs = [] } = useCollection<LocationDoc>("locations");
  const { data: inventoryTransfers = [] } = useCollection<InventoryTransfer>(
    isValidUserId ? `users/${userId}/inventoryTransfers` : ""
  );
  const warehouseNameById = useMemo(() => {
    const map: Record<string, string> = {};
    locationDocs.forEach((loc) => {
      map[loc.id] = formatWarehouseDisplayName(loc.name || loc.id);
    });
    inventoryTransfers.forEach((row) => {
      const fromId = String(row.fromLocationId || "").trim();
      const toId = String(row.toLocationId || "").trim();
      const fromName = String(row.fromLocationName || "").trim();
      const toName = String(row.toLocationName || "").trim();
      if (fromId && fromName && !map[fromId]) {
        map[fromId] = formatWarehouseDisplayName(fromName);
      }
      if (toId && toName && !map[toId]) {
        map[toId] = formatWarehouseDisplayName(toName);
      }
    });
    return map;
  }, [locationDocs, inventoryTransfers]);

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

  const pricingUser = isValidUserId ? selectedUser : null;
  const {
    pricingRules: effectivePricingRules,
    additionalServicesPricing: effectiveAdditionalServicesPricing,
    boxForwardingPricing: effectiveBoxForwardingPricing,
    palletForwardingPricing: effectivePalletForwardingPricing,
  } = useUserPricingCollections(pricingUser);

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
  const cancelledCount = requests.filter(req => req.status === "cancelled").length;

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
      extraServiceQuantities?: Record<string, number>;
      extraServiceUnitPrices?: Record<string, number>;
      crossdockHoldFulfillment?: boolean;
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
      const extraServiceQuantities = additionalServices?.extraServiceQuantities;
      const extraServiceUnitPrices = additionalServices?.extraServiceUnitPrices;
      const crossdockHoldFulfillment = additionalServices?.crossdockHoldFulfillment === true;

      const committedByProduct = new Map<string, number>();
      if (!crossdockHoldFulfillment) {
      for (const shipment of request.shipments ?? []) {
        const productId = String(shipment.productId ?? "").trim();
        if (!productId || committedByProduct.has(productId)) continue;
        committedByProduct.set(
          productId,
          await getCommittedOutboundUnits(targetUserId, productId, request.id)
        );
      }
      }

      await runTransaction(db, async (transaction) => {
        const requestRef = doc(db, `users/${targetUserId}/shipmentRequests`, request.id);
        const confirmedAt = Timestamp.now();

        // Validate stock availability (deduction happens at warehouse dispatch, not here).
        const isCustomProduct =
          String(request.productType || "").toLowerCase() === "custom" &&
          String(request.shipmentType || "").toLowerCase() === "product";

        if (!crossdockHoldFulfillment) {
        await Promise.all(
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
            const selectedSourceLocationId = String((shipment as any).sourceLocationId || "").trim();
            const committed = committedByProduct.get(shipment.productId) ?? 0;
            const sellableQty = Math.max(0, currentInventory.quantity - committed);

            if (sellableQty < totalUnitsShipped) {
              throw new Error(
                `Not enough stock for ${currentInventory.productName}. Available: ${sellableQty}, Requested: ${totalUnitsShipped}.`
              );
            }

            const incoming = (currentInventory as any).locationQuantities;
            const locationQuantities: Record<string, number> = {};
            if (incoming && typeof incoming === "object") {
              for (const [key, value] of Object.entries(incoming as Record<string, unknown>)) {
                const id = String(key || "").trim();
                const qtyValue = Number(value);
                if (!id || !Number.isFinite(qtyValue) || qtyValue <= 0) continue;
                locationQuantities[id] = qtyValue;
              }
            }
            const fallbackLocationId = String((currentInventory as any).locationId || "").trim();
            if (Object.keys(locationQuantities).length === 0 && fallbackLocationId) {
              locationQuantities[fallbackLocationId] = Number(currentInventory.quantity) || 0;
            }
            const locationIds = Object.keys(locationQuantities);
            const requiresSourceSelection = locationIds.length > 1;
            const effectiveSourceLocationId =
              selectedSourceLocationId || locationIds[0] || fallbackLocationId;

            if (requiresSourceSelection && !selectedSourceLocationId) {
              throw new Error(`Please select ship-from location for ${currentInventory.productName}.`);
            }
            const hasTrackedLocations = locationIds.length > 0;
            const sourceAvailable = hasTrackedLocations
              ? Number(locationQuantities[effectiveSourceLocationId] || 0)
              : Number(currentInventory.quantity || 0);
            if (hasTrackedLocations && sourceAvailable < totalUnitsShipped) {
              throw new Error(
                `Not enough stock in selected location for ${currentInventory.productName}. Available: ${sourceAvailable}, Requested: ${totalUnitsShipped}.`
              );
            }

            return {
              shipment,
              effectivePackOf,
              inventoryDocRef,
              currentInventory,
              totalUnitsShipped,
              selectedSourceLocationId: effectiveSourceLocationId,
              locationQuantities,
              hasTrackedLocations,
            };
          })
        );
        }

        // Approve for warehouse — client inventory deducts at dispatch, not here.
        transaction.update(requestRef, {
          status: "confirmed",
          confirmedBy: adminProfile.uid,
          confirmedAt,
          ...(crossdockHoldFulfillment
            ? { crossdockFulfillment: true }
            : { clientInventoryDeductionTiming: "dispatch" }),
          adminRemarks: adminRemarks || "",
          ...(typeof (request as any).customDimensions === "string"
            ? { customDimensions: (request as any).customDimensions.trim() }
            : {}),
          ...(isCustomProduct && additionalServices?.customProductPricing
            ? { adminCustomProductPricing: additionalServices.customProductPricing }
            : {}),
          adminAdditionalServices: {
            bubbleWrapFeet,
            stickerRemovalItems,
            warningLabels,
            pricePerFoot,
            pricePerItem,
            pricePerLabel,
            total: additionalServicesTotal,
            ...(extraServiceQuantities && Object.keys(extraServiceQuantities).length > 0
              ? { extraServiceQuantities }
              : {}),
            ...(extraServiceUnitPrices && Object.keys(extraServiceUnitPrices).length > 0
              ? { extraServiceUnitPrices }
              : {}),
          },
        });

      });

      await addDoc(collection(db, `users/${targetUserId}/notifications`), {
        type: "shipment_request",
        title: "Outbound shipment request approved",
        message: "Your outbound shipment request was approved and sent to the warehouse for fulfillment.",
        isRead: false,
        targetUrl: "/dashboard/create-shipment-with-labels",
        relatedRequestId: request.id,
        createdAt: Timestamp.now(),
        createdBy: adminProfile.uid,
      });

      toast({
        title: "Success",
        description: "Shipment request confirmed — inventory will deduct when dispatched.",
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

        // Restore inventory only if it was already deducted (legacy confirm or after dispatch).
        if ((request as ShipmentRequest & { clientInventoryDeductedAt?: unknown }).clientInventoryDeductedAt && request.shipments) {
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

      if ((request as ShipmentRequest & { clientInventoryDeductedAt?: unknown }).clientInventoryDeductedAt && request.shipments && authUser && targetUserId) {
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
      const approvePayload: any = {
        status: "awaiting_label_upload",
        approvedForLabelBy: adminProfile.uid,
        approvedForLabelAt: Timestamp.now(),
        adminRemarks: adminRemarks.trim(),
      };
      if (typeof (request as any).customDimensions === "string") {
        approvePayload.customDimensions = (request as any).customDimensions.trim();
      }
      await updateDoc(doc(db, `users/${targetUserId}/shipmentRequests`, request.id), approvePayload);

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
            <SelectItem value="cancelled">Cancelled</SelectItem>
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
                            : request.status === "cancelled"
                            ? "secondary"
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
                            : request.status === "cancelled"
                            ? `Cancelled ${(request as any).cancelledAt ? formatDate((request as any).cancelledAt) : ""}${
                                (request as any).cancellationReason
                                  ? ` — ${(request as any).cancellationReason}`
                                  : ""
                              }`
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
          warehouseNameById={warehouseNameById}
          onConfirm={handleConfirm}
          onReject={handleReject}
          onApproveForLabelUpload={handleApproveForLabelUpload}
          onClose={() => setSelectedRequest(null)}
          isProcessing={isProcessing}
          additionalServicesPricing={effectiveAdditionalServicesPricing || []}
          pricingRules={effectivePricingRules || []}
          boxForwardingPricing={effectiveBoxForwardingPricing}
          palletForwardingPricing={effectivePalletForwardingPricing}
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
  warehouseNameById,
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
  warehouseNameById: Record<string, string>;
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
      extraServiceQuantities?: Record<string, number>;
      extraServiceUnitPrices?: Record<string, number>;
      crossdockHoldFulfillment?: boolean;
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
  const [crossdockHoldFulfillment, setCrossdockHoldFulfillment] = useState(false);
  const [adminCustomDimensions, setAdminCustomDimensions] = useState(
    String((request as any).customDimensions || "")
  );
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
  
  // Initialize per-shipment admin quantities (extras live in `extra`; legacy three use numeric fields)
  const [perShipmentQuantities, setPerShipmentQuantities] = useState<Record<number, PerShipmentAdditionalQty>>(() => {
    const initial: Record<number, PerShipmentAdditionalQty> = {};
    request.shipments.forEach((shipment: any, index: number) => {
      if (hasPerShipmentServices && shipment.selectedAdditionalServices) {
        initial[index] = {
          ...emptyPerShipmentQty(),
          extra: initExtraQtyForKeys(shipment.selectedAdditionalServices as string[]),
        };
      } else {
        initial[index] = { ...emptyPerShipmentQty() };
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
  const [adminExtraServiceQty, setAdminExtraServiceQty] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    if (!hasPerShipmentServices) {
      (requestLevelServices as string[]).forEach((k) => {
        if (!isLegacyAdditionalServiceKey(k)) init[k] = 0;
      });
    }
    return init;
  });

  const isCustomProduct =
    String(request.productType || "").toLowerCase() === "custom" &&
    String(request.shipmentType || "").toLowerCase() === "product";
  const hasLabelUploaded =
    typeof request.labelUrl === "string" && request.labelUrl.trim().length > 0;

  const isPalletExistingInventory =
    String(request.shipmentType || "").toLowerCase() === "pallet" &&
    String(request.palletSubType || "").toLowerCase() === "existing_inventory";

  const getLocationBreakdownForProduct = (product?: InventoryItem) => {
    if (!product) return [] as Array<{ locationId: string; qty: number }>;
    const locationQuantitiesRaw =
      typeof (product as any).locationQuantities === "object"
        ? ((product as any).locationQuantities as Record<string, unknown>)
        : {};
    const locationBreakdown = Object.entries(locationQuantitiesRaw)
      .map(([locationId, qty]) => ({
        locationId,
        qty: Number(qty) || 0,
      }))
      .filter((entry) => entry.qty > 0);
    if (locationBreakdown.length === 0 && (product as any).locationId) {
      locationBreakdown.push({
        locationId: String((product as any).locationId),
        qty: Number(product.quantity) || 0,
      });
    }
    return locationBreakdown;
  };
  const requiresSourceLocationSelection = (product?: InventoryItem) =>
    getLocationBreakdownForProduct(product).length > 1;
  const prettyLocationLabel = (locationId: string) => {
    const raw = String(locationId || "").trim();
    const mapped = warehouseNameById[raw];
    if (mapped) return mapped;
    const normalized = raw.replace(/[^a-z0-9]/gi, "");
    if (/^[a-z]{2}0*\d+$/i.test(normalized)) {
      return formatWarehouseDisplayName(raw);
    }
    // Unknown legacy id: keep a readable generic label and avoid raw Firestore ids.
    if (!raw) return "Unknown location";
    return "Unknown location";
  };

  const [shipFromLocationByIndex, setShipFromLocationByIndex] = useState<Record<number, string>>(() => {
    const initial: Record<number, string> = {};
    request.shipments.forEach((shipment: any, index: number) => {
      const product = inventory.find((item) => item.id === shipment.productId);
      const options = getLocationBreakdownForProduct(product);
      initial[index] = options[0]?.locationId || "";
    });
    return initial;
  });

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
      const bUpdated = typeof b.updatedAt === "string" ? new Date(b.updatedAt).getTime() : (b.updatedAt as any)?.seconds ? (b.updatedAt as any).seconds * 1000 : 0;
      return bUpdated - aUpdated;
    })[0];
  }, [additionalServicesPricing]);

  const serviceCatalog = useMemo(
    () => catalogFromPricingDoc(latestAdditionalPricing as any),
    [latestAdditionalPricing]
  );

  const pricePerFoot = unitPriceForServiceKey("bubbleWrap", serviceCatalog);
  const pricePerItem = unitPriceForServiceKey("stickerRemoval", serviceCatalog);
  const pricePerLabel = unitPriceForServiceKey("warningLabels", serviceCatalog);

  // Calculate totals: per-shipment (new format) or request-level (old format)
  let additionalServicesTotal = 0;
  if (hasPerShipmentServices) {
    request.shipments.forEach((_: any, index: number) => {
      const quantities = perShipmentQuantities[index] || emptyPerShipmentQty();
      additionalServicesTotal += subtotalAdditionalForLine(quantities, serviceCatalog);
    });
  } else {
    additionalServicesTotal =
      (adminBubbleWrapFeet || 0) * unitPriceForServiceKey("bubbleWrap", serviceCatalog) +
      (adminStickerRemovalItems || 0) * unitPriceForServiceKey("stickerRemoval", serviceCatalog) +
      (adminWarningLabels || 0) * unitPriceForServiceKey("warningLabels", serviceCatalog);
    Object.entries(adminExtraServiceQty).forEach(([k, qty]) => {
      additionalServicesTotal += (Number(qty) || 0) * unitPriceForServiceKey(k, serviceCatalog);
    });
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

    const missingSourceSelection = request.shipments.some((shipment: any, index: number) => {
      const product = inventory.find((item) => item.id === shipment.productId);
      if (!requiresSourceLocationSelection(product)) return false;
      return !shipFromLocationByIndex[index];
    });
    if (missingSourceSelection) {
      toast({
        variant: "destructive",
        title: "Source Location Required",
        description: "Please select ship-from location for each product before confirming.",
      });
      return;
    }

    const invalidSourceQty = request.shipments.find((shipment: any, index: number) => {
      const product = inventory.find((item) => item.id === shipment.productId);
      if (!requiresSourceLocationSelection(product)) return false;
      const selectedLocationId = shipFromLocationByIndex[index];
      const options = getLocationBreakdownForProduct(product);
      const selectedEntry = options.find((entry) => entry.locationId === selectedLocationId);
      const effectivePackOf = isCustomProduct
        ? (customProductPricing[index]?.packOf || shipment.packOf || 1)
        : shipment.packOf;
      const totalUnits = (shipment.quantity || 0) * (effectivePackOf || 1);
      return !selectedEntry || selectedEntry.qty < totalUnits;
    });
    if (invalidSourceQty) {
      toast({
        variant: "destructive",
        title: "Insufficient Source Stock",
        description: "Selected ship-from location does not have enough quantity for one or more products.",
      });
      return;
    }
    
    // Apply manual pallet existing inventory unit prices (if applicable)
    const requestForConfirmBase: ShipmentRequest = isPalletExistingInventory
      ? ({
          ...request,
          shipments: request.shipments.map((s: any, idx: number) => ({
            ...s,
            unitPrice: palletExistingUnitPrice[idx] ?? s.unitPrice ?? 0,
          })),
        } as any)
      : request;
    const requestForConfirm: ShipmentRequest = {
      ...(requestForConfirmBase as any),
      customDimensions: isCustomProduct
        ? (adminCustomDimensions.trim() || undefined)
        : (request as any).customDimensions,
      shipments: (requestForConfirmBase.shipments || []).map((s: any, idx: number) => ({
        ...s,
        sourceLocationId: shipFromLocationByIndex[idx] || "",
      })),
    } as any;

    const extraAgg: Record<string, number> = {};
    if (hasPerShipmentServices) {
      request.shipments.forEach((_: any, index: number) => {
        const q = perShipmentQuantities[index] || emptyPerShipmentQty();
        Object.entries(q.extra || {}).forEach(([k, v]) => {
          extraAgg[k] = (extraAgg[k] || 0) + (Number(v) || 0);
        });
      });
    } else {
      Object.assign(extraAgg, adminExtraServiceQty);
    }
    const extraUnitPrices: Record<string, number> = {};
    Object.keys(extraAgg).forEach((k) => {
      extraUnitPrices[k] = unitPriceForServiceKey(k, serviceCatalog);
    });
    const extraPayload =
      Object.keys(extraAgg).length > 0
        ? {
            extraServiceQuantities: extraAgg,
            extraServiceUnitPrices: extraUnitPrices,
          }
        : {};

    if (hasPerShipmentServices) {
      // New format: combine all per-shipment quantities
      let totalBubbleWrapFeet = 0;
      let totalStickerRemovalItems = 0;
      let totalWarningLabels = 0;

      request.shipments.forEach((shipment: any, index: number) => {
        const quantities = perShipmentQuantities[index] || emptyPerShipmentQty();
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
        crossdockHoldFulfillment,
        ...extraPayload,
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
        crossdockHoldFulfillment,
        ...extraPayload,
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
            {request.shipmentPreference && (
              <div>
                <label className="text-sm font-medium">Shipment Preference</label>
                <p className="text-sm font-medium capitalize">{request.shipmentPreference}</p>
              </div>
            )}
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
                const locationBreakdown = getLocationBreakdownForProduct(product);
                
                // Get selected services for this shipment (new format) or use request-level (old format)
                const shipmentSelectedServices = hasPerShipmentServices
                  ? (shipment.selectedAdditionalServices || [])
                  : (index === 0 ? requestLevelServices : []);

                const catalogName = (key: string) =>
                  serviceCatalog.find((r) => r.key === key)?.name ?? key;
                const catalogRow = (key: string) => serviceCatalog.find((r) => r.key === key);

                const hasAnyService =
                  Array.isArray(shipmentSelectedServices) && shipmentSelectedServices.length > 0;

                const quantities = perShipmentQuantities[index] || emptyPerShipmentQty();
                const shipmentTotal = hasPerShipmentServices
                  ? subtotalAdditionalForLine(quantities, serviceCatalog)
                  : index === 0
                    ? additionalServicesTotal
                    : 0;

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
                      shipment.quantity
                    );
                    if (calculatedPrice) {
                      unitPrice = calculatedPrice.rate || shipment.unitPrice || 0;
                      packOfPrice = 0;
                    }
                  }
                }

                // Pallet Existing Inventory is priced manually by admin at approval time
                if (isPalletExistingInventory) {
                  unitPrice = palletExistingUnitPrice[index] ?? shipment.unitPrice ?? 0;
                }
                
                // Calculate pricing breakdown
                // Formula: (Unit Price x Quantity) + fixed pack add-on.
                const isCustom = String(request.productType || "").toLowerCase() === "custom";
                const baseTotal = isCustom ? unitPrice * shipment.quantity : unitPrice * shipment.quantity; // unitPrice is per-box
                const packCharge = isCustom ? packOfPrice : 0;
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
                                <span className="font-medium">${packOfPrice.toFixed(2)} (fixed add-on)</span>
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
                            {locationBreakdown.length > 1 && (
                              <div className="mt-2 text-left">
                                <p className="text-xs font-medium text-muted-foreground">Ship From Location</p>
                                <Select
                                  value={shipFromLocationByIndex[index] || ""}
                                  onValueChange={(value) =>
                                    setShipFromLocationByIndex((prev) => ({ ...prev, [index]: value }))
                                  }
                                >
                                  <SelectTrigger className="mt-1 h-8 text-xs">
                                    <SelectValue placeholder="Select source location" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {locationBreakdown.map((entry) => (
                                      <SelectItem key={`ship-from-${index}-${entry.locationId}`} value={entry.locationId}>
                                        {prettyLocationLabel(entry.locationId)} ({entry.qty})
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            )}
                            {locationBreakdown.length > 0 && (
                              <div className="mt-2 text-left">
                                <p className="text-xs font-medium text-muted-foreground">Stock by Location</p>
                                <div className="mt-1 space-y-0.5">
                                  {locationBreakdown.map((entry) => (
                                    <p key={entry.locationId} className="text-xs text-muted-foreground">
                                      {prettyLocationLabel(entry.locationId)}: {entry.qty}
                                    </p>
                                  ))}
                                </div>
                              </div>
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
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-xs font-medium">Additional Services for this product</label>
                          <span className="text-xs text-muted-foreground text-right">
                            User selected: {shipmentSelectedServices.map(catalogName).join(", ")}
                          </span>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3">
                          {shipmentSelectedServices.map((serviceKey: string) => {
                            const row = catalogRow(serviceKey);
                            const unit = unitPriceForServiceKey(serviceKey, serviceCatalog);

                            if (serviceKey === "bubbleWrap") {
                              return (
                                <div key={serviceKey} className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Bubble Wrap (feet)</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={
                                      hasPerShipmentServices
                                        ? quantities.bubbleWrapFeet
                                        : index === 0
                                          ? adminBubbleWrapFeet
                                          : 0
                                    }
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10) || 0;
                                      if (hasPerShipmentServices) {
                                        setPerShipmentQuantities((prev) => ({
                                          ...prev,
                                          [index]: {
                                            ...(prev[index] || emptyPerShipmentQty()),
                                            bubbleWrapFeet: v,
                                          },
                                        }));
                                      } else if (index === 0) {
                                        setAdminBubbleWrapFeet(v);
                                      }
                                    }}
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    ${unit.toFixed(2)} per foot
                                  </p>
                                </div>
                              );
                            }
                            if (serviceKey === "stickerRemoval") {
                              return (
                                <div key={serviceKey} className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Sticker Removal (items)</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={
                                      hasPerShipmentServices
                                        ? quantities.stickerRemovalItems
                                        : index === 0
                                          ? adminStickerRemovalItems
                                          : 0
                                    }
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10) || 0;
                                      if (hasPerShipmentServices) {
                                        setPerShipmentQuantities((prev) => ({
                                          ...prev,
                                          [index]: {
                                            ...(prev[index] || emptyPerShipmentQty()),
                                            stickerRemovalItems: v,
                                          },
                                        }));
                                      } else if (index === 0) {
                                        setAdminStickerRemovalItems(v);
                                      }
                                    }}
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    ${unit.toFixed(2)} per item
                                  </p>
                                </div>
                              );
                            }
                            if (serviceKey === "warningLabels") {
                              return (
                                <div key={serviceKey} className="space-y-1">
                                  <label className="text-xs text-muted-foreground">Warning Labels (count)</label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={
                                      hasPerShipmentServices
                                        ? quantities.warningLabels
                                        : index === 0
                                          ? adminWarningLabels
                                          : 0
                                    }
                                    onChange={(e) => {
                                      const v = parseInt(e.target.value, 10) || 0;
                                      if (hasPerShipmentServices) {
                                        setPerShipmentQuantities((prev) => ({
                                          ...prev,
                                          [index]: {
                                            ...(prev[index] || emptyPerShipmentQty()),
                                            warningLabels: v,
                                          },
                                        }));
                                      } else if (index === 0) {
                                        setAdminWarningLabels(v);
                                      }
                                    }}
                                  />
                                  <p className="text-xs text-muted-foreground">
                                    ${unit.toFixed(2)} per label
                                  </p>
                                </div>
                              );
                            }

                            return (
                              <div key={serviceKey} className="space-y-1">
                                <label className="text-xs text-muted-foreground">
                                  {row?.name ?? serviceKey} (qty)
                                </label>
                                <Input
                                  type="number"
                                  min={0}
                                  value={
                                    hasPerShipmentServices
                                      ? quantities.extra[serviceKey] ?? 0
                                      : index === 0
                                        ? adminExtraServiceQty[serviceKey] ?? 0
                                        : 0
                                  }
                                  onChange={(e) => {
                                    const v = parseInt(e.target.value, 10) || 0;
                                    if (hasPerShipmentServices) {
                                      setPerShipmentQuantities((prev) => ({
                                        ...prev,
                                        [index]: {
                                          ...(prev[index] || emptyPerShipmentQty()),
                                          extra: {
                                            ...(prev[index]?.extra || {}),
                                            [serviceKey]: v,
                                          },
                                        },
                                      }));
                                    } else if (index === 0) {
                                      setAdminExtraServiceQty((prev) => ({ ...prev, [serviceKey]: v }));
                                    }
                                  }}
                                />
                                <p className="text-xs text-muted-foreground">
                                  ${unit.toFixed(2)}
                                  {row?.description ? ` · ${row.description}` : ""}
                                </p>
                              </div>
                            );
                          })}
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
                  shipment.quantity
                );
                if (calculatedPrice) {
                  unitPrice = calculatedPrice.rate || shipment.unitPrice || 0;
                  packOfPrice = 0;
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
                     Warning: No shipping label uploaded for this shipment request.
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
              <label className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={crossdockHoldFulfillment}
                  onChange={(e) => setCrossdockHoldFulfillment(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Cross-dock hold fulfillment</span>
                  <span className="block text-xs text-muted-foreground mt-0.5">
                    Ship from a closed cross-dock unit already in the warehouse — skip inventory
                    checks. Link the unit on Dispatch → Cross-dock after confirming.
                  </span>
                </span>
              </label>
              {isCustomProduct && (
                <div>
                  <label className="text-sm font-medium">Custom Dimensions (Optional)</label>
                  <Textarea
                    placeholder="Admin can add or correct dimensions here."
                    value={adminCustomDimensions}
                    onChange={(e) => setAdminCustomDimensions(e.target.value)}
                    className="mt-1"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    If user did not provide dimensions, add them here before approval/completion.
                  </p>
                </div>
              )}
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
              <div>
                <label className="text-sm font-medium">Custom Dimensions (Optional)</label>
                <Textarea
                  placeholder="Admin can add or correct dimensions here."
                  value={adminCustomDimensions}
                  onChange={(e) => setAdminCustomDimensions(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div className="flex gap-2">
                <Button
                  onClick={() =>
                    onApproveForLabelUpload(
                      {
                        ...(request as any),
                        customDimensions: adminCustomDimensions.trim() || undefined,
                      } as ShipmentRequest,
                      adminRemarks
                    )
                  }
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

