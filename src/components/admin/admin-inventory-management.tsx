"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import { DatePicker } from "@/components/ui/date-picker";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { doc, updateDoc, deleteDoc, addDoc, collection, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { Trash2, Edit, Package, Eye, EyeOff, Search, Filter, X, Download, History, RotateCcw, Calendar, Plus, Truck, FileText, List, Bell, ClipboardList } from "lucide-react";
import { AddInventoryForm } from "@/components/admin/add-inventory-form";
import { AddInventoryRequestForm } from "@/components/dashboard/add-inventory-request-form";
import { ShipInventoryForm } from "@/components/admin/ship-inventory-form";
import { CreateShipmentWithLabelsForm } from "@/components/dashboard/create-shipment-with-labels-form";
import { ShipmentRequestsManagement } from "@/components/admin/shipment-requests-management";
import { InventoryRequestsManagement } from "@/components/admin/inventory-requests-management";
import { ProductReturnsManagement } from "@/components/admin/product-returns-management";
import { DisposeRequestsManagement } from "@/components/admin/dispose-requests-management";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import type { InventoryItem, ShippedItem, UserProfile, RestockHistory, RecycledShippedItem, RecycledRestockHistory, RecycledInventoryItem, DeleteLog, EditLog } from "@/types";
import { arrayToCSV, downloadCSV, formatDateForCSV, type InventoryCSVRow, type ShippedCSVRow } from "@/lib/csv-utils";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";

interface AdminInventoryManagementProps {
  selectedUser: UserProfile | null;
  inventory: InventoryItem[];
  shipped: ShippedItem[];
  loading: boolean;
  /** When set to "user-requests", opens the User Requests card and section (e.g. from Notifications "Process"). */
  initialSection?: string;
  /** Notification type: shipment_request | inventory_request | product_return — selects the corresponding tab. */
  initialRequestTab?: string;
  /** Request/return ID to auto-open in the request management component. */
  initialRequestId?: string;
}

const editProductSchema = z.object({
  productName: z.string().min(1, "Product name is required"),
  quantity: z.number().min(0, "Quantity must be non-negative"),
});

const restockSchema = z.object({
  quantity: z.number().min(1, "Quantity must be at least 1"),
  restockDate: z.date({ required_error: "A restock date is required." }),
});

const recycleSchema = z.object({
  quantity: z.number().min(1, "Quantity must be at least 1"),
  remarks: z.string().optional(),
});

const deleteSchema = z.object({
  reason: z.string().min(1, "Reason for deletion is required."),
});

const editLogSchema = z.object({
  reason: z.string().min(1, "Reason for editing is required."),
});

function notificationTypeToTabValue(type: string): "shipment" | "inventory" | "return" | "dispose" {
  if (type === "shipment_request") return "shipment";
  if (type === "inventory_request") return "inventory";
  if (type === "product_return") return "return";
  if (type === "dispose_request") return "dispose";
  return "shipment";
}

