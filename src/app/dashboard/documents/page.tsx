"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { collection, addDoc, Timestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import {
  FileText,
  Download,
  Upload,
  Loader2,
  CheckCircle,
  Clock,
  FileSignature,
  Eye,
  Building2,
  User,
  MapPin,
  Mail,
  Phone,
  ClipboardList,
} from "lucide-react";
import { FULFILLMENT_SERVICE_PROVIDER, FULFILLMENT_AGREEMENT_SECTIONS } from "@/lib/fulfillment-agreement-content";
import { PARTNERSHIP_SERVICE_PROVIDER, PARTNERSHIP_AGREEMENT_SECTIONS } from "@/lib/partnership-agreement-content";
import { CUSTOM_DOCUMENT_REQUEST_LABEL } from "@/lib/document-request-labels";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { generateSignedMsaPdfForUser } from "@/lib/signed-msa-pdf";
import { PlatformDocumentVersionRow } from "@/components/documents/platform-document-version-row";
import { formatPlatformVersionLabel } from "@/lib/platform-document-control";
import {
  getAcceptedMsaVersion,
  isMsaVersionBehind,
} from "@/lib/document-version-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PlatformDocumentSlug, PlatformDocumentSummary } from "@/lib/platform-documents-types";
import { PLATFORM_DOCUMENT_LABELS } from "@/lib/platform-documents-types";
import {
  DEFAULT_LIST_PAGE_SIZE,
  ListPagination,
  paginateList,
} from "@/components/ui/list-pagination";

const AVAILABLE_PLATFORM_DOCUMENT_SLUGS = ["terms", "privacy"] as const satisfies readonly PlatformDocumentSlug[];

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
  /** Client legal name typed as signature on the agreement. */
  clientLegalName?: string;
  /** How the request was fulfilled: approved using template vs uploaded file. */
  decisionType?: "approved" | "uploaded";
  /** Partnership agreement fields */
  partnerAgencyName?: string;
  address?: string;
  phone?: string;
  partnerAuthorizedName?: string;
  partnerTitle?: string;
  /** Custom document request — scope / description from the client */
  customDocumentBrief?: string;
}

const DOCUMENT_TYPES = [
  { id: "fulfillment" as const, label: "Fulfillment & Prep Services Agreement", description: "Warehousing, prep, and fulfillment services" },
  { id: "partnership" as const, label: "B2B Partnership Agreement", description: "Referral and strategic partnership" },
  {
    id: "custom" as const,
    label: CUSTOM_DOCUMENT_REQUEST_LABEL,
    description: "NDAs, addenda, or other agreements beyond our standard templates",
  },
] as const;

type SelectedDocType = (typeof DOCUMENT_TYPES)[number]["id"];

type RequestListFilter = "all" | "pending" | "complete";

