"use client";

import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollectionGroup } from "@/hooks/use-collection";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { doc, updateDoc, Timestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "@/lib/firebase";
import { FileText, Upload, Loader2, CheckCircle, Clock, Download, User, Search, FileStack, CalendarCheck, FileSignature, BookOpen } from "lucide-react";
import { format, subDays } from "date-fns";
import { generateSignedMsaPdfForUser } from "@/lib/signed-msa-pdf";
import { formatPlatformVersionLabel } from "@/lib/platform-document-control";
import { getAcceptedMsaVersion } from "@/lib/document-version-utils";
import { generateFulfillmentAgreementPDF } from "@/lib/fulfillment-agreement-pdf-generator";
import { generatePartnershipAgreementPDF } from "@/lib/partnership-agreement-pdf-generator";
import type { UserProfile } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CUSTOM_DOCUMENT_REQUEST_LABEL } from "@/lib/document-request-labels";
import { PlatformDocumentsManagement } from "@/components/admin/platform-documents-management";
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateList,
} from "@/components/ui/list-pagination";

interface DocumentRequest {
  id: string;
  userId: string;
  documentType: string;
  status: "pending" | "complete" | "rejected";
  requestedAt: any;
  completedAt?: any;
  documentUrl?: string;
  fileName?: string;
  notes?: string;
  companyName?: string;
  contact?: string;
  email?: string;
  userEmail?: string;
  userName?: string;
  clientLegalName?: string;
  decisionType?: "approved" | "uploaded";
  partnerAgencyName?: string;
  address?: string;
  phone?: string;
  partnerAuthorizedName?: string;
  partnerTitle?: string;
  customDocumentBrief?: string;
}