export function AdminInventoryManagement({
  selectedUser,
  inventory,
  shipped,
  loading,
  initialSection,
  initialRequestTab,
  initialRequestId,
}: AdminInventoryManagementProps) {
  const { toast } = useToast();
  const { user: authUser, userProfile: adminUser } = useAuth();

  const syncShopifyInventoryIfNeeded = async (
    item: InventoryItem & { source?: string; shop?: string; shopifyVariantId?: string; shopifyInventoryItemId?: string },
    newQuantity: number,
    userId: string
  ) => {
    if (item.source !== "shopify" || !item.shop || !item.shopifyVariantId || !authUser) return;
    try {
      const token = await authUser.getIdToken();
      const res = await fetch("/api/shopify/sync-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId,
          shop: item.shop,
          shopifyVariantId: item.shopifyVariantId,
          shopifyInventoryItemId: item.shopifyInventoryItemId,
          newQuantity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "PrepCorex updated; Shopify did not update",
          description: typeof data.error === "string" ? data.error : "Add write_inventory scope in Shopify app and re-connect the store.",
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PrepCorex updated; Shopify did not update",
        description: e instanceof Error ? e.message : "Re-connect the store in Integrations if the app was updated.",
      });
    }
  };

  const syncShopifyProductTitleIfNeeded = async (
    item: InventoryItem & { source?: string; shop?: string; shopifyProductId?: string },
    newTitle: string,
    userId: string
  ) => {
    if (item.source !== "shopify" || !item.shop || !item.shopifyProductId || !authUser) return;
    try {
      const token = await authUser.getIdToken();
      const res = await fetch("/api/shopify/update-product", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId,
          shop: item.shop,
          shopifyProductId: item.shopifyProductId,
          title: newTitle,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "PrepCorex updated; Shopify product name did not update",
          description: typeof data.error === "string" ? data.error : "Add write_products scope and re-connect the store.",
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PrepCorex updated; Shopify product name did not update",
        description: e instanceof Error ? e.message : "Re-connect the store in Integrations.",
      });
    }
  };

  const syncEbayInventoryIfNeeded = async (
    item: InventoryItem & { source?: string; ebayConnectionId?: string; ebayOfferId?: string; ebayListingId?: string },
    newQuantity: number,
    userId: string
  ) => {
    if (item.source !== "ebay" || !item.ebayConnectionId || !authUser) return;
    if (!item.ebayOfferId && !item.ebayListingId) return;
    try {
      const token = await authUser.getIdToken();
      const res = await fetch("/api/integrations/ebay/sync-inventory", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          userId,
          connectionId: item.ebayConnectionId,
          offerId: item.ebayOfferId || undefined,
          listingId: item.ebayListingId || undefined,
          newQuantity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          variant: "destructive",
          title: "PrepCorex updated; eBay did not update",
          description: typeof data.error === "string" ? data.error : "eBay quantity sync failed. Reconnect eBay in Integrations if needed.",
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "PrepCorex updated; eBay did not update",
        description: e instanceof Error ? e.message : "eBay sync failed.",
      });
    }
  };

  // Debug authentication state
  console.log("=== ADMIN INVENTORY MANAGEMENT DEBUG ===");
  console.log("Admin user:", adminUser);
  console.log("Admin user role:", adminUser?.role);
  console.log("Admin user UID:", adminUser?.uid);
  console.log("Selected user:", selectedUser);
  console.log("Inventory:", inventory);
  console.log("Loading:", loading);
  const [editingProduct, setEditingProduct] = useState<InventoryItem | null>(null);
  const [restockingProduct, setRestockingProduct] = useState<InventoryItem | null>(null);
  const [recyclingProduct, setRecyclingProduct] = useState<InventoryItem | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<InventoryItem | null>(null);
  const [editingProductWithLog, setEditingProductWithLog] = useState<InventoryItem | null>(null);
  // Single state to track active section
  const [activeSection, setActiveSection] = useState<string>("current-inventory");
  const [addInventoryMode, setAddInventoryMode] = useState<"quick" | "request">("quick");
  const [shipInventoryMode, setShipInventoryMode] = useState<"quick" | "request">("quick");
  // User Requests tab (shipment | inventory | return | dispose)
  const [userRequestsTab, setUserRequestsTab] = useState<"shipment" | "inventory" | "return" | "dispose">(
    initialRequestTab ? notificationTypeToTabValue(initialRequestTab) : "shipment"
  );
  // Dispose requests dedicated section sub-tab (requests | log)
  const [disposeRequestsSubTab, setDisposeRequestsSubTab] = useState<"requests" | "log">("requests");

  // When navigated from Notifications "Process", open User Requests section and correct tab
  useEffect(() => {
    if (initialSection === "user-requests") {
      setActiveSection("user-requests");
      if (initialRequestTab) {
        setUserRequestsTab(notificationTypeToTabValue(initialRequestTab));
      }
    }
  }, [initialSection, initialRequestTab]);

  const [selectedRemarks, setSelectedRemarks] = useState<string>("");
  const [isRemarksDialogOpen, setIsRemarksDialogOpen] = useState(false);
  const [detailsTitle, setDetailsTitle] = useState<string>("");
  const [detailsLines, setDetailsLines] = useState<string[]>([]);
  const [isDetailsDialogOpen, setIsDetailsDialogOpen] = useState(false);
  const [deleteLogsSearch, setDeleteLogsSearch] = useState("");
  const [editLogsSearch, setEditLogsSearch] = useState("");
  const [recycleSearch, setRecycleSearch] = useState("");
  const [deleteLogsDateFilter, setDeleteLogsDateFilter] = useState<string>("all");
  const [editLogsDateFilter, setEditLogsDateFilter] = useState<string>("all");
  const [recycleDateFilter, setRecycleDateFilter] = useState<string>("all");
  
  // Pagination states
  const [inventoryPage, setInventoryPage] = useState(1);
  const [shippedPage, setShippedPage] = useState(1);
  const [restockHistoryPage, setRestockHistoryPage] = useState(1);
  const [deleteLogsPage, setDeleteLogsPage] = useState(1);
  const [editLogsPage, setEditLogsPage] = useState(1);
  const [recyclePage, setRecyclePage] = useState(1);
  const itemsPerPage = 10;
  const inventoryItemsPerPage = 12; // 3 cards per row Ãƒâ€” 4 rows = 12 items per page for current inventory card view
  const shippedItemsPerPage = 20; // compact list view Ãƒâ€” 4 rows = 12 items per page for shipped inventory card view

  // Invoice range selection for generating invoice over specific dates
  const [invoiceFromDate, setInvoiceFromDate] = useState<Date | undefined>();
  const [invoiceToDate, setInvoiceToDate] = useState<Date | undefined>();

  // Fetch restock history
  const { data: restockHistory, loading: restockHistoryLoading } = useCollection<RestockHistory>(
    selectedUser ? `users/${selectedUser.uid}/restockHistory` : ""
  );

  // Fetch recycled items
  const { data: recycledShipped, loading: recycledShippedLoading } = useCollection<RecycledShippedItem>(
    selectedUser ? `users/${selectedUser.uid}/recycledShipped` : ""
  );

  const { data: recycledRestockHistory, loading: recycledRestockHistoryLoading } = useCollection<RecycledRestockHistory>(
    selectedUser ? `users/${selectedUser.uid}/recycledRestockHistory` : ""
  );

  const { data: recycledInventory, loading: recycledInventoryLoading } = useCollection<RecycledInventoryItem>(
    selectedUser ? `users/${selectedUser.uid}/recycledInventory` : ""
  );

  // Fetch delete logs
  const { data: deleteLogs, loading: deleteLogsLoading } = useCollection<DeleteLog>(
    selectedUser ? `users/${selectedUser.uid}/deleteLogs` : ""
  );

  // Fetch edit logs
  const { data: editLogs, loading: editLogsLoading } = useCollection<EditLog>(
    selectedUser ? `users/${selectedUser.uid}/editLogs` : ""
  );
  
  // Search and filter states
  const [inventorySearch, setInventorySearch] = useState("");
  const [inventoryStatusFilter, setInventoryStatusFilter] = useState<string>("all");
  const [inventoryDateFilter, setInventoryDateFilter] = useState<string>("all");
  const [inventorySortBy, setInventorySortBy] = useState<string>("name-asc");
  const [inventoryFromDate, setInventoryFromDate] = useState<Date | undefined>();
  const [inventoryToDate, setInventoryToDate] = useState<Date | undefined>();
  const [shippedSearch, setShippedSearch] = useState("");
  const [shippedDateFilter, setShippedDateFilter] = useState<string>("all");
  const [restockDateFilter, setRestockDateFilter] = useState<string>("all");
  const [restockSearch, setRestockSearch] = useState("");

  const editForm = useForm<z.infer<typeof editProductSchema>>({
    resolver: zodResolver(editProductSchema),
    defaultValues: {
      productName: "",
      quantity: 0,
    },
  });

  const restockForm = useForm<z.infer<typeof restockSchema>>({
    resolver: zodResolver(restockSchema),
    defaultValues: {
      quantity: 1,
      restockDate: new Date(),
    },
  });

  const recycleForm = useForm<z.infer<typeof recycleSchema>>({
    resolver: zodResolver(recycleSchema),
    defaultValues: {
      quantity: 1,
      remarks: "",
    },
  });

  const deleteForm = useForm<z.infer<typeof deleteSchema>>({
    resolver: zodResolver(deleteSchema),
    defaultValues: {
      reason: "",
    },
  });

  const editLogForm = useForm<z.infer<typeof editLogSchema>>({
    resolver: zodResolver(editLogSchema),
    defaultValues: {
      reason: "",
    },
  });

  const handleEditProduct = (product: InventoryItem) => {
    setEditingProduct(product);
    editForm.setValue("productName", product.productName);
    editForm.setValue("quantity", product.quantity);
  };

  const handleRestockProduct = (product: InventoryItem) => {
    setRestockingProduct(product);
    restockForm.setValue("quantity", 1);
    restockForm.setValue("restockDate", new Date());
  };

  const handleRecycleProduct = (product: InventoryItem) => {
    setRecyclingProduct(product);
    recycleForm.setValue("quantity", 1);
    recycleForm.setValue("remarks", "");
  };

  const handleDeleteProduct = (product: InventoryItem) => {
    setDeletingProduct(product);
    deleteForm.setValue("reason", "");
  };

  const handleEditProductWithLog = (product: InventoryItem) => {
    setEditingProductWithLog(product);
    editLogForm.setValue("reason", "");
  };

  const handleRemarksClick = (remarks: string) => {
    setSelectedRemarks(remarks);
    setIsRemarksDialogOpen(true);
  };

  const handleDetailsClick = (title: string, lines: string[]) => {
    setDetailsTitle(title);
    setDetailsLines(lines);
    setIsDetailsDialogOpen(true);
  };

  const onEditSubmit = async (values: z.infer<typeof editProductSchema>) => {
    if (!editingProduct || !selectedUser) return;

    try {
      const productRef = doc(db, `users/${selectedUser.uid}/inventory`, editingProduct.id);
      await updateDoc(productRef, {
        productName: values.productName,
        quantity: values.quantity,
        status: values.quantity > 0 ? "In Stock" : "Out of Stock",
      });
      await syncShopifyInventoryIfNeeded(editingProduct as any, values.quantity, selectedUser.uid);
      if (values.productName && (editingProduct as any).productName !== values.productName) {
        await syncShopifyProductTitleIfNeeded(editingProduct as any, values.productName, selectedUser.uid);
      }

      toast({
        title: "Success",
        description: "Product updated successfully!",
      });
      setEditingProduct(null);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update product.",
      });
    }
  };

  const onRestockSubmit = async (values: z.infer<typeof restockSchema>) => {
    if (!restockingProduct || !selectedUser || !adminUser) return;

    try {
      const productRef = doc(db, `users/${selectedUser.uid}/inventory`, restockingProduct.id);
      const previousQuantity = restockingProduct.quantity;
      const newQuantity = previousQuantity + values.quantity;
      
      // Update the product quantity
      await updateDoc(productRef, {
        quantity: newQuantity,
        status: "In Stock",
      });
      await syncShopifyInventoryIfNeeded(restockingProduct as any, newQuantity, selectedUser.uid);
      await syncEbayInventoryIfNeeded(restockingProduct as any, newQuantity, selectedUser.uid);

      // Record restock history with selected date
      const restockHistoryRef = collection(db, `users/${selectedUser.uid}/restockHistory`);
      await addDoc(restockHistoryRef, {
        productName: restockingProduct.productName,
        previousQuantity: previousQuantity,
        restockedQuantity: values.quantity,
        newQuantity: newQuantity,
        restockedBy: adminUser.name || "Admin",
        restockedAt: values.restockDate, // Use selected date instead of new Date()
      });

      toast({
        title: "Success",
        description: `Product restocked! Previous: ${previousQuantity}, Added: ${values.quantity}, New Total: ${newQuantity}`,
      });
      setRestockingProduct(null);
      restockForm.reset();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to restock product.",
      });
    }
  };

  const onRecycleSubmit = async (values: z.infer<typeof recycleSchema>) => {
    if (!recyclingProduct) return;

    try {
      console.log("Recycle form submitted with values:", values);
      await handleRecycleInventoryItem(recyclingProduct, values.quantity, values.remarks);
      setRecyclingProduct(null);
      recycleForm.reset();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to recycle product.",
      });
    }
  };

  const onDeleteSubmit = async (values: z.infer<typeof deleteSchema>) => {
    if (!deletingProduct || !selectedUser || !adminUser) return;

    try {
      // Log the deletion
      const deleteLogRef = collection(db, `users/${selectedUser.uid}/deleteLogs`);
      await addDoc(deleteLogRef, {
        productName: deletingProduct.productName,
        quantity: deletingProduct.quantity,
        dateAdded: deletingProduct.dateAdded,
        status: deletingProduct.status,
        deletedAt: new Date(),
        deletedBy: adminUser.name || "Admin",
        reason: values.reason,
      });

      // Delete the product
      const productRef = doc(db, `users/${selectedUser.uid}/inventory`, deletingProduct.id);
      await deleteDoc(productRef);
      await syncShopifyInventoryIfNeeded(deletingProduct as any, 0, selectedUser.uid);

      toast({
        title: "Success",
        description: `Product "${deletingProduct.productName}" deleted successfully!`,
      });
      setDeletingProduct(null);
      deleteForm.reset();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete product.",
      });
    }
  };

  const onEditWithLogSubmit = async (values: z.infer<typeof editLogSchema>) => {
    if (!editingProductWithLog || !selectedUser || !adminUser) return;

    try {
      // Get current product data
      const productRef = doc(db, `users/${selectedUser.uid}/inventory`, editingProductWithLog.id);
      const productDoc = await getDoc(productRef);
      
      if (!productDoc.exists()) {
        throw new Error("Product not found");
      }

      const currentData = productDoc.data() as Omit<InventoryItem, 'id'>;
      const previousProductName = currentData.productName;
      const previousQuantity = currentData.quantity;
      const previousStatus = currentData.status;

      // Update the product
      const newQty = editForm.getValues("quantity");
      const newStatus = newQty > 0 ? "In Stock" : "Out of Stock";
      await updateDoc(productRef, {
        productName: editForm.getValues("productName"),
        quantity: newQty,
        status: newStatus,
      });
      await syncShopifyInventoryIfNeeded(editingProductWithLog as any, newQty, selectedUser.uid);
      if (previousProductName !== editForm.getValues("productName")) {
        await syncShopifyProductTitleIfNeeded(editingProductWithLog as any, editForm.getValues("productName"), selectedUser.uid);
      }

      // Log the edit
      const editLogRef = collection(db, `users/${selectedUser.uid}/editLogs`);
      const editLogData: any = {
        productName: editForm.getValues("productName"),
        previousQuantity: previousQuantity,
        newQuantity: editForm.getValues("quantity"),
        previousStatus: previousStatus,
        newStatus: newStatus,
        dateAdded: editingProductWithLog.dateAdded,
        editedAt: new Date(),
        editedBy: adminUser.name || "Admin",
        reason: values.reason,
      };

      // Only include previousProductName if it actually changed
      if (previousProductName !== editForm.getValues("productName")) {
        editLogData.previousProductName = previousProductName;
      }

      await addDoc(editLogRef, editLogData);

      toast({
        title: "Success",
        description: `Product "${editForm.getValues("productName")}" updated successfully!`,
      });
      setEditingProductWithLog(null);
      editLogForm.reset();
      editForm.reset();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to update product.",
      });
    }
  };

  const handleDeleteRestockHistory = async (restockItem: RestockHistory) => {
    if (!selectedUser) return;

    try {
      const restockRef = doc(db, `users/${selectedUser.uid}/restockHistory`, restockItem.id);
      await deleteDoc(restockRef);

      toast({
        title: "Success",
        description: `Restock history for "${restockItem.productName}" deleted successfully!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete restock history.",
      });
    }
  };

  const handleDeleteShippedOrder = async (shippedItem: ShippedItem) => {
    if (!selectedUser) return;

    try {
      const shippedRef = doc(db, `users/${selectedUser.uid}/shipped`, shippedItem.id);
      await deleteDoc(shippedRef);

      toast({
        title: "Success",
        description: `Shipped order for "${shippedItem.productName}" deleted successfully!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete shipped order.",
      });
    }
  };

  const handleRecycleShippedOrder = async (shippedItem: ShippedItem) => {
    if (!selectedUser || !adminUser) return;

    try {
      // Add to recycled collection
      const recycledRef = collection(db, `users/${selectedUser.uid}/recycledShipped`);
      await addDoc(recycledRef, {
        ...shippedItem,
        recycledAt: new Date(),
        recycledBy: adminUser.name || "Admin",
      });

      // Delete from original collection
      const shippedRef = doc(db, `users/${selectedUser.uid}/shipped`, shippedItem.id);
      await deleteDoc(shippedRef);

      toast({
        title: "Success",
        description: `Shipped order for "${shippedItem.productName}" moved to recycle bin!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to recycle shipped order.",
      });
    }
  };

  const handleRecycleRestockHistory = async (restockItem: RestockHistory) => {
    if (!selectedUser || !adminUser) return;

    try {
      // Add to recycled collection
      const recycledRef = collection(db, `users/${selectedUser.uid}/recycledRestockHistory`);
      await addDoc(recycledRef, {
        ...restockItem,
        recycledAt: new Date(),
        recycledBy: adminUser.name || "Admin",
      });

      // Delete from original collection
      const restockRef = doc(db, `users/${selectedUser.uid}/restockHistory`, restockItem.id);
      await deleteDoc(restockRef);

      toast({
        title: "Success",
        description: `Restock history for "${restockItem.productName}" moved to recycle bin!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to recycle restock history.",
      });
    }
  };

  const handleRestoreShippedOrder = async (recycledItem: RecycledShippedItem) => {
    if (!selectedUser || !adminUser) return;

    try {
      // Add back to original collection
      const shippedRef = collection(db, `users/${selectedUser.uid}/shipped`);
      await addDoc(shippedRef, {
        productName: recycledItem.productName,
        date: recycledItem.date,
        shippedQty: recycledItem.shippedQty,
        remainingQty: recycledItem.remainingQty,
        packOf: recycledItem.packOf,
        remarks: recycledItem.remarks,
      });

      // Delete from recycled collection
      const recycledRef = doc(db, `users/${selectedUser.uid}/recycledShipped`, recycledItem.id);
      await deleteDoc(recycledRef);

      toast({
        title: "Success",
        description: `Shipped order for "${recycledItem.productName}" restored successfully!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to restore shipped order.",
      });
    }
  };

  const handleRestoreRestockHistory = async (recycledItem: RecycledRestockHistory) => {
    if (!selectedUser || !adminUser) return;

    try {
      // Add back to original collection
      const restockRef = collection(db, `users/${selectedUser.uid}/restockHistory`);
      await addDoc(restockRef, {
        productName: recycledItem.productName,
        previousQuantity: recycledItem.previousQuantity,
        restockedQuantity: recycledItem.restockedQuantity,
        newQuantity: recycledItem.newQuantity,
        restockedBy: recycledItem.restockedBy,
        restockedAt: recycledItem.restockedAt,
      });

      // Delete from recycled collection
      const recycledRef = doc(db, `users/${selectedUser.uid}/recycledRestockHistory`, recycledItem.id);
      await deleteDoc(recycledRef);

      toast({
        title: "Success",
        description: `Restock history for "${recycledItem.productName}" restored successfully!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to restore restock history.",
      });
    }
  };

  const handleRecycleInventoryItem = async (inventoryItem: InventoryItem, recycleQuantity: number, remarks?: string) => {
    if (!selectedUser || !adminUser) return;

    try {
      if (recycleQuantity >= inventoryItem.quantity) {
        // Recycle entire item
        const recycledRef = collection(db, `users/${selectedUser.uid}/recycledInventory`);
        await addDoc(recycledRef, {
          ...inventoryItem,
          recycledAt: new Date(),
          recycledBy: adminUser.name || "Admin",
          remarks: remarks || "",
        });

        // Delete from original collection
        const inventoryRef = doc(db, `users/${selectedUser.uid}/inventory`, inventoryItem.id);
        await deleteDoc(inventoryRef);
        await syncShopifyInventoryIfNeeded(inventoryItem as any, 0, selectedUser.uid);

        toast({
          title: "Success",
          description: `Inventory item "${inventoryItem.productName}" (${recycleQuantity} units) moved to recycle bin!`,
        });
      } else {
        // Partial recycle - update original item and add to recycled
        const newQuantity = inventoryItem.quantity - recycleQuantity;
        const newStatus = newQuantity > 0 ? "In Stock" : "Out of Stock";

        // Update original inventory
        const inventoryRef = doc(db, `users/${selectedUser.uid}/inventory`, inventoryItem.id);
        await updateDoc(inventoryRef, {
          quantity: newQuantity,
          status: newStatus,
        });
        await syncShopifyInventoryIfNeeded(inventoryItem as any, newQuantity, selectedUser.uid);

        // Add partial quantity to recycled collection
        const recycledRef = collection(db, `users/${selectedUser.uid}/recycledInventory`);
        await addDoc(recycledRef, {
          productName: inventoryItem.productName,
          quantity: recycleQuantity,
          dateAdded: inventoryItem.dateAdded,
          status: inventoryItem.status,
          recycledAt: new Date(),
          recycledBy: adminUser.name || "Admin",
          remarks: remarks || "",
        });

        toast({
          title: "Success",
          description: `${recycleQuantity} units of "${inventoryItem.productName}" moved to recycle bin! ${newQuantity} units remaining.`,
        });
      }
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to recycle inventory item.",
      });
    }
  };


  const formatDate = (date: any) => {
    if (!date) return "N/A";
    if (typeof date === 'string') return date;
    return format(new Date(date.seconds * 1000), "MMM dd, yyyy");
  };

  // Helper function for date filtering
  const matchesDateFilter = (date: any, filter: string) => {
    if (filter === "all") return true;
    
    const now = new Date();
    const itemDate = typeof date === 'string' ? new Date(date) : new Date(date.seconds * 1000);
    
    switch (filter) {
      case "today":
        return itemDate.toDateString() === now.toDateString();
      case "week":
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return itemDate >= weekAgo;
      case "month":
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return itemDate >= monthAgo;
      case "year":
        const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        return itemDate >= yearAgo;
      default:
        return true;
    }
  };

  // Filtered delete logs
  const filteredDeleteLogs = deleteLogs.filter((item) => {
    const matchesSearch = item.productName.toLowerCase().includes(deleteLogsSearch.toLowerCase()) ||
                          item.reason.toLowerCase().includes(deleteLogsSearch.toLowerCase()) ||
                          item.deletedBy.toLowerCase().includes(deleteLogsSearch.toLowerCase());
    const matchesDate = matchesDateFilter(item.deletedAt, deleteLogsDateFilter);
    return matchesSearch && matchesDate;
  }).sort((a, b) => {
    const dateA = typeof a.deletedAt === 'string' ? new Date(a.deletedAt) : new Date(a.deletedAt.seconds * 1000);
    const dateB = typeof b.deletedAt === 'string' ? new Date(b.deletedAt) : new Date(b.deletedAt.seconds * 1000);
    return dateB.getTime() - dateA.getTime();
  });

  // Pagination for delete logs
  const deleteLogsTotalPages = Math.ceil(filteredDeleteLogs.length / itemsPerPage);
  const deleteLogsStartIndex = (deleteLogsPage - 1) * itemsPerPage;
  const deleteLogsEndIndex = deleteLogsStartIndex + itemsPerPage;
  const paginatedDeleteLogs = filteredDeleteLogs.slice(deleteLogsStartIndex, deleteLogsEndIndex);
  const resetDeleteLogsPagination = () => setDeleteLogsPage(1);

  const filteredEditLogs = editLogs.filter((item) => {
    const matchesSearch = item.productName.toLowerCase().includes(editLogsSearch.toLowerCase()) ||
                          item.reason.toLowerCase().includes(editLogsSearch.toLowerCase()) ||
                          item.editedBy.toLowerCase().includes(editLogsSearch.toLowerCase()) ||
                          (item.previousProductName && item.previousProductName.toLowerCase().includes(editLogsSearch.toLowerCase()));
    const matchesDate = matchesDateFilter(item.editedAt, editLogsDateFilter);
    return matchesSearch && matchesDate;
  }).sort((a, b) => {
    const dateA = typeof a.editedAt === 'string' ? new Date(a.editedAt) : new Date(a.editedAt.seconds * 1000);
    const dateB = typeof b.editedAt === 'string' ? new Date(b.editedAt) : new Date(b.editedAt.seconds * 1000);
    return dateB.getTime() - dateA.getTime();
  });

  // Pagination for edit logs
  const editLogsTotalPages = Math.ceil(filteredEditLogs.length / itemsPerPage);
  const editLogsStartIndex = (editLogsPage - 1) * itemsPerPage;
  const editLogsEndIndex = editLogsStartIndex + itemsPerPage;
  const paginatedEditLogs = filteredEditLogs.slice(editLogsStartIndex, editLogsEndIndex);
  const resetEditLogsPagination = () => setEditLogsPage(1);

  const filteredRecycledInventory = recycledInventory.filter((item) => {
    const matchesSearch = item.productName.toLowerCase().includes(recycleSearch.toLowerCase()) ||
                          (item.remarks && item.remarks.toLowerCase().includes(recycleSearch.toLowerCase())) ||
                          item.recycledBy.toLowerCase().includes(recycleSearch.toLowerCase());
    const matchesDate = matchesDateFilter(item.recycledAt, recycleDateFilter);
    return matchesSearch && matchesDate;
  }).sort((a, b) => {
    const dateA = typeof a.recycledAt === 'string' ? new Date(a.recycledAt) : new Date(a.recycledAt.seconds * 1000);
    const dateB = typeof b.recycledAt === 'string' ? new Date(b.recycledAt) : new Date(b.recycledAt.seconds * 1000);
    return dateB.getTime() - dateA.getTime();
  });

  // Pagination for recycled inventory
  const recycleTotalPages = Math.ceil(filteredRecycledInventory.length / itemsPerPage);
  const recycleStartIndex = (recyclePage - 1) * itemsPerPage;
  const recycleEndIndex = recycleStartIndex + itemsPerPage;
  const paginatedRecycledInventory = filteredRecycledInventory.slice(recycleStartIndex, recycleEndIndex);
  const resetRecyclePagination = () => setRecyclePage(1);

  // Helper function for date picker filtering
  const matchesDatePickerFilter = (date: any, fromDate?: Date, toDate?: Date) => {
    if (!fromDate && !toDate) return true;
    
    let itemDate: Date;
    if (typeof date === 'string') {
      itemDate = new Date(date);
    } else if (date && typeof date === 'object' && date.seconds) {
      itemDate = new Date(date.seconds * 1000);
    } else {
      return false;
    }
    
    // Set time to start/end of day for accurate comparison
    const itemDateOnly = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());
    
    if (fromDate && toDate) {
      const fromDateOnly = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
      const toDateOnly = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
      return itemDateOnly >= fromDateOnly && itemDateOnly <= toDateOnly;
    } else if (fromDate) {
      const fromDateOnly = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
      return itemDateOnly >= fromDateOnly;
    } else if (toDate) {
      const toDateOnly = new Date(toDate.getFullYear(), toDate.getMonth(), toDate.getDate());
      return itemDateOnly <= toDateOnly;
    }
    
    return true;
  };


  // Download functions
  const handleDownloadInventory = () => {
    if (!selectedUser || filteredInventory.length === 0) {
      toast({
        variant: "destructive",
        title: "No Data",
        description: "No inventory data available to download.",
      });
      return;
    }

    const csvData: InventoryCSVRow[] = filteredInventory.map(item => ({
      'Product Name': item.productName,
      'Quantity': item.quantity,
      'Status': item.status,
      'Date Added': formatDateForCSV(item.dateAdded),
    }));

    const csvContent = arrayToCSV(csvData, ['Product Name', 'Quantity', 'Status', 'Date Added']);
    const filename = `${selectedUser.name}_inventory_${new Date().toISOString().split('T')[0]}.csv`;
    
    downloadCSV(csvContent, filename);
    
    toast({
      title: "Download Started",
      description: `Inventory data for ${selectedUser.name} is being downloaded.`,
    });
  };

  const aggregateAdditionalServices = (shipments: any[]) => {
    let totalBubbleWrapFeet = 0;
    let totalStickerRemovalItems = 0;
    let totalWarningLabels = 0;
    let pricePerFoot = 0;
    let pricePerItem = 0;
    let pricePerLabel = 0;
    let total = 0;
    let hasStoredTotal = false;

    shipments.forEach((shipment) => {
      const add = shipment?.additionalServices;
      if (!add) return;

      totalBubbleWrapFeet += Number(add.bubbleWrapFeet || 0);
      totalStickerRemovalItems += Number(add.stickerRemovalItems || 0);
      totalWarningLabels += Number(add.warningLabels || 0);

      if (!pricePerFoot && add.pricePerFoot) pricePerFoot = Number(add.pricePerFoot);
      if (!pricePerItem && add.pricePerItem) pricePerItem = Number(add.pricePerItem);
      if (!pricePerLabel && add.pricePerLabel) pricePerLabel = Number(add.pricePerLabel);

      if (typeof add.total === "number" && Number.isFinite(add.total)) {
        total += add.total;
        hasStoredTotal = true;
      }
    });

    if (!hasStoredTotal) {
      total =
        totalBubbleWrapFeet * (pricePerFoot || 0) +
        totalStickerRemovalItems * (pricePerItem || 0) +
        totalWarningLabels * (pricePerLabel || 0);
    }

    total = Number.isFinite(total) ? Math.max(0, total) : 0;
    if (total <= 0.0001) return null;

    return {
      bubbleWrapFeet: totalBubbleWrapFeet,
      stickerRemovalItems: totalStickerRemovalItems,
      warningLabels: totalWarningLabels,
      pricePerFoot,
      pricePerItem,
      pricePerLabel,
      total,
    };
  };

  const handleGenerateInvoice = async () => {
    if (!selectedUser) {
      toast({
        variant: "destructive",
        title: "No User Selected",
        description: "Please select a user first.",
      });
      return;
    }

    // Import invoice generator functions
    const { generateInvoicePDF, generateInvoiceNumber } = await import('@/lib/invoice-generator');
    
    // Get today's shipments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayShipments = filteredShipped.filter(shippedItem => {
      const shipmentDate = typeof shippedItem.date === 'string' 
        ? new Date(shippedItem.date) 
        : new Date(shippedItem.date.seconds * 1000);
      shipmentDate.setHours(0, 0, 0, 0);
      return shipmentDate.getTime() === today.getTime();
    });

    if (todayShipments.length === 0) {
      toast({
        variant: "destructive",
        title: "No Shipments Today",
        description: "No shipments found for today to generate invoice.",
      });
      return;
    }

    // Create invoice data
    const invoiceNumber = generateInvoiceNumber();
    const additionalServices = aggregateAdditionalServices(todayShipments);
    const additionalServicesTotal = Number(additionalServices?.total || 0);

    const invoiceData = {
      invoiceNumber,
      date: format(today, 'dd/MM/yyyy'),
      orderNumber: `ORD-${format(today, 'yyyyMMdd')}-${Date.now().toString().slice(-4)}`,
      soldTo: {
        name: selectedUser.name || 'Unknown User',
        email: selectedUser.email || '',
        phone: selectedUser.phone || '',
        address: '',
      },
      fbm: 'Standard Shipping',
      items: todayShipments.map(shipped => ({
        quantity: Number((shipped as any).unitsForPricing ?? (shipped as any).boxesShipped ?? shipped.shippedQty ?? 0),
        productName: shipped.productName || "Unknown Product",
        shipDate: (typeof shipped.date === 'string')
          ? format(new Date(shipped.date), 'dd/MM/yyyy')
          : format(new Date(shipped.date.seconds * 1000), 'dd/MM/yyyy'),
        packaging: `${shipped.packOf} Nos.`,
        unitPrice: shipped.unitPrice || 0,
        amount: ((shipped as any).unitsForPricing ?? (shipped as any).boxesShipped ?? shipped.shippedQty) * (shipped.unitPrice || 0),
      })),
      additionalServices: additionalServices || undefined,
    };

    // Calculate totals
    const subtotal = invoiceData.items.reduce((sum, item) => sum + item.amount, 0);
    const grandTotal = subtotal + additionalServicesTotal; // No tax added
    
    // Save invoice to Firestore
    const invoiceDoc: any = {
      invoiceNumber,
      date: invoiceData.date,
      orderNumber: invoiceData.orderNumber,
      soldTo: invoiceData.soldTo,
      fbm: invoiceData.fbm,
      items: invoiceData.items,
      subtotal,
      grandTotal,
      status: 'pending' as const,
      createdAt: new Date(),
      userId: selectedUser.uid,
    };

    if (additionalServices) {
      invoiceDoc.additionalServices = additionalServices;
    }
    
    await addDoc(collection(db, `users/${selectedUser.uid}/invoices`), invoiceDoc);
    
    // Generate PDF
    await generateInvoicePDF({ ...invoiceData, subtotal, grandTotal });
    
    toast({
      title: "Invoice Generated",
      description: `Invoice ${invoiceNumber} has been generated for ${selectedUser.name}.`,
    });
  };

  const handleDownloadShipped = () => {
    if (!selectedUser || filteredShipped.length === 0) {
      toast({
        variant: "destructive",
        title: "No Data",
        description: "No shipped orders data available to download.",
      });
      return;
    }

    const csvData: ShippedCSVRow[] = filteredShipped.map(item => ({
      'Product Name': item.productName || "Unknown Product",
      'Shipped Quantity': item.shippedQty ?? 0,
      'Pack Of': item.packOf ?? 0,
      'Date Shipped': formatDateForCSV(item.date),
      'Remarks': item.remarks || '',
    }));

    const csvContent = arrayToCSV(csvData, ['Product Name', 'Shipped Quantity', 'Pack Of', 'Date Shipped', 'Remarks']);
    const filename = `${selectedUser.name}_shipped_orders_${new Date().toISOString().split('T')[0]}.csv`;
    
    downloadCSV(csvContent, filename);
    
    toast({
      title: "Download Started",
      description: `Shipped orders data for ${selectedUser.name} is being downloaded.`,
    });
  };

  const handleGenerateInvoiceForRange = async (from?: Date, to?: Date) => {
    if (!selectedUser) {
      toast({ variant: "destructive", title: "No User Selected", description: "Please select a user first." });
      return;
    }
    if (!from || !to) {
      toast({ variant: "destructive", title: "Select Dates", description: "Please select a start and end date." });
      return;
    }

    const { generateInvoicePDF, generateInvoiceNumber } = await import('@/lib/invoice-generator');

    // Normalize range to whole days
    const start = new Date(from);
    start.setHours(0,0,0,0);
    const end = new Date(to);
    end.setHours(23,59,59,999);

    // Filter shipments by date range
    const rangeShipments = filteredShipped.filter(shippedItem => {
      const shipmentDate = typeof shippedItem.date === 'string' 
        ? new Date(shippedItem.date) 
        : new Date(shippedItem.date.seconds * 1000);
      return shipmentDate >= start && shipmentDate <= end;
    });

    if (rangeShipments.length === 0) {
      toast({ variant: "destructive", title: "No Shipments", description: "No shipments found in the selected date range." });
      return;
    }

    const invoiceNumber = generateInvoiceNumber();
    const invoiceDate = format(new Date(), 'dd/MM/yyyy');
    const additionalServices = aggregateAdditionalServices(rangeShipments);
    const additionalServicesTotal = Number(additionalServices?.total || 0);

    const invoiceData = {
      invoiceNumber,
      date: invoiceDate,
      orderNumber: `ORD-${format(new Date(), 'yyyyMMdd')}-${Date.now().toString().slice(-4)}`,
      soldTo: {
        name: selectedUser.name || 'Unknown User',
        email: selectedUser.email || '',
        phone: selectedUser.phone || '',
        address: '',
      },
      fbm: 'Standard Shipping',
      items: rangeShipments.map(shipped => ({
        quantity: Number((shipped as any).unitsForPricing ?? (shipped as any).boxesShipped ?? shipped.shippedQty ?? 0),
        productName: shipped.productName || "Unknown Product",
        shipDate: (typeof shipped.date === 'string')
          ? format(new Date(shipped.date), 'dd/MM/yyyy')
          : format(new Date(shipped.date.seconds * 1000), 'dd/MM/yyyy'),
        packaging: `${shipped.packOf} Nos.`,
        unitPrice: shipped.unitPrice || 0,
        amount: ((shipped as any).unitsForPricing ?? (shipped as any).boxesShipped ?? shipped.shippedQty) * (shipped.unitPrice || 0),
      })),
      additionalServices: additionalServices || undefined,
    } as const;

    const subtotal = invoiceData.items.reduce((sum, item) => sum + item.amount, 0);
    const grandTotal = subtotal + additionalServicesTotal;

    const invoiceDoc: any = {
      invoiceNumber,
      date: invoiceData.date,
      orderNumber: invoiceData.orderNumber,
      soldTo: invoiceData.soldTo,
      fbm: invoiceData.fbm,
      items: invoiceData.items,
      subtotal,
      grandTotal,
      status: 'pending' as const,
      createdAt: new Date(),
      userId: selectedUser.uid,
      range: { from: start, to: end },
    };

    if (additionalServices) {
      invoiceDoc.additionalServices = additionalServices;
    }

    await addDoc(collection(db, `users/${selectedUser.uid}/invoices`), invoiceDoc);
    await generateInvoicePDF({ ...invoiceData, subtotal, grandTotal });
    toast({ title: "Invoice Generated", description: `Range invoice ${invoiceNumber} created for ${selectedUser.name}.` });
  };

  // Filtered inventory data
  const filteredInventory = useMemo(() => {
    let filtered = inventory.filter((item) => {
      const matchesSearch = item.productName.toLowerCase().includes(inventorySearch.toLowerCase());
      const matchesStatus = inventoryStatusFilter === "all" || item.status === inventoryStatusFilter;
      const matchesDate = matchesDateFilter(item.dateAdded, inventoryDateFilter);
      const matchesDatePicker = matchesDatePickerFilter(item.dateAdded, inventoryFromDate, inventoryToDate);
      return matchesSearch && matchesStatus && matchesDate && matchesDatePicker;
    });

    // Apply sorting - prioritize items with quantity < 5 at the top
    filtered.sort((a, b) => {
      const aLowStock = a.quantity < 5;
      const bLowStock = b.quantity < 5;
      
      // If one is low stock and the other isn't, low stock comes first
      if (aLowStock && !bLowStock) return -1;
      if (!aLowStock && bLowStock) return 1;
      
      // If both are low stock or both are not, apply the selected sort
      switch (inventorySortBy) {
        case "name-asc":
          return a.productName.localeCompare(b.productName);
        case "name-desc":
          return b.productName.localeCompare(a.productName);
        case "date-asc": {
          const dateA = typeof a.dateAdded === 'string' 
            ? new Date(a.dateAdded) 
            : new Date((a.dateAdded as { seconds: number; nanoseconds: number }).seconds * 1000);
          const dateB = typeof b.dateAdded === 'string' 
            ? new Date(b.dateAdded) 
            : new Date((b.dateAdded as { seconds: number; nanoseconds: number }).seconds * 1000);
          return dateA.getTime() - dateB.getTime();
        }
        case "date-desc":
        default: {
          const dateA = typeof a.dateAdded === 'string' 
            ? new Date(a.dateAdded) 
            : new Date((a.dateAdded as { seconds: number; nanoseconds: number }).seconds * 1000);
          const dateB = typeof b.dateAdded === 'string' 
            ? new Date(b.dateAdded) 
            : new Date((b.dateAdded as { seconds: number; nanoseconds: number }).seconds * 1000);
          return dateB.getTime() - dateA.getTime();
        }
      }
    });

    return filtered;
  }, [inventory, inventorySearch, inventoryStatusFilter, inventoryDateFilter, inventoryFromDate, inventoryToDate, inventorySortBy]);

  // Pagination for inventory (4 items per page for card view)
  const inventoryTotalPages = Math.ceil(filteredInventory.length / inventoryItemsPerPage);
  const inventoryStartIndex = (inventoryPage - 1) * inventoryItemsPerPage;
  const inventoryEndIndex = inventoryStartIndex + inventoryItemsPerPage;
  const paginatedInventory = filteredInventory.slice(inventoryStartIndex, inventoryEndIndex);
  const resetInventoryPagination = () => setInventoryPage(1);

  // Filtered shipped data
  const filteredShipped = useMemo(() => {
    const filtered = shipped.filter((item) => {
      const matchesSearch = (item.productName || "").toLowerCase().includes(shippedSearch.toLowerCase());
      const matchesDate = matchesDateFilter(item.date, shippedDateFilter);
      return matchesSearch && matchesDate;
    });

    // Sort by createdAt when available, otherwise by date (most recent first)
    return filtered.sort((a, b) => {
      const aCreated = (a as any).createdAt
        ? (typeof (a as any).createdAt === 'string' ? new Date((a as any).createdAt) : new Date((a as any).createdAt.seconds * 1000))
        : (typeof a.date === 'string' ? new Date(a.date) : new Date(a.date.seconds * 1000));
      const bCreated = (b as any).createdAt
        ? (typeof (b as any).createdAt === 'string' ? new Date((b as any).createdAt) : new Date((b as any).createdAt.seconds * 1000))
        : (typeof b.date === 'string' ? new Date(b.date) : new Date(b.date.seconds * 1000));
      return bCreated.getTime() - aCreated.getTime();
    });
  }, [shipped, shippedSearch, shippedDateFilter]);

  // Pagination for shipped (12 items per page for card view)
  const shippedTotalPages = Math.ceil(filteredShipped.length / shippedItemsPerPage);
  const shippedStartIndex = (shippedPage - 1) * shippedItemsPerPage;
  const shippedEndIndex = shippedStartIndex + shippedItemsPerPage;
  const paginatedShipped = filteredShipped.slice(shippedStartIndex, shippedEndIndex);
  const resetShippedPagination = () => setShippedPage(1);

  // Filtered restock history data
  const filteredRestockHistory = useMemo(() => {
    const q = restockSearch.trim().toLowerCase();
    const filtered = restockHistory.filter((item) => {
      const matchesDate = matchesDateFilter(item.restockedAt, restockDateFilter);
      const matchesSearch =
        q.length === 0 ||
        (item.productName || "").toLowerCase().includes(q) ||
        (item.restockedBy || "").toLowerCase().includes(q);
      return matchesDate && matchesSearch;
    });
    
    // Sort by date (most recent first)
    return filtered.sort((a, b) => {
      const dateA = typeof a.restockedAt === 'string' ? new Date(a.restockedAt) : new Date(a.restockedAt.seconds * 1000);
      const dateB = typeof b.restockedAt === 'string' ? new Date(b.restockedAt) : new Date(b.restockedAt.seconds * 1000);
      return dateB.getTime() - dateA.getTime();
    });
  }, [restockHistory, restockDateFilter, restockSearch]);

  // Pagination for restock history
  const restockHistoryTotalPages = Math.ceil(filteredRestockHistory.length / itemsPerPage);
  const restockHistoryStartIndex = (restockHistoryPage - 1) * itemsPerPage;
  const restockHistoryEndIndex = restockHistoryStartIndex + itemsPerPage;
  const paginatedRestockHistory = filteredRestockHistory.slice(restockHistoryStartIndex, restockHistoryEndIndex);
  const resetRestockHistoryPagination = () => setRestockHistoryPage(1);

  if (!selectedUser) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Inventory Management</CardTitle>
          <CardDescription>Select a user to manage their inventory</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">No user selected</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
      {/* User Info Header */}
      <Card className="border-2 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50 border-b">
          <div className="flex flex-col gap-4">
            <div>
              <CardTitle className="text-xl font-bold text-gray-900">Managing: {selectedUser.name}</CardTitle>
              <CardDescription className="text-sm text-gray-600 mt-1">
                Email: {selectedUser.email} | Phone: {selectedUser.phone || "Not provided"}
              </CardDescription>
            </div>
            
            {/* Section Navigation Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mt-2">
              {/* Add Inventory Card */}
              <div
                onClick={() => setActiveSection("add-inventory")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "add-inventory"
                    ? "border-indigo-500 bg-gradient-to-br from-indigo-50 to-indigo-100 shadow-lg scale-105 ring-2 ring-indigo-200"
                    : "border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "add-inventory" ? "bg-indigo-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <Plus className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "add-inventory" ? "text-indigo-900" : "text-gray-700"
                    }`}>
                      Add Inventory
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      New product
                    </p>
                  </div>
                </div>
              </div>

              {/* Ship Inventory Card */}
              <div
                onClick={() => setActiveSection("ship-inventory")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "ship-inventory"
                    ? "border-cyan-500 bg-gradient-to-br from-cyan-50 to-cyan-100 shadow-lg scale-105 ring-2 ring-cyan-200"
                    : "border-gray-200 bg-white hover:border-cyan-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "ship-inventory" ? "bg-cyan-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <Truck className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "ship-inventory" ? "text-cyan-900" : "text-gray-700"
                    }`}>
                      Ship Inventory
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Record shipment
                    </p>
                  </div>
                </div>
              </div>

              {/* Current Inventory Card */}
              <div
                onClick={() => setActiveSection("current-inventory")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "current-inventory"
                    ? "border-violet-500 bg-gradient-to-br from-violet-50 to-violet-100 shadow-lg scale-105 ring-2 ring-violet-200"
                    : "border-gray-200 bg-white hover:border-violet-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "current-inventory" ? "bg-violet-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <List className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "current-inventory" ? "text-violet-900" : "text-gray-700"
                    }`}>
                      Current Inventory
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {inventory.length} items
                    </p>
                  </div>
                </div>
              </div>

              {/* Shipped Orders Card */}
              <div
                onClick={() => setActiveSection("shipped-orders")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "shipped-orders"
                    ? "border-blue-500 bg-gradient-to-br from-blue-50 to-blue-100 shadow-lg scale-105 ring-2 ring-blue-200"
                    : "border-gray-200 bg-white hover:border-blue-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "shipped-orders" ? "bg-blue-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <Package className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "shipped-orders" ? "text-blue-900" : "text-gray-700"
                    }`}>
                      Shipped Orders
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {shipped.length} items
                    </p>
                  </div>
                </div>
              </div>

              {/* Restock Summary Card */}
              <div
                onClick={() => setActiveSection("restock-history")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "restock-history"
                    ? "border-green-500 bg-gradient-to-br from-green-50 to-green-100 shadow-lg scale-105 ring-2 ring-green-200"
                    : "border-gray-200 bg-white hover:border-green-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "restock-history" ? "bg-green-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <History className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "restock-history" ? "text-green-900" : "text-gray-700"
                    }`}>
                      Restock Summary
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      View logs
                    </p>
                  </div>
                </div>
              </div>

              {/* Disposed Inventory Card */}
              <div
                onClick={() => setActiveSection("recycle-bin")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "recycle-bin"
                    ? "border-orange-500 bg-gradient-to-br from-orange-50 to-orange-100 shadow-lg scale-105 ring-2 ring-orange-200"
                    : "border-gray-200 bg-white hover:border-orange-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "recycle-bin" ? "bg-orange-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <RotateCcw className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "recycle-bin" ? "text-orange-900" : "text-gray-700"
                    }`}>
                      Disposed Inventory
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Disposed items
                    </p>
                  </div>
                </div>
              </div>

              {/* Modification Logs Card */}
              <div
                onClick={() => setActiveSection("edit-log")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "edit-log"
                    ? "border-pink-500 bg-gradient-to-br from-pink-50 to-pink-100 shadow-lg scale-105 ring-2 ring-pink-200"
                    : "border-gray-200 bg-white hover:border-pink-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "edit-log" ? "bg-pink-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <FileText className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "edit-log" ? "text-pink-900" : "text-gray-700"
                    }`}>
                      Modification Logs
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {editLogs.length} records
                    </p>
                  </div>
                </div>
              </div>

              {/* Deleted Log Card */}
              <div
                onClick={() => setActiveSection("delete-log")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "delete-log"
                    ? "border-red-500 bg-gradient-to-br from-red-50 to-red-100 shadow-lg scale-105 ring-2 ring-red-200"
                    : "border-gray-200 bg-white hover:border-red-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "delete-log" ? "bg-red-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <Trash2 className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "delete-log" ? "text-red-900" : "text-gray-700"
                    }`}>
                      Deleted Log
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {deleteLogs.length} records
                    </p>
                  </div>
                </div>
              </div>

              {/* User Requests (Notifications) Card */}
              <div
                onClick={() => setActiveSection("user-requests")}
                className={`relative cursor-pointer rounded-xl border-2 transition-all duration-300 p-4 ${
                  activeSection === "user-requests"
                    ? "border-amber-500 bg-gradient-to-br from-amber-50 to-amber-100 shadow-lg scale-105 ring-2 ring-amber-200"
                    : "border-gray-200 bg-white hover:border-amber-300 hover:shadow-md"
                }`}
              >
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className={`p-3 rounded-lg ${
                    activeSection === "user-requests" ? "bg-amber-500 text-white" : "bg-gray-100 text-gray-600"
                  } transition-colors`}>
                    <Bell className="h-6 w-6" />
                  </div>
                  <div>
                    <p className={`font-semibold text-xs ${
                      activeSection === "user-requests" ? "text-amber-900" : "text-gray-700"
                    }`}>
                      User Requests
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Shipment · Inventory · Return · Dispose
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* User Requests (per-user notifications) */}
      {activeSection === "user-requests" && (
        <Card>
          <CardHeader>
            <CardTitle>User Requests — {selectedUser.name}</CardTitle>
            <CardDescription>
              Process this user&apos;s shipment, inventory, and return requests. Each tab shows only this user&apos;s requests.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs value={userRequestsTab} onValueChange={(v) => setUserRequestsTab(v as "shipment" | "inventory" | "return" | "dispose")} className="w-full">
              <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
                <TabsTrigger value="shipment">Shipment</TabsTrigger>
                <TabsTrigger value="inventory">Inventory</TabsTrigger>
                <TabsTrigger value="return">Returns</TabsTrigger>
                <TabsTrigger value="dispose">Dispose</TabsTrigger>
              </TabsList>
              <TabsContent value="shipment" className="mt-4">
                <ShipmentRequestsManagement selectedUser={selectedUser} inventory={inventory} initialRequestId={initialRequestId} />
              </TabsContent>
              <TabsContent value="inventory" className="mt-4">
                <InventoryRequestsManagement selectedUser={selectedUser} initialRequestId={initialRequestId} />
              </TabsContent>
              <TabsContent value="return" className="mt-4">
                <ProductReturnsManagement selectedUser={selectedUser} inventory={inventory} initialReturnId={initialRequestId} />
              </TabsContent>
              <TabsContent value="dispose" className="mt-4">
                <DisposeRequestsManagement selectedUser={selectedUser} inventory={inventory} initialRequestId={initialRequestId} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Current Inventory */}
      {activeSection === "current-inventory" && (
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle>Current Inventory ({filteredInventory.length})</CardTitle>
              <CardDescription>Manage products in {selectedUser.name}'s inventory</CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadInventory}
              disabled={filteredInventory.length === 0}
              className="flex items-center gap-2 w-full sm:w-auto"
            >
              <Download className="h-4 w-4" />
              Download CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* Search and Filter Controls */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <div className="sm:col-span-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search products..."
                  value={inventorySearch}
                  onChange={(e) => {
                    setInventorySearch(e.target.value);
                    resetInventoryPagination();
                  }}
                  className="pl-10"
                />
                {inventorySearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => setInventorySearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
            <div className="sm:w-48">
              <Select value={inventoryStatusFilter} onValueChange={(value) => {
                setInventoryStatusFilter(value);
                resetInventoryPagination();
              }}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="In Stock">In Stock</SelectItem>
                  <SelectItem value="Out of Stock">Out of Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="sm:w-48">
              <Select value={inventoryDateFilter} onValueChange={(value) => {
                setInventoryDateFilter(value);
                resetInventoryPagination();
              }}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2" />
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
            <div className="sm:w-48">
              <DateRangePicker
                fromDate={inventoryFromDate}
                toDate={inventoryToDate}
                setFromDate={setInventoryFromDate}
                setToDate={setInventoryToDate}
                className="w-full"
              />
            </div>
            <div className="sm:w-48">
              <Select value={inventorySortBy} onValueChange={(value) => {
                setInventorySortBy(value);
                resetInventoryPagination();
              }}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="name-asc">Sort by Name (A-Z)</SelectItem>
                  <SelectItem value="name-desc">Sort by Name (Z-A)</SelectItem>
                  <SelectItem value="date-asc">Sort by Date (Oldest)</SelectItem>
                  <SelectItem value="date-desc">Sort by Date (Newest)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          {loading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : filteredInventory.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {paginatedInventory.map((item) => {
                const isEbayListing = item.source === "ebay";
                const isLowStock = !isEbayListing && item.quantity < 5;
                return (
                <Card key={item.id} className={`hover:shadow-md transition-shadow flex flex-col h-full ${isLowStock ? 'border-red-500 border-2 bg-red-50 dark:bg-red-950/20' : ''}`}>
                  <CardContent className="p-4 flex flex-col flex-1">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <h3 className={`font-semibold text-base leading-tight flex-1 min-w-0 ${isLowStock ? 'text-red-700 dark:text-red-400' : ''}`}>{item.productName}</h3>
                      <Badge variant={item.status === "In Stock" ? "default" : "destructive"} className="text-xs shrink-0">
                        {item.status}
                      </Badge>
                    </div>
                    <div className="space-y-2 mb-4 flex-1">
                      <div className={`flex items-center gap-2 text-sm ${isLowStock ? 'text-red-700 dark:text-red-400' : 'text-muted-foreground'}`}>
                        <Package className={`h-4 w-4 shrink-0 ${isLowStock ? 'text-red-600 dark:text-red-400' : ''}`} />
                        <span>Qty: <span className={`font-semibold ${isLowStock ? 'text-red-800 dark:text-red-300' : 'text-foreground'}`}>{item.quantity}</span></span>
                  </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Calendar className="h-4 w-4 shrink-0" />
                        <span className="truncate">Added: {formatDate(item.dateAdded)}</span>
                      </div>
                      {isEbayListing && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                          <span>Source: eBay · Restock syncs to eBay</span>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-auto">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={isEbayListing}
                          onClick={() => handleEditProductWithLog(item)}
                            className="w-full"
                        >
                            <Edit className="h-4 w-4 mr-1" />
                            <span className="text-xs">Edit</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{isEbayListing ? "Edit not supported for eBay listings" : "Edit product details"}</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleRestockProduct(item)}
                            className="w-full text-green-600 hover:text-green-700"
                        >
                            <Package className="h-4 w-4 mr-1" />
                            <span className="text-xs">Restock</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{isEbayListing ? "Restock product and update quantity on eBay" : "Restock product"}</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button 
                          variant="outline" 
                          size="sm"
                          disabled={isEbayListing}
                          onClick={() => handleRecycleProduct(item)}
                            className="w-full text-orange-600 hover:text-orange-700"
                        >
                            <RotateCcw className="h-4 w-4 mr-1" />
                            <span className="text-xs">Recycle</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{isEbayListing ? "Recycle not supported for eBay listings" : "Move to Recycle Bin"}</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline" 
                          size="sm"
                          disabled={isEbayListing}
                          onClick={() => handleDeleteProduct(item)}
                            className="w-full text-red-600 hover:text-red-700"
                        >
                            <Trash2 className="h-4 w-4 mr-1" />
                            <span className="text-xs">Delete</span>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{isEbayListing ? "Remove from Integrations → eBay listings" : "Permanently delete product"}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                  </CardContent>
                </Card>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-8">
              <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No inventory items</h3>
              <p className="text-muted-foreground">This user has no products in their inventory.</p>
              </div>
          )}

          {/* Pagination Controls */}
          {filteredInventory.length > inventoryItemsPerPage && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {inventoryStartIndex + 1} to {Math.min(inventoryEndIndex, filteredInventory.length)} of {filteredInventory.length} items
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInventoryPage(p => Math.max(1, p - 1))}
                  disabled={inventoryPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {inventoryPage} of {inventoryTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInventoryPage(p => Math.min(inventoryTotalPages, p + 1))}
                  disabled={inventoryPage === inventoryTotalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Shipped Orders (Conditional) */}
      {/* Add Inventory Section */}
      {activeSection === "add-inventory" && selectedUser && (
        <Card className="border-2 border-indigo-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-indigo-50 to-indigo-100 border-b">
            <CardTitle className="text-indigo-900 flex items-center gap-2">
              <Plus className="h-5 w-5" />
              Add New Inventory
            </CardTitle>
            <CardDescription className="text-indigo-700">
              Add a new product to {selectedUser.name}'s inventory
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <Tabs
              value={addInventoryMode}
              onValueChange={(v) => setAddInventoryMode(v as "quick" | "request")}
            >
              <TabsList className="w-full grid grid-cols-2 bg-slate-100 p-1 rounded-lg">
                <TabsTrigger
                  value="quick"
                  className="rounded-md data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
                >
                  Quick Add
                </TabsTrigger>
                <TabsTrigger
                  value="request"
                  className="rounded-md data-[state=active]:bg-indigo-600 data-[state=active]:text-white"
                >
                  Create Request
                </TabsTrigger>
              </TabsList>
              <TabsContent value="quick" className="mt-4">
                <AddInventoryForm userId={selectedUser.uid} inventory={inventory} />
              </TabsContent>
              <TabsContent value="request" className="mt-4">
                <AddInventoryRequestForm
                  targetUserId={selectedUser.uid}
                  targetUserName={selectedUser.name ?? selectedUser.email ?? "User"}
                  mode="inline"
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Ship Inventory Section */}
      {activeSection === "ship-inventory" && selectedUser && (
        <Card className="border-2 border-cyan-200 shadow-lg">
          <CardHeader className="bg-gradient-to-r from-cyan-50 to-cyan-100 border-b">
            <CardTitle className="text-cyan-900 flex items-center gap-2">
              <Truck className="h-5 w-5" />
              Ship Inventory
            </CardTitle>
            <CardDescription className="text-cyan-700">
              Quick ship removes stock immediately, or create a pending shipment request (labels, services, product types) under {selectedUser.name}&apos;s account—same as the client flow.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            <Tabs
              value={shipInventoryMode}
              onValueChange={(v) => setShipInventoryMode(v as "quick" | "request")}
            >
              <TabsList className="w-full grid grid-cols-2 bg-slate-100 p-1 rounded-lg">
                <TabsTrigger
                  value="quick"
                  className="rounded-md data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
                >
                  Quick Ship
                </TabsTrigger>
                <TabsTrigger
                  value="request"
                  className="rounded-md data-[state=active]:bg-cyan-600 data-[state=active]:text-white"
                >
                  Create Shipment Request
                </TabsTrigger>
              </TabsList>
              <TabsContent value="quick" className="mt-4">
                <ShipInventoryForm userId={selectedUser.uid} inventory={inventory} />
              </TabsContent>
              <TabsContent value="request" className="mt-4">
                <CreateShipmentWithLabelsForm
                  inventory={inventory}
                  targetUserId={selectedUser.uid}
                  targetUserName={selectedUser.name ?? selectedUser.email ?? "User"}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {activeSection === "shipped-orders" && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle>Shipped Orders ({filteredShipped.length})</CardTitle>
                <CardDescription>View shipped orders for {selectedUser.name}</CardDescription>
              </div>
              <div className="grid grid-cols-1 sm:flex sm:flex-row gap-2 items-stretch sm:items-center w-full sm:w-auto">
                <DateRangePicker
                  fromDate={invoiceFromDate}
                  toDate={invoiceToDate}
                  setFromDate={setInvoiceFromDate}
                  setToDate={setInvoiceToDate}
                  className="w-full sm:w-64"
                />
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleGenerateInvoice}
                  className="flex items-center gap-2 w-full sm:w-auto"
                >
                  <Download className="h-4 w-4" />
                  Generate Invoice
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleGenerateInvoiceForRange(invoiceFromDate, invoiceToDate)}
                  className="flex items-center gap-2 w-full sm:w-auto"
                  disabled={!invoiceFromDate || !invoiceToDate}
                >
                  <Download className="h-4 w-4" />
                  Generate (Range)
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadShipped}
                  disabled={filteredShipped.length === 0}
                  className="flex items-center gap-2 w-full sm:w-auto"
                >
                  <Download className="h-4 w-4" />
                  Download CSV
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Search and Filter Controls for Shipped Orders */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search shipped orders..."
                    value={shippedSearch}
                    onChange={(e) => {
                      setShippedSearch(e.target.value);
                      resetShippedPagination();
                    }}
                    className="pl-10"
                  />
                  {shippedSearch && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                      onClick={() => setShippedSearch("")}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="sm:w-48">
                <Select value={shippedDateFilter} onValueChange={(value) => {
                  setShippedDateFilter(value);
                  resetShippedPagination();
                }}>
                  <SelectTrigger>
                    <Filter className="h-4 w-4 mr-2" />
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
            
            {filteredShipped.length > 0 ? (
              <div className="rounded-md border overflow-x-auto">
                <Table className="min-w-[900px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[140px]">Product</TableHead>
                      <TableHead className="min-w-[140px]">Service</TableHead>
                      <TableHead className="min-w-[120px]">Type</TableHead>
                      <TableHead className="text-right w-20">Shipped</TableHead>
                      <TableHead className="text-right w-20">Remaining</TableHead>
                      <TableHead className="text-right w-16">Pack</TableHead>
                      <TableHead className="whitespace-nowrap">Date</TableHead>
                      <TableHead className="min-w-[120px]">Remarks</TableHead>
                      <TableHead className="w-10">Add’l</TableHead>
                      <TableHead className="w-12 text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedShipped.map((item) => {
                      const svc = (item as any).service as string | undefined;
                      const shipmentType = (item as any).shipmentType as string | undefined;
                      const productType = (item as any).productType as string | undefined;
                      const palletSubType = (item as any).palletSubType as string | undefined;
                      const itemsCount = Array.isArray((item as any).items) ? (item as any).items.length : 0;
                      const add = (item as any).additionalServices as any | undefined;
                      const hasAdd = !!add && ((add.bubbleWrapFeet || 0) > 0 || (add.stickerRemovalItems || 0) > 0 || (add.warningLabels || 0) > 0 || (add.total || 0) > 0);
                      const typeLabel = shipmentType === "pallet" && palletSubType ? `Pallet (${palletSubType})` : shipmentType ?? undefined;
                      const typeProductText = [typeLabel, productType].filter(Boolean).join(" • ") || "—";
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="font-medium">
                            <span className="truncate block max-w-[180px]" title={item.productName}>{item.productName}</span>
                            {itemsCount > 1 && <span className="text-xs text-muted-foreground">({itemsCount} items)</span>}
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            <span className="truncate block max-w-[160px]" title={svc}>{svc || "—"}</span>
                          </TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            <span className="truncate block max-w-[140px]">{typeProductText}</span>
                          </TableCell>
                          <TableCell className="text-right font-medium">{(item as any).boxesShipped ?? item.shippedQty}</TableCell>
                          <TableCell className="text-right">{item.remainingQty}</TableCell>
                          <TableCell className="text-right">{item.packOf}</TableCell>
                          <TableCell className="text-muted-foreground text-sm whitespace-nowrap">{formatDate(item.date)}</TableCell>
                          <TableCell className="min-w-[120px]">
                            {item.remarks ? (
                              <Button variant="ghost" size="sm" className="h-auto p-1 text-xs text-left justify-start max-w-full truncate" onClick={() => handleRemarksClick(item.remarks || "")}>
                                <span className="truncate block">{item.remarks}</span>
                                <Eye className="h-3 w-3 ml-1 shrink-0" />
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            {hasAdd ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => {
                                  const lines: string[] = [];
                                  if ((add?.bubbleWrapFeet || 0) > 0) lines.push(`Bubble Wrap: ${add.bubbleWrapFeet} feet` + (add?.pricePerFoot ? ` (x $${Number(add.pricePerFoot).toFixed(2)})` : ""));
                                  if ((add?.stickerRemovalItems || 0) > 0) lines.push(`Sticker Removal: ${add.stickerRemovalItems} items` + (add?.pricePerItem ? ` (x $${Number(add.pricePerItem).toFixed(2)})` : ""));
                                  if ((add?.warningLabels || 0) > 0) lines.push(`Warning Labels: ${add.warningLabels}` + (add?.pricePerLabel ? ` (x $${Number(add.pricePerLabel).toFixed(2)})` : ""));
                                  if ((add?.total || 0) > 0) lines.push(`Total Additional: $${Number(add.total || 0).toFixed(2)}`);
                                  if (lines.length === 0) lines.push("No additional services.");
                                  handleDetailsClick("Additional Services", lines);
                                }}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="destructive" size="sm" className="h-8 w-8 p-0">
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Delete Shipped Order</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Are you sure you want to delete this shipped order for "{item.productName}"? This action cannot be undone.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleDeleteShippedOrder(item)} className="bg-red-600 hover:bg-red-700">
                                    Delete
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-center py-8">
                <Package className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No shipped orders</h3>
                <p className="text-muted-foreground">No orders have been shipped yet.</p>
              </div>
            )}

            {/* Pagination Controls for Shipped Orders */}
            {filteredShipped.length > shippedItemsPerPage && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Showing {shippedStartIndex + 1} to {Math.min(shippedEndIndex, filteredShipped.length)} of {filteredShipped.length} items
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShippedPage(p => Math.max(1, p - 1))}
                    disabled={shippedPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {shippedPage} of {shippedTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShippedPage(p => Math.min(shippedTotalPages, p + 1))}
                    disabled={shippedPage === shippedTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Restock Summary (Conditional) */}
      {activeSection === "restock-history" && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle>Restock Summary ({filteredRestockHistory.length})</CardTitle>
                <CardDescription>View restock summary for {selectedUser.name}</CardDescription>
              </div>
              <div className="w-full sm:w-72">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search product or restocked by..."
                    value={restockSearch}
                    onChange={(e) => {
                      setRestockSearch(e.target.value);
                      resetRestockHistoryPagination();
                    }}
                    className="pl-10 pr-10"
                  />
                  {restockSearch && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                      onClick={() => {
                        setRestockSearch("");
                        resetRestockHistoryPagination();
                      }}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
              <div className="w-full sm:w-48">
                <Select value={restockDateFilter} onValueChange={(value) => {
                  setRestockDateFilter(value);
                  resetRestockHistoryPagination();
                }}>
                  <SelectTrigger>
                    <Filter className="h-4 w-4 mr-2" />
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
            {restockHistoryLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : filteredRestockHistory.length > 0 ? (
              <div className="space-y-3">
                {paginatedRestockHistory.map((item) => (
                  <div key={item.id} className="p-3 sm:p-4 border rounded-lg">
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <h3 className="font-semibold text-sm sm:text-base truncate">{item.productName}</h3>
                        <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:text-sm text-muted-foreground">
                          <span>Previous: {item.previousQuantity}</span>
                          <span className="text-green-600">+{item.restockedQuantity}</span>
                          <span>New Total: {item.newQuantity}</span>
                          <span>Restocked by: {item.restockedBy}</span>
                          <span>Date: {formatDate(item.restockedAt)}</span>
                        </div>
                      </div>
                      <div className="w-full sm:w-auto grid grid-cols-1 sm:flex gap-2 sm:items-center sm:justify-end">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="destructive" size="sm" className="w-full sm:w-auto">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Delete Restock Entry</AlertDialogTitle>
                              <AlertDialogDescription>
                                Are you sure you want to delete this restock record for "{item.productName}"?
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDeleteRestockHistory(item)}
                                className="bg-red-600 hover:bg-red-700"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <History className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No restock summary</h3>
                <p className="text-muted-foreground">
                  {restockHistory.length === 0 ? "No products have been restocked yet." : "No restocks match your search or date filter."}
                </p>
              </div>
            )}

            {/* Pagination Controls for Restock Summary */}
            {filteredRestockHistory.length > itemsPerPage && (
              <div className="flex items-center justify-between mt-4 pt-4 border-t">
                <div className="text-sm text-muted-foreground">
                  Showing {restockHistoryStartIndex + 1} to {Math.min(restockHistoryEndIndex, filteredRestockHistory.length)} of {filteredRestockHistory.length} records
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRestockHistoryPage(p => Math.max(1, p - 1))}
                    disabled={restockHistoryPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm">
                    Page {restockHistoryPage} of {restockHistoryTotalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setRestockHistoryPage(p => Math.min(restockHistoryTotalPages, p + 1))}
                    disabled={restockHistoryPage === restockHistoryTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Disposed Inventory Section */}
      {activeSection === "recycle-bin" && (
        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <div>
                <CardTitle className="text-orange-600">Disposed Inventory ({filteredRecycledInventory.length})</CardTitle>
                <CardDescription>View and restore recycled items for {selectedUser.name}</CardDescription>
              </div>
              <div className="sm:w-48">
                <Select value={recycleDateFilter} onValueChange={(value) => {
                  setRecycleDateFilter(value);
                  resetRecyclePagination();
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
          </CardHeader>
          <CardContent>
            {/* Search Controls */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by product name, reason, or admin..."
                    value={recycleSearch}
                    onChange={(e) => {
                      setRecycleSearch(e.target.value);
                      resetRecyclePagination();
                    }}
                    className="pl-10"
                  />
                  {recycleSearch && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                      onClick={() => setRecycleSearch("")}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
            <div className="space-y-6">
              {/* Recycled Inventory Items */}
              <div>
                <h3 className="text-lg font-semibold mb-4">Disposed Inventory Items ({filteredRecycledInventory.length})</h3>
                {recycledInventoryLoading ? (
                  <div className="space-y-4">
                    {[1, 2].map((i) => (
                      <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
                    ))}
                  </div>
                ) : filteredRecycledInventory.length > 0 ? (
                  <div className="space-y-3">
                    {paginatedRecycledInventory.map((item) => (
                        <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg bg-orange-50">
                          <div className="flex-1">
                            <h4 className="font-semibold">{item.productName}</h4>
                            <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                              <span>Qty: {item.quantity}</span>
                              <span>Added: {formatDate(item.dateAdded)}</span>
                              <span className="text-orange-600">Recycled: {formatDate(item.recycledAt)}</span>
                              <span>By: {item.recycledBy}</span>
                            </div>
                            {item.remarks && (
                              <div className="mt-2 text-sm">
                                <span className="text-muted-foreground">Reason: </span>
                                <span className="text-orange-700 font-medium">{item.remarks}</span>
                              </div>
                            )}
                            <div className="mt-2">
                              <Badge variant={item.status === "In Stock" ? "default" : "destructive"}>
                                {item.status}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <RotateCcw className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">No disposed inventory items</h3>
                    <p className="text-muted-foreground">
                      {recycledInventory.length === 0 ? "No inventory items have been disposed yet." : "No disposed inventory items match your search or date filter."}
                    </p>
                  </div>
                )}

                {/* Pagination for Recycle Section */}
                {filteredRecycledInventory.length > itemsPerPage && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Showing {recycleStartIndex + 1} to {Math.min(recycleEndIndex, filteredRecycledInventory.length)} of {filteredRecycledInventory.length} records
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRecyclePage(p => Math.max(1, p - 1))}
                        disabled={recyclePage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-sm">
                        Page {recyclePage} of {recycleTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setRecyclePage(p => Math.min(recycleTotalPages, p + 1))}
                        disabled={recyclePage === recycleTotalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Deleted Logs Section */}
      {activeSection === "delete-log" && (
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-red-600">Deleted Logs ({filteredDeleteLogs.length})</CardTitle>
              <CardDescription>View permanently deleted products for {selectedUser.name}</CardDescription>
            </div>
            <div className="sm:w-48">
              <Select value={deleteLogsDateFilter} onValueChange={(value) => {
                setDeleteLogsDateFilter(value);
                resetDeleteLogsPagination();
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
        </CardHeader>
        <CardContent>
          {/* Search Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by product name, reason, or admin..."
                  value={deleteLogsSearch}
                  onChange={(e) => {
                    setDeleteLogsSearch(e.target.value);
                    resetDeleteLogsPagination();
                  }}
                  className="pl-10"
                />
                {deleteLogsSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => setDeleteLogsSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          {deleteLogsLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : filteredDeleteLogs.length > 0 ? (
            <div className="space-y-3">
              {paginatedDeleteLogs.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg bg-red-50">
                    <div className="flex-1">
                      <h4 className="font-semibold text-red-800">{item.productName}</h4>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>Qty: {item.quantity}</span>
                        <span>Added: {formatDate(item.dateAdded)}</span>
                        <span className="text-red-600">Deleted: {formatDate(item.deletedAt)}</span>
                        <span>By: {item.deletedBy}</span>
                      </div>
                      <div className="mt-2 text-sm">
                        <span className="text-muted-foreground">Reason: </span>
                        <span className="text-red-700 font-medium">{item.reason}</span>
                      </div>
                      <div className="mt-2">
                        <Badge variant={item.status === "In Stock" ? "default" : "destructive"}>
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Trash2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No deleted products</h3>
              <p className="text-muted-foreground">
                {deleteLogs.length === 0 ? "No products have been permanently deleted yet." : "No deleted products match your search or date filter."}
              </p>
            </div>
          )}

          {/* Pagination Controls for Deleted Logs */}
          {filteredDeleteLogs.length > itemsPerPage && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {deleteLogsStartIndex + 1} to {Math.min(deleteLogsEndIndex, filteredDeleteLogs.length)} of {filteredDeleteLogs.length} records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteLogsPage(p => Math.max(1, p - 1))}
                  disabled={deleteLogsPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {deleteLogsPage} of {deleteLogsTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setDeleteLogsPage(p => Math.min(deleteLogsTotalPages, p + 1))}
                  disabled={deleteLogsPage === deleteLogsTotalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Modification Logs Section */}
      {activeSection === "edit-log" && (
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <CardTitle className="text-blue-600">Modification Logs ({filteredEditLogs.length})</CardTitle>
              <CardDescription>View product edit history for {selectedUser.name}</CardDescription>
            </div>
            <div className="sm:w-48">
              <Select value={editLogsDateFilter} onValueChange={(value) => {
                setEditLogsDateFilter(value);
                resetEditLogsPagination();
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
        </CardHeader>
        <CardContent>
          {/* Search Controls */}
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by product name, reason, or admin..."
                  value={editLogsSearch}
                  onChange={(e) => {
                    setEditLogsSearch(e.target.value);
                    resetEditLogsPagination();
                  }}
                  className="pl-10"
                />
                {editLogsSearch && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                    onClick={() => setEditLogsSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          {editLogsLoading ? (
            <div className="space-y-4">
              {[1, 2].map((i) => (
                <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : filteredEditLogs.length > 0 ? (
            <div className="space-y-3">
              {paginatedEditLogs.map((item) => (
                  <div key={item.id} className="flex items-center justify-between p-4 border rounded-lg bg-blue-50">
                    <div className="flex-1">
                      <h4 className="font-semibold text-blue-800">{item.productName}</h4>
                      <div className="flex items-center gap-4 mt-1 text-sm text-muted-foreground">
                        <span>Qty: {item.previousQuantity} → {item.newQuantity}</span>
                        <span>Status: {item.previousStatus} → {item.newStatus}</span>
                        <span className="text-blue-600">Edited: {formatDate(item.editedAt)}</span>
                        <span>By: {item.editedBy}</span>
                      </div>
                      {item.previousProductName && item.previousProductName !== item.productName && (
                        <div className="mt-1 text-sm">
                          <span className="text-muted-foreground">Name changed from: </span>
                          <span className="text-blue-700 font-medium">{item.previousProductName}</span>
                        </div>
                      )}
                      <div className="mt-2 text-sm">
                        <span className="text-muted-foreground">Reason: </span>
                        <span className="text-blue-700 font-medium">{item.reason}</span>
                      </div>
                      <div className="mt-2">
                        <Badge variant={item.newStatus === "In Stock" ? "default" : "destructive"}>
                          {item.newStatus}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <Edit className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No product edits</h3>
              <p className="text-muted-foreground">
                {editLogs.length === 0 ? "No products have been edited yet." : "No product edits match your search or date filter."}
              </p>
            </div>
          )}

          {/* Pagination Controls for Modification Logs */}
          {filteredEditLogs.length > itemsPerPage && (
            <div className="flex items-center justify-between mt-4 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {editLogsStartIndex + 1} to {Math.min(editLogsEndIndex, filteredEditLogs.length)} of {filteredEditLogs.length} records
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditLogsPage(p => Math.max(1, p - 1))}
                  disabled={editLogsPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {editLogsPage} of {editLogsTotalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setEditLogsPage(p => Math.min(editLogsTotalPages, p + 1))}
                  disabled={editLogsPage === editLogsTotalPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {/* Edit Product Dialog */}
      <Dialog open={!!editingProduct} onOpenChange={() => setEditingProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Product</DialogTitle>
            <DialogDescription>Update product details</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="productName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Product Name</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter product name" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={editForm.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        placeholder="Enter quantity" 
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Update Product</Button>
                <Button type="button" variant="outline" onClick={() => setEditingProduct(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Restock Product Dialog */}
      <Dialog open={!!restockingProduct} onOpenChange={() => setRestockingProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restock Product</DialogTitle>
            <DialogDescription>Add inventory to "{restockingProduct?.productName}"</DialogDescription>
          </DialogHeader>
          <Form {...restockForm}>
            <form onSubmit={restockForm.handleSubmit(onRestockSubmit)} className="space-y-4">
              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm">
                  <strong>Current Quantity:</strong> {restockingProduct?.quantity}
                </p>
                <p className="text-sm">
                  <strong>Product:</strong> {restockingProduct?.productName}
                </p>
              </div>
              <FormField
                control={restockForm.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity to Add</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        placeholder="Enter quantity to add" 
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={restockForm.control}
                name="restockDate"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Restock Date</FormLabel>
                    <DatePicker date={field.value} setDate={field.onChange} />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">Restock Product</Button>
                <Button type="button" variant="outline" onClick={() => setRestockingProduct(null)}>
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Recycle Product Dialog */}
      <Dialog open={!!recyclingProduct} onOpenChange={() => setRecyclingProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Dispose Product</DialogTitle>
            <DialogDescription>Move inventory to disposed inventory for "{recyclingProduct?.productName}"</DialogDescription>
          </DialogHeader>
          <Form {...recycleForm}>
            <form onSubmit={recycleForm.handleSubmit(onRecycleSubmit)} className="space-y-4">
              <div className="bg-muted/50 p-3 rounded-lg">
                <p className="text-sm">
                  <strong>Current Quantity:</strong> {recyclingProduct?.quantity}
                </p>
                <p className="text-sm">
                  <strong>Product:</strong> {recyclingProduct?.productName}
                </p>
              </div>
              <FormField
                control={recycleForm.control}
                name="quantity"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Quantity to Recycle</FormLabel>
                    <FormControl>
                      <Input 
                        type="number" 
                        placeholder="Enter quantity to recycle" 
                        min="1"
                        max={recyclingProduct?.quantity || 1}
                        value={field.value || 1}
                        onChange={(e) => field.onChange(parseInt(e.target.value) || 1)}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">
                      Maximum: {recyclingProduct?.quantity} units
                    </p>
                  </FormItem>
                )}
              />
              <FormField
                control={recycleForm.control}
                name="remarks"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for Recycling</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Enter reason for recycling (optional)" 
                        value={field.value || ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">
                      Optional: Explain why this item is being recycled
                    </p>
                  </FormItem>
                )}
              />
              <div className="flex gap-2">
                <Button 
                  type="submit" 
                  className="flex-1 bg-orange-600 hover:bg-orange-700 text-white font-medium"
                  disabled={false}
                  onClick={() => console.log("Done button clicked!")}
                >
                  Done
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setRecyclingProduct(null)}
                  className="px-6"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete Product Dialog */}
      <Dialog open={!!deletingProduct} onOpenChange={() => setDeletingProduct(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Product</DialogTitle>
            <DialogDescription>Permanently delete "{deletingProduct?.productName}" from inventory</DialogDescription>
          </DialogHeader>
          <Form {...deleteForm}>
            <form onSubmit={deleteForm.handleSubmit(onDeleteSubmit)} className="space-y-4">
              <div className="bg-red-50 border border-red-200 p-3 rounded-lg">
                <p className="text-sm text-red-800">
                  <strong>⚠️ Warning:</strong> This action will permanently delete the product from inventory.
                </p>
                <div className="mt-2 text-sm">
                  <p><strong>Product:</strong> {deletingProduct?.productName}</p>
                  <p><strong>Quantity:</strong> {deletingProduct?.quantity} units</p>
                  <p><strong>Status:</strong> {deletingProduct?.status}</p>
                </div>
              </div>
              <FormField
                control={deleteForm.control}
                name="reason"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Reason for Deletion *</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="Enter reason for deleting this product" 
                        value={field.value || ""}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        name={field.name}
                        ref={field.ref}
                      />
                    </FormControl>
                    <FormMessage />
                    <p className="text-xs text-muted-foreground">
                      Required: Explain why this product is being deleted
                    </p>
                  </FormItem>
                )}
              />
              <div className="flex gap-2">
                <Button 
                  type="submit" 
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-medium"
                >
                  Delete Product
                </Button>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setDeletingProduct(null)}
                  className="px-6"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Product with Log Dialog */}
      <Dialog open={!!editingProductWithLog} onOpenChange={() => setEditingProductWithLog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Product with Log</DialogTitle>
            <DialogDescription>Update product details and provide reason for changes</DialogDescription>
          </DialogHeader>
          <div className="space-y-6">
            {/* Product Info Display */}
            <div className="bg-blue-50 border border-blue-200 p-3 rounded-lg">
              <p className="text-sm text-blue-800">
                <strong>Editing:</strong> {editingProductWithLog?.productName}
              </p>
              <div className="mt-2 text-sm">
                <p><strong>Current Quantity:</strong> {editingProductWithLog?.quantity} units</p>
                <p><strong>Current Status:</strong> {editingProductWithLog?.status}</p>
                <p><strong>Date Added:</strong> {formatDate(editingProductWithLog?.dateAdded)}</p>
              </div>
            </div>

            {/* Edit Form */}
            <Form {...editForm}>
              <form onSubmit={editForm.handleSubmit((editValues) => {
                // Handle edit form submission
                editLogForm.handleSubmit(onEditWithLogSubmit)();
              })} className="space-y-4">
                <div className="grid gap-4 md:grid-cols-2">
                  <FormField
                    control={editForm.control}
                    name="productName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Product Name</FormLabel>
                        <FormControl>
                          <Input placeholder="Enter product name" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={editForm.control}
                    name="quantity"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Quantity</FormLabel>
                        <FormControl>
                          <Input 
                            type="number" 
                            placeholder="Enter quantity" 
                            {...field}
                            onChange={(e) => field.onChange(parseInt(e.target.value) || 0)}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Reason for Edit */}
                <FormField
                  control={editLogForm.control}
                  name="reason"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reason for Edit *</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="Enter reason for editing this product" 
                          value={field.value || ""}
                          onChange={field.onChange}
                          onBlur={field.onBlur}
                          name={field.name}
                          ref={field.ref}
                        />
                      </FormControl>
                      <FormMessage />
                      <p className="text-xs text-muted-foreground">
                        Required: Explain why this product is being edited
                      </p>
                    </FormItem>
                  )}
                />

                <div className="flex gap-2">
                  <Button 
                    type="submit" 
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-medium"
                  >
                    Update Product
                  </Button>
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => setEditingProductWithLog(null)}
                    className="px-6"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            </Form>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remarks Dialog */}
      <Dialog open={isRemarksDialogOpen} onOpenChange={setIsRemarksDialogOpen}>
        <DialogContent className="max-w-sm sm:max-w-md md:max-w-lg lg:max-w-xl xl:max-w-2xl max-h-[80vh] overflow-hidden">
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
    </div>
    </TooltipProvider>
  );
}