function DocumentsPageContent() {
  const searchParams = useSearchParams();
  const { userProfile, user } = useAuth();
  const { toast } = useToast();
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedDocumentType, setSelectedDocumentType] = useState<SelectedDocType | null>(null);
  const [requestStep, setRequestStep] = useState<1 | 2>(1);
  const [notes, setNotes] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contact, setContact] = useState("");
  const [email, setEmail] = useState("");
  const [clientLegalName, setClientLegalName] = useState("");
  const [partnerAgencyName, setPartnerAgencyName] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [partnerAuthorizedName, setPartnerAuthorizedName] = useState("");
  const [partnerTitle, setPartnerTitle] = useState("");
  const [customDocumentBrief, setCustomDocumentBrief] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [msaDownloading, setMsaDownloading] = useState(false);
  const [requestListFilter, setRequestListFilter] = useState<RequestListFilter>("all");
  const [pendingPage, setPendingPage] = useState(1);
  const [completedPage, setCompletedPage] = useState(1);
  const [platformDocuments, setPlatformDocuments] = useState<PlatformDocumentSummary[]>([]);
  const [platformDocsLoading, setPlatformDocsLoading] = useState(true);

  useEffect(() => {
    const s = searchParams.get("status")?.toLowerCase();
    if (s === "pending" || s === "complete") {
      setRequestListFilter(s);
    }
  }, [searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/platform-documents");
        const data = await res.json();
        if (!cancelled && res.ok && Array.isArray(data.documents)) {
          setPlatformDocuments(data.documents);
        }
      } finally {
        if (!cancelled) setPlatformDocsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: documentRequests, loading } = useCollection<DocumentRequest>(
    userProfile ? `users/${userProfile.uid}/documentRequests` : ""
  );

  const validateStepOne = () => {
    if (!userProfile || !user) {
      toast({ variant: "destructive", title: "Error", description: "Please log in to request documents." });
      return false;
    }
    if (selectedDocumentType === "fulfillment") {
      if (!companyName?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Company Name is required." });
        return false;
      }
      if (!contact?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Contact is required." });
        return false;
      }
      if (!email?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Email is required." });
        return false;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        toast({ variant: "destructive", title: "Validation Error", description: "Please enter a valid email address." });
        return false;
      }
      if (!clientLegalName?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Client legal name (signature) is required." });
        return false;
      }
      return true;
    }
    if (selectedDocumentType === "partnership") {
      if (!partnerAgencyName?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Partner / Agency Name is required." });
        return false;
      }
      if (!address?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Address is required." });
        return false;
      }
      if (!email?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Email is required." });
        return false;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        toast({ variant: "destructive", title: "Validation Error", description: "Please enter a valid email address." });
        return false;
      }
      if (!phone?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Phone is required." });
        return false;
      }
      if (!partnerAuthorizedName?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Authorized name (signature) is required." });
        return false;
      }
      return true;
    }
    if (selectedDocumentType === "custom") {
      if (!companyName?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Company or organization name is required." });
        return false;
      }
      if (!contact?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Contact is required." });
        return false;
      }
      if (!email?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Email is required." });
        return false;
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        toast({ variant: "destructive", title: "Validation Error", description: "Please enter a valid email address." });
        return false;
      }
      if (!clientLegalName?.trim()) {
        toast({ variant: "destructive", title: "Validation Error", description: "Legal name is required." });
        return false;
      }
      const brief = customDocumentBrief?.trim() ?? "";
      if (brief.length < 40) {
        toast({
          variant: "destructive",
          title: "Validation Error",
          description: "Please describe what you need in at least a few sentences (40+ characters).",
        });
        return false;
      }
      return true;
    }
    return false;
  };

  const handleNextFromDetails = () => {
    const ok = validateStepOne();
    if (ok) {
      setRequestStep(2);
    }
  };

  const handleRequestDocument = async () => {
    if (!userProfile || !user) {
      toast({
        variant: "destructive",
        title: "Error",
        description: "Please log in to request documents.",
      });
      return;
    }

    if (!validateStepOne()) return;

    setIsSubmitting(true);
    try {
      const documentTypeLabel =
        selectedDocumentType === "partnership"
          ? "B2B Partnership Agreement"
          : selectedDocumentType === "custom"
            ? CUSTOM_DOCUMENT_REQUEST_LABEL
            : "Fulfillment & Prep Services Agreement";
      const requestData: any = {
        userId: userProfile.uid,
        documentType: documentTypeLabel,
        status: "pending",
        requestedAt: Timestamp.now(),
      };
      if (selectedDocumentType === "fulfillment") {
        requestData.companyName = companyName.trim();
        requestData.contact = contact.trim();
        requestData.email = email.trim();
        requestData.clientLegalName = clientLegalName.trim();
        requestData.serviceProviderName = "Prep Services FBA LLC";
      } else if (selectedDocumentType === "partnership") {
        requestData.partnerAgencyName = partnerAgencyName.trim();
        requestData.address = address.trim();
        requestData.email = email.trim();
        requestData.phone = phone.trim();
        requestData.partnerAuthorizedName = partnerAuthorizedName.trim();
        if (partnerTitle?.trim()) requestData.partnerTitle = partnerTitle.trim();
      } else if (selectedDocumentType === "custom") {
        requestData.companyName = companyName.trim();
        requestData.contact = contact.trim();
        requestData.email = email.trim();
        requestData.clientLegalName = clientLegalName.trim();
        requestData.customDocumentBrief = customDocumentBrief.trim();
      }
      if (notes?.trim()) requestData.notes = notes.trim();

      await addDoc(collection(db, `users/${userProfile.uid}/documentRequests`), requestData);

      toast({
        title: "Request Submitted",
        description:
          selectedDocumentType === "custom"
            ? "Your custom document request has been submitted. Our team will review it and follow up by email."
            : "Your agreement request has been submitted. Admin will review and approve or upload it.",
      });

      setNotes("");
      setCompanyName("");
      setContact("");
      setEmail("");
      setClientLegalName("");
      setPartnerAgencyName("");
      setAddress("");
      setPhone("");
      setPartnerAuthorizedName("");
      setPartnerTitle("");
      setCustomDocumentBrief("");
      setSelectedDocumentType(null);
      setRequestStep(1);
      setRequestDialogOpen(false);
    } catch (error: any) {
      console.error("Error submitting document request:", error);
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to submit request. Please try again.",
      });
    } finally {
      setIsSubmitting(false);
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

  const handleDownloadMSA = async () => {
    if (!userProfile?.msaClientDetails || !userProfile?.msaEffectiveDate) return;
    setMsaDownloading(true);
    try {
      const acceptedAt = userProfile.accountActivatedAt && "seconds" in userProfile.accountActivatedAt
        ? format(new Date(userProfile.accountActivatedAt.seconds * 1000), "MMMM d, yyyy")
        : undefined;
      const blob = await generateSignedMsaPdfForUser(userProfile, {
        effectiveDate: userProfile.msaEffectiveDate,
        clientDetails: userProfile.msaClientDetails,
        acceptedAt,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `MSA-${userProfile.msaClientDetails.companyName.replace(/\s+/g, "-")}-${userProfile.msaEffectiveDate}${acceptedMsaVersion != null ? `-v${acceptedMsaVersion}` : ""}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: "Download started", description: "Your MSA has been downloaded." });
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to generate MSA PDF.",
      });
    } finally {
      setMsaDownloading(false);
    }
  };

  const pendingRequests = documentRequests.filter((req) => req.status === "pending");
  const completedRequests = documentRequests.filter((req) => req.status === "complete");

  useEffect(() => {
    setPendingPage(1);
    setCompletedPage(1);
  }, [requestListFilter]);

  const pendingPagination = paginateList(pendingRequests, pendingPage, DEFAULT_LIST_PAGE_SIZE);
  const completedPagination = paginateList(completedRequests, completedPage, DEFAULT_LIST_PAGE_SIZE);

  const availablePlatformDocuments: PlatformDocumentSummary[] = AVAILABLE_PLATFORM_DOCUMENT_SLUGS.map(
    (slug) => {
      const found = platformDocuments.find((d) => d.slug === slug);
      if (found) return found;
      return {
        slug,
        title: PLATFORM_DOCUMENT_LABELS[slug].title,
        version: 1,
      };
    }
  );

  const showPendingCard =
    requestListFilter === "pending" ||
    (requestListFilter === "all" && pendingRequests.length > 0);
  const showCompletedCard =
    requestListFilter === "complete" || requestListFilter === "all";

  const acceptedMsaVersion = getAcceptedMsaVersion(userProfile);
  const currentMsaVersion = platformDocuments.find((d) => d.slug === "msa")?.version ?? null;
  const msaVersionBehind = isMsaVersionBehind(acceptedMsaVersion, currentMsaVersion);

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Documents</h1>
          <p className="text-muted-foreground mt-1">
            Request and download your service documents
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={requestListFilter}
            onValueChange={(v) => setRequestListFilter(v as RequestListFilter)}
          >
            <SelectTrigger className="w-[min(100vw-2rem,220px)] sm:w-[220px]">
              <SelectValue placeholder="Request status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All requests</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
              <SelectItem value="complete">Completed</SelectItem>
            </SelectContent>
          </Select>
        <Dialog
          open={requestDialogOpen}
          onOpenChange={(open) => {
            setRequestDialogOpen(open);
            if (!open) {
              setRequestStep(1);
              setSelectedDocumentType(null);
              setCustomDocumentBrief("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <FileText className="mr-2 h-4 w-4" />
              Request Document
            </Button>
          </DialogTrigger>
          <DialogContent
            className={cn(
              "max-w-lg overflow-x-hidden",
              selectedDocumentType != null &&
                requestStep === 1 &&
                "max-w-3xl max-h-[90vh] !flex flex-col overflow-hidden gap-4",
              selectedDocumentType != null && requestStep === 2 && "max-h-[90vh] !flex flex-col overflow-hidden gap-4"
            )}
          >
            <DialogHeader className="shrink-0 pr-10">
              <DialogTitle>
                {selectedDocumentType == null
                  ? "Select Document"
                  : selectedDocumentType === "fulfillment"
                    ? "Fulfillment & Prep Services Agreement"
                    : selectedDocumentType === "partnership"
                      ? "B2B Partnership Agreement"
                      : CUSTOM_DOCUMENT_REQUEST_LABEL}
              </DialogTitle>
              <DialogDescription>
                {selectedDocumentType == null
                  ? "Choose a standard agreement or a custom document request. You’ll complete the details in the next step."
                  : requestStep === 1
                    ? selectedDocumentType === "custom"
                      ? "Provide your contact information and a clear description of the document you need. Our team will review and follow up by email—there is no standard template for this option."
                      : "Read the full agreement below and fill your details in the template. Service provider will be shown as Prep Services FBA LLC."
                    : selectedDocumentType === "custom"
                      ? "Add any extra context for our team (optional), then submit your request."
                      : "Add any notes for the admin (optional), then submit your request."}
              </DialogDescription>
            </DialogHeader>

            {selectedDocumentType == null ? (
              <div
                className={cn(
                  "grid min-h-0 max-h-[min(60vh,22rem)] grid-cols-1 gap-3 overflow-y-auto overflow-x-hidden py-4 pr-1 [scrollbar-width:thin]",
                  "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
                )}
              >
                {DOCUMENT_TYPES.map((docType) => (
                  <Button
                    key={docType.id}
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-auto w-full min-w-0 max-w-full flex-col items-stretch justify-start gap-1.5 whitespace-normal p-4 text-left transition-colors",
                      docType.id === "custom" &&
                        "border-primary/30 bg-primary/[0.04] hover:bg-primary/[0.07] hover:border-primary/40"
                    )}
                    onClick={() => {
                      setSelectedDocumentType(docType.id);
                      setRequestStep(1);
                    }}
                  >
                    {docType.id === "custom" && (
                      <span className="flex w-full min-w-0 items-center gap-1.5 text-xs font-medium text-primary">
                        <ClipboardList className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        Other / custom
                      </span>
                    )}
                    <span className="block w-full min-w-0 break-words text-left font-semibold">{docType.label}</span>
                    <span className="block w-full min-w-0 break-words text-left text-xs font-normal leading-snug text-muted-foreground">
                      {docType.description}
                    </span>
                  </Button>
                ))}
              </div>
            ) : requestStep === 1 ? (
              selectedDocumentType === "custom" ? (
              <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
                <div
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1 pr-2",
                    "[scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_hsl(var(--muted))]",
                    "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
                    "[&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-muted/60"
                  )}
                >
                  <div className="flex flex-col gap-4">
                    <div className="rounded-xl border border-primary/20 bg-primary/[0.06] px-4 py-3 text-sm">
                      <p className="mb-1.5 flex items-center gap-2 font-semibold text-foreground">
                        <ClipboardList className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                        How custom requests work
                      </p>
                      <p className="text-muted-foreground leading-relaxed">
                        Use this path for documents that are not our standard fulfillment or partnership agreements—for
                        example NDAs, addenda, or bespoke terms. Describe what you need, who it is for, and any deadlines.
                        Legal and operations will review your request and respond by email.
                      </p>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Request date:{" "}
                      <span className="font-medium text-foreground">{format(new Date(), "MMMM d, yyyy")}</span>
                    </p>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <Label className="text-sm font-semibold text-muted-foreground">Service provider</Label>
                        </div>
                        <div className="rounded-xl border bg-muted/20 p-4 space-y-1.5 text-sm">
                          <p className="font-semibold text-foreground">{FULFILLMENT_SERVICE_PROVIDER.name}</p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="h-4 w-4 shrink-0" />
                            {FULFILLMENT_SERVICE_PROVIDER.contact}
                          </p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="h-4 w-4 shrink-0" />
                            {FULFILLMENT_SERVICE_PROVIDER.phone}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <User className="h-4 w-4" />
                          </div>
                          <Label className="text-sm font-semibold text-muted-foreground">Your organization</Label>
                        </div>
                        <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 bg-background p-4 space-y-3">
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-companyName" className="text-xs font-medium">
                              Company or organization <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="custom-companyName"
                              value={companyName}
                              onChange={(e) => setCompanyName(e.target.value)}
                              placeholder="Legal entity or DBA"
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-contact" className="text-xs font-medium">
                              Phone or primary contact <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="custom-contact"
                              value={contact}
                              onChange={(e) => setContact(e.target.value)}
                              placeholder="Best number to reach you"
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-email" className="text-xs font-medium">
                              Email <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="custom-email"
                              type="email"
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="For correspondence and delivery"
                              className="h-9"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="custom-legal" className="text-xs font-medium">
                              Authorized signatory (legal name) <span className="text-red-500">*</span>
                            </Label>
                            <Input
                              id="custom-legal"
                              value={clientLegalName}
                              onChange={(e) => setClientLegalName(e.target.value)}
                              placeholder="Full name as it should appear on documents"
                              className="h-9"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="custom-brief" className="text-sm font-medium">
                        Document request details <span className="text-red-500">*</span>
                      </Label>
                      <Textarea
                        id="custom-brief"
                        value={customDocumentBrief}
                        onChange={(e) => setCustomDocumentBrief(e.target.value)}
                        placeholder="Describe the document you need (e.g. mutual NDA, pricing addendum), its purpose, parties involved, and any deadlines or special requirements."
                        rows={6}
                        className="min-h-[140px] resize-y text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        Minimum 40 characters. Be specific so our team can respond without unnecessary back-and-forth.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="shrink-0 space-y-3 border-t border-border/60 bg-background pt-3">
                  <p className="text-xs text-muted-foreground">
                    By continuing, you confirm the information above is accurate to the best of your knowledge. This
                    request does not create a binding agreement until a document is prepared and executed by both parties.
                  </p>
                  <div className="flex gap-3">
                    <Button type="button" variant="outline" onClick={() => setSelectedDocumentType(null)}>
                      Back
                    </Button>
                    <Button onClick={handleNextFromDetails} className="flex-1">
                      Next
                    </Button>
                  </div>
                </div>
              </div>
              ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden">
                <div
                  className={cn(
                    "min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1 pr-2",
                    "[scrollbar-width:thin] [scrollbar-color:hsl(var(--border))_hsl(var(--muted))]",
                    "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border",
                    "[&::-webkit-scrollbar-track]:rounded-full [&::-webkit-scrollbar-track]:bg-muted/60"
                  )}
                >
                  <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  This agreement is entered into as of <span className="font-medium text-foreground">{format(new Date(), "MMMM d, yyyy")}</span>, by and between:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <Label className="text-sm font-semibold text-muted-foreground">Service Provider</Label>
                    </div>
                    <div className="rounded-xl border bg-muted/20 p-4 space-y-1.5 text-sm">
                      {selectedDocumentType === "fulfillment" ? (
                        <>
                          <p className="font-semibold text-foreground">{FULFILLMENT_SERVICE_PROVIDER.name}</p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="h-4 w-4 shrink-0" />
                            {FULFILLMENT_SERVICE_PROVIDER.contact}
                          </p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="h-4 w-4 shrink-0" />
                            {FULFILLMENT_SERVICE_PROVIDER.phone}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-semibold text-foreground">{PARTNERSHIP_SERVICE_PROVIDER.name}</p>
                          <p className="flex items-start gap-2 text-muted-foreground">
                            <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                            <span>{PARTNERSHIP_SERVICE_PROVIDER.address}</span>
                          </p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <Mail className="h-4 w-4 shrink-0" />
                            {PARTNERSHIP_SERVICE_PROVIDER.email}
                          </p>
                          <p className="flex items-center gap-2 text-muted-foreground">
                            <Phone className="h-4 w-4 shrink-0" />
                            {PARTNERSHIP_SERVICE_PROVIDER.phone}
                          </p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <User className="h-4 w-4" />
                      </div>
                      <Label className="text-sm font-semibold text-muted-foreground">
                        {selectedDocumentType === "fulfillment" ? "Client (your details)" : "Partner (your details)"}
                      </Label>
                    </div>
                    <div className="rounded-xl border-2 border-dashed border-muted-foreground/20 bg-background p-4 space-y-3">
                      {selectedDocumentType === "fulfillment" ? (
                        <>
                          <div className="space-y-1.5">
                            <Label htmlFor="companyName" className="text-xs font-medium">Company Name <span className="text-red-500">*</span></Label>
                            <Input id="companyName" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Your company name" className="h-9" />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="contact" className="text-xs font-medium">Contact <span className="text-red-500">*</span></Label>
                            <Input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} placeholder="Contact number" className="h-9" />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="email" className="text-xs font-medium">Email <span className="text-red-500">*</span></Label>
                            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="h-9" />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="clientLegalName" className="text-xs font-medium">Legal Name (signature) <span className="text-red-500">*</span></Label>
                            <Input id="clientLegalName" value={clientLegalName} onChange={(e) => setClientLegalName(e.target.value)} placeholder="Full legal name" className="h-9" />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="space-y-1.5">
                            <Label htmlFor="partnerAgencyName" className="text-xs font-medium">Partner / Agency Name <span className="text-red-500">*</span></Label>
                            <Input id="partnerAgencyName" value={partnerAgencyName} onChange={(e) => setPartnerAgencyName(e.target.value)} placeholder="Partner or agency name" className="h-9" />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="address" className="text-xs font-medium">Address <span className="text-red-500">*</span></Label>
                            <Input id="address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full address" className="h-9" />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1.5">
                              <Label htmlFor="email" className="text-xs font-medium">Email <span className="text-red-500">*</span></Label>
                              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="h-9" />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor="phone" className="text-xs font-medium">Phone <span className="text-red-500">*</span></Label>
                              <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone" className="h-9" />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="partnerAuthorizedName" className="text-xs font-medium">Authorized Name (signature) <span className="text-red-500">*</span></Label>
                            <Input id="partnerAuthorizedName" value={partnerAuthorizedName} onChange={(e) => setPartnerAuthorizedName(e.target.value)} placeholder="Full legal name" className="h-9" />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor="partnerTitle" className="text-xs font-medium">Title (optional)</Label>
                            <Input id="partnerTitle" value={partnerTitle} onChange={(e) => setPartnerTitle(e.target.value)} placeholder="e.g. Founder, CEO" className="h-9" />
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="rounded-xl border bg-muted/20">
                  <div className="border-b bg-muted/30 px-4 py-2">
                    <p className="text-sm font-semibold">Agreement terms</p>
                    <p className="text-xs text-muted-foreground">Please read the full agreement below.</p>
                  </div>
                  <div className="space-y-4 px-4 py-4">
                    {(selectedDocumentType === "fulfillment" ? FULFILLMENT_AGREEMENT_SECTIONS : PARTNERSHIP_AGREEMENT_SECTIONS).map((section, i) => (
                      <div key={section.title} className={cn(i > 0 && "pt-4 border-t border-border/60")}>
                        <h3 className="font-semibold text-foreground text-sm uppercase tracking-wide mb-1.5">
                          {section.title}
                        </h3>
                        <p className="text-muted-foreground text-sm leading-relaxed">{section.body}</p>
                      </div>
                    ))}
                  </div>
                </div>
                  </div>
                </div>
                <div className="shrink-0 space-y-3 border-t border-border/60 bg-background pt-3">
                <p className="text-xs text-muted-foreground">
                  Agreed and Accepted by: Service Provider — Prep Services FBA LLC. {selectedDocumentType === "fulfillment" ? "Client" : "Partner"} — your name above will appear as signature.
                </p>
                <div className="flex gap-3">
                  <Button type="button" variant="outline" onClick={() => setSelectedDocumentType(null)}>
                    Back
                  </Button>
                  <Button onClick={handleNextFromDetails} className="flex-1">
                    Next
                  </Button>
                </div>
                </div>
              </div>
              )
            ) : (
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-2 pr-1 [scrollbar-width:thin]">
                <div className="space-y-1">
                  <p className="font-medium">Review & Notes (optional)</p>
                  <p className="text-sm text-muted-foreground">
                    {selectedDocumentType === "custom"
                      ? "Optional: deadlines, counterparties, formatting (PDF/DOC), or other context for our team."
                      : "Add any notes if you want the admin to modify or add clauses to the agreement (optional)."}
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="notes">Notes (Optional)</Label>
                  <Textarea
                    id="notes"
                    placeholder={
                      selectedDocumentType === "custom"
                        ? "Example: Need PDF by March 1; include our registered agent address…"
                        : "Example: Please adjust pricing paragraph, or add my warehouse address..."
                    }
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                  />
                </div>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-32"
                    onClick={() => setRequestStep(1)}
                    disabled={isSubmitting}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleRequestDocument}
                    disabled={isSubmitting}
                    className="flex-1"
                  >
                    {isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Submitting...
                      </>
                    ) : (
                      <>
                        <Upload className="mr-2 h-4 w-4" />
                        Submit Request
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {/* Master Service Agreement (signed) */}
      {userProfile?.msaClientDetails && userProfile?.msaEffectiveDate && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSignature className="h-5 w-5 text-indigo-500" />
              Master Service Agreement
            </CardTitle>
            <CardDescription>
              Your accepted agreement (effective {userProfile.msaEffectiveDate}
              {acceptedMsaVersion != null
                ? ` · ${formatPlatformVersionLabel(acceptedMsaVersion)}`
                : ""}
              ). Download the exact version you signed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {msaVersionBehind && currentMsaVersion != null && acceptedMsaVersion != null && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                A newer platform MSA is available ({formatPlatformVersionLabel(currentMsaVersion)}).
                Your signed copy remains {formatPlatformVersionLabel(acceptedMsaVersion)} until you
                accept an updated agreement.
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 p-4">
              <div>
                <p className="font-medium">{userProfile.msaClientDetails.companyName}</p>
                <p className="text-sm text-muted-foreground">
                  Accepted by {userProfile.msaClientDetails.legalName} · Effective{" "}
                  {userProfile.msaEffectiveDate}
                </p>
                {acceptedMsaVersion != null && (
                  <p className="text-sm text-muted-foreground mt-1">
                    Signed version: {formatPlatformVersionLabel(acceptedMsaVersion)}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleDownloadMSA} disabled={msaDownloading}>
                {msaDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    Download PDF
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pending Requests */}
      {showPendingCard && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-orange-500" />
              Pending Requests
            </CardTitle>
            <CardDescription>
              Your document requests awaiting admin review
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingRequests.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                No pending document requests.
              </div>
            ) : (
              <>
              <div className="space-y-4">
                {pendingPagination.items.map((request) => (
                  <div
                    key={request.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="h-10 w-10 rounded-full bg-orange-100 flex items-center justify-center">
                        <FileText className="h-5 w-5 text-orange-600" />
                      </div>
                      <div>
                        <p className="font-semibold">{request.documentType}</p>
                        <p className="text-sm text-muted-foreground">
                          Requested {format(new Date(request.requestedAt?.seconds * 1000 || Date.now()), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                        {request.notes && (
                          <p className="text-sm text-muted-foreground mt-1">
                            Notes: {request.notes}
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">
                      Pending
                    </Badge>
                  </div>
                ))}
              </div>
              <ListPagination
                page={pendingPagination.page}
                totalItems={pendingRequests.length}
                onPageChange={setPendingPage}
                itemLabel="requests"
              />
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Completed Requests */}
      {showCompletedCard && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Available Documents
          </CardTitle>
          <CardDescription>
            Platform legal documents and uploaded agreements ready to view or download
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading || platformDocsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : completedRequests.length === 0 && availablePlatformDocuments.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <FileText className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>No documents available yet.</p>
              <p className="text-sm mt-1">
                Request a document above and admin will upload it for you.
              </p>
            </div>
          ) : (
            <>
            <div className="space-y-4">
              {availablePlatformDocuments.map((doc) => (
                <PlatformDocumentVersionRow key={doc.slug} doc={doc} />
              ))}
              {completedPagination.items.map((request) => (
              {completedRequests.map((request) => (
                <div
                  key={request.id}
                  className="flex items-center justify-between p-4 border rounded-lg hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-semibold">{request.documentType}</p>
                      <p className="text-sm text-muted-foreground">
                        Completed {request.completedAt && format(new Date(request.completedAt?.seconds * 1000), "MMM d, yyyy 'at' h:mm a")}
                      </p>
                      {request.fileName && (
                        <p className="text-sm text-muted-foreground mt-1">
                          File: {request.fileName}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                      Complete
                    </Badge>
                    {request.documentUrl && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(request.documentUrl!, "_blank")}
                        >
                          <Eye className="mr-2 h-4 w-4" />
                          View
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDownload(request.documentUrl!, request.fileName || "document.pdf")}
                        >
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <ListPagination
              page={completedPagination.page}
              totalItems={completedRequests.length}
              onPageChange={setCompletedPage}
              itemLabel="documents"
            />
            </>
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}

export default function DocumentsPage() {
  return (
    <Suspense
      fallback={
        <div className="container mx-auto py-6 space-y-6">
          <div className="h-10 w-64 animate-pulse rounded-md bg-muted" />
          <div className="h-48 animate-pulse rounded-xl bg-muted" />
        </div>
      }
    >
      <DocumentsPageContent />
    </Suspense>
  );
}