export default function DocumentRequestsPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<DocumentRequest | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [approvingRequestId, setApprovingRequestId] = useState<string | null>(null);
  const [msaDownloadingUid, setMsaDownloadingUid] = useState<string | null>(null);

  // Get all document requests using collectionGroup
  const { data: allRequests, loading } = useCollectionGroup<DocumentRequest>(
    "documentRequests"
  );

  const { managedUsers: users, managedUserIds } = useManagedUsers();
  const scopedRequests = useMemo(() => {
    if (managedUserIds === null) return allRequests;
    const set = new Set(managedUserIds);
    return allRequests.filter((r) => set.has(r.userId));
  }, [allRequests, managedUserIds]);

  const requestsWithUserData = scopedRequests.map((request) => {
    const user = users.find((u: any) => u.uid === request.userId);
    return {
      ...request,
      userName: user?.name || "Unknown User",
      userEmail: user?.email || "Unknown Email",
    };
  });

  const pendingRequests = requestsWithUserData.filter((req) => req.status === "pending");
  const completedRequests = requestsWithUserData.filter((req) => req.status === "complete");

  // Stat: completed in the last 7 days
  const processedThisWeek = useMemo(() => {
    const weekAgo = subDays(new Date(), 7).getTime();
    return completedRequests.filter((req) => {
      const ms = req.completedAt?.seconds != null ? req.completedAt.seconds * 1000 : 0;
      return ms >= weekAgo;
    }).length;
  }, [completedRequests]);

  // Unique companies for company filter ("All companies" + list of company names)
  const companyOptions = useMemo(() => {
    const companies = new Set<string>();
    requestsWithUserData.forEach((r) => {
      const name = (r.companyName || "").trim();
      if (name) companies.add(name);
    });
    return Array.from(companies).sort((a, b) => a.localeCompare(b));
  }, [requestsWithUserData]);

  // Unique client names (requesters) for client filter ("All clients" + list of names)
  const clientNameOptions = useMemo(() => {
    const names = new Set<string>();
    requestsWithUserData.forEach((r) => {
      const name = (r.userName || "").trim();
      if (name) names.add(name);
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [requestsWithUserData]);

  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCompany, setSelectedCompany] = useState<string>("all");
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [selectedDocumentType, setSelectedDocumentType] = useState<string>("all");
  const [selectedDateRange, setSelectedDateRange] = useState<string>("all");
  const [activeTab, setActiveTab] = useState<string>("pending");
  const [managementTab, setManagementTab] = useState<string>("requests");
  const [msaSearchQuery, setMsaSearchQuery] = useState("");
  const [msaSelectedCompany, setMsaSelectedCompany] = useState<string>("all");
  const [msaDateFilter, setMsaDateFilter] = useState<string>("all");
  const [msaVersionFilter, setMsaVersionFilter] = useState<string>("all");
  const [msaSortOrder, setMsaSortOrder] = useState<
    "newest" | "oldest" | "name_asc" | "name_desc"
  >("newest");
  const [msaPage, setMsaPage] = useState(1);
  const [requestsPage, setRequestsPage] = useState(1);

  // Search matches: documentType, userName, userEmail, companyName, contact, email, notes
  const matchesSearch = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return () => true;
    return (req: typeof requestsWithUserData[0]) => {
      const str = [
        req.documentType,
        req.userName,
        req.userEmail,
        req.companyName,
        req.contact,
        req.email,
        req.notes,
        req.customDocumentBrief,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return str.includes(q);
    };
  }, [searchQuery]);

  const filteredPending = useMemo(() => {
    let list = pendingRequests;
    if (selectedCompany !== "all") {
      list = list.filter((r) => (r.companyName || "").trim() === selectedCompany);
    }
    if (selectedClient !== "all") {
      list = list.filter((r) => (r.userName || "").trim() === selectedClient);
    }
    if (selectedDocumentType !== "all") {
      list = list.filter((r) => (r.documentType || "").trim() === selectedDocumentType);
    }
    if (selectedDateRange !== "all") {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      list = list.filter((r) => {
        const ms = r.requestedAt?.seconds != null ? r.requestedAt.seconds * 1000 : 0;
        if (!ms) return false;
        const diffDays = Math.floor((now - ms) / dayMs);
        if (selectedDateRange === "today") return diffDays === 0;
        if (selectedDateRange === "week") return diffDays <= 7;
        if (selectedDateRange === "month") return diffDays <= 30;
        return true;
      });
    }
    return list.filter(matchesSearch);
  }, [pendingRequests, selectedCompany, selectedClient, selectedDocumentType, selectedDateRange, matchesSearch]);

  const filteredCompleted = useMemo(() => {
    let list = completedRequests;
    if (selectedCompany !== "all") {
      list = list.filter((r) => (r.companyName || "").trim() === selectedCompany);
    }
    if (selectedClient !== "all") {
      list = list.filter((r) => (r.userName || "").trim() === selectedClient);
    }
    if (selectedDocumentType !== "all") {
      list = list.filter((r) => (r.documentType || "").trim() === selectedDocumentType);
    }
    if (selectedDateRange !== "all") {
      const now = Date.now();
      const dayMs = 24 * 60 * 60 * 1000;
      list = list.filter((r) => {
        const ms = r.requestedAt?.seconds != null ? r.requestedAt.seconds * 1000 : 0;
        if (!ms) return false;
        const diffDays = Math.floor((now - ms) / dayMs);
        if (selectedDateRange === "today") return diffDays === 0;
        if (selectedDateRange === "week") return diffDays <= 7;
        if (selectedDateRange === "month") return diffDays <= 30;
        return true;
      });
    }
    return list.filter(matchesSearch);
  }, [completedRequests, selectedCompany, selectedClient, selectedDocumentType, selectedDateRange, matchesSearch]);

  const documentTypeOptions = useMemo(() => {
    const set = new Set<string>();
    requestsWithUserData.forEach((r) => {
      const t = (r.documentType || "").trim();
      if (t) set.add(t);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [requestsWithUserData]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    selectedCompany !== "all" ||
    selectedClient !== "all" ||
    selectedDocumentType !== "all" ||
    selectedDateRange !== "all";

  const handleOpenUploadDialog = (request: DocumentRequest) => {
    setSelectedRequest(request);
    setFile(null);
    setUploadDialogOpen(true);
  };

  const handleApproveRequest = async (request: DocumentRequest) => {
    if (request.documentType === CUSTOM_DOCUMENT_REQUEST_LABEL) {
      toast({
        variant: "destructive",
        title: "Use Upload for custom requests",
        description:
          "Custom document requests do not have an auto-generated PDF. Upload the prepared document instead.",
      });
      return;
    }
    setApprovingRequestId(request.id);
    try {
      const requestRef = doc(db, `users/${request.userId}/documentRequests`, request.id);
      const completedAt = Timestamp.now();
      const completedAtStr = format(completedAt.toDate(), "MMM d, yyyy");

      const isPartnership = request.documentType === "B2B Partnership Agreement";
      let blob: Blob;
      let fileName: string;

      if (isPartnership) {
        blob = await generatePartnershipAgreementPDF({
          partnerAgencyName: request.partnerAgencyName || "[Partner / Agency Name]",
          address: request.address || "",
          email: request.email || "",
          phone: request.phone || "",
          partnerAuthorizedName: request.partnerAuthorizedName || request.userName || "Partner",
          partnerTitle: request.partnerTitle,
          completedAt: completedAtStr,
        });
        const safeName = (request.partnerAgencyName || "Partner").replace(/\s+/g, "-");
        fileName = `B2B-Partnership-Agreement-${safeName}.pdf`;
      } else {
        blob = await generateFulfillmentAgreementPDF({
          companyName: request.companyName || "(Company)",
          contact: request.contact || "",
          email: request.email || "",
          clientLegalName: request.clientLegalName || request.userName || "Client",
          completedAt: completedAtStr,
        });
        const safeCompany = (request.companyName || "Client").replace(/\s+/g, "-");
        fileName = `Fulfillment-Prep-Services-Agreement-${safeCompany}.pdf`;
      }

      const storagePath = `documentRequests/${request.userId}/${request.id}/${Date.now()}_${fileName}`;
      const storageRef = ref(storage, storagePath);
      await uploadBytes(storageRef, blob);
      const downloadURL = await getDownloadURL(storageRef);
      await updateDoc(requestRef, {
        status: "complete",
        completedAt,
        decisionType: "approved",
        documentUrl: downloadURL,
        fileName,
      });
      toast({
        title: "Request Approved",
        description: "Agreement PDF generated and the user can now view and download it.",
      });
    } catch (error: any) {
      console.error("Error approving document request:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to approve request. Please try again.",
      });
    } finally {
      setApprovingRequestId(null);
    }
  };

  const handleRejectRequest = async (request: DocumentRequest) => {
    try {
      const requestRef = doc(db, `users/${request.userId}/documentRequests`, request.id);
      await updateDoc(requestRef, {
        status: "rejected",
      });
      toast({
        title: "Request Rejected",
        description: "The document request has been rejected.",
      });
    } catch (error: any) {
      console.error("Error rejecting document request:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to reject request. Please try again.",
      });
    }
  };

  const handleUploadDocument = async () => {
    if (!selectedRequest || !file) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please select a file to upload.",
      });
      return;
    }

    setIsUploading(true);
    try {
      // Validate file type
      const allowedTypes = [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ];
      
      if (!allowedTypes.includes(file.type)) {
        throw new Error(`File type not allowed. Please upload PDF, DOC, DOCX, or TXT files.`);
      }

      // Validate file size (50MB limit)
      const maxSize = 50 * 1024 * 1024; // 50MB
      if (file.size > maxSize) {
        throw new Error(`File size exceeds 50MB limit. Please upload a smaller file.`);
      }

      // Upload file to Firebase Storage
      const storagePath = `documentRequests/${selectedRequest.userId}/${selectedRequest.id}/${Date.now()}_${file.name}`;
      const storageRef = ref(storage, storagePath);
      
      console.log("Uploading file to Firebase Storage:", storagePath);
      
      // Upload the file
      await uploadBytes(storageRef, file);
      console.log("File uploaded successfully");

      // Get download URL
      const downloadURL = await getDownloadURL(storageRef);
      console.log("Download URL obtained:", downloadURL);

      // Update document request with file URL and status
      const requestRef = doc(db, `users/${selectedRequest.userId}/documentRequests`, selectedRequest.id);
      await updateDoc(requestRef, {
        status: "complete",
        documentUrl: downloadURL,
        fileName: file.name,
        completedAt: Timestamp.now(),
        decisionType: "uploaded",
      });

      console.log("Document request updated in Firestore");

      toast({
        title: "Document Uploaded",
        description: "The document has been uploaded and is now available to the user.",
      });

      setUploadDialogOpen(false);
      setSelectedRequest(null);
      setFile(null);
    } catch (error: any) {
      console.error("Error uploading document:", error);
      
      // Handle Firebase Storage errors
      let errorMessage = "Failed to upload document. Please try again.";
      
      if (error.code) {
        switch (error.code) {
          case 'storage/unauthorized':
            errorMessage = "You don't have permission to upload files. Please contact an administrator.";
            break;
          case 'storage/canceled':
            errorMessage = "Upload was canceled. Please try again.";
            break;
          case 'storage/unknown':
            errorMessage = "An unknown error occurred during upload. Please try again.";
            break;
          case 'storage/quota-exceeded':
            errorMessage = "Storage quota exceeded. Please contact an administrator.";
            break;
          case 'storage/unauthenticated':
            errorMessage = "Please log in to upload documents.";
            break;
          default:
            errorMessage = error.message || errorMessage;
        }
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      toast({
        variant: "destructive",
        title: "Error",
        description: errorMessage,
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDownload = (url: string, fileName: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName || "document.pdf";
    link.target = "_blank";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const usersWithMSA = useMemo(
    () => users.filter((u: UserProfile) => u.msaClientDetails && u.msaEffectiveDate),
    [users]
  );

  function msaSortTimestamp(u: UserProfile): number {
    const activated = u.accountActivatedAt;
    if (activated && typeof activated === "object" && "seconds" in activated) {
      return activated.seconds * 1000;
    }
    if (activated instanceof Date) {
      return activated.getTime();
    }
    if (u.msaEffectiveDate) {
      const d = new Date(u.msaEffectiveDate);
      if (!Number.isNaN(d.getTime())) return d.getTime();
    }
    return 0;
  }

  function msaDisplayName(u: UserProfile): string {
    return (u.name || u.email || u.msaClientDetails?.companyName || "").trim();
  }

  const msaCompanyOptions = useMemo(() => {
    const companies = new Set<string>();
    usersWithMSA.forEach((u) => {
      const company = (u.msaClientDetails?.companyName || "").trim();
      if (company) companies.add(company);
    });
    return Array.from(companies).sort((a, b) => a.localeCompare(b));
  }, [usersWithMSA]);

  const msaVersionOptions = useMemo(() => {
    const versions = new Set<number>();
    usersWithMSA.forEach((u) => {
      const v = getAcceptedMsaVersion(u);
      if (v != null) versions.add(v);
    });
    return Array.from(versions).sort((a, b) => b - a);
  }, [usersWithMSA]);

  const filteredMSAUsers = useMemo(() => {
    const q = msaSearchQuery.trim().toLowerCase();
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;

    const filtered = usersWithMSA.filter((u) => {
      const company = (u.msaClientDetails?.companyName || "").trim();
      const matchesCompany = msaSelectedCompany === "all" || company === msaSelectedCompany;
      if (!matchesCompany) return false;

      if (msaVersionFilter !== "all") {
        const acceptedVersion = getAcceptedMsaVersion(u);
        if (String(acceptedVersion ?? "") !== msaVersionFilter) return false;
      }

      const matchesSearch =
        q.length === 0 ||
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q) ||
        company.toLowerCase().includes(q);
      if (!matchesSearch) return false;

      if (msaDateFilter === "all") return true;
      const effectiveDate = u.msaEffectiveDate ? new Date(u.msaEffectiveDate) : null;
      if (!effectiveDate || Number.isNaN(effectiveDate.getTime())) return false;
      const diffDays = Math.floor((now - effectiveDate.getTime()) / dayMs);
      if (msaDateFilter === "today") return diffDays === 0;
      if (msaDateFilter === "week") return diffDays <= 7;
      if (msaDateFilter === "month") return diffDays <= 30;
      return true;
    });

    return [...filtered].sort((a, b) => {
      switch (msaSortOrder) {
        case "oldest":
          return msaSortTimestamp(a) - msaSortTimestamp(b);
        case "name_asc":
          return msaDisplayName(a).localeCompare(msaDisplayName(b), undefined, {
            sensitivity: "base",
          });
        case "name_desc":
          return msaDisplayName(b).localeCompare(msaDisplayName(a), undefined, {
            sensitivity: "base",
          });
        case "newest":
        default:
          return msaSortTimestamp(b) - msaSortTimestamp(a);
      }
    });
  }, [usersWithMSA, msaSearchQuery, msaSelectedCompany, msaDateFilter, msaVersionFilter, msaSortOrder]);

  const msaItemsPerPage = DEFAULT_LIST_PAGE_SIZE;
  const pendingPagination = paginateList(filteredPending, requestsPage, msaItemsPerPage);
  const completedPagination = paginateList(filteredCompleted, requestsPage, msaItemsPerPage);
  const msaStartIndex = (msaPage - 1) * msaItemsPerPage;
  const paginatedMSAUsers = filteredMSAUsers.slice(msaStartIndex, msaStartIndex + msaItemsPerPage);

  useEffect(() => {
    setMsaPage(1);
  }, [msaSearchQuery, msaSelectedCompany, msaDateFilter, msaVersionFilter, msaSortOrder]);

  useEffect(() => {
    setRequestsPage(1);
  }, [
    activeTab,
    searchQuery,
    selectedCompany,
    selectedClient,
    selectedDocumentType,
    selectedDateRange,
  ]);

  const hasMsaActiveFilters =
    msaSearchQuery.trim() !== "" ||
    msaSelectedCompany !== "all" ||
    msaDateFilter !== "all" ||
    msaVersionFilter !== "all";

  const handleDownloadMSA = async (user: UserProfile) => {
    if (!user.msaClientDetails || !user.msaEffectiveDate) return;
    setMsaDownloadingUid(user.uid);
    try {
      const acceptedAt = user.accountActivatedAt && typeof user.accountActivatedAt === "object" && "seconds" in user.accountActivatedAt
        ? format(new Date((user.accountActivatedAt as { seconds: number }).seconds * 1000), "MMMM d, yyyy")
        : undefined;
      const blob = await generateSignedMsaPdfForUser(user, {
        effectiveDate: user.msaEffectiveDate,
        clientDetails: user.msaClientDetails,
        acceptedAt,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `MSA-${user.msaClientDetails.companyName.replace(/\s+/g, "-")}-${user.msaEffectiveDate}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: "MSA PDF has been downloaded." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to generate MSA PDF.",
      });
    } finally {
      setMsaDownloadingUid(null);
    }
  };

  const mgmtTabTriggerClass =
    "gap-1 rounded-md px-1.5 py-2 text-[10px] font-semibold text-muted-foreground transition-all sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm hover:text-foreground";

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Tabs value={managementTab} onValueChange={setManagementTab} className="min-w-0 space-y-3 sm:space-y-6">
        <div className="rounded-lg border bg-card p-1 shadow-sm sm:p-1.5">
          <TabsList className="grid h-auto w-full grid-cols-3 gap-0.5 bg-muted/50 p-1 sm:max-w-3xl sm:gap-1.5">
            <TabsTrigger value="requests" className={mgmtTabTriggerClass}>
              <FileStack className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="sm:hidden">Requests</span>
              <span className="hidden sm:inline">Document Requests</span>
            </TabsTrigger>
            <TabsTrigger value="msa" className={mgmtTabTriggerClass}>
              <FileSignature className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="sm:hidden">MSA</span>
              <span className="hidden sm:inline">MSA Agreements</span>
              <Badge
                variant={managementTab === "msa" ? "secondary" : "outline"}
                className="ml-0.5 h-4 min-w-[1rem] px-1 text-[10px] font-bold sm:h-5 sm:min-w-[1.25rem] sm:px-1.5 sm:text-xs"
              >
                {usersWithMSA.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="platform-legal" className={mgmtTabTriggerClass}>
              <BookOpen className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" />
              <span className="sm:hidden">Legal</span>
              <span className="hidden sm:inline">Legal Templates</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="requests" className="mt-0 space-y-3 sm:space-y-6">
          {/* Stat cards */}
          <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setActiveTab("pending")}
          onKeyDown={(e) => e.key === "Enter" && setActiveTab("pending")}
          className="border-2 border-orange-200/50 bg-gradient-to-br from-orange-50 to-orange-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-orange-400 focus:ring-offset-2 sm:shadow-lg"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium text-orange-900 sm:text-sm">Pending</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 shadow-md sm:h-10 sm:w-10">
              <Clock className="h-4 w-4 text-white sm:h-5 sm:w-5" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <Skeleton className="h-7 w-10 sm:h-8 sm:w-12" />
            ) : (
              <>
                <div className="text-2xl font-bold text-orange-900 sm:text-3xl">{pendingRequests.length}</div>
                <p className="mt-0.5 text-[10px] text-orange-700 sm:mt-1 sm:text-xs">Awaiting review</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => setActiveTab("completed")}
          onKeyDown={(e) => e.key === "Enter" && setActiveTab("completed")}
          className="border-2 border-green-200/50 bg-gradient-to-br from-green-50 to-green-100/50 shadow-md cursor-pointer transition-shadow hover:shadow-md focus:outline-none focus:ring-2 focus:ring-green-400 focus:ring-offset-2 sm:shadow-lg"
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium text-green-900 sm:text-sm">Completed</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-500 shadow-md sm:h-10 sm:w-10">
              <CheckCircle className="h-4 w-4 text-white sm:h-5 sm:w-5" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <Skeleton className="h-7 w-10 sm:h-8 sm:w-12" />
            ) : (
              <>
                <div className="text-2xl font-bold text-green-900 sm:text-3xl">{completedRequests.length}</div>
                <p className="mt-0.5 text-[10px] text-green-700 sm:mt-1 sm:text-xs">Fulfilled</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="border-2 border-blue-200/50 bg-gradient-to-br from-blue-50 to-blue-100/50 shadow-md sm:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium text-blue-900 sm:text-sm">Total</CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500 shadow-md sm:h-10 sm:w-10">
              <FileStack className="h-4 w-4 text-white sm:h-5 sm:w-5" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <Skeleton className="h-7 w-10 sm:h-8 sm:w-12" />
            ) : (
              <>
                <div className="text-2xl font-bold text-blue-900 sm:text-3xl">{requestsWithUserData.length}</div>
                <p className="mt-0.5 text-[10px] text-blue-700 sm:mt-1 sm:text-xs">All time</p>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="border-2 border-amber-200/50 bg-gradient-to-br from-amber-50 to-amber-100/50 shadow-md sm:shadow-lg">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 p-3 pb-1 sm:p-6 sm:pb-2">
            <CardTitle className="text-xs font-medium text-amber-900 sm:text-sm">
              <span className="sm:hidden">This week</span>
              <span className="hidden sm:inline">Processed This Week</span>
            </CardTitle>
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500 shadow-md sm:h-10 sm:w-10">
              <CalendarCheck className="h-4 w-4 text-white sm:h-5 sm:w-5" />
            </div>
          </CardHeader>
          <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
            {loading ? (
              <Skeleton className="h-7 w-10 sm:h-8 sm:w-12" />
            ) : (
              <>
                <div className="text-2xl font-bold text-amber-900 sm:text-3xl">{processedThisWeek}</div>
                <p className="mt-0.5 text-[10px] text-amber-700 sm:mt-1 sm:text-xs">Last 7 days</p>
              </>
            )}
          </CardContent>
        </Card>
          </div>

          {/* Filters Dashboard */}
          <Card className="min-w-0 border shadow-sm">
        <CardHeader className="p-3 pb-2 sm:p-6 sm:pb-3">
          <CardTitle className="text-sm sm:text-base">Filters</CardTitle>
          <CardDescription className="text-xs sm:text-sm">Search, client, company, type, and date.</CardDescription>
        </CardHeader>
        <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={selectedCompany} onValueChange={setSelectedCompany}>
              <SelectTrigger><SelectValue placeholder="All companies" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All companies</SelectItem>
                {companyOptions.map((company) => (
                  <SelectItem key={company} value={company}>{company}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedClient} onValueChange={setSelectedClient}>
              <SelectTrigger><SelectValue placeholder="All clients" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All clients</SelectItem>
                {clientNameOptions.map((name) => (
                  <SelectItem key={name} value={name}>{name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={selectedDocumentType} onValueChange={setSelectedDocumentType}>
              <SelectTrigger><SelectValue placeholder="All document types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All document types</SelectItem>
                {documentTypeOptions.map((docType) => (
                  <SelectItem key={docType} value={docType}>{docType}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2">
              <Select value={selectedDateRange} onValueChange={setSelectedDateRange}>
                <SelectTrigger><SelectValue placeholder="Requested date" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="week">Last 7 days</SelectItem>
                  <SelectItem value="month">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              {hasActiveFilters && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchQuery("");
                    setSelectedCompany("all");
                    setSelectedClient("all");
                    setSelectedDocumentType("all");
                    setSelectedDateRange("all");
                  }}
                >
                  Reset
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="min-w-0 space-y-3 sm:space-y-4">
            <TabsList className="grid h-auto w-full grid-cols-2 gap-1 p-1 sm:inline-flex sm:h-10 sm:w-auto">
              <TabsTrigger value="pending" className="gap-1 px-2 py-1.5 text-xs sm:gap-2 sm:px-3 sm:text-sm">
                Pending ({pendingRequests.length})
              </TabsTrigger>
              <TabsTrigger value="completed" className="gap-1 px-2 py-1.5 text-xs sm:gap-2 sm:px-3 sm:text-sm">
                Done ({completedRequests.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="pending" className="space-y-3 sm:space-y-4">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="p-3 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <Clock className="h-4 w-4 text-orange-500 sm:h-5 sm:w-5" />
                Pending Requests
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Awaiting review, approval, upload, or rejection
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredPending.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>
                    {hasActiveFilters
                      ? "No document requests match your filters."
                      : "No pending document requests."}
                  </p>
                </div>
              ) : (
                <>
                <div className="space-y-2 sm:space-y-3">
                  {pendingPagination.items.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-lg border bg-background p-3 sm:p-4"
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-orange-100 flex items-center justify-center shrink-0">
                            <FileText className="h-4 w-4 text-orange-600" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                            <p className="font-semibold">{request.documentType}</p>
                            <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                              Pending
                            </Badge>
                            {request.documentType === CUSTOM_DOCUMENT_REQUEST_LABEL && (
                              <Badge variant="secondary" className="text-xs font-normal">
                                Upload only — no auto PDF
                              </Badge>
                            )}
                          </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <User className="h-4 w-4" />
                            <span>{request.userName} ({request.userEmail})</span>
                            </div>
                          {request.companyName && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Company: {request.companyName}
                            </p>
                          )}
                          {request.contact && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Contact: {request.contact}
                            </p>
                          )}
                          {request.email && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Email: {request.email}
                            </p>
                          )}
                          {request.clientLegalName && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Client signature: {request.clientLegalName}
                            </p>
                          )}
                          {request.documentType === "B2B Partnership Agreement" && (
                            <>
                              {request.partnerAgencyName && (
                                <p className="text-sm text-muted-foreground mt-1">Partner: {request.partnerAgencyName}</p>
                              )}
                              {request.address && (
                                <p className="text-sm text-muted-foreground mt-1">Address: {request.address}</p>
                              )}
                              {request.phone && (
                                <p className="text-sm text-muted-foreground mt-1">Phone: {request.phone}</p>
                              )}
                              {request.partnerAuthorizedName && (
                                <p className="text-sm text-muted-foreground mt-1">Authorized: {request.partnerAuthorizedName}</p>
                              )}
                            </>
                          )}
                          <p className="text-sm text-muted-foreground mt-1">
                            Requested {format(new Date(request.requestedAt?.seconds * 1000 || Date.now()), "MMM d, yyyy 'at' h:mm a")}
                          </p>
                          {request.customDocumentBrief && (
                            <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                                Request details
                              </p>
                              <p className="text-foreground whitespace-pre-wrap">{request.customDocumentBrief}</p>
                            </div>
                          )}
                          {request.notes && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Notes: {request.notes}
                            </p>
                          )}
                          </div>
                        </div>
                        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
                          {request.documentType !== CUSTOM_DOCUMENT_REQUEST_LABEL && (
                            <Button
                              size="sm"
                              className="h-8 flex-1 sm:flex-none"
                              onClick={() => handleApproveRequest(request)}
                              disabled={approvingRequestId === request.id}
                            >
                              {approvingRequestId === request.id ? (
                                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin sm:mr-2 sm:h-4 sm:w-4" />
                              ) : (
                                <CheckCircle className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                              )}
                              Approve
                            </Button>
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 sm:flex-none"
                            onClick={() => handleOpenUploadDialog(request)}
                          >
                            <Upload className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                            Upload
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8 flex-1 border-red-200 text-red-600 hover:bg-red-50 sm:flex-none"
                            onClick={() => handleRejectRequest(request)}
                          >
                            Reject
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <ListPagination
                  page={pendingPagination.page}
                  totalItems={filteredPending.length}
                  itemsPerPage={msaItemsPerPage}
                  onPageChange={setRequestsPage}
                  itemLabel="requests"
                />
                </>
              )}
            </CardContent>
          </Card>
            </TabsContent>

            <TabsContent value="completed" className="space-y-3 sm:space-y-4">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="p-3 sm:p-6">
              <CardTitle className="flex items-center gap-2 text-base sm:text-lg">
                <CheckCircle className="h-4 w-4 text-green-500 sm:h-5 sm:w-5" />
                Completed Requests
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Fulfilled document requests
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredCompleted.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <CheckCircle className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>
                    {hasActiveFilters
                      ? "No document requests match your filters."
                      : "No completed document requests yet."}
                  </p>
                </div>
              ) : (
                <>
                <div className="space-y-2 sm:space-y-3">
                  {completedPagination.items.map((request) => (
                    <div
                      key={request.id}
                      className="rounded-lg border bg-background p-3 sm:p-4"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                            <FileText className="h-4 w-4 text-green-600" />
                          </div>
                          <div className="min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <p className="font-semibold">{request.documentType}</p>
                            <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                              Complete
                            </Badge>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <User className="h-4 w-4" />
                            <span>{request.userName} ({request.userEmail})</span>
                          </div>
                          {request.companyName && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Company: {request.companyName}
                            </p>
                          )}
                          {request.contact && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Contact: {request.contact}
                            </p>
                          )}
                          {request.email && (
                            <p className="text-sm text-muted-foreground mt-1">
                              Email: {request.email}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground mt-1">
                            Completed {request.completedAt && format(new Date(request.completedAt?.seconds * 1000), "MMM d, yyyy 'at' h:mm a")}
                          </p>
                          {request.fileName && (
                            <p className="text-sm text-muted-foreground mt-1">
                              File: {request.fileName}
                            </p>
                          )}
                          </div>
                        </div>
                      </div>
                      {request.documentUrl && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(request.documentUrl!, request.fileName || "document.pdf")}
                          className="h-8 w-full shrink-0 sm:ml-4 sm:w-auto"
                        >
                          <Download className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                          Download
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
                <ListPagination
                  page={completedPagination.page}
                  totalItems={filteredCompleted.length}
                  itemsPerPage={msaItemsPerPage}
                  onPageChange={setRequestsPage}
                  itemLabel="requests"
                />
                </>
              )}
            </CardContent>
          </Card>
            </TabsContent>
          </Tabs>
        </TabsContent>
        <TabsContent value="msa" className="mt-0 space-y-3 sm:space-y-4">
          <Card className="min-w-0 overflow-hidden">
            <CardHeader className="p-3 sm:p-6">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base sm:text-lg">
                <FileSignature className="h-4 w-4 text-indigo-500 sm:h-5 sm:w-5" />
                Signed MSAs ({filteredMSAUsers.length})
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Clients who accepted the MSA — download a copy for any client.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-0 sm:p-6 sm:pt-0">
              {usersWithMSA.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileSignature className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>No MSA agreements found yet.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search client..."
                        value={msaSearchQuery}
                        onChange={(e) => setMsaSearchQuery(e.target.value)}
                        className="pl-9"
                      />
                    </div>
                    <Select value={msaSelectedCompany} onValueChange={setMsaSelectedCompany}>
                      <SelectTrigger><SelectValue placeholder="All companies" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All companies</SelectItem>
                        {msaCompanyOptions.map((company) => (
                          <SelectItem key={company} value={company}>{company}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={msaDateFilter} onValueChange={setMsaDateFilter}>
                      <SelectTrigger><SelectValue placeholder="Effective date" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All time</SelectItem>
                        <SelectItem value="today">Today</SelectItem>
                        <SelectItem value="week">Last 7 days</SelectItem>
                        <SelectItem value="month">Last 30 days</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={msaVersionFilter} onValueChange={setMsaVersionFilter}>
                      <SelectTrigger><SelectValue placeholder="MSA version" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All versions</SelectItem>
                        {msaVersionOptions.map((version) => (
                          <SelectItem key={version} value={String(version)}>
                            {formatPlatformVersionLabel(version)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={msaSortOrder} onValueChange={(v) => setMsaSortOrder(v as typeof msaSortOrder)}>
                      <SelectTrigger><SelectValue placeholder="Sort by" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="newest">Newest to oldest</SelectItem>
                        <SelectItem value="oldest">Oldest to newest</SelectItem>
                        <SelectItem value="name_asc">Name A → Z</SelectItem>
                        <SelectItem value="name_desc">Name Z → A</SelectItem>
                      </SelectContent>
                    </Select>
                    <div className="flex flex-wrap items-center gap-2 xl:col-span-2">
                      {hasMsaActiveFilters && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9"
                          onClick={() => {
                            setMsaSearchQuery("");
                            setMsaSelectedCompany("all");
                            setMsaDateFilter("all");
                            setMsaVersionFilter("all");
                            setMsaSortOrder("newest");
                          }}
                        >
                          Reset
                        </Button>
                      )}
                      <Badge variant="outline" className="h-9 px-2 text-xs sm:h-10 sm:px-3">
                        Total: {filteredMSAUsers.length}
                      </Badge>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {paginatedMSAUsers.map((u: UserProfile) => (
                      <div
                        key={u.uid}
                        className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium sm:text-base">{u.name ?? u.email}</p>
                          <p className="text-xs text-muted-foreground sm:text-sm">
                            {u.msaClientDetails!.companyName} · Effective {u.msaEffectiveDate}
                            {getAcceptedMsaVersion(u) != null && (
                              <> · Signed {formatPlatformVersionLabel(getAcceptedMsaVersion(u)!)}</>
                            )}
                          </p>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 w-full shrink-0 sm:w-auto"
                          onClick={() => handleDownloadMSA(u)}
                          disabled={msaDownloadingUid === u.uid}
                        >
                          {msaDownloadingUid === u.uid ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Download className="mr-1 h-3.5 w-3.5 sm:mr-2 sm:h-4 sm:w-4" />
                              Download
                            </>
                          )}
                        </Button>
                      </div>
                    ))}
                  </div>

                  <ListPagination
                    page={msaPage}
                    totalItems={filteredMSAUsers.length}
                    itemsPerPage={msaItemsPerPage}
                    onPageChange={setMsaPage}
                    itemLabel="agreements"
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="platform-legal" className="mt-0">
          <PlatformDocumentsManagement />
        </TabsContent>
      </Tabs>

      {/* Upload Dialog */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="flex max-h-[100dvh] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh]">
          <DialogHeader className="shrink-0 border-b p-4 text-left sm:p-6">
            <DialogTitle>Upload Document</DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              Upload the requested document for {selectedRequest?.userName}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-6">
            <div className="space-y-2">
              <Label>Document Type</Label>
              <Input value={selectedRequest?.documentType || ""} disabled />
            </div>
            <div className="space-y-2">
              <Label htmlFor="file">Select File</Label>
              <Input
                id="file"
                type="file"
                accept=".pdf,.doc,.docx,.txt"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
              <p className="text-xs text-muted-foreground">
                Accepted formats: PDF, DOC, DOCX, TXT
              </p>
            </div>
            <Button
              onClick={handleUploadDocument}
              disabled={!file || isUploading}
              className="w-full"
            >
              {isUploading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload Document
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
