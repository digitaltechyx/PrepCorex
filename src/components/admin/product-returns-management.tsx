"use client";

import { useState, useMemo, useEffect } from "react";
import type { ProductReturn, UserProfile, InventoryItem } from "@/types";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { db } from "@/lib/firebase";
import {
  doc,
  updateDoc,
  addDoc,
  collection,
  Timestamp,
  runTransaction,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { format } from "date-fns";
import {
  Eye,
  Check,
  X,
  Loader2,
  Package,
  Truck,
  Plus,
  XCircle,
  CheckCircle,
  Clock,
  FileStack,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { generateInvoicePDF } from "@/lib/invoice-generator";
import { ProductReturnRequestForm } from "@/components/dashboard/product-return-request-form";
import {
  useAllProductReturns,
  getReturnOwnerId,
  type AdminProductReturn,
} from "@/hooks/use-all-product-returns";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { hasRole } from "@/lib/permissions";
import { Search } from "lucide-react";

function formatDate(date: ProductReturn["createdAt"]) {
  if (!date) return "N/A";
  if (typeof date === 'string') {
    return format(new Date(date), "PPP");
  }
  if (date && typeof date === 'object' && 'seconds' in date) {
    return format(new Date(date.seconds * 1000), "PPP");
  }
  return "N/A";
}

function getStatusBadge(status: ProductReturn["status"]) {
  const base = "flex items-center gap-1.5 w-fit rounded-md text-xs font-medium";
  switch (status) {
    case "pending":
      return <Badge variant="outline" className={`${base} border-amber-300 text-amber-700 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 dark:text-amber-300`}><Clock className="h-3 w-3" />Pending</Badge>;
    case "approved":
      return <Badge variant="default" className={`${base} bg-blue-500 hover:bg-blue-600`}><CheckCircle className="h-3 w-3" />Approved</Badge>;
    case "in_progress":
      return <Badge variant="default" className={`${base} bg-blue-500 hover:bg-blue-600`}><Package className="h-3 w-3" />In Progress</Badge>;
    case "closed":
      return <Badge variant="default" className={`${base} bg-green-600 hover:bg-green-700`}><CheckCircle className="h-3 w-3" />Closed</Badge>;
    case "cancelled":
      return <Badge variant="destructive" className={base}><XCircle className="h-3 w-3" />Cancelled</Badge>;
    default:
      return <Badge variant="outline" className={base}>{status}</Badge>;
  }
}

interface ProductReturnsManagementProps {
  managedUsers: UserProfile[];
  filterUserId?: string | null;
  initialReturnId?: string;
}

export function ProductReturnsManagement({
  managedUsers,
  filterUserId,
  initialReturnId,
}: ProductReturnsManagementProps) {
  const { toast } = useToast();
  const { userProfile: adminProfile } = useAuth();
  const [selectedReturn, setSelectedReturn] = useState<ProductReturn | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isUpdateQuantityOpen, setIsUpdateQuantityOpen] = useState(false);
  const [isCloseDialogOpen, setIsCloseDialogOpen] = useState(false);
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [isShipDialogOpen, setIsShipDialogOpen] = useState(false);
  const [addReturnDialogOpen, setAddReturnDialogOpen] = useState(false);
  const [behalfUser, setBehalfUser] = useState<UserProfile | null>(null);
  const [behalfUserSearch, setBehalfUserSearch] = useState("");
  const [clientFilter, setClientFilter] = useState<string>(filterUserId || "all");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    if (filterUserId) setClientFilter(filterUserId);
  }, [filterUserId]);
  const [newQuantity, setNewQuantity] = useState<string>("");
  const [quantityNotes, setQuantityNotes] = useState<string>("");
  const [rejectReason, setRejectReason] = useState<string>("");
  const [shipQuantity, setShipQuantity] = useState<string>("");
  const [shipTo, setShipTo] = useState<string>("");
  const [shipNotes, setShipNotes] = useState<string>("");
  const [generateInvoiceOnClose, setGenerateInvoiceOnClose] = useState(true);
  const [generateInvoiceOnShip, setGenerateInvoiceOnShip] = useState(false);

  // Pricing form state
  const [returnFee, setReturnFee] = useState<string>("");
  const [packingFee, setPackingFee] = useState<string>("");
  const [boxQuantity, setBoxQuantity] = useState<string>("");
  const [boxPricePerUnit, setBoxPricePerUnit] = useState<string>("");
  const [palletFee, setPalletFee] = useState<string>("");
  const [palletQuantity, setPalletQuantity] = useState<string>("");
  const [palletPricePerUnit, setPalletPricePerUnit] = useState<string>("");
  // Used in "Ship Products" dialog (admin enters total shipping cost for that shipment)
  const [shippingFee, setShippingFee] = useState<string>("");
  // Used in "Ship Products" dialog (admin enters per-unit shipping price; total is auto-calculated)
  const [shipShippingUnitPrice, setShipShippingUnitPrice] = useState<string>("");
  // Used in "Close Return Request" dialog (admin enters per-unit shipping price; total uses remaining qty)
  const [closeShippingUnitPrice, setCloseShippingUnitPrice] = useState<string>("");

  const { data: allReturns, loading, error } = useAllProductReturns();

  const managedUserIds = useMemo(
    () => new Set(managedUsers.map((u) => u.uid).filter(Boolean)),
    [managedUsers]
  );

  const selectableClients = useMemo(
    () =>
      managedUsers
        .filter((u) => {
          if (hasRole(u, "admin")) return false;
          const isApproved = u.status === "approved" || !u.status;
          return isApproved && u.status !== "deleted";
        })
        .sort((a, b) => (a.name || "").localeCompare(b.name || "")),
    [managedUsers]
  );

  const getClientProfile = (ownerId: string) =>
    managedUsers.find((u) => u.uid === ownerId);

  const { data: behalfInventory } = useCollection<InventoryItem>(
    behalfUser?.uid ? `users/${behalfUser.uid}/inventory` : ""
  );

  const returns = useMemo(() => {
    let list = allReturns.filter((r) => managedUserIds.has(r.ownerUserId));
    if (clientFilter !== "all") {
      list = list.filter((r) => r.ownerUserId === clientFilter);
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((r) => {
        const client = getClientProfile(r.ownerUserId);
        const product = (r.productName || r.newProductName || "").toLowerCase();
        return (
          product.includes(q) ||
          client?.name?.toLowerCase().includes(q) ||
          client?.email?.toLowerCase().includes(q) ||
          client?.clientId?.toLowerCase().includes(q)
        );
      });
    }
    return list;
  }, [allReturns, managedUserIds, clientFilter, searchQuery, managedUsers]);

  const [didAutoOpen, setDidAutoOpen] = useState(false);
  useEffect(() => {
    if (didAutoOpen) return;
    if (!initialReturnId) return;
    if (!returns || returns.length === 0) return;
    const match = returns.find((r: any) => r.id === initialReturnId);
    if (match) {
      setSelectedReturn(match);
      setIsDetailsOpen(true);
      setDidAutoOpen(true);
    }
  }, [didAutoOpen, initialReturnId, returns]);

  const filteredReturns = useMemo(() => {
    let filtered = statusFilter === "all" ? returns : returns.filter((r) => r.status === statusFilter);
    
    // Sort by createdAt (newest first)
    filtered = [...filtered].sort((a, b) => {
      const getDate = (returnItem: ProductReturn) => {
        if (returnItem.createdAt) {
          if (typeof returnItem.createdAt === 'string') {
            return new Date(returnItem.createdAt).getTime();
          }
          if (returnItem.createdAt && typeof returnItem.createdAt === 'object' && 'seconds' in returnItem.createdAt) {
            return (returnItem.createdAt as any).seconds * 1000;
          }
        }
        return 0;
      };
      
      const dateA = getDate(a);
      const dateB = getDate(b);
      return dateB - dateA; // Descending order (newest first)
    });
    
    return filtered;
  }, [returns, statusFilter]);

  // Pagination
  const totalPages = Math.ceil(filteredReturns.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedReturns = filteredReturns.slice(startIndex, endIndex);

  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [statusFilter, clientFilter, searchQuery]);

  const pendingCount = returns.filter((r) => r.status === "pending").length;
  const inProgressCount = returns.filter((r) => r.status === "in_progress").length;
  const closedCount = returns.filter((r) => r.status === "closed").length;
  const totalCount = returns.length;

  const handleApprove = async (returnItem: AdminProductReturn) => {
    const ownerId = getReturnOwnerId(returnItem);
    if (!ownerId || !adminProfile) return;

    setIsProcessing(true);
    try {
      const returnRef = doc(db, `users/${ownerId}/productReturns`, returnItem.id);
      const now = Timestamp.now();

      await updateDoc(returnRef, {
        status: "approved",
        approvedAt: now,
        approvedBy: adminProfile.uid,
        updatedAt: now,
      });

      // Initialize receiving log if it doesn't exist
      if (!returnItem.receivingLog) {
        await updateDoc(returnRef, {
          receivingLog: [],
        });
      }

      toast({
        title: "Success",
        description: "Return request approved.",
      });
      setIsDetailsOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to approve return request.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    const ownerId = getReturnOwnerId(selectedReturn);
    if (!selectedReturn || !adminProfile || !ownerId) return;

    if (!rejectReason.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please provide a reason for rejection.",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const returnRef = doc(db, `users/${ownerId}/productReturns`, selectedReturn.id);
      const now = Timestamp.now();

      await updateDoc(returnRef, {
        status: "cancelled",
        adminRemarks: rejectReason,
        updatedAt: now,
      });

      toast({
        title: "Success",
        description: "Return request rejected.",
      });
      setIsDetailsOpen(false);
      setIsRejectDialogOpen(false);
      setRejectReason("");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to reject return request.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleUpdateQuantity = async () => {
    const ownerId = getReturnOwnerId(selectedReturn);
    if (!selectedReturn || !adminProfile || !ownerId) return;

    const quantity = parseInt(newQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid quantity.",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const returnRef = doc(db, `users/${ownerId}/productReturns`, selectedReturn.id);
      const now = Timestamp.now();
      const currentReceived = selectedReturn.receivedQuantity || 0;
      const newReceived = currentReceived + quantity;

      // Get current receiving log
      const currentLog = selectedReturn.receivingLog || [];
      const newLogEntry: any = {
        quantity: quantity,
        receivedAt: now,
        receivedBy: adminProfile.uid,
      };
      if (quantityNotes && quantityNotes.trim()) {
        newLogEntry.notes = quantityNotes;
      }

      // Update status to in_progress if not already
      const newStatus = selectedReturn.status === "approved" ? "in_progress" : selectedReturn.status;

      await updateDoc(returnRef, {
        receivedQuantity: newReceived,
        receivingLog: [...currentLog, newLogEntry],
        status: newStatus,
        updatedAt: now,
      });

      toast({
        title: "Success",
        description: `Added ${quantity} units. Total received: ${newReceived} / ${selectedReturn.requestedQuantity}`,
      });

      setNewQuantity("");
      setQuantityNotes("");
      setIsUpdateQuantityOpen(false);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update quantity.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleShip = async () => {
    const ownerId = getReturnOwnerId(selectedReturn);
    const client = ownerId ? getClientProfile(ownerId) : undefined;
    if (!selectedReturn || !adminProfile || !ownerId) return;

    if (!shipTo || !shipTo.trim()) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a ship to destination.",
      });
      return;
    }

    const quantity = parseInt(shipQuantity);
    if (isNaN(quantity) || quantity <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid quantity to ship.",
      });
      return;
    }

    const currentShipped = selectedReturn.shippedQuantity || 0;
    const availableToShip = selectedReturn.receivedQuantity - currentShipped;

    if (quantity > availableToShip) {
      toast({
        variant: "destructive",
        title: "Error",
        description: `Cannot ship ${quantity} units. Only ${availableToShip} units available to ship.`,
      });
      return;
    }

    setIsProcessing(true);
    try {
      const now = Timestamp.now();
      const today = new Date();
      const newShippedQuantity = currentShipped + quantity;

      // Get current shipping log
      const currentShippingLog = selectedReturn.shippingLog || [];
      const newShippingLogEntry: any = {
        quantity: quantity,
        shippedAt: now,
        shippedBy: adminProfile.uid,
      };
      if (shipNotes && shipNotes.trim()) {
        newShippingLogEntry.notes = shipNotes;
      }

      let invoiceId: string | undefined;
      let invoiceNumber: string | undefined;

      // Use transaction for atomicity
      await runTransaction(db, async (transaction) => {
        const returnRef = doc(db, `users/${ownerId}/productReturns`, selectedReturn.id);

        // Generate invoice if requested
        if (generateInvoiceOnShip) {
          const invoiceNum = `INV-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-8)}`;
          const orderNumber = `ORD-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-4)}`;
          invoiceNumber = invoiceNum;

          // Calculate shipping cost (admin can provide unit price or total)
          const shippingCost = parseFloat(shippingFee) || 0;
          const unitPrice =
            quantity > 0
              ? (parseFloat(shipShippingUnitPrice) || (shippingCost / quantity) || 0)
              : 0;
          const invoiceItems: any[] = [
            {
              quantity: quantity,
              productName: `${selectedReturn.productName || selectedReturn.newProductName || "N/A"} (Return Shipment)`,
              sku: selectedReturn.sku || selectedReturn.newProductSku || '',
              shipDate: format(today, 'dd/MM/yyyy'),
              packaging: 'N/A',
              shipTo: shipTo || selectedReturn.additionalServices?.shippingAddress?.address || '',
              unitPrice: unitPrice,
              amount: shippingCost,
            },
          ];

          const invoiceData = {
            invoiceNumber: invoiceNum,
            date: format(today, 'dd/MM/yyyy'),
            orderNumber,
            soldTo: {
              name: client?.name ?? 'Unknown User',
              email: client?.email ?? '',
              phone: client?.phone ?? '',
              address: client?.address ?? '',
            },
            fbm: 'Product Return Shipment',
            items: invoiceItems,
            subtotal: shippingCost,
            grandTotal: shippingCost,
            status: 'pending' as const,
            createdAt: new Date(),
            userId: ownerId,
            type: "product_return_shipment",
            returnRequestId: selectedReturn.id,
          };

          const invoiceRef = doc(collection(db, `users/${ownerId}/invoices`));
          transaction.set(invoiceRef, invoiceData);
          invoiceId = invoiceRef.id;

          // Update return with shipping log including invoice info
          const shippingLogEntryWithInvoice: any = {
            quantity: newShippingLogEntry.quantity,
            shippedAt: newShippingLogEntry.shippedAt,
            shippedBy: newShippingLogEntry.shippedBy,
            invoiceId: invoiceRef.id,
            invoiceNumber: invoiceNum,
            shippingUnitPrice: unitPrice,
            shippingTotal: shippingCost,
          };
          if (newShippingLogEntry.notes) {
            shippingLogEntryWithInvoice.notes = newShippingLogEntry.notes;
          }
          transaction.update(returnRef, {
            shippingLog: [...currentShippingLog, shippingLogEntryWithInvoice],
            shippedQuantity: newShippedQuantity,
            updatedAt: now,
          });
        } else {
          // Update return with shipping log without invoice
          transaction.update(returnRef, {
            shippingLog: [...currentShippingLog, newShippingLogEntry],
            shippedQuantity: newShippedQuantity,
            updatedAt: now,
          });
        }
      });

      // Generate PDF after transaction if invoice was requested
      if (generateInvoiceOnShip && invoiceNumber) {
        const orderNumber = `ORD-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-4)}`;
        const shippingCost = parseFloat(shippingFee) || 0;
        const unitPrice =
          quantity > 0
            ? (parseFloat(shipShippingUnitPrice) || (shippingCost / quantity) || 0)
            : 0;
        await generateInvoicePDF({
          invoiceNumber: invoiceNumber,
          date: format(today, 'dd/MM/yyyy'),
          orderNumber,
          soldTo: {
            name: client?.name || 'Unknown User',
            email: client?.email || '',
            phone: client?.phone || '',
            address: client?.address || '',
          },
          fbm: 'Product Return Shipment',
          items: [{
            quantity: quantity,
            productName: `${selectedReturn.productName || selectedReturn.newProductName || "N/A"} (Return Shipment)`,
            sku: selectedReturn.sku || selectedReturn.newProductSku || '',
            shipDate: format(today, 'dd/MM/yyyy'),
            packaging: 'N/A',
            shipTo: shipTo || selectedReturn.additionalServices?.shippingAddress?.address || '',
            unitPrice: unitPrice,
            amount: shippingCost,
          }],
          subtotal: shippingCost,
          grandTotal: shippingCost,
          status: 'pending' as const,
          type: 'product_return_shipment',
        });
      }

      toast({
        title: "Success",
        description: `Shipped ${quantity} units.${generateInvoiceOnShip && invoiceNumber ? ` Invoice ${invoiceNumber} generated.` : ''}`,
      });

      setShipQuantity("");
      setShipTo("");
      setShipNotes("");
      setShippingFee("");
      setShipShippingUnitPrice("");
      setCloseShippingUnitPrice("");
      setGenerateInvoiceOnShip(false);
      setIsShipDialogOpen(false);
    } catch (error: any) {
      console.error("Error shipping products:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to ship products.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleCloseRequest = async () => {
    const ownerId = getReturnOwnerId(selectedReturn);
    const client = ownerId ? getClientProfile(ownerId) : undefined;
    if (!selectedReturn || !adminProfile || !ownerId) return;

    // Validate pricing
    const returnFeeNum = parseFloat(returnFee);
    if (isNaN(returnFeeNum) || returnFeeNum < 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please enter a valid return handling fee.",
      });
      return;
    }

    if (selectedReturn.receivedQuantity <= 0) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Cannot close request with zero received quantity.",
      });
      return;
    }

    setIsProcessing(true);
    try {
      const now = Timestamp.now();
      const today = new Date();

      const shippedQtyCurrent = selectedReturn.shippedQuantity || 0;
      const remainingToShipOnClose = Math.max(0, selectedReturn.receivedQuantity - shippedQtyCurrent);

      // Calculate pricing
      const returnHandlingTotal = returnFeeNum * selectedReturn.receivedQuantity;
      const packingFeeNum = parseFloat(packingFee) || 0;
      const palletFeeNum = parseFloat(palletFee) || 0;
      const shippingUnitPriceNum = parseFloat(closeShippingUnitPrice) || 0;
      const shouldShipOnClose = !!selectedReturn.additionalServices?.shipToAddress;
      const shippingFeeNum = shouldShipOnClose ? (remainingToShipOnClose * shippingUnitPriceNum) : 0;
      const servicesTotal = packingFeeNum + palletFeeNum + shippingFeeNum;
      const grandTotal = returnHandlingTotal + servicesTotal;

      // Build pricing object without undefined values (Firestore doesn't allow undefined)
      const pricing: any = {
        returnFee: returnFeeNum,
        total: grandTotal,
      };
      
      if (packingFeeNum > 0) {
        pricing.packingFee = packingFeeNum;
      }
      
      if (palletFeeNum > 0) {
        pricing.palletFee = palletFeeNum;
      }
      
      if (shippingFeeNum > 0) {
        pricing.shippingFee = shippingFeeNum;
      }

      // Declare invoiceNumber outside transaction so it's accessible after
      let invoiceNumber: string | undefined;

      await runTransaction(db, async (transaction) => {
        const returnRef = doc(db, `users/${ownerId}/productReturns`, selectedReturn.id);
        const returnSnap = await transaction.get(returnRef);
        const latestReturn: any = returnSnap.exists() ? returnSnap.data() : selectedReturn;
        
        // Calculate values needed for transaction
        const productName = selectedReturn.productName || selectedReturn.newProductName || "Unknown Product";
        const sku = selectedReturn.sku || selectedReturn.newProductSku;
        const shippedQty = latestReturn?.shippedQuantity || 0;
        const currentShippingLog = latestReturn?.shippingLog || selectedReturn.shippingLog || [];
        const remainingQuantity = Math.max(0, selectedReturn.receivedQuantity - shippedQty);
        const closedAtLabel = format(today, "dd/MM/yyyy HH:mm");
        const closedByLabel =
          adminProfile.name ||
          adminProfile.email ||
          adminProfile.uid ||
          "Admin";
        const requestedByLabel =
          client?.name ||
          client?.email ||
          client?.uid ||
          "User";
        const returnReason = (latestReturn?.userRemarks || selectedReturn.userRemarks || "").trim();
        const returnTypeLabel = selectedReturn.type === "existing" ? "Existing Product Return" : "New Product Return";
        const returnSummaryParts = [
          `[Return Completed] ID: ${selectedReturn.id}`,
          `Type: ${returnTypeLabel}`,
          `Product: ${productName}`,
          `SKU: ${sku || "N/A"}`,
          `Requested Qty: ${selectedReturn.requestedQuantity || 0}`,
          `Received Qty: ${selectedReturn.receivedQuantity || 0}`,
          `Already Shipped: ${shippedQty || 0}`,
          `Added To Inventory: ${remainingQuantity}`,
          `Requested By: ${requestedByLabel}`,
          `Closed By: ${closedByLabel}`,
          `Closed At: ${closedAtLabel}`,
          `Return Reason: ${returnReason || "N/A"}`,
        ];
        const returnSummary = returnSummaryParts.join(" | ");
        const shipToAddress = (() => {
          const shippingAddress = selectedReturn.additionalServices?.shippingAddress;
          if (!shippingAddress) return "";
          return `${shippingAddress.address}, ${shippingAddress.city || ''} ${shippingAddress.state || ''} ${shippingAddress.zipCode || ''}, ${shippingAddress.country || ''}`.trim();
        })();

        // STEP 1: Perform ALL reads first (required by Firestore)
        let inventoryDoc: any = null;
        let inventoryRef: any = null;

        // Only add returned items to inventory if they are NOT being shipped back on close
        const willShipRemainingOnClose = !!selectedReturn.additionalServices?.shipToAddress && remainingQuantity > 0;
        
        if (!willShipRemainingOnClose && remainingQuantity > 0 && selectedReturn.type === "existing" && selectedReturn.productId) {
          // Read existing inventory if it exists
          inventoryRef = doc(db, `users/${ownerId}/inventory`, selectedReturn.productId);
          inventoryDoc = await transaction.get(inventoryRef);
        }

        // STEP 2: Now perform ALL writes
        // 1. Update return request
        const returnUpdate: any = {
          status: "closed",
          closedAt: now,
          closedBy: adminProfile.uid,
          pricing: pricing,
          updatedAt: now,
        };

        // If user selected ship-to-address, mark remaining items as shipped on close (append to shipping log)
        if (willShipRemainingOnClose) {
          const closeShipLogEntry: any = {
            quantity: remainingQuantity,
            shippedAt: now,
            shippedBy: adminProfile.uid,
            notes: "Shipped remaining items on close",
            shippingUnitPrice: shippingUnitPriceNum,
            shippingTotal: shippingFeeNum,
          };
          returnUpdate.shippingLog = [...currentShippingLog, closeShipLogEntry];
          returnUpdate.shippedQuantity = shippedQty + remainingQuantity; // should equal receivedQuantity
        }

        transaction.update(returnRef, returnUpdate);

        // 2. Update inventory with remaining quantity (received - shipped)
        // Only add to inventory if there's remaining quantity
        if (!willShipRemainingOnClose && remainingQuantity > 0) {
          if (selectedReturn.type === "existing" && selectedReturn.productId && inventoryDoc) {
            // Update existing inventory
            if (inventoryDoc.exists()) {
              const currentData = inventoryDoc.data();
              const currentQuantity = currentData.quantity || 0;
              const existingRemarks = (currentData.remarks || "").trim();
              const mergedRemarks = existingRemarks
                ? `${existingRemarks}\n\n${returnSummary}`
                : returnSummary;
              transaction.update(inventoryRef, {
                quantity: currentQuantity + remainingQuantity,
                status: "In Stock",
                remarks: mergedRemarks,
                updatedAt: now,
              });
            } else {
              // Product not found, create new inventory item
              const newInventoryRef = doc(collection(db, `users/${ownerId}/inventory`));
              transaction.set(newInventoryRef, {
                productName: productName,
                quantity: remainingQuantity,
                dateAdded: now,
                receivingDate: now,
                status: "In Stock",
                inventoryType: "product",
                sku: sku,
                remarks: returnSummary,
                createdAt: now,
                updatedAt: now,
              });
            }
          } else {
            // Create new inventory item for new product return
            const newInventoryRef = doc(collection(db, `users/${ownerId}/inventory`));
            transaction.set(newInventoryRef, {
              productName: productName,
              quantity: remainingQuantity,
              dateAdded: now,
              receivingDate: now,
              status: "In Stock",
              inventoryType: "product",
              sku: sku,
              remarks: returnSummary,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        // 3. Generate invoice if requested
        let invoiceRef: any = null;
        if (generateInvoiceOnClose) {
          invoiceNumber = `INV-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-8)}`;
          const orderNumber = `ORD-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-4)}`;

          const invoiceItems: any[] = [
            {
              quantity: selectedReturn.receivedQuantity,
              productName: `${productName} (Return Handling)`,
              sku: sku || '',
              shipDate: format(today, 'dd/MM/yyyy'),
              packaging: 'N/A',
              shipTo: shipToAddress,
              unitPrice: returnFeeNum,
              amount: returnHandlingTotal,
            },
          ];

          if (packingFeeNum > 0) {
            const boxQty = parseFloat(boxQuantity) || 1;
            invoiceItems.push({
              quantity: boxQty,
              productName: `Packing Service`,
              shipDate: format(today, 'dd/MM/yyyy'),
              packaging: 'N/A',
              shipTo: '',
              unitPrice: boxQty > 0 ? packingFeeNum / boxQty : packingFeeNum,
              amount: packingFeeNum,
            });
          }

          if (palletFeeNum > 0) {
            const palletQty = parseFloat(palletQuantity) || 1;
            invoiceItems.push({
              quantity: palletQty,
              productName: `Palletizing Service`,
              shipDate: format(today, 'dd/MM/yyyy'),
              packaging: 'N/A',
              shipTo: '',
              unitPrice: palletQty > 0 ? palletFeeNum / palletQty : palletFeeNum,
              amount: palletFeeNum,
            });
          }

          if (shippingFeeNum > 0) {
            invoiceItems.push({
              quantity: remainingQuantity,
              productName: `${productName} (Return Shipment)`,
              sku: sku || '',
              shipDate: format(today, 'dd/MM/yyyy'),
              packaging: 'N/A',
              shipTo: shipToAddress,
              unitPrice: shippingUnitPriceNum,
              amount: shippingFeeNum,
            });
          }

          const invoiceData = {
            invoiceNumber,
            date: format(today, 'dd/MM/yyyy'),
            orderNumber,
            soldTo: {
              name: client?.name ?? 'Unknown User',
              email: client?.email ?? '',
              phone: client?.phone ?? '',
              address: client?.address ?? '',
            },
            fbm: 'Product Return',
            items: invoiceItems,
            subtotal: grandTotal,
            grandTotal: grandTotal,
            status: 'pending' as const,
            createdAt: new Date(),
            userId: ownerId,
            type: "product_return",
            returnRequestId: selectedReturn.id,
          };

          invoiceRef = doc(collection(db, `users/${ownerId}/invoices`));
          transaction.set(invoiceRef, invoiceData);
        }

        // 4. Create shipped order for remaining quantity shipped on close (when ship-to-address is selected)
        if (willShipRemainingOnClose) {
          const shippedRef = doc(collection(db, `users/${ownerId}/shipped`));
          transaction.set(shippedRef, {
            productName: productName,
            date: Timestamp.fromDate(today),
            createdAt: now,
            shippedQty: remainingQuantity,
            boxesShipped: selectedReturn.additionalServices?.boxesCount || 1,
            unitsForPricing: remainingQuantity,
            remainingQty: 0, // Returned products, so no remaining
            packOf: 1,
            unitPrice: shippingUnitPriceNum,
            shipTo: shipToAddress,
            service: 'Product Return Shipment',
            productType: 'Standard',
            remarks: `Product Return - Request ID: ${selectedReturn.id}`,
            items: [{
              productId: selectedReturn.productId || '',
              productName: productName,
              boxesShipped: selectedReturn.additionalServices?.boxesCount || 1,
              shippedQty: remainingQuantity,
              packOf: 1,
              unitPrice: shippingUnitPriceNum,
              remainingQty: 0,
            }],
            totalBoxes: selectedReturn.additionalServices?.boxesCount || 1,
            totalUnits: remainingQuantity,
            totalSkus: 1,
            returnRequestId: selectedReturn.id, // Link to return request
          });
        }

        // Update return request with invoice info if invoice was created
        if (invoiceRef && invoiceNumber) {
          transaction.update(returnRef, {
            invoiceId: invoiceRef.id,
            invoiceNumber: invoiceNumber,
          });
        }
      });

      // Generate PDF invoice if requested
      if (generateInvoiceOnClose && invoiceNumber) {
        const orderNumber = `ORD-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-4)}`;
        const shipToAddress = (() => {
          const shippingAddress = selectedReturn.additionalServices?.shippingAddress;
          if (!shippingAddress) return "";
          return `${shippingAddress.address}, ${shippingAddress.city || ''} ${shippingAddress.state || ''} ${shippingAddress.zipCode || ''}, ${shippingAddress.country || ''}`.trim();
        })();
        const invoiceItems: any[] = [
          {
            quantity: selectedReturn.receivedQuantity,
            productName: `${selectedReturn.productName || selectedReturn.newProductName || "N/A"} (Return Handling)`,
            sku: selectedReturn.sku || selectedReturn.newProductSku || '',
            shipDate: format(today, 'dd/MM/yyyy'),
            packaging: 'N/A',
            shipTo: shipToAddress,
            unitPrice: returnFeeNum,
            amount: returnHandlingTotal,
          },
        ];

        if (packingFeeNum > 0) {
          const boxQty = parseFloat(boxQuantity) || 1;
          invoiceItems.push({
            quantity: boxQty,
            productName: `Packing Service`,
            shipDate: format(today, 'dd/MM/yyyy'),
            packaging: 'N/A',
            shipTo: '',
            unitPrice: boxQty > 0 ? packingFeeNum / boxQty : packingFeeNum,
            amount: packingFeeNum,
          });
        }

        if (palletFeeNum > 0) {
          const palletQty = parseFloat(palletQuantity) || 1;
          invoiceItems.push({
            quantity: palletQty,
            productName: `Palletizing Service`,
            shipDate: format(today, 'dd/MM/yyyy'),
            packaging: 'N/A',
            shipTo: '',
            unitPrice: palletQty > 0 ? palletFeeNum / palletQty : palletFeeNum,
            amount: palletFeeNum,
          });
        }

        if (shippingFeeNum > 0) {
          invoiceItems.push({
            quantity: remainingToShipOnClose,
            productName: `${selectedReturn.productName || selectedReturn.newProductName || "N/A"} (Return Shipment)`,
            sku: selectedReturn.sku || selectedReturn.newProductSku || '',
            shipDate: format(today, 'dd/MM/yyyy'),
            packaging: 'N/A',
            shipTo: shipToAddress,
            unitPrice: shippingUnitPriceNum,
            amount: shippingFeeNum,
          });
        }

        const invoiceDataForPDF = {
          invoiceNumber,
          date: format(today, 'dd/MM/yyyy'),
          orderNumber,
          soldTo: {
            name: client?.name || 'Unknown User',
            email: client?.email || '',
            phone: client?.phone || '',
            address: client?.address || '',
          },
          fbm: 'Product Return',
          items: invoiceItems,
          subtotal: grandTotal,
          grandTotal: grandTotal,
          status: 'pending' as const,
          type: 'product_return' as const,
        };

        await generateInvoicePDF(invoiceDataForPDF);
      }

      toast({
        title: "Success",
        description: `Return request closed.${generateInvoiceOnClose && invoiceNumber ? ` Invoice ${invoiceNumber} generated.` : ''}${selectedReturn.additionalServices?.shipToAddress ? ' Shipped order created.' : ''}`,
      });

      setIsCloseDialogOpen(false);
      setIsDetailsOpen(false);
      setReturnFee("");
      setPackingFee("");
      setBoxQuantity("");
      setBoxPricePerUnit("");
      setPalletFee("");
      setPalletQuantity("");
      setPalletPricePerUnit("");
      setShippingFee("");
    } catch (error: any) {
      console.error("Error closing return request:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to close return request.",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleViewDetails = (returnItem: ProductReturn) => {
    setSelectedReturn(returnItem);
    setIsDetailsOpen(true);
    // Reset form states
    setReturnFee("");
    setPackingFee("");
    setBoxQuantity("");
    setBoxPricePerUnit("");
    setPalletFee("");
    setPalletQuantity("");
    setPalletPricePerUnit("");
    setShippingFee("");
    setCloseShippingUnitPrice("");
    setRejectReason("");
  };

  const handleOpenUpdateQuantity = (returnItem: ProductReturn) => {
    setSelectedReturn(returnItem);
    setNewQuantity("");
    setQuantityNotes("");
    setIsUpdateQuantityOpen(true);
  };

  const handleOpenCloseDialog = (returnItem: ProductReturn) => {
    setSelectedReturn(returnItem);
    setReturnFee("");
    setPackingFee("");
    setPalletFee("");
    setShippingFee("");
    setCloseShippingUnitPrice("");
    setIsCloseDialogOpen(true);
  };

  return (
    <div className="space-y-5">
      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter("pending")}
          onKeyDown={(e) => e.key === "Enter" && setStatusFilter("pending")}
          className="border-2 border-amber-200/60 bg-gradient-to-br from-amber-50 to-orange-50/50 dark:from-amber-950/20 dark:to-orange-950/20 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:ring-offset-2 rounded-xl overflow-hidden"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-amber-900 dark:text-amber-100">Pending</CardTitle>
            <div className="h-9 w-9 rounded-lg bg-amber-500 flex items-center justify-center shadow-sm">
              <Clock className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-12 rounded" />
            ) : (
              <>
                <div className="text-2xl font-bold text-amber-900 dark:text-amber-100">{pendingCount}</div>
                <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">Awaiting review</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter("in_progress")}
          onKeyDown={(e) => e.key === "Enter" && setStatusFilter("in_progress")}
          className="border-2 border-blue-200/60 bg-gradient-to-br from-blue-50 to-sky-50/50 dark:from-blue-950/20 dark:to-sky-950/20 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:ring-offset-2 rounded-xl overflow-hidden"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-blue-900 dark:text-blue-100">In Progress</CardTitle>
            <div className="h-9 w-9 rounded-lg bg-blue-500 flex items-center justify-center shadow-sm">
              <Package className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-12 rounded" />
            ) : (
              <>
                <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{inProgressCount}</div>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">Receiving / processing</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter("closed")}
          onKeyDown={(e) => e.key === "Enter" && setStatusFilter("closed")}
          className="border-2 border-green-200/60 bg-gradient-to-br from-green-50 to-emerald-50/50 dark:from-green-950/20 dark:to-emerald-950/20 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 rounded-xl overflow-hidden"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-green-900 dark:text-green-100">Closed</CardTitle>
            <div className="h-9 w-9 rounded-lg bg-green-500 flex items-center justify-center shadow-sm">
              <CheckCircle className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-12 rounded" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-900 dark:text-green-100">{closedCount}</div>
                <p className="text-xs text-green-700 dark:text-green-300 mt-0.5">Completed</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setStatusFilter("all")}
          onKeyDown={(e) => e.key === "Enter" && setStatusFilter("all")}
          className="border-2 border-slate-200/60 bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-900/30 dark:to-slate-800/30 shadow-md cursor-pointer transition-all hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 rounded-xl overflow-hidden"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-slate-900 dark:text-slate-100">Total</CardTitle>
            <div className="h-9 w-9 rounded-lg bg-slate-500 flex items-center justify-center shadow-sm">
              <FileStack className="h-4 w-4 text-white" />
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-12 rounded" />
            ) : (
              <>
                <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{totalCount}</div>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">All returns</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filter + Submit */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3 flex-1 min-w-0">
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px] rounded-lg h-10 border-border/80">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label className="text-sm text-muted-foreground">Client</Label>
            <Select value={clientFilter} onValueChange={setClientFilter}>
              <SelectTrigger className="w-[220px] rounded-lg h-10 border-border/80">
                <SelectValue placeholder="All clients" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {selectableClients.map((u) => (
                  <SelectItem key={u.uid} value={u.uid}>
                    {formatUserDisplayName(u, { showEmail: true })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 min-w-[200px] flex-1 max-w-sm">
            <Label className="text-sm text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Product, client name, email…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 rounded-lg h-10"
              />
            </div>
          </div>
        </div>
        <Button
          size="sm"
          className="rounded-lg bg-teal-600 hover:bg-teal-700 text-white shadow-sm font-medium shrink-0"
          onClick={() => {
            setBehalfUser(null);
            setBehalfUserSearch("");
            setAddReturnDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-2" />
          Submit return for user
        </Button>
      </div>

      {/* Returns Table */}
      <Card className="rounded-xl border-2 border-border/50 shadow-sm overflow-hidden">
        <CardHeader className="bg-muted/30 border-b pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-lg font-semibold tracking-tight">All product return requests</CardTitle>
              <CardDescription className="mt-1">
                {clientFilter === "all"
                  ? "Returns from all clients in your scope"
                  : `Filtered to ${formatUserDisplayName(getClientProfile(clientFilter) ?? {}, { showEmail: true })}`}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error && (
            <div className="mx-6 mt-6 p-4 bg-destructive/10 border border-destructive/20 rounded-xl">
              <p className="text-sm text-destructive font-medium">Error loading returns:</p>
              <p className="text-xs text-destructive/80 mt-1">{error.message}</p>
            </div>
          )}
          {loading ? (
            <div className="p-6 space-y-3">
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
              <Skeleton className="h-12 w-full rounded-lg" />
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-12 px-6">
              <Package className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground font-medium">No product return requests found</p>
              <p className="text-sm text-muted-foreground/80 mt-1">
                {statusFilter !== "all" || clientFilter !== "all" || searchQuery
                  ? "Try changing your filters."
                  : "No returns yet. Use Submit return for user to create one on behalf of a client."}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent border-b bg-muted/40">
                      <TableHead className="font-semibold">Client</TableHead>
                      <TableHead className="font-semibold">Product</TableHead>
                      <TableHead className="font-semibold">Type</TableHead>
                      <TableHead className="font-semibold">Quantity</TableHead>
                      <TableHead className="font-semibold">Progress</TableHead>
                      <TableHead className="font-semibold">Status</TableHead>
                      <TableHead className="font-semibold">Created</TableHead>
                      <TableHead className="font-semibold text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedReturns.map((returnItem) => {
                      const row = returnItem as AdminProductReturn;
                      const progress = row.requestedQuantity > 0
                        ? Math.round((row.receivedQuantity / row.requestedQuantity) * 100)
                        : 0;
                      const productName = row.productName || row.newProductName || "N/A";
                      const canUpdate = row.status === "approved" || row.status === "in_progress";
                      const canClose = canUpdate && row.receivedQuantity > 0;
                      const rowClient = getClientProfile(row.ownerUserId);

                      return (
                        <TableRow
                          key={`${row.ownerUserId}-${row.id}`}
                          className="transition-colors hover:bg-muted/50"
                        >
                          <TableCell className="text-sm">
                            <p className="font-medium truncate max-w-[160px]">
                              {formatUserDisplayName(rowClient, { showEmail: false }) || "Unknown"}
                            </p>
                            <p className="text-xs text-muted-foreground truncate max-w-[160px]">
                              {rowClient?.email || row.ownerUserId}
                            </p>
                          </TableCell>
                          <TableCell className="font-medium">{productName}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              <Badge variant="outline" className="rounded-md text-xs font-medium">
                                {returnItem.type === "existing" ? "Existing" : "New"}
                              </Badge>
                              {returnItem.type === "existing" && returnItem.returnType && (
                                <Badge variant="secondary" className="rounded-md text-xs">
                                  {returnItem.returnType === "combine" ? "Combine" : "Partial"}
                                </Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="tabular-nums">
                            {returnItem.receivedQuantity} / {returnItem.requestedQuantity}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2 min-w-[100px]">
                              <div className="flex-1 bg-muted rounded-full h-2.5 overflow-hidden">
                                <div
                                  className="bg-teal-500 h-2.5 rounded-full transition-all duration-300"
                                  style={{ width: `${Math.min(progress, 100)}%` }}
                                />
                              </div>
                              <span className="text-sm text-muted-foreground w-10 text-right tabular-nums">
                                {progress}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>{getStatusBadge(returnItem.status)}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">{formatDate(returnItem.createdAt)}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 rounded-md"
                                onClick={() => handleViewDetails(returnItem)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {canUpdate && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-8 rounded-md text-xs"
                                  onClick={() => handleOpenUpdateQuantity(returnItem)}
                                >
                                  <Plus className="h-3.5 w-3.5 mr-1" />
                                  Add Qty
                                </Button>
                              )}
                              {canClose && (
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="h-8 rounded-md text-xs bg-teal-600 hover:bg-teal-700"
                                  onClick={() => handleOpenCloseDialog(returnItem)}
                                >
                                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                                  Close
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4 border-t bg-muted/20">
                  <div className="text-sm text-muted-foreground">
                    Showing <span className="font-medium text-foreground">{startIndex + 1}</span> to{" "}
                    <span className="font-medium text-foreground">{Math.min(endIndex, filteredReturns.length)}</span> of{" "}
                    <span className="font-medium text-foreground">{filteredReturns.length}</span> returns
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                    >
                      Previous
                    </Button>
                    <span className="text-sm px-2 tabular-nums">
                      Page {currentPage} of {totalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="rounded-lg"
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

      {/* Details Dialog */}
      {selectedReturn && (
        <>
          <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
            <DialogContent className="max-w-3xl h-[90vh] flex flex-col overflow-hidden p-0">
              <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4">
                <DialogTitle>Return Request Details</DialogTitle>
                <DialogDescription>
                  View detailed information and activity log
                </DialogDescription>
              </DialogHeader>
              <Tabs defaultValue="details" className="flex-1 flex flex-col min-h-0 px-6 pb-6">
                <TabsList className="mb-4">
                  <TabsTrigger value="details">Details</TabsTrigger>
                  <TabsTrigger value="logs">Logs</TabsTrigger>
                </TabsList>
                <TabsContent value="details" className="flex-1 overflow-y-auto min-h-0 pr-4 custom-scrollbar mt-0">
                  <div className="space-y-6">
                  {/* Basic Info */}
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <div className="text-sm text-muted-foreground">Product Name</div>
                      <div className="font-medium">
                        {selectedReturn.productName || selectedReturn.newProductName || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">SKU</div>
                      <div className="font-medium">
                        {selectedReturn.sku || selectedReturn.newProductSku || "N/A"}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Type</div>
                      <div className="font-medium">
                        {selectedReturn.type === "existing" ? "Existing Product" : "New Inventory"}
                        {selectedReturn.type === "existing" && selectedReturn.returnType && (
                          <span className="ml-2 text-xs text-muted-foreground">
                            ({selectedReturn.returnType === "combine" ? "Combine" : "Partial"})
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Status</div>
                      <div>{getStatusBadge(selectedReturn.status)}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Requested Quantity</div>
                      <div className="font-medium">{selectedReturn.requestedQuantity}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Received Quantity</div>
                      <div className="font-medium">{selectedReturn.receivedQuantity}</div>
                    </div>
                  </div>

                  {/* User Remarks */}
                  {selectedReturn.userRemarks && (
                    <div>
                      <div className="text-sm text-muted-foreground mb-1">User Remarks</div>
                      <div className="p-3 bg-muted rounded-md">{selectedReturn.userRemarks}</div>
                    </div>
                  )}

                  {/* Additional Services */}
                  {selectedReturn.additionalServices && (
                    <div>
                      <div className="text-sm font-medium mb-2">Additional Services</div>
                      <div className="space-y-2">
                        {selectedReturn.additionalServices.packIntoBoxes && (
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <span>Pack into Boxes</span>
                            {selectedReturn.additionalServices.boxesCount && (
                              <Badge variant="outline">
                                {selectedReturn.additionalServices.boxesCount} boxes
                              </Badge>
                            )}
                          </div>
                        )}
                        {selectedReturn.additionalServices.placeOnPallet && (
                          <div className="flex items-center gap-2">
                            <Package className="h-4 w-4 text-muted-foreground" />
                            <span>Place on Pallet</span>
                            {selectedReturn.additionalServices.palletsCount && (
                              <Badge variant="outline">
                                {selectedReturn.additionalServices.palletsCount} pallets
                              </Badge>
                            )}
                          </div>
                        )}
                        {selectedReturn.additionalServices.shipToAddress && (
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Truck className="h-4 w-4 text-muted-foreground" />
                              <span>Ship to Address</span>
                            </div>
                            {selectedReturn.additionalServices.shippingAddress && (
                              <div className="pl-6 text-sm text-muted-foreground">
                                {selectedReturn.additionalServices.shippingAddress.name && (
                                  <div>{selectedReturn.additionalServices.shippingAddress.name}</div>
                                )}
                                <div>{selectedReturn.additionalServices.shippingAddress.address}</div>
                                {selectedReturn.additionalServices.shippingAddress.city && (
                                  <div>
                                    {selectedReturn.additionalServices.shippingAddress.city}
                                    {selectedReturn.additionalServices.shippingAddress.state && `, ${selectedReturn.additionalServices.shippingAddress.state}`}
                                    {selectedReturn.additionalServices.shippingAddress.zipCode && ` ${selectedReturn.additionalServices.shippingAddress.zipCode}`}
                                  </div>
                                )}
                                {selectedReturn.additionalServices.shippingAddress.country && (
                                  <div>{selectedReturn.additionalServices.shippingAddress.country}</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  {selectedReturn.status === "pending" && (
                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        onClick={() => handleApprove(selectedReturn)}
                        disabled={isProcessing}
                        className="flex-1"
                      >
                        {isProcessing ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="mr-2 h-4 w-4" />
                        )}
                        Open Request (Approve)
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={() => {
                          setRejectReason("");
                          setIsRejectDialogOpen(true);
                        }}
                        disabled={isProcessing}
                        className="flex-1"
                      >
                        <X className="mr-2 h-4 w-4" />
                        Reject
                      </Button>
                    </div>
                  )}

                  {/* Ship button for approved/in_progress requests */}
                  {(selectedReturn.status === "approved" || selectedReturn.status === "in_progress") && 
                   selectedReturn.receivedQuantity > 0 && 
                   (selectedReturn.receivedQuantity - (selectedReturn.shippedQuantity || 0)) > 0 && (
                    <div className="flex gap-2 pt-4 border-t">
                      <Button
                        onClick={() => {
                          setShipQuantity("");
                          setShipTo("");
                          setShipNotes("");
                          setShippingFee("");
                          setGenerateInvoiceOnShip(false);
                          setIsShipDialogOpen(true);
                        }}
                        disabled={isProcessing}
                        className="flex-1"
                      >
                        <Truck className="mr-2 h-4 w-4" />
                        Ship Products
                      </Button>
                    </div>
                  )}
                  </div>
                </TabsContent>
                <TabsContent value="logs" className="flex-1 overflow-y-auto min-h-0 pr-4 custom-scrollbar mt-0">
                  <div className="space-y-6">
                    {/* Receiving Log */}
                    {selectedReturn.receivingLog && selectedReturn.receivingLog.length > 0 && (
                      <div>
                        <div className="text-sm font-medium mb-2">Receiving History</div>
                        <div className="space-y-2">
                          {selectedReturn.receivingLog.map((log, index) => (
                            <div key={index} className="p-3 bg-muted rounded-md">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium">+{log.quantity} units received</div>
                                  {log.notes && (
                                    <div className="text-sm text-muted-foreground mt-1">{log.notes}</div>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground">
                                  {formatDate(log.receivedAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Shipping Log */}
                    {selectedReturn.shippingLog && selectedReturn.shippingLog.length > 0 && (
                      <div>
                        <div className="text-sm font-medium mb-2">Shipping History</div>
                        <div className="space-y-2">
                          {selectedReturn.shippingLog.map((log: any, index: number) => (
                            <div key={index} className="p-3 bg-muted rounded-md">
                              <div className="flex justify-between items-start">
                                <div className="flex-1">
                                  <div className="font-medium">-{log.quantity} units shipped</div>
                                  {log.notes && (
                                    <div className="text-sm text-muted-foreground mt-1">{log.notes}</div>
                                  )}
                                  {log.packOf && (
                                    <div className="text-sm text-muted-foreground mt-1">{log.quantity} pack of {log.packOf}</div>
                                  )}
                                  {log.invoiceNumber && (
                                    <div className="mt-2">
                                      <span className="text-xs px-2 py-1 bg-primary/10 text-primary rounded-md">
                                        Invoice: {log.invoiceNumber}
                                      </span>
                                    </div>
                                  )}
                                </div>
                                <div className="text-sm text-muted-foreground ml-4">
                                  {formatDate(log.shippedAt)}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>

          {/* Update Quantity Dialog */}
          <Dialog open={isUpdateQuantityOpen} onOpenChange={setIsUpdateQuantityOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Received Quantity</DialogTitle>
                <DialogDescription>
                  Add quantity received for this return request
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Quantity Received</Label>
                  <Input
                    type="number"
                    value={newQuantity || ""}
                    onChange={(e) => setNewQuantity(e.target.value)}
                    placeholder="Enter quantity"
                    min="1"
                  />
                </div>
                <div>
                  <Label>Notes (Optional)</Label>
                  <Textarea
                    value={quantityNotes}
                    onChange={(e) => setQuantityNotes(e.target.value)}
                    placeholder="Add any notes about this receiving..."
                    rows={3}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleUpdateQuantity}
                    disabled={isProcessing || !newQuantity}
                    className="flex-1"
                  >
                    {isProcessing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="mr-2 h-4 w-4" />
                    )}
                    Add Quantity
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setIsUpdateQuantityOpen(false)}
                    disabled={isProcessing}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Reject Dialog */}
          <Dialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Reject Return Request</DialogTitle>
                <DialogDescription>
                  Please provide a reason for rejection
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Rejection Reason</Label>
                  <Textarea
                    value={rejectReason}
                    onChange={(e) => setRejectReason(e.target.value)}
                    placeholder="Enter reason for rejection..."
                    rows={4}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="destructive"
                    onClick={handleReject}
                    disabled={isProcessing || !rejectReason.trim()}
                    className="flex-1"
                  >
                    {isProcessing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <X className="mr-2 h-4 w-4" />
                    )}
                    Reject
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsRejectDialogOpen(false);
                      setRejectReason("");
                    }}
                    disabled={isProcessing}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* Close Request Dialog */}
          <Dialog open={isCloseDialogOpen} onOpenChange={setIsCloseDialogOpen}>
            <DialogContent className="max-w-2xl max-h-[90vh]">
              <DialogHeader>
                <DialogTitle>Close Return Request</DialogTitle>
                <DialogDescription>
                  Set pricing and close this return request. Invoice will be generated automatically.
                </DialogDescription>
              </DialogHeader>
              <ScrollArea className="max-h-[70vh] pr-4">
                <div className="space-y-6">
                  {/* Summary */}
                  <div className="p-4 bg-muted rounded-lg">
                    <div className="text-sm font-medium mb-2">Summary</div>
                    <div className="space-y-1 text-sm">
                      <div className="flex justify-between">
                        <span>Product:</span>
                        <span className="font-medium">
                          {selectedReturn.productName || selectedReturn.newProductName || "N/A"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span>Received Quantity:</span>
                        <span className="font-medium">{selectedReturn.receivedQuantity}</span>
                      </div>
                    </div>
                  </div>

                  {/* Pricing */}
                  <div className="space-y-4">
                    <div>
                      <Label>Return Handling Fee (per unit) *</Label>
                      <Input
                        type="number"
                        value={returnFee || ""}
                        onChange={(e) => setReturnFee(e.target.value)}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                      <div className="text-xs text-muted-foreground mt-1">
                        Total: ${(parseFloat(returnFee) || 0) * selectedReturn.receivedQuantity}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label>Packing Fee</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Box Quantity</Label>
                          <Input
                            type="number"
                            value={boxQuantity || ""}
                            onChange={(e) => {
                              setBoxQuantity(e.target.value);
                              // Auto-calculate total packing fee
                              const qty = parseFloat(e.target.value) || 0;
                              const price = parseFloat(boxPricePerUnit) || 0;
                              setPackingFee((qty * price).toFixed(2));
                            }}
                            placeholder="0"
                            step="1"
                            min="0"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Price per Box</Label>
                          <Input
                            type="number"
                            value={boxPricePerUnit || ""}
                            onChange={(e) => {
                              setBoxPricePerUnit(e.target.value);
                              // Auto-calculate total packing fee
                              const qty = parseFloat(boxQuantity) || 0;
                              const price = parseFloat(e.target.value) || 0;
                              setPackingFee((qty * price).toFixed(2));
                            }}
                            placeholder="0.00"
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Total: ${(parseFloat(packingFee) || 0).toFixed(2)}
                      </div>
                    </div>

                    <div className="space-y-3">
                      <Label>Palletizing Fee</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Pallet Quantity</Label>
                          <Input
                            type="number"
                            value={palletQuantity || ""}
                            onChange={(e) => {
                              setPalletQuantity(e.target.value);
                              // Auto-calculate total palletizing fee
                              const qty = parseFloat(e.target.value) || 0;
                              const price = parseFloat(palletPricePerUnit) || 0;
                              setPalletFee((qty * price).toFixed(2));
                            }}
                            placeholder="0"
                            step="1"
                            min="0"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Price per Pallet</Label>
                          <Input
                            type="number"
                            value={palletPricePerUnit || ""}
                            onChange={(e) => {
                              setPalletPricePerUnit(e.target.value);
                              // Auto-calculate total palletizing fee
                              const qty = parseFloat(palletQuantity) || 0;
                              const price = parseFloat(e.target.value) || 0;
                              setPalletFee((qty * price).toFixed(2));
                            }}
                            placeholder="0.00"
                            step="0.01"
                            min="0"
                          />
                        </div>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Total: ${(parseFloat(palletFee) || 0).toFixed(2)}
                      </div>
                    </div>

                    {selectedReturn.additionalServices?.shipToAddress && (
                      <div className="space-y-3">
                        <Label>Shipping Fee</Label>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">Remaining Items Shipped</Label>
                            <Input
                              type="number"
                              value={Math.max(0, selectedReturn.receivedQuantity - (selectedReturn.shippedQuantity || 0))}
                              readOnly
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Unit Price (per item)</Label>
                            <Input
                              type="number"
                              value={closeShippingUnitPrice || ""}
                              onChange={(e) => setCloseShippingUnitPrice(e.target.value)}
                              placeholder="0.00"
                              step="0.01"
                              min="0"
                            />
                          </div>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Total: ${(
                            Math.max(0, selectedReturn.receivedQuantity - (selectedReturn.shippedQuantity || 0)) *
                            (parseFloat(closeShippingUnitPrice) || 0)
                          ).toFixed(2)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Ship to:{" "}
                          {(() => {
                            const shippingAddress = selectedReturn.additionalServices?.shippingAddress;
                            if (!shippingAddress) return "N/A";
                            return `${shippingAddress.address}, ${shippingAddress.city || ''} ${shippingAddress.state || ''} ${shippingAddress.zipCode || ''}, ${shippingAddress.country || ''}`.trim();
                          })()}
                        </div>
                      </div>
                    )}

                    {/* Total */}
                    <div className="p-4 bg-muted rounded-lg">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">Grand Total:</span>
                        <span className="text-2xl font-bold">
                          $
                          {(
                            (parseFloat(returnFee) || 0) * selectedReturn.receivedQuantity +
                            (parseFloat(packingFee) || 0) +
                            (parseFloat(palletFee) || 0) +
                            (selectedReturn.additionalServices?.shipToAddress
                              ? Math.max(0, selectedReturn.receivedQuantity - (selectedReturn.shippedQuantity || 0)) *
                                (parseFloat(closeShippingUnitPrice) || 0)
                              : 0)
                          ).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Invoice Generation Option */}
                  <div className="flex items-center space-x-2 pt-2 border-t">
                    <input
                      type="checkbox"
                      id="generateInvoice"
                      checked={generateInvoiceOnClose}
                      onChange={(e) => setGenerateInvoiceOnClose(e.target.checked)}
                      className="h-4 w-4"
                    />
                    <Label htmlFor="generateInvoice" className="text-sm font-normal cursor-pointer">
                      Generate invoice on close
                    </Label>
                  </div>

                  <div className="flex gap-2 pt-4 border-t">
                    <Button
                      onClick={handleCloseRequest}
                      disabled={isProcessing || !returnFee}
                      className="flex-1"
                    >
                      {isProcessing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <CheckCircle className="mr-2 h-4 w-4" />
                      )}
                      Close Request{generateInvoiceOnClose ? ' & Generate Invoice' : ''}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => setIsCloseDialogOpen(false)}
                      disabled={isProcessing}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>

          {/* Ship Dialog */}
          <Dialog open={isShipDialogOpen} onOpenChange={setIsShipDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Ship Products</DialogTitle>
                <DialogDescription>
                  Ship a portion of the received products. This will be logged but won't appear in shipped orders.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div>
                  <Label>Available to Ship</Label>
                  <div className="text-sm text-muted-foreground mt-1">
                    Received: {selectedReturn.receivedQuantity} | 
                    Already Shipped: {selectedReturn.shippedQuantity || 0} | 
                    Available: {selectedReturn.receivedQuantity - (selectedReturn.shippedQuantity || 0)}
                  </div>
                </div>
                <div>
                  <Label>Quantity to Ship *</Label>
                  <Input
                    type="number"
                    value={shipQuantity || ""}
                    onChange={(e) => setShipQuantity(e.target.value)}
                    placeholder="Enter quantity"
                    min="1"
                    max={selectedReturn.receivedQuantity - (selectedReturn.shippedQuantity || 0)}
                  />
                </div>
                <div>
                  <Label>Ship To *</Label>
                  <Input
                    type="text"
                    value={shipTo || ""}
                    onChange={(e) => setShipTo(e.target.value)}
                    placeholder="Enter destination address"
                  />
                </div>
                <div>
                  <Label>Shipping (for Invoice)</Label>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-muted-foreground">Unit Price (per item)</Label>
                      <Input
                        type="number"
                        value={shipShippingUnitPrice || ""}
                        onChange={(e) => {
                          const next = e.target.value;
                          setShipShippingUnitPrice(next);
                          const qty = parseInt(shipQuantity || "0");
                          const unit = parseFloat(next) || 0;
                          if (!isNaN(qty) && qty > 0) {
                            setShippingFee((qty * unit).toFixed(2));
                          }
                        }}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Total Shipping Cost</Label>
                      <Input
                        type="number"
                        value={shippingFee || ""}
                        onChange={(e) => {
                          const next = e.target.value;
                          setShippingFee(next);
                          const qty = parseInt(shipQuantity || "0");
                          const total = parseFloat(next) || 0;
                          if (!isNaN(qty) && qty > 0) {
                            setShipShippingUnitPrice((total / qty).toFixed(2));
                          }
                        }}
                        placeholder="0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Unit Price × Quantity = Total. (Needed only if you generate an invoice.)
                  </div>
                </div>
                <div>
                  <Label>Notes (Optional)</Label>
                  <Textarea
                    value={shipNotes}
                    onChange={(e) => setShipNotes(e.target.value)}
                    placeholder="Add any notes about this shipment..."
                    rows={3}
                  />
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    id="generateInvoiceOnShip"
                    checked={generateInvoiceOnShip}
                    onChange={(e) => setGenerateInvoiceOnShip(e.target.checked)}
                    className="h-4 w-4"
                    disabled={!shippingFee || parseFloat(shippingFee) <= 0}
                  />
                  <Label htmlFor="generateInvoiceOnShip" className="text-sm font-normal cursor-pointer">
                    Generate invoice for this shipment
                  </Label>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handleShip}
                    disabled={isProcessing || !shipQuantity || !shipTo}
                    className="flex-1"
                  >
                    {isProcessing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Truck className="mr-2 h-4 w-4" />
                    )}
                    Ship Products
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsShipDialogOpen(false);
                      setShipQuantity("");
                      setShipTo("");
                      setShipNotes("");
                      setShippingFee("");
                      setShipShippingUnitPrice("");
                      setGenerateInvoiceOnShip(false);
                    }}
                    disabled={isProcessing}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}

      {/* Submit return for user - always mounted so button can open it */}
      <Dialog
        open={addReturnDialogOpen}
        onOpenChange={(open) => {
          setAddReturnDialogOpen(open);
          if (!open) {
            setBehalfUser(null);
            setBehalfUserSearch("");
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden p-0">
          <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-2">
            <DialogTitle>
              {behalfUser
                ? `Submit return for ${formatUserDisplayName(behalfUser, { showEmail: false })}`
                : "Submit return for user"}
            </DialogTitle>
            <DialogDescription>
              {behalfUser
                ? "Create a product return request on behalf of this client."
                : "Select a client, then complete the return request form."}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-6">
            {!behalfUser ? (
              <div className="space-y-4 pr-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name or email…"
                    value={behalfUserSearch}
                    onChange={(e) => setBehalfUserSearch(e.target.value)}
                    className="pl-9 rounded-lg"
                  />
                </div>
                <ScrollArea className="h-[280px] rounded-lg border p-2">
                  <div className="space-y-1">
                    {selectableClients
                      .filter(
                        (u) =>
                          !behalfUserSearch.trim() ||
                          u.name?.toLowerCase().includes(behalfUserSearch.toLowerCase()) ||
                          u.email?.toLowerCase().includes(behalfUserSearch.toLowerCase()) ||
                          u.clientId?.toLowerCase().includes(behalfUserSearch.toLowerCase())
                      )
                      .map((u) => (
                        <Button
                          key={u.uid}
                          variant="ghost"
                          className="w-full justify-start h-auto py-2.5"
                          onClick={() => setBehalfUser(u)}
                        >
                          <div className="text-left">
                            <p className="font-medium">{formatUserDisplayName(u, { showEmail: false })}</p>
                            <p className="text-xs text-muted-foreground">{u.email}</p>
                          </div>
                        </Button>
                      ))}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="pr-4 pb-4 space-y-3">
                <Button variant="outline" size="sm" onClick={() => setBehalfUser(null)}>
                  Change client
                </Button>
                <ProductReturnRequestForm
                  key={behalfUser.uid}
                  targetUserId={behalfUser.uid}
                  targetUserInventory={behalfInventory ?? []}
                  onSuccess={() => {
                    setAddReturnDialogOpen(false);
                    setBehalfUser(null);
                    setBehalfUserSearch("");
                  }}
                />
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

