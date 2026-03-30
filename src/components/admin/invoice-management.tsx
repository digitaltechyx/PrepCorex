"use client";

import { useMemo, useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Search, Download, CheckCircle, Clock, X, Eye, Receipt, User, Users } from "lucide-react";
import { generateInvoicePDF } from "@/lib/invoice-generator";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { type Invoice, type UserProfile, type Commission } from "@/types";
import { db } from "@/lib/firebase";
import { collection, query, getDocs, orderBy, doc, updateDoc, where } from "firebase/firestore";
import type { ShippedItem } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { createCommissionForInvoice } from "@/lib/commission-utils";
import { DollarSign } from "lucide-react";
import { Label } from "@/components/ui/label";
import { hasRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";

interface InvoiceManagementProps {
  users: UserProfile[];
  /** Initial tab from URL (e.g. ?tab=pending) so dashboard Pending Invoices card opens on pending tab */
  initialTab?: "pending" | "paid" | null;
}

interface UserInvoiceSummary {
  user: UserProfile;
  pendingCount: number;
  paidCount: number;
  totalAmount: number;
}

export function InvoiceManagement({ users, initialTab }: InvoiceManagementProps) {
  const { user, userProfile: adminUser } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedUserInvoices, setSelectedUserInvoices] = useState<Invoice[]>([]);
  const [isViewDialogOpen, setIsViewDialogOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [userInvoices, setUserInvoices] = useState<Record<string, Invoice[]>>({});
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [usersPage, setUsersPage] = useState(1);
  const [userFilterTab, setUserFilterTab] = useState<"all" | "unpaid" | "paid">("all");
  const [activeTab, setActiveTab] = useState<"pending" | "paid">(
    initialTab === "pending" || initialTab === "paid" ? initialTab : "pending"
  );

  useEffect(() => {
    if (initialTab === "pending" || initialTab === "paid") {
      setActiveTab(initialTab);
    }
  }, [initialTab]);
  const [currentPage, setCurrentPage] = useState(1);
  const [mainTab, setMainTab] = useState<"invoices" | "commissions">("invoices");
  const [commissionTab, setCommissionTab] = useState<"pending" | "paid">("pending");
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [commissionsLoading, setCommissionsLoading] = useState(false);
  const [commissionPage, setCommissionPage] = useState(1);
  const itemsPerPage = 12;

  // Manual test generation for storage invoices (admin review)
  const [isStorageTestDialogOpen, setIsStorageTestDialogOpen] = useState(false);
  const [storageTestUserId, setStorageTestUserId] = useState<string>("");
  const [storageTestMonth, setStorageTestMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [isGeneratingStorageTest, setIsGeneratingStorageTest] = useState(false);

  // Discount editor (admin-only, for already generated invoices)
  const [isDiscountDialogOpen, setIsDiscountDialogOpen] = useState(false);
  const [discountInvoice, setDiscountInvoice] = useState<Invoice | null>(null);
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountValue, setDiscountValue] = useState<string>("");
  const [isApplyingDiscount, setIsApplyingDiscount] = useState(false);
  
  // Load all invoices from all users
  const loadInvoices = async () => {
    setLoading(true);
    try {
      // Load all users' invoices in parallel (faster than sequential per-user fetches).
      const results = await Promise.all(
        users.map(async (u) => {
          const invoicesQuery = query(
            collection(db, `users/${u.uid}/invoices`),
            orderBy("createdAt", "desc")
          );
          const snapshot = await getDocs(invoicesQuery);

          const loaded = snapshot.docs.map((invoiceDoc) => ({
            ...(invoiceDoc.data() as Invoice),
            id: invoiceDoc.id,
            // Ensure owner ID is always present for actions like mark-as-paid.
            userId: (invoiceDoc.data() as any)?.userId || u.uid,
          }));

          // Defensive: ensure latest invoices appear first even if createdAt is missing/mixed
          const getInvoiceSortTime = (inv: any) => {
            const createdAt = inv?.createdAt;
            if (createdAt) {
              if (typeof createdAt === "string") {
                const t = new Date(createdAt).getTime();
                if (!Number.isNaN(t)) return t;
              }
              if (typeof createdAt === "object" && typeof createdAt.seconds === "number") {
                return createdAt.seconds * 1000;
              }
              if (createdAt instanceof Date) {
                return createdAt.getTime();
              }
            }
            const t2 = inv?.date ? new Date(inv.date).getTime() : 0;
            return Number.isNaN(t2) ? 0 : t2;
          };

          return [u.uid, [...loaded].sort((a: any, b: any) => getInvoiceSortTime(b) - getInvoiceSortTime(a))] as const;
        })
      );

      const invoicesMap: Record<string, Invoice[]> = {};
      for (const [uid, list] of results) {
        invoicesMap[uid] = list;
      }

      setUserInvoices(invoicesMap);
    } catch (error) {
      console.error('Error loading invoices:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load invoices.",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateStorageTestInvoice = async () => {
    if (!storageTestUserId) {
      toast({
        variant: "destructive",
        title: "Select a user",
        description: "Please choose a user to generate a storage invoice for.",
      });
      return;
    }

    setIsGeneratingStorageTest(true);
    try {
      const idToken = user ? await user.getIdToken() : "";
      if (!idToken) throw new Error("Please re-login and try again.");

      const res = await fetch(`/api/admin/generate-storage-invoice-test`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          userId: storageTestUserId,
          month: storageTestMonth,
        }),
      });

      const payload = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        throw new Error(payload?.details || payload?.error || "Failed to generate storage invoice");
      }

      toast({
        title: "Storage Invoice Generated",
        description: payload?.invoiceNumber ? `Created ${payload.invoiceNumber}` : "Invoice generation completed.",
      });

      setIsStorageTestDialogOpen(false);
      await loadInvoices();
    } catch (error: any) {
      console.error("Storage test invoice generation failed:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to generate storage invoice.",
      });
    } finally {
      setIsGeneratingStorageTest(false);
    }
  };

  // Load all commissions
  const loadCommissions = async () => {
    setCommissionsLoading(true);
    try {
      // Check if user is admin before attempting to load
      if (!adminUser || (!hasRole(adminUser, "admin") && !hasRole(adminUser, "sub_admin"))) {
        console.warn('User is not an admin, skipping commissions load');
        setCommissions([]);
        setCommissionsLoading(false);
        return;
      }

      const commissionsQuery = query(
        collection(db, "commissions"),
        orderBy('createdAt', 'desc')
      );
      const snapshot = await getDocs(commissionsQuery);
      
      const commissionsData = snapshot.docs.map(doc => ({
        ...doc.data() as Commission,
        id: doc.id,
      }));
      
      setCommissions(commissionsData);
      console.log('Commissions loaded successfully:', commissionsData.length);
    } catch (error: any) {
      console.error('Error loading commissions:', error);
      console.error('Error code:', error?.code);
      console.error('Error message:', error?.message);
      toast({
        variant: "destructive",
        title: "Error",
        description: `Failed to load commissions: ${error?.message || 'Unknown error'}`,
      });
    } finally {
      setCommissionsLoading(false);
    }
  };

  useEffect(() => {
    loadInvoices();
    loadCommissions();
  }, [users]);

  // Keep the opened user-invoices dialog in sync after refreshes (e.g. mark as paid).
  useEffect(() => {
    if (!selectedUser) return;
    const list = userInvoices[selectedUser.uid] || [];
    setSelectedUserInvoices(list);
  }, [selectedUser, userInvoices]);

  // Calculate summary for each user
  const userSummaries: UserInvoiceSummary[] = users.map(user => {
    const invoices = userInvoices[user.uid] || [];
    const pendingCount = invoices.filter(inv => inv.status === 'pending').length;
    const paidCount = invoices.filter(inv => inv.status === 'paid').length;
    const totalAmount = invoices
      .filter(inv => inv.status === 'pending')
      .reduce((sum, inv) => sum + inv.grandTotal, 0);
    
    return {
      user,
      pendingCount,
      paidCount,
      totalAmount,
    };
  });

  // Filter users based on search and invoice status, pin admin first, then sort A-Z
  const filteredUsers = (() => {
    const filtered = userSummaries.filter(({ user, pendingCount, paidCount }) => {
      // Search filter
      const matchesSearch = 
        user.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchTerm.toLowerCase());
      
      if (!matchesSearch) return false;
      
      // Invoice status filter
      if (userFilterTab === "unpaid") {
        return pendingCount > 0; // Users with unpaid (pending) invoices
      } else if (userFilterTab === "paid") {
        return paidCount > 0; // Users with paid invoices
      }
      
      return true; // "all" - show all users
    });
    
    // Separate admin and other users
    const admin = filtered.find(({ user }) => user.uid === adminUser?.uid);
    const others = filtered.filter(({ user }) => user.uid !== adminUser?.uid);
    
    // Sort others A-Z by user name
    const sortedOthers = others.sort((a, b) => {
      const nameA = (a.user.name || '').toLowerCase();
      const nameB = (b.user.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    // Pin admin first, then others
    return admin ? [admin, ...sortedOthers] : sortedOthers;
  })();

  // Reset users page when filter or search changes
  useEffect(() => {
    setUsersPage(1);
  }, [searchTerm, userFilterTab]);

  const handleViewUserInvoices = async (user: UserProfile) => {
    setSelectedUser(user);
    // Always show latest first
    const list = userInvoices[user.uid] || [];
    const getInvoiceSortTime = (inv: any) => {
      const createdAt = inv?.createdAt;
      if (createdAt) {
        if (typeof createdAt === "string") {
          const t = new Date(createdAt).getTime();
          if (!Number.isNaN(t)) return t;
        }
        if (typeof createdAt === "object" && typeof createdAt.seconds === "number") {
          return createdAt.seconds * 1000;
        }
        if (createdAt instanceof Date) {
          return createdAt.getTime();
        }
      }
      const t2 = inv?.date ? new Date(inv.date).getTime() : 0;
      return Number.isNaN(t2) ? 0 : t2;
    };
    setSelectedUserInvoices([...list].sort((a: any, b: any) => getInvoiceSortTime(b) - getInvoiceSortTime(a)));
    setIsDetailDialogOpen(true);
    // Reset date filters and tab when opening a new user's invoices
    setStartDate("");
    setEndDate("");
    setActiveTab("pending");
    setCurrentPage(1);
  };

  // Filter invoices based on date range
  const getFilteredInvoices = (invoices: Invoice[]) => {
    if (!startDate && !endDate) return invoices;
    
    return invoices.filter(invoice => {
      const invoiceDate = new Date(invoice.date);
      const start = startDate ? new Date(startDate) : null;
      const end = endDate ? new Date(endDate) : null;
      
      if (start && end) {
        return invoiceDate >= start && invoiceDate <= end;
      } else if (start) {
        return invoiceDate >= start;
      } else if (end) {
        return invoiceDate <= end;
      }
      return true;
    }).sort((a: any, b: any) => {
      // Keep newest first after filtering
      const getInvoiceSortTime = (inv: any) => {
        const createdAt = inv?.createdAt;
        if (createdAt) {
          if (typeof createdAt === "string") {
            const t = new Date(createdAt).getTime();
            if (!Number.isNaN(t)) return t;
          }
          if (typeof createdAt === "object" && typeof createdAt.seconds === "number") {
            return createdAt.seconds * 1000;
          }
          if (createdAt instanceof Date) {
            return createdAt.getTime();
          }
        }
        const t2 = inv?.date ? new Date(inv.date).getTime() : 0;
        return Number.isNaN(t2) ? 0 : t2;
      };
      return getInvoiceSortTime(b) - getInvoiceSortTime(a);
    });
  };

  const filteredPendingInvoices = getFilteredInvoices(selectedUserInvoices.filter(inv => inv.status === 'pending'));
  const filteredPaidInvoices = getFilteredInvoices(selectedUserInvoices.filter(inv => inv.status === 'paid'));

  // Get current tab invoices
  const getCurrentTabInvoices = () => {
    return activeTab === "pending" ? filteredPendingInvoices : filteredPaidInvoices;
  };

  const currentTabInvoices = getCurrentTabInvoices();

  // Pagination for users list
  const totalUsersPages = Math.ceil(filteredUsers.length / itemsPerPage);
  const usersStartIndex = (usersPage - 1) * itemsPerPage;
  const usersEndIndex = usersStartIndex + itemsPerPage;
  const paginatedUsers = filteredUsers.slice(usersStartIndex, usersEndIndex);

  // Pagination for invoices
  const totalPages = Math.ceil(currentTabInvoices.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedInvoices = currentTabInvoices.slice(startIndex, endIndex);

  // Reset to page 1 when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value as "pending" | "paid");
    setCurrentPage(1);
  };

  // Reset pagination when date filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [startDate, endDate]);

  const handleViewInvoice = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
    setIsViewDialogOpen(true);
  };

  const openDiscountEditor = (invoice: Invoice) => {
    setDiscountInvoice(invoice);
    const existingType = ((invoice as any).discountType as "amount" | "percent" | undefined) || "amount";
    const existingValue = (invoice as any).discountValue;
    setDiscountType(existingType);
    setDiscountValue(typeof existingValue === "number" ? String(existingValue) : "");
    setIsDiscountDialogOpen(true);
  };

  const discountPreview = useMemo(() => {
    if (!discountInvoice) {
      return {
        grossTotal: 0,
        discountAmount: 0,
        grandTotal: 0,
      };
    }

    const grossTotalRaw =
      typeof (discountInvoice as any).grossTotal === "number"
        ? (discountInvoice as any).grossTotal
        : (typeof discountInvoice.subtotal === "number"
          ? discountInvoice.subtotal
          : discountInvoice.grandTotal);

    const grossTotal = Number.isFinite(grossTotalRaw) ? grossTotalRaw : 0;
    const valueNum = parseFloat(discountValue) || 0;

    let discountAmount = 0;
    if (discountType === "percent") {
      discountAmount = grossTotal * (Math.max(0, Math.min(100, valueNum)) / 100);
    } else {
      discountAmount = Math.max(0, valueNum);
    }
    discountAmount = Math.min(grossTotal, discountAmount);

    const grandTotal = Math.max(0, grossTotal - discountAmount);
    return { grossTotal, discountAmount, grandTotal };
  }, [discountInvoice, discountType, discountValue]);

  const handleApplyDiscount = async () => {
    if (!discountInvoice) return;
    if (!discountInvoice.id) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Cannot update discount: missing invoice id.",
      });
      return;
    }

    setIsApplyingDiscount(true);
    try {
      const grossTotal = discountPreview.grossTotal;
      const discountAmount = discountPreview.discountAmount;
      const grandTotal = discountPreview.grandTotal;
      const valueNum = parseFloat(discountValue) || 0;

      const normalizedValue =
        discountType === "percent"
          ? Math.max(0, Math.min(100, valueNum))
          : Math.max(0, valueNum);

      await updateDoc(doc(db, `users/${discountInvoice.userId}/invoices/${discountInvoice.id}`), {
        grossTotal,
        discountType,
        discountValue: normalizedValue,
        discountAmount,
        grandTotal,
        updatedAt: new Date(),
      } as any);

      await loadInvoices();

      toast({
        title: "Discount Applied",
        description: `Invoice updated. New total: $${grandTotal.toFixed(2)}`,
      });

      setIsDiscountDialogOpen(false);
      setDiscountInvoice(null);
      setDiscountValue("");
    } catch (error: any) {
      console.error("Error applying discount:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error?.message || "Failed to apply discount.",
      });
    } finally {
      setIsApplyingDiscount(false);
    }
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
      const ownerUserId = invoice.userId || selectedUser?.uid;
      const invoiceDocId = invoice.id || invoiceId;
      if (!ownerUserId || !invoiceDocId) {
        throw new Error("Missing invoice owner or invoice id.");
      }

      // Find the user who owns this invoice
      const ownerUser = users.find(u => u.uid === ownerUserId);

      await updateDoc(doc(db, `users/${ownerUserId}/invoices/${invoiceDocId}`), {
        status: 'paid',
      });
      
      // Create commission if user was referred by an agent
      if (ownerUser && invoice.status === 'pending') {
        try {
          // Ensure invoice has id field
          const invoiceWithId = { ...invoice, id: invoiceDocId, userId: ownerUserId };
          await createCommissionForInvoice(invoiceWithId, ownerUser);
          // Refresh both commissions and invoices after creating commission
          await Promise.all([
            loadCommissions(), // Refresh commissions after creating
            loadInvoices(),    // Refresh invoices list
          ]);
        } catch (commissionError) {
          console.error("Error creating commission:", commissionError);
          // Don't fail the whole operation if commission creation fails
        }
      } else {
        // If no commission created, just refresh invoices
        await loadInvoices(); // Refresh UI
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

  const handleMarkCommissionAsPaid = async (commissionId: string, commission: Commission) => {
    try {
      await updateDoc(doc(db, `commissions/${commissionId}`), {
        status: 'paid',
        paidAt: new Date(),
        paidBy: adminUser?.uid || 'admin',
      });
      
      toast({
        title: "Commission Marked as Paid",
        description: "Commission status has been updated.",
      });
      
      // Refresh both commissions and invoices to update all sections
      await Promise.all([
        loadCommissions(), // Refresh commissions list
        loadInvoices(),    // Refresh invoices list (paid invoices section)
      ]);
    } catch (error) {
      console.error("Error updating commission:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to update commission status.",
      });
    }
  };

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    if (typeof date === 'string') return new Date(date).toLocaleDateString();
    return new Date(date.seconds * 1000).toLocaleDateString();
  };

  // Filter commissions by status
  const pendingCommissions = commissions.filter(c => c.status === 'pending');
  const paidCommissions = commissions.filter(c => c.status === 'paid');
  const currentCommissions = commissionTab === 'pending' ? pendingCommissions : paidCommissions;
  
  // Pagination for commissions
  const commissionStartIndex = (commissionPage - 1) * itemsPerPage;
  const commissionEndIndex = commissionStartIndex + itemsPerPage;
  const paginatedCommissions = currentCommissions.slice(commissionStartIndex, commissionEndIndex);
  const totalCommissionPages = Math.ceil(currentCommissions.length / itemsPerPage);

  return (
    <div className="space-y-6">
      {/* Main Tabs: Invoices and Commissions */}
      <Tabs value={mainTab} onValueChange={(value) => setMainTab(value as "invoices" | "commissions")} className="w-full">
        <TabsList className="grid grid-cols-2 w-full mb-6">
          <TabsTrigger value="invoices" className="flex items-center gap-2">
            <Receipt className="h-4 w-4" />
            Invoices
          </TabsTrigger>
          <TabsTrigger value="commissions" className="flex items-center gap-2">
            <DollarSign className="h-4 w-4" />
            Commissions
            {pendingCommissions.length > 0 && (
              <Badge variant="secondary" className="ml-1">{pendingCommissions.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices" className="space-y-6">
          {/* Search Bar */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Invoice Management
                  </CardTitle>
                  <CardDescription>View user invoices and payment status</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary" className="text-yellow-600 bg-yellow-100 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2">
                    Total Pending: {userSummaries.reduce((sum, s) => sum + s.pendingCount, 0)}
                  </Badge>
                  <Badge variant="default" className="text-green-600 bg-green-100 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2">
                    Total Paid: {userSummaries.reduce((sum, s) => sum + s.paidCount, 0)}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    onClick={() => setIsStorageTestDialogOpen(true)}
                  >
                    <Receipt className="h-4 w-4 mr-2" />
                    Generate Storage Invoice (Test)
                  </Button>
                </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value);
                  setUsersPage(1);
                }}
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

            {/* Filter Tabs */}
            <Tabs value={userFilterTab} onValueChange={(value) => {
              setUserFilterTab(value as "all" | "unpaid" | "paid");
              setUsersPage(1);
            }} className="w-full">
              <TabsList className="grid w-full grid-cols-3 h-12 p-1 rounded-xl bg-slate-100/90 border">
                <TabsTrigger
                  value="all"
                  className="rounded-lg font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-slate-700 data-[state=active]:shadow-sm"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Users className="h-4 w-4" />
                    <span>All Users</span>
                    <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
                      {userSummaries.length}
                    </span>
                  </div>
                </TabsTrigger>
                <TabsTrigger
                  value="unpaid"
                  className="rounded-lg font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-amber-700 data-[state=active]:shadow-sm"
                >
                  <div className="flex items-center justify-center gap-2">
                    <Clock className="h-4 w-4" />
                    <span>Unpaid Invoices</span>
                    <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                      {userSummaries.filter(({ pendingCount }) => pendingCount > 0).length}
                    </span>
                  </div>
                </TabsTrigger>
                <TabsTrigger
                  value="paid"
                  className="rounded-lg font-medium transition-all data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm"
                >
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    <span>Paid Invoices</span>
                    <span className="inline-flex min-w-[1.6rem] items-center justify-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                      {userSummaries.filter(({ paidCount }) => paidCount > 0).length}
                    </span>
                  </div>
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </CardContent>
      </Card>

      {/* Users List */}
      <Card>
        <CardHeader>
          <CardTitle>Users ({filteredUsers.length})</CardTitle>
          <CardDescription>Click on a user to view their invoices</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : filteredUsers.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {paginatedUsers.map(({ user, pendingCount, paidCount, totalAmount }, idx) => (
                <Card 
                  key={`${user.uid || user.email || 'user'}-${idx}`}
                  className="cursor-pointer transition-all hover:shadow-md hover:border-primary"
                  onClick={() => handleViewUserInvoices(user)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-lg">{formatUserDisplayName(user, { showEmail: false })}</CardTitle>
                        <CardDescription className="mt-1">{user.email}</CardDescription>
                      </div>
                      {pendingCount > 0 && (
                        <Badge variant="destructive" className="h-6 w-6 flex items-center justify-center">
                          {pendingCount}
                        </Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Pending Invoices:</span>
                        <Badge variant={pendingCount > 0 ? "secondary" : "outline"}>
                          {pendingCount}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Paid Invoices:</span>
                        <Badge variant="default" className="bg-green-100 text-green-800">
                          {paidCount}
                        </Badge>
                      </div>
                      {pendingCount > 0 && (
                        <div className="flex items-center justify-between text-sm pt-2 border-t">
                          <span className="font-semibold">Pending Amount:</span>
                          <span className="font-bold text-yellow-600">${totalAmount.toFixed(2)}</span>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <Users className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">No users found</h3>
              <p className="text-muted-foreground">
                {users.length === 0 ? "No users available." : "No users match your search."}
              </p>
            </div>
          )}

          {/* Pagination Controls for Users */}
          {filteredUsers.length > itemsPerPage && (
            <div className="flex items-center justify-between mt-6 pt-4 border-t">
              <div className="text-sm text-muted-foreground">
                Showing {usersStartIndex + 1} to {Math.min(usersEndIndex, filteredUsers.length)} of {filteredUsers.length} users
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUsersPage(p => Math.max(1, p - 1))}
                  disabled={usersPage === 1}
                >
                  Previous
                </Button>
                <span className="text-sm">
                  Page {usersPage} of {totalUsersPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setUsersPage(p => Math.min(totalUsersPages, p + 1))}
                  disabled={usersPage === totalUsersPages}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* User Invoices Detail Dialog */}
      <Dialog open={isDetailDialogOpen} onOpenChange={setIsDetailDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] sm:max-h-[90vh] h-[100dvh] sm:h-auto overflow-y-auto p-4 sm:p-6">
          <DialogHeader className="pb-2 sm:pb-4">
            <DialogTitle className="flex items-center gap-2 text-base sm:text-lg">
              <Receipt className="h-4 w-4 sm:h-5 sm:w-5" />
              {selectedUser?.name}'s Invoices
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              View and manage all invoices for {selectedUser?.name}
            </DialogDescription>
          </DialogHeader>
          
          {selectedUser && (
            <div className="space-y-4 sm:space-y-6 mt-2 sm:mt-4">
              {/* User Info */}
              <div className="p-3 sm:p-4 bg-muted rounded-lg">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">Name</p>
                    <p className="font-semibold text-sm sm:text-base break-words">{selectedUser.name}</p>
                  </div>
                  <div>
                    <p className="text-xs sm:text-sm text-muted-foreground">Email</p>
                    <p className="font-semibold text-sm sm:text-base break-all">{selectedUser.email}</p>
                  </div>
                </div>
              </div>

              {/* Date Range Filter */}
              <div className="p-3 sm:p-4 border rounded-lg space-y-3">
                <h4 className="font-semibold text-xs sm:text-sm">Filter by Date Range</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-xs sm:text-sm text-muted-foreground">From Date</label>
                    <Input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="w-full text-sm"
                    />
                  </div>
                  <div className="space-y-1.5 sm:space-y-2">
                    <label className="text-xs sm:text-sm text-muted-foreground">To Date</label>
                    <Input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="w-full text-sm"
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
                    }}
                    className="w-full text-xs sm:text-sm"
                  >
                    Clear Filter
                  </Button>
                )}
              </div>

              {/* Invoices with Tabs */}
              {selectedUserInvoices.length > 0 ? (
                <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                  <TabsList className="grid grid-cols-2 w-full">
                    <TabsTrigger value="pending" className="flex items-center justify-center gap-2">
                      <Clock className="h-4 w-4" />
                      <span>Pending</span>
                      <Badge variant="secondary" className="text-xs">{filteredPendingInvoices.length}</Badge>
                    </TabsTrigger>
                    <TabsTrigger value="paid" className="flex items-center justify-center gap-2">
                      <CheckCircle className="h-4 w-4" />
                      <span>Paid</span>
                      <Badge variant="secondary" className="text-xs">{filteredPaidInvoices.length}</Badge>
                    </TabsTrigger>
                  </TabsList>

                  <TabsContent value="pending" className="mt-6">
                    {currentTabInvoices.length > 0 ? (
                      <>
                        <div className="space-y-2 sm:space-y-3">
                          {paginatedInvoices.map((invoice) => (
                            <div key={invoice.id || `${invoice.invoiceNumber}-${invoice.date}`} className="flex flex-col gap-2.5 sm:gap-3 p-3 sm:p-4 border rounded-lg bg-yellow-50">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 sm:mb-2 flex-wrap">
                                  <h4 className="font-semibold text-xs sm:text-base truncate">{invoice.invoiceNumber}</h4>
                                  <Badge variant="secondary" className="text-[9px] sm:text-xs shrink-0">Pending</Badge>
                                </div>
                                <div className="text-xs sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
                                  <p>Date: {invoice.date}</p>
                                  <p className="font-semibold text-sm sm:text-lg">Total: ${invoice.grandTotal.toFixed(2)}</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2 w-full">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full text-xs sm:text-sm h-8 sm:h-9"
                                  onClick={() => handleViewInvoice(invoice)}
                                >
                                  <Eye className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                                  <span className="hidden sm:inline">View</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full text-xs sm:text-sm h-8 sm:h-9"
                                  onClick={() => handleDownloadInvoice(invoice)}
                                >
                                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                                  <span className="hidden sm:inline">Download</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="col-span-2 w-full text-xs sm:text-sm h-8 sm:h-9"
                                  onClick={() => openDiscountEditor(invoice)}
                                >
                                  <DollarSign className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                                  Discount
                                </Button>
                                <Button
                                  variant="default"
                                  size="sm"
                                  className="col-span-2 w-full text-xs sm:text-sm h-8 sm:h-9"
                                  onClick={() => handleMarkAsPaid(invoice.id, invoice)}
                                >
                                  Mark as Paid
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                        
                        {/* Pagination */}
                        {currentTabInvoices.length > itemsPerPage && (
                          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 mt-6 pt-4 border-t">
                            <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                              Showing {startIndex + 1} to {Math.min(endIndex, currentTabInvoices.length)} of {currentTabInvoices.length} invoices
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs sm:text-sm h-8 sm:h-9"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                              >
                                Previous
                              </Button>
                              <span className="text-xs sm:text-sm">
                                Page {currentPage} of {totalPages}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs sm:text-sm h-8 sm:h-9"
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
                      <div className="text-center py-8 sm:py-12">
                        <Clock className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-3 sm:mb-4" />
                        <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2">No pending invoices</h3>
                        <p className="text-xs sm:text-sm text-muted-foreground">This user has no pending invoices.</p>
                      </div>
                    )}
                  </TabsContent>

                  <TabsContent value="paid" className="mt-6">
                    {currentTabInvoices.length > 0 ? (
                      <>
                        <div className="space-y-2 sm:space-y-3">
                          {paginatedInvoices.map((invoice) => (
                            <div key={invoice.id || `${invoice.invoiceNumber}-${invoice.date}`} className="flex flex-col gap-2.5 sm:gap-3 p-3 sm:p-4 border rounded-lg bg-green-50">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 sm:mb-2 flex-wrap">
                                  <h4 className="font-semibold text-xs sm:text-base truncate">{invoice.invoiceNumber}</h4>
                                  <Badge variant="default" className="bg-green-100 text-green-800 text-[9px] sm:text-xs shrink-0">Paid</Badge>
                                </div>
                                <div className="text-xs sm:text-sm text-muted-foreground space-y-0.5 sm:space-y-1">
                                  <p>Date: {invoice.date}</p>
                                  <p className="font-semibold text-sm sm:text-lg">Total: ${invoice.grandTotal.toFixed(2)}</p>
                                </div>
                              </div>
                              <div className="grid grid-cols-2 gap-2 w-full">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full text-xs sm:text-sm h-8 sm:h-9"
                                  onClick={() => handleViewInvoice(invoice)}
                                >
                                  <Eye className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                                  <span className="hidden sm:inline">View</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="w-full text-xs sm:text-sm h-8 sm:h-9"
                                  onClick={() => handleDownloadInvoice(invoice)}
                                >
                                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                                  <span className="hidden sm:inline">Download</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="col-span-2 w-full text-xs sm:text-sm h-8 sm:h-9"
                                  onClick={() => openDiscountEditor(invoice)}
                                >
                                  <DollarSign className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                                  Discount
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                        
                        {/* Pagination */}
                        {currentTabInvoices.length > itemsPerPage && (
                          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-0 mt-6 pt-4 border-t">
                            <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                              Showing {startIndex + 1} to {Math.min(endIndex, currentTabInvoices.length)} of {currentTabInvoices.length} invoices
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs sm:text-sm h-8 sm:h-9"
                                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                disabled={currentPage === 1}
                              >
                                Previous
                              </Button>
                              <span className="text-xs sm:text-sm">
                                Page {currentPage} of {totalPages}
                              </span>
                              <Button
                                variant="outline"
                                size="sm"
                                className="text-xs sm:text-sm h-8 sm:h-9"
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
                      <div className="text-center py-8 sm:py-12">
                        <CheckCircle className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-3 sm:mb-4" />
                        <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2">No paid invoices</h3>
                        <p className="text-xs sm:text-sm text-muted-foreground">This user has no paid invoices.</p>
                      </div>
                    )}
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="text-center py-8 sm:py-12">
                  <Receipt className="h-12 w-12 sm:h-16 sm:w-16 text-muted-foreground mx-auto mb-3 sm:mb-4" />
                  <h3 className="text-sm sm:text-lg font-semibold mb-1 sm:mb-2">No invoices found</h3>
                  <p className="text-xs sm:text-sm text-muted-foreground">This user has no invoices yet.</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* View Invoice Detail Dialog */}
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
                          : (((item as any).shipDate) || '-');
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
              <div className="flex justify-end gap-2 pt-3 sm:pt-4 border-t">
                <Button
                  variant="outline"
                  size="sm"
                  className="text-xs sm:text-sm h-8 sm:h-9 w-full sm:w-auto"
                  onClick={() => selectedInvoice && handleDownloadInvoice(selectedInvoice)}
                >
                  <Download className="h-3 w-3 sm:h-4 sm:w-4 mr-1 sm:mr-2" />
                  Download PDF
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Discount Dialog */}
      <Dialog open={isDiscountDialogOpen} onOpenChange={(open) => {
        setIsDiscountDialogOpen(open);
        if (!open) {
          setDiscountInvoice(null);
          setDiscountValue("");
          setDiscountType("amount");
        }
      }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Apply Discount</DialogTitle>
            <DialogDescription>
              Update an already-generated invoice by applying a discount (amount or percentage). This will update the invoice totals and PDF.
            </DialogDescription>
          </DialogHeader>

          {discountInvoice && (
            <div className="space-y-4">
              <div className="p-3 rounded-lg bg-muted/40 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Invoice</span>
                  <span className="font-medium">{discountInvoice.invoiceNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Gross Total</span>
                  <span className="font-medium">${discountPreview.grossTotal.toFixed(2)}</span>
                </div>
              </div>

              <Tabs value={discountType} onValueChange={(v) => setDiscountType(v as any)} className="w-full">
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="amount">Amount ($)</TabsTrigger>
                  <TabsTrigger value="percent">Percentage (%)</TabsTrigger>
                </TabsList>

                <TabsContent value="amount" className="mt-4">
                  <Label>Discount Amount ($)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder="0.00"
                  />
                </TabsContent>

                <TabsContent value="percent" className="mt-4">
                  <Label>Discount Percentage (%)</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    value={discountValue}
                    onChange={(e) => setDiscountValue(e.target.value)}
                    placeholder="0"
                  />
                </TabsContent>
              </Tabs>

              <div className="p-3 rounded-lg bg-muted/40 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Discount</span>
                  <span className="font-medium">-${discountPreview.discountAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Grand Total</span>
                  <span className="font-semibold">${discountPreview.grandTotal.toFixed(2)}</span>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  className="flex-1"
                  onClick={handleApplyDiscount}
                  disabled={isApplyingDiscount || !discountInvoice}
                >
                  {isApplyingDiscount ? "Saving..." : "Apply Discount"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setIsDiscountDialogOpen(false)}
                  disabled={isApplyingDiscount}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

        </TabsContent>

        <TabsContent value="commissions" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <DollarSign className="h-5 w-5" />
                    Commission Management
                  </CardTitle>
                  <CardDescription>View and manage commission payments to agents</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary" className="text-yellow-600 bg-yellow-100 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2">
                    Pending: ${pendingCommissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0).toFixed(2)}
                  </Badge>
                  <Badge variant="default" className="text-green-600 bg-green-100 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2">
                    Paid: ${paidCommissions.reduce((sum, c) => sum + (c.commissionAmount || 0), 0).toFixed(2)}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Tabs value={commissionTab} onValueChange={(value) => {
                setCommissionTab(value as "pending" | "paid");
                setCommissionPage(1);
              }} className="w-full">
                <TabsList className="grid grid-cols-2 w-full mb-6">
                  <TabsTrigger value="pending" className="flex items-center justify-center gap-2">
                    <Clock className="h-4 w-4" />
                    Pending Commissions
                    <Badge variant="secondary" className="text-xs">{pendingCommissions.length}</Badge>
                  </TabsTrigger>
                  <TabsTrigger value="paid" className="flex items-center justify-center gap-2">
                    <CheckCircle className="h-4 w-4" />
                    Paid Commissions
                    <Badge variant="secondary" className="text-xs">{paidCommissions.length}</Badge>
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="pending" className="mt-6">
                  {commissionsLoading ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Loading commissions...</p>
                    </div>
                  ) : paginatedCommissions.length > 0 ? (
                    <>
                      <div className="space-y-3">
                        {paginatedCommissions.map((commission) => {
                          const client = users.find(u => u.uid === commission.clientId);
                          return (
                            <Card key={commission.id} className="border-yellow-200 bg-yellow-50/50">
                              <CardContent className="p-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                  <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-semibold text-sm sm:text-base">Agent: {commission.agentName}</h4>
                                      <Badge variant="secondary" className="text-xs">Pending</Badge>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
                                      <div>
                                        <span className="text-muted-foreground">Client:</span>
                                        <p className="font-medium">{client?.name || commission.clientName || "Unknown"}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Invoice #:</span>
                                        <p className="font-mono font-medium">{commission.invoiceNumber}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Invoice Amount:</span>
                                        <p className="font-medium">${commission.invoiceAmount.toFixed(2)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Commission (10%):</span>
                                        <p className="font-bold text-lg text-yellow-700">${commission.commissionAmount.toFixed(2)}</p>
                                      </div>
                                      <div className="sm:col-span-2">
                                        <span className="text-muted-foreground">Created:</span>
                                        <p className="text-xs">{formatDate(commission.createdAt)}</p>
                                      </div>
                                    </div>
                                  </div>
                                  {commissionTab === 'pending' && (
                                    <Button
                                      variant="default"
                                      size="sm"
                                      onClick={() => handleMarkCommissionAsPaid(commission.id, commission)}
                                      className="w-full sm:w-auto bg-green-600 hover:bg-green-700"
                                    >
                                      <CheckCircle className="h-4 w-4 mr-2" />
                                      Mark as Paid
                                    </Button>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                      
                      {totalCommissionPages > 1 && (
                        <div className="flex items-center justify-between mt-6 pt-4 border-t">
                          <div className="text-sm text-muted-foreground">
                            Showing {commissionStartIndex + 1} to {Math.min(commissionEndIndex, currentCommissions.length)} of {currentCommissions.length} commissions
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCommissionPage(p => Math.max(1, p - 1))}
                              disabled={commissionPage === 1}
                            >
                              Previous
                            </Button>
                            <span className="text-sm">
                              Page {commissionPage} of {totalCommissionPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCommissionPage(p => Math.min(totalCommissionPages, p + 1))}
                              disabled={commissionPage === totalCommissionPages}
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <DollarSign className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                      <h3 className="text-lg font-semibold mb-2">No {commissionTab === 'pending' ? 'Pending' : 'Paid'} Commissions</h3>
                      <p className="text-muted-foreground">
                        {commissionTab === 'pending' 
                          ? "All commissions have been paid." 
                          : "No commissions have been paid yet."}
                      </p>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="paid" className="mt-6">
                  {commissionsLoading ? (
                    <div className="text-center py-12">
                      <p className="text-muted-foreground">Loading commissions...</p>
                    </div>
                  ) : paginatedCommissions.length > 0 ? (
                    <>
                      <div className="space-y-3">
                        {paginatedCommissions.map((commission) => {
                          const client = users.find(u => u.uid === commission.clientId);
                          return (
                            <Card key={commission.id} className="border-green-200 bg-green-50/50">
                              <CardContent className="p-4">
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                                  <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <h4 className="font-semibold text-sm sm:text-base">Agent: {commission.agentName}</h4>
                                      <Badge variant="default" className="text-xs bg-green-600">Paid</Badge>
                                    </div>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs sm:text-sm">
                                      <div>
                                        <span className="text-muted-foreground">Client:</span>
                                        <p className="font-medium">{client?.name || commission.clientName || "Unknown"}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Invoice #:</span>
                                        <p className="font-mono font-medium">{commission.invoiceNumber}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Invoice Amount:</span>
                                        <p className="font-medium">${commission.invoiceAmount.toFixed(2)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Commission (10%):</span>
                                        <p className="font-bold text-lg text-green-700">${commission.commissionAmount.toFixed(2)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Paid On:</span>
                                        <p className="text-xs">{formatDate(commission.paidAt)}</p>
                                      </div>
                                      <div>
                                        <span className="text-muted-foreground">Created:</span>
                                        <p className="text-xs">{formatDate(commission.createdAt)}</p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                      
                      {totalCommissionPages > 1 && (
                        <div className="flex items-center justify-between mt-6 pt-4 border-t">
                          <div className="text-sm text-muted-foreground">
                            Showing {commissionStartIndex + 1} to {Math.min(commissionEndIndex, currentCommissions.length)} of {currentCommissions.length} commissions
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCommissionPage(p => Math.max(1, p - 1))}
                              disabled={commissionPage === 1}
                            >
                              Previous
                            </Button>
                            <span className="text-sm">
                              Page {commissionPage} of {totalCommissionPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setCommissionPage(p => Math.min(totalCommissionPages, p + 1))}
                              disabled={commissionPage === totalCommissionPages}
                            >
                              Next
                            </Button>
                          </div>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-12">
                      <DollarSign className="h-16 w-16 text-muted-foreground mx-auto mb-4 opacity-50" />
                      <h3 className="text-lg font-semibold mb-2">No Paid Commissions</h3>
                      <p className="text-muted-foreground">
                        No commissions have been paid yet.
                      </p>
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Generate Storage Invoice (Test) */}
      <Dialog open={isStorageTestDialogOpen} onOpenChange={setIsStorageTestDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Generate Storage Invoice (Test)</DialogTitle>
            <DialogDescription>
              Creates a test storage invoice for review (does not overwrite existing invoices).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>User</Label>
              <Select value={storageTestUserId} onValueChange={setStorageTestUserId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a user..." />
                </SelectTrigger>
                <SelectContent>
                  {users.map((u) => (
                    <SelectItem key={u.uid} value={u.uid}>
                      {formatUserDisplayName(u, { showEmail: true })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Month</Label>
                <Input
                  type="month"
                  value={storageTestMonth}
                  onChange={(e) => setStorageTestMonth(e.target.value)}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                onClick={() => setIsStorageTestDialogOpen(false)}
                disabled={isGeneratingStorageTest}
              >
                Cancel
              </Button>
              <Button
                onClick={handleGenerateStorageTestInvoice}
                disabled={!storageTestUserId || isGeneratingStorageTest}
              >
                {isGeneratingStorageTest ? "Generating..." : "Generate"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}