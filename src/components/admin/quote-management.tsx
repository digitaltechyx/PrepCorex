
"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { generateQuoteInvoicePdfBlob } from "@/lib/quote-invoice-generator";
import {
  Badge,
} from "@/components/ui/badge";
import {
  Button,
} from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle,
  Download,
  Eye,
  Loader2,
  Mail,
  Pencil,
  Plus,
  Send,
  Trash2,
  XCircle,
  FileText,
  Clock,
  TrendingUp,
  X,
  Archive,
  BookOpen,
  RotateCcw,
} from "lucide-react";

type QuoteStatus = "draft" | "sent" | "accepted" | "lost";

interface QuoteLineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface QuoteEmailLog {
  type: "send" | "follow_up" | "invoice";
  to: string;
  subject: string;
  message: string;
  attachments: { name: string; size: number }[];
  sentAt: any;
  sentBy?: string;
  followUpStep?: 1 | 2 | 3;
  autoFollowUp?: boolean;
}

interface QuoteDecisionDetails {
  clientName?: string;
  clientEmail?: string;
  clientContact?: string;
  clientCompany?: string;
  notes?: string;
  decidedAt?: any;
  decidedBy?: string;
}

interface Quote {
  id: string;
  status: QuoteStatus;
  reference: string;
  quoteDate: string;
  validUntil: string;
  recipientName: string;
  recipientEmail: string;
  recipientAddress?: string;
  recipientCity?: string;
  recipientState?: string;
  recipientZip?: string;
  recipientCountry?: string;
  recipientPhone?: string;
  subject: string;
  message: string;
  notes?: string;
  terms?: string;
  items: QuoteLineItem[];
  subtotal: number;
  salesTax: number;
  shippingCost: number;
  total: number;
  preparedBy?: string;
  approvedBy?: string;
  preparedDate?: string;
  approvedDate?: string;
  createdAt?: any;
  updatedAt?: any;
  sentAt?: any;
  followUpCount?: number;
  lastFollowUpAt?: any;
  emailLog?: QuoteEmailLog[];
  acceptedDetails?: QuoteDecisionDetails;
  lostDetails?: QuoteDecisionDetails;
  convertedInvoiceId?: string;
  convertedInvoiceNumber?: string;
  convertedAt?: any;
  invoiceSentAt?: any;
}

type FollowUpLogRow = {
  id: string;
  quoteId: string;
  quoteReference: string;
  clientName: string;
  clientEmail: string;
  followUpStep: 1 | 2 | 3 | null;
  sentAt: any;
  sentBy?: string;
  subject: string;
  message: string;
  autoFollowUp?: boolean;
};

const FOLLOW_UP_LIMIT = 3;
const TAX_RATE = 0.06625;
const TZ_NEW_JERSEY = "America/New_York";
const FOLLOW_UP_THROTTLE_MS = 10 * 60 * 1000;

const COMPANY_INFO = {
  name: "Prep Services FBA",
  addressLines: ["7000 Atrium Way B05", "Mount Laurel, NJ, 08054"],
  phone: "+1-347-661-3010",
  email: "info@prepservicesfba.com",
};

// Default terms for invoices (should match invoice-management-portal)
const INVOICE_TERMS = [
  "Invoices must be paid in full before work begins unless written credit terms are approved by management.",
  "Unpaid invoices after the due time may incur a $19 late fee per invoice.",
  "Prep Services FBA may pause receiving, prep, storage, and shipments until payment is completed.",
  "All completed labor services are non-refundable.",
  "Client is responsible for product compliance, labeling accuracy, and marketplace requirements.",
  "Any billing concern must be reported within 5 business days of invoice receipt. Unauthorized chargebacks may result in service suspension.",
].join("\n");

const createEmptyItem = (): QuoteLineItem => ({
  id: crypto.randomUUID(),
  description: "",
  quantity: 1,
  unitPrice: 0,
  amount: 0,
});

const createEmptyQuoteForm = (): Omit<Quote, "id" | "status" | "createdAt" | "updatedAt"> => {
  const today = new Date();
  const validUntil = new Date(today);
  validUntil.setDate(today.getDate() + 7);
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return {
    reference: `Q-${year}${month}-${randomNum}`,
    quoteDate: today.toISOString().slice(0, 10),
    validUntil: validUntil.toISOString().slice(0, 10),
    recipientName: "",
    recipientEmail: "",
    recipientAddress: "",
    recipientCity: "",
    recipientState: "",
    recipientZip: "",
    recipientCountry: "",
    recipientPhone: "",
    subject: "",
    message: "",
    notes: "",
    terms:
      "Payment is required 100% upfront before any prep work or shipments are processed.\n" +
      "All quantities are confirmed based on physical inventory received at our warehouse only.\n" +
      "Client is responsible for supplier, carrier, or Amazon inbound discrepancies.\n" +
      "Client is responsible for providing accurate FNSKU labels, prep instructions, and Amazon compliance requirements.\n" +
      "Client shipments leave our facility; carrier delays, losses, or Amazon receiving issues are not our responsibility.\n" +
      "Completed orders not shipped or collected within 7 days may incur storage fees.\n" +
      "Quotes are estimates only. The final invoice is based on the actual received units and services performed.",
    items: [createEmptyItem()],
    subtotal: 0,
    salesTax: 0,
    shippingCost: 0,
    total: 0,
    preparedBy: "",
    approvedBy: "",
    preparedDate: "",
    approvedDate: "",
    sentAt: undefined,
    followUpCount: 0,
    lastFollowUpAt: undefined,
    emailLog: [],
    acceptedDetails: undefined,
    lostDetails: undefined,
    convertedInvoiceId: undefined,
    convertedAt: undefined,
  };
};

const formatDate = (value?: any) => {
  if (!value) return "—";
  const date =
    value?.toDate?.() ||
    (typeof value?.seconds === "number" ? new Date(value.seconds * 1000) : null) ||
    (typeof value === "string" ? new Date(value) : null) ||
    (value instanceof Date ? value : null);
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString();
};

const formatDateTime = (value?: any) => {
  if (!value) return "—";
  const date =
    value?.toDate?.() ||
    (typeof value?.seconds === "number" ? new Date(value.seconds * 1000) : null) ||
    (typeof value === "string" ? new Date(value) : null) ||
    (value instanceof Date ? value : null);
  if (!date || Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
};

const getDateMs = (value?: any): number => {
  if (!value) return 0;
  const date =
    value?.toDate?.() ||
    (typeof value?.seconds === "number" ? new Date(value.seconds * 1000) : null) ||
    (typeof value === "string" ? new Date(value) : null) ||
    (value instanceof Date ? value : null);
  if (!date || Number.isNaN(date.getTime())) return 0;
  return date.getTime();
};

const formatDateForDisplay = (dateString?: string) => {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) return dateString;
    return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  } catch {
    return dateString;
  }
};

const getTodayDateInputInNJ = (): string => {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ_NEW_JERSEY,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;
  if (!year || !month || !day) return new Date().toISOString().slice(0, 10);
  return `${year}-${month}-${day}`;
};

const addDaysToDateInput = (value: string, days: number): string | null => {
  const base = parseDateOnlyLocal(value);
  if (!base) return null;
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return formatDateInputLocal(next);
};

const getAutoFollowUpPlan = (quoteDate?: string, validUntil?: string) => {
  if (!quoteDate || !validUntil) return [] as Array<{ step: 1 | 2 | 3; sendDate: string }>;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate) || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return [] as Array<{ step: 1 | 2 | 3; sendDate: string }>;

  const offsets: Array<{ step: 1 | 2 | 3; offset: number }> = [
    { step: 1, offset: -2 },
    { step: 2, offset: -1 },
    { step: 3, offset: 0 },
  ];

  return offsets
    .map(({ step, offset }) => {
      const sendDate = addDaysToDateInput(validUntil, offset);
      return sendDate ? { step, sendDate } : null;
    })
    .filter((entry): entry is { step: 1 | 2 | 3; sendDate: string } => Boolean(entry) && entry.sendDate >= quoteDate);
};

// Helper function to check if a quote is expired (New Jersey date boundary)
const isQuoteExpired = (validUntil?: string): boolean => {
  if (!validUntil || !/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return false;
  return validUntil < getTodayDateInputInNJ();
};

const formatTermsAsBullets = (terms?: string) => {
  if (!terms) return [];
  return terms
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
};

const calculateTotals = (items: QuoteLineItem[], shippingCost: number, salesTax: number) => {
  const normalized = items.map((item) => ({
    ...item,
    amount: Number(item.quantity || 0) * Number(item.unitPrice || 0),
  }));
  const subtotal = normalized.reduce((sum, item) => sum + (item.amount || 0), 0);
  const total = subtotal + Number(salesTax || 0) + Number(shippingCost || 0);
  return { items: normalized, subtotal, salesTax, total };
};

export function QuoteManagement() {
  const { userProfile, user } = useAuth();
  const { toast } = useToast();

  const toBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  };
  const quoteTemplateRef = useRef<HTMLDivElement | null>(null);
  const quoteContentRef = useRef<HTMLDivElement | null>(null);
  const quoteFooterRef = useRef<HTMLDivElement | null>(null);
  const quotesQuery = useMemo(
    () => query(collection(db, "quotes"), orderBy("createdAt", "desc")),
    []
  );
  const { data: quotes, loading } = useCollection<Quote>("quotes", quotesQuery);
  
  const deleteLogsQuery = useMemo(
    () => query(collection(db, "quote_delete_logs"), orderBy("deletedAt", "desc")),
    []
  );
  const { data: deleteLogs, loading: deleteLogsLoading } = useCollection<any>("quote_delete_logs", deleteLogsQuery);

  const [activeTab, setActiveTab] = useState("new");
  const [formData, setFormData] = useState(createEmptyQuoteForm());
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailMode, setEmailMode] = useState<"send" | "follow_up" | "invoice">("send");
  const [activeEmailQuote, setActiveEmailQuote] = useState<Quote | null>(null);
  const [decisionDialogOpen, setDecisionDialogOpen] = useState(false);
  const [decisionQuote, setDecisionQuote] = useState<Quote | null>(null);
  const [decisionStatus, setDecisionStatus] = useState<"accepted" | "lost">("accepted");
  const [decisionDetails, setDecisionDetails] = useState<QuoteDecisionDetails>({});
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [isPrintMode, setIsPrintMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showConvertedOnly, setShowConvertedOnly] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: "",
    subject: "",
    message: "",
    attachments: [] as File[],
    invoiceDueDate: "" as string,
  });
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteQuote, setDeleteQuote] = useState<Quote | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  // Address Book state
  const [addressBookFilter, setAddressBookFilter] = useState<"all" | "draft" | "sent" | "accepted" | "rejected">("all");
  const [addressBookSearch, setAddressBookSearch] = useState("");
  const [downloadType, setDownloadType] = useState<"all" | "draft" | "sent" | "accepted" | "rejected">("all");
  
  // Expired status filter state for tabs that still need mixed views
  const [acceptedStatusFilter, setAcceptedStatusFilter] = useState<"all" | "active" | "expired">("all");
  const [rejectedStatusFilter, setRejectedStatusFilter] = useState<"all" | "active" | "expired">("all");
  const [convertStatusFilter, setConvertStatusFilter] = useState<"all" | "active" | "expired">("all");

  const statusCounts = useMemo(() => {
    const counts = { draft: 0, sent: 0, accepted: 0, lost: 0 };
    quotes.forEach((quote) => {
      counts[quote.status] += 1;
    });
    return counts;
  }, [quotes]);

  const draftQuotes = quotes.filter((q) => q.status === "draft");
  const sentQuotes = quotes.filter((q) => q.status === "sent");
  const activeSentQuotes = sentQuotes.filter((q) => !isQuoteExpired(q.validUntil));
  const expiredQuotes = sentQuotes.filter((q) => isQuoteExpired(q.validUntil));
  const acceptedQuotes = quotes.filter((q) => q.status === "accepted");
  const lostQuotes = quotes.filter((q) => q.status === "lost");
  const filteredDraftQuotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return draftQuotes;
    return draftQuotes.filter((quote) =>
      [quote.reference, quote.recipientName, quote.recipientEmail]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))
    );
  }, [draftQuotes, searchQuery]);
  const filteredSentQuotes = useMemo(() => {
    let filtered = activeSentQuotes;
    
    // Apply search filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((quote) =>
        [quote.reference, quote.recipientName, quote.recipientEmail]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      );
    }
    
    return filtered;
  }, [activeSentQuotes, searchQuery]);
  const filteredAcceptedQuotes = useMemo(() => {
    let filtered = acceptedQuotes;
    
    // Apply expired status filter
    if (acceptedStatusFilter !== "all") {
      filtered = filtered.filter((quote) => {
        const expired = isQuoteExpired(quote.validUntil);
        return acceptedStatusFilter === "expired" ? expired : !expired;
      });
    }
    
    // Apply search filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((quote) =>
        [quote.reference, quote.recipientName, quote.recipientEmail]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      );
    }
    
    return filtered;
  }, [acceptedQuotes, searchQuery, acceptedStatusFilter]);
  const filteredLostQuotes = useMemo(() => {
    let filtered = lostQuotes;
    
    // Apply expired status filter
    if (rejectedStatusFilter !== "all") {
      filtered = filtered.filter((quote) => {
        const expired = isQuoteExpired(quote.validUntil);
        return rejectedStatusFilter === "expired" ? expired : !expired;
      });
    }
    
    // Apply search filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((quote) =>
        [quote.reference, quote.recipientName, quote.recipientEmail]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      );
    }
    
    return filtered;
  }, [lostQuotes, searchQuery, rejectedStatusFilter]);
  const filteredConvertibleQuotes = useMemo(() => {
    let base = acceptedQuotes;
    
    // Apply expired status filter
    if (convertStatusFilter !== "all") {
      base = base.filter((quote) => {
        const expired = isQuoteExpired(quote.validUntil);
        return convertStatusFilter === "expired" ? expired : !expired;
      });
    }
    
    // Apply search filter
    const query = searchQuery.trim().toLowerCase();
    if (query) {
      base = base.filter((quote) =>
        [quote.reference, quote.recipientName, quote.recipientEmail]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      );
    }
    
    // Apply converted filter
    if (showConvertedOnly) {
      base = base.filter((quote) => Boolean(quote.convertedInvoiceId));
    }
    
    return base;
  }, [acceptedQuotes, searchQuery, convertStatusFilter, showConvertedOnly]);

  // Filtered delete logs
  const filteredDeleteLogs = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return deleteLogs;
    return deleteLogs.filter((log: any) =>
      log.reference?.toLowerCase().includes(query) ||
      log.recipientName?.toLowerCase().includes(query) ||
      log.recipientEmail?.toLowerCase().includes(query)
    );
  }, [deleteLogs, searchQuery]);

  const followUpLogRows = useMemo<FollowUpLogRow[]>(() => {
    const rows: FollowUpLogRow[] = [];
    quotes.forEach((quote) => {
      const logs = quote.emailLog || [];
      logs.forEach((entry, idx) => {
        if (entry.type !== "follow_up") return;
        rows.push({
          id: `${quote.id}-${idx}-${getDateMs(entry.sentAt)}`,
          quoteId: quote.id,
          quoteReference: quote.reference || "—",
          clientName: quote.recipientName || "—",
          clientEmail: quote.recipientEmail || "—",
          followUpStep: entry.followUpStep ?? null,
          sentAt: entry.sentAt,
          sentBy: entry.sentBy,
          subject: entry.subject || "Follow-up",
          message: entry.message || "",
          autoFollowUp: entry.autoFollowUp,
        });
      });
    });
    return rows.sort((a, b) => getDateMs(b.sentAt) - getDateMs(a.sentAt));
  }, [quotes]);

  const filteredFollowUpLogRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return followUpLogRows;
    return followUpLogRows.filter((row) =>
      [
        row.quoteReference,
        row.clientName,
        row.clientEmail,
        row.subject,
        row.followUpStep ? `follow up ${row.followUpStep}` : "",
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query))
    );
  }, [followUpLogRows, searchQuery]);

  // Address Book filtered quotes
  const addressBookQuotes = useMemo(() => {
    let filtered = quotes;
    
    // Apply status filter
    if (addressBookFilter !== "all") {
      filtered = filtered.filter((quote) => {
        if (addressBookFilter === "rejected") {
          return quote.status === "lost";
        }
        return quote.status === addressBookFilter;
      });
    }
    
    // Apply search filter
    const query = addressBookSearch.trim().toLowerCase();
    if (query) {
      filtered = filtered.filter((quote) =>
        [quote.reference, quote.recipientName, quote.recipientEmail]
          .filter(Boolean)
          .some((value) => value!.toLowerCase().includes(query))
      );
    }
    
    return filtered;
  }, [quotes, addressBookFilter, addressBookSearch]);

  // Pagination helper function
  const getPaginatedData = <T,>(data: T[], page: number) => {
    const totalPages = Math.ceil(data.length / itemsPerPage);
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    const paginatedData = data.slice(startIndex, endIndex);
    return { paginatedData, totalPages, startIndex, endIndex };
  };

  // Reset page when tab changes or search query changes
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setCurrentPage(1);
  };

  // Reset page when search query changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, acceptedStatusFilter, rejectedStatusFilter, convertStatusFilter]);

  // Auto-delete drafts older than 10 days
  useEffect(() => {
    const checkAndAutoDeleteOldDrafts = async () => {
      if (loading || !quotes.length) return;

      const now = new Date();
      const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const oldDrafts = draftQuotes.filter((quote) => {
        if (!quote.createdAt && !quote.updatedAt) return false;
        
        // Get the most recent date (updatedAt if exists, otherwise createdAt)
        const dateToCheck = quote.updatedAt || quote.createdAt;
        let quoteDate: Date | null = null;
        
        if (dateToCheck) {
          if (typeof dateToCheck === 'string') {
            quoteDate = new Date(dateToCheck);
          } else if (dateToCheck && typeof dateToCheck === 'object' && 'toDate' in dateToCheck) {
            quoteDate = dateToCheck.toDate();
          } else if (dateToCheck && typeof dateToCheck === 'object' && 'seconds' in dateToCheck) {
            quoteDate = new Date((dateToCheck as any).seconds * 1000);
          }
        }
        
        if (!quoteDate || isNaN(quoteDate.getTime())) return false;
        
        return quoteDate < tenDaysAgo;
      });

      if (oldDrafts.length === 0) return;

      // Process each old draft
      for (const quote of oldDrafts) {
        try {
          // Prepare deletion log data
          const deletionLogData: any = {
            quoteId: quote.id,
            reference: quote.reference || "",
            recipientName: quote.recipientName || "",
            recipientEmail: quote.recipientEmail || "",
            recipientAddress: quote.recipientAddress || "",
            recipientCity: quote.recipientCity || "",
            recipientState: quote.recipientState || "",
            recipientZip: quote.recipientZip || "",
            recipientCountry: quote.recipientCountry || "",
            recipientPhone: quote.recipientPhone || "",
            status: quote.status || "draft",
            subtotal: quote.subtotal || 0,
            salesTax: quote.salesTax || 0,
            shippingCost: quote.shippingCost || 0,
            total: quote.total || 0,
            items: quote.items || [],
            quoteDate: quote.quoteDate || "",
            validUntil: quote.validUntil || "",
            terms: quote.terms || "",
            preparedBy: quote.preparedBy || "",
            approvedBy: quote.approvedBy || "",
            reason: "Auto-deleted: Draft older than 10 days without action",
            deletedBy: "system",
            deletedByName: "System (Auto-delete)",
            deletedAt: serverTimestamp(),
            followUpCount: quote.followUpCount || 0,
            autoDeleted: true,
          };

          // Only include timestamp fields if they exist
          if (quote.createdAt) {
            deletionLogData.createdAt = quote.createdAt;
          }
          if (quote.updatedAt) {
            deletionLogData.updatedAt = quote.updatedAt;
          }

          // Filter out undefined values
          const cleanLogData = Object.fromEntries(
            Object.entries(deletionLogData).filter(([_, value]) => value !== undefined)
          );

          // Save deletion log
          await addDoc(collection(db, "quote_delete_logs"), cleanLogData);
          
          // Delete the quote
          await deleteDoc(doc(db, "quotes", quote.id));
        } catch (error) {
          console.error(`Failed to auto-delete draft ${quote.id}:`, error);
        }
      }

      if (oldDrafts.length > 0) {
        toast({ 
          title: `${oldDrafts.length} draft(s) auto-deleted`, 
          description: "Drafts older than 10 days have been moved to the Deleted tab."
        });
      }
    };

    checkAndAutoDeleteOldDrafts();
  }, [quotes, loading, draftQuotes]);

  const resetForm = () => {
    setFormData(createEmptyQuoteForm());
    setEditingQuoteId(null);
  };

  const mapQuoteToFormData = (quote: Quote) => ({
    reference: quote.reference,
    quoteDate: quote.quoteDate,
    validUntil: quote.validUntil,
    recipientName: quote.recipientName,
    recipientEmail: quote.recipientEmail,
    recipientAddress: quote.recipientAddress || "",
    recipientCity: quote.recipientCity || "",
    recipientState: quote.recipientState || "",
    recipientZip: quote.recipientZip || "",
    recipientCountry: quote.recipientCountry || "",
    recipientPhone: quote.recipientPhone || "",
    subject: quote.subject || "",
    message: quote.message || "",
    notes: quote.notes || "",
    terms: quote.terms || "",
    items: quote.items.length ? quote.items : [createEmptyItem()],
    subtotal: quote.subtotal,
    salesTax: quote.salesTax || 0,
    shippingCost: quote.shippingCost || 0,
    total: quote.total,
    preparedBy: quote.preparedBy || "",
    approvedBy: quote.approvedBy || "",
    preparedDate: quote.preparedDate || "",
    approvedDate: quote.approvedDate || "",
    sentAt: quote.sentAt,
    followUpCount: quote.followUpCount ?? 0,
    lastFollowUpAt: quote.lastFollowUpAt,
    emailLog: quote.emailLog ?? [],
    acceptedDetails: quote.acceptedDetails,
    lostDetails: quote.lostDetails,
    convertedInvoiceId: quote.convertedInvoiceId,
    convertedAt: quote.convertedAt,
  });

  const validateForm = () => {
    if (!formData.recipientName.trim()) {
      toast({ variant: "destructive", title: "Recipient name is required." });
      return false;
    }
    if (!formData.recipientEmail.trim()) {
      toast({ variant: "destructive", title: "Recipient email is required." });
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.recipientEmail.trim())) {
      toast({ variant: "destructive", title: "Recipient email is invalid." });
      return false;
    }
    if (!formData.items.length || formData.items.every((item) => !item.description.trim())) {
      toast({ variant: "destructive", title: "Add at least one line item." });
      return false;
    }
    return true;
  };

  const handleSaveDraft = async () => {
    // For drafts, only validate that we have at least a reference number
    if (!formData.reference.trim()) {
      toast({ variant: "destructive", title: "Quotation number is required." });
      return;
    }
    setSaving(true);
    try {
      const { items, subtotal, salesTax, total } = calculateTotals(
        formData.items,
        formData.shippingCost,
        formData.salesTax
      );
      
      // Remove undefined values from formData (Firestore doesn't allow undefined)
      const cleanFormData = Object.fromEntries(
        Object.entries(formData).filter(([_, value]) => value !== undefined)
      );
      
      if (editingQuoteId) {
        await updateDoc(doc(db, "quotes", editingQuoteId), {
          ...cleanFormData,
          items,
          subtotal,
          salesTax,
          total,
          status: "draft",
          updatedAt: serverTimestamp(),
        });
        toast({ title: "Draft updated." });
      } else {
        await addDoc(collection(db, "quotes"), {
          ...cleanFormData,
          items,
          subtotal,
          salesTax,
          total,
          status: "draft",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userProfile?.uid || "",
        });
        toast({ title: "Draft saved." });
      }
      resetForm();
      setActiveTab("draft");
    } catch (error) {
      console.error("Failed to save draft:", error);
      toast({ 
        variant: "destructive", 
        title: "Failed to save draft.",
        description: error instanceof Error ? error.message : "Please try again."
      });
    } finally {
      setSaving(false);
    }
  };

  const openEmailDialog = (quote: Quote, mode: "send" | "follow_up" | "invoice") => {
    setEmailMode(mode);
    setActiveEmailQuote(quote);
    if (mode === "send") {
      setFormData(mapQuoteToFormData(quote));
      setEditingQuoteId(quote.id);
      if (activeTab !== "new") {
        setActiveTab("new");
      }
    }
    if (mode !== "send") {
      setEditingQuoteId(null);
    }
    const invoiceNumber = quote.convertedInvoiceNumber || `INV-${quote.reference}`;
    const defaultDueDate =
      mode === "invoice"
        ? /^\d{4}-\d{2}-\d{2}$/.test(quote.validUntil || "")
          ? quote.validUntil!
          : (() => {
              const d = new Date();
              d.setDate(d.getDate() + 2);
              return d.toISOString().slice(0, 10);
            })()
        : "";
    setEmailForm({
      to: quote.recipientEmail,
      subject:
        mode === "invoice"
          ? `Prep Services FBA - Invoice ${invoiceNumber}`
          : quote.subject || `Prep Services FBA - Quotation ${quote.reference}`,
      message: quote.message || "",
      attachments: [],
      invoiceDueDate: defaultDueDate,
    });
    setEmailDialogOpen(true);
  };

  const handleSendFromForm = async () => {
    if (!validateForm()) return;
    setSaving(true);
    try {
      const { items, subtotal, salesTax, total } = calculateTotals(
        formData.items,
        formData.shippingCost,
        formData.salesTax
      );
      
      // Remove undefined values from formData (Firestore doesn't allow undefined)
      const cleanFormData = Object.fromEntries(
        Object.entries(formData).filter(([_, value]) => value !== undefined)
      );
      
      if (editingQuoteId) {
        await updateDoc(doc(db, "quotes", editingQuoteId), {
          ...cleanFormData,
          items,
          subtotal,
          salesTax,
          total,
          updatedAt: serverTimestamp(),
        });
        const quote = quotes.find((q) => q.id === editingQuoteId);
        if (quote) {
          const preparedQuote = {
            ...quote,
            ...(cleanFormData as Omit<Quote, "id" | "status">),
            items,
            subtotal,
            salesTax,
            total,
          } as Quote;
          openEmailDialog(preparedQuote, "send");
        }
      } else {
        const docRef = await addDoc(collection(db, "quotes"), {
          ...cleanFormData,
          items,
          subtotal,
          salesTax,
          total,
          status: "draft",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdBy: userProfile?.uid || "",
        });
        const preparedQuote = {
          id: docRef.id,
          status: "draft",
          ...(cleanFormData as Omit<Quote, "id" | "status">),
          items,
          subtotal,
          salesTax,
          total,
        } as Quote;
        openEmailDialog(preparedQuote, "send");
      }
    } catch (error) {
      console.error("Failed to prepare send:", error);
      toast({ variant: "destructive", title: "Failed to prepare email." });
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteQuote = (quote: Quote) => {
    setDeleteQuote(quote);
    setDeleteReason("");
    setDeleteDialogOpen(true);
  };

  const confirmDeleteQuote = async () => {
    if (!deleteQuote) return;
    if (!deleteReason.trim()) {
      toast({ variant: "destructive", title: "Please provide a reason for deletion." });
      return;
    }
    setSaving(true);
    try {
      // Prepare deletion log data, filtering out undefined values and handling timestamps
      const deletionLogData: any = {
        quoteId: deleteQuote.id,
        reference: deleteQuote.reference || "",
        recipientName: deleteQuote.recipientName || "",
        recipientEmail: deleteQuote.recipientEmail || "",
        recipientAddress: deleteQuote.recipientAddress || "",
        recipientCity: deleteQuote.recipientCity || "",
        recipientState: deleteQuote.recipientState || "",
        recipientZip: deleteQuote.recipientZip || "",
        recipientCountry: deleteQuote.recipientCountry || "",
        recipientPhone: deleteQuote.recipientPhone || "",
        status: deleteQuote.status || "draft",
        subtotal: deleteQuote.subtotal || 0,
        salesTax: deleteQuote.salesTax || 0,
        shippingCost: deleteQuote.shippingCost || 0,
        total: deleteQuote.total || 0,
        items: deleteQuote.items || [],
        quoteDate: deleteQuote.quoteDate || "",
        validUntil: deleteQuote.validUntil || "",
        terms: deleteQuote.terms || "",
        preparedBy: deleteQuote.preparedBy || "",
        approvedBy: deleteQuote.approvedBy || "",
        reason: deleteReason.trim(),
        deletedBy: userProfile?.uid || "",
        deletedByName: userProfile?.name || userProfile?.email || "Unknown",
        deletedAt: serverTimestamp(),
        followUpCount: deleteQuote.followUpCount || 0,
      };

      // Only include timestamp fields if they exist and are valid
      if (deleteQuote.createdAt) {
        deletionLogData.createdAt = deleteQuote.createdAt;
      }
      if (deleteQuote.sentAt) {
        deletionLogData.sentAt = deleteQuote.sentAt;
      }
      if (deleteQuote.lastFollowUpAt) {
        deletionLogData.lastFollowUpAt = deleteQuote.lastFollowUpAt;
      }

      // Filter out undefined values
      const cleanLogData = Object.fromEntries(
        Object.entries(deletionLogData).filter(([_, value]) => value !== undefined)
      );

      // Save deletion log before deleting
      await addDoc(collection(db, "quote_delete_logs"), cleanLogData);
      
      // Delete the quote
      await deleteDoc(doc(db, "quotes", deleteQuote.id));
      toast({ title: "Quote deleted and logged." });
      setDeleteDialogOpen(false);
      setDeleteQuote(null);
      setDeleteReason("");
    } catch (error: any) {
      console.error("Failed to delete quote:", error);
      const errorMessage = error?.message || error?.code || "Unknown error occurred";
      toast({ 
        variant: "destructive", 
        title: "Failed to delete quote.",
        description: errorMessage.includes("permission") 
          ? "You don't have permission to delete quotes. Please contact an administrator."
          : errorMessage.includes("not-found")
          ? "Quote not found. It may have already been deleted."
          : `Error: ${errorMessage.substring(0, 100)}`
      });
    } finally {
      setSaving(false);
    }
  };

  const handleEditQuote = (quote: Quote) => {
    setFormData(mapQuoteToFormData(quote));
    setEditingQuoteId(quote.id);
    setActiveTab("new");
  };

  const generateQuotePdfFile = async (reference: string) => {
    setIsPrintMode(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 150));
      const hasContentAndFooter = quoteContentRef.current && quoteFooterRef.current;
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginPt = 40;
      const contentWidth = pageWidth - 2 * marginPt;
      const contentHeight = pageHeight - 2 * marginPt;

      if (hasContentAndFooter) {
        const contentCanvas = await html2canvas(quoteContentRef.current!, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
        });
        const footerCanvas = await html2canvas(quoteFooterRef.current!, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
        });
        const contentImgData = contentCanvas.toDataURL("image/png");
        const footerImgData = footerCanvas.toDataURL("image/png");
        const contentImgHeight = (contentCanvas.height * contentWidth) / contentCanvas.width;
        const footerImgHeight = (footerCanvas.height * contentWidth) / footerCanvas.width;
        const footerGap = 20;
        let y = marginPt;
        let contentBottomY = marginPt;

        if (contentImgHeight <= contentHeight) {
          pdf.addImage(contentImgData, "PNG", marginPt, marginPt, contentWidth, contentImgHeight);
          contentBottomY = marginPt + contentImgHeight;
        } else {
          let remainingHeight = contentImgHeight;
          while (remainingHeight > 0) {
            pdf.addImage(contentImgData, "PNG", marginPt, y, contentWidth, contentImgHeight);
            remainingHeight -= contentHeight;
            contentBottomY = y + contentImgHeight;
            y -= contentHeight;
            if (remainingHeight > 0) pdf.addPage();
          }
        }

        const spaceLeft = pageHeight - marginPt - contentBottomY;
        if (spaceLeft >= footerImgHeight + footerGap) {
          pdf.addImage(footerImgData, "PNG", marginPt, contentBottomY + footerGap, contentWidth, footerImgHeight);
        } else {
          pdf.addPage();
          pdf.addImage(footerImgData, "PNG", marginPt, marginPt, contentWidth, footerImgHeight);
        }
      } else if (quoteTemplateRef.current) {
        const canvas = await html2canvas(quoteTemplateRef.current, {
          backgroundColor: "#ffffff",
          scale: 2,
          useCORS: true,
        });
        const imgData = canvas.toDataURL("image/png");
        const imgHeight = (canvas.height * contentWidth) / canvas.width;
        let y = marginPt;
        if (imgHeight <= contentHeight) {
          pdf.addImage(imgData, "PNG", marginPt, marginPt, contentWidth, imgHeight);
        } else {
          let remainingHeight = imgHeight;
          while (remainingHeight > 0) {
            pdf.addImage(imgData, "PNG", marginPt, y, contentWidth, imgHeight);
            remainingHeight -= contentHeight;
            y -= contentHeight;
            if (remainingHeight > 0) pdf.addPage();
          }
        }
      } else {
        return null;
      }

      const pdfBlob = pdf.output("blob");
      return new File([pdfBlob], `${reference || "quotation"}.pdf`, { type: "application/pdf" });
    } finally {
      setIsPrintMode(false);
    }
  };

  const sendEmailRequest = async ({
    to,
    subject,
    message,
    attachments,
  }: {
    to: string;
    subject: string;
    message: string;
    attachments: File[];
  }) => {
    const idToken = user ? await user.getIdToken() : "";
    if (!idToken) {
      throw new Error("Please re-login and try again.");
    }

    const headers: HeadersInit = {
      Authorization: `Bearer ${idToken}`,
    };
    const externalEmailApi = process.env.NEXT_PUBLIC_EMAIL_API_URL;
    const vercelBypass = process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
    if (vercelBypass) {
      headers["x-vercel-protection-bypass"] = vercelBypass;
    }

    let response: Response;
    if (externalEmailApi) {
      const attachmentsPayload = await Promise.all(
        attachments.map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          dataBase64: toBase64(await file.arrayBuffer()),
        }))
      );

      response = await fetch(externalEmailApi, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          message: message || "",
          attachments: attachmentsPayload,
        }),
      });
    } else {
      const payload = new FormData();
      payload.append("to", to.trim());
      payload.append("subject", subject.trim());
      payload.append("message", message || "");
      attachments.forEach((file) => payload.append("attachments", file));

      const apiUrl = vercelBypass
        ? `/api/email/send?x-vercel-protection-bypass=${encodeURIComponent(vercelBypass)}`
        : "/api/email/send";

      response = await fetch(apiUrl, {
        method: "POST",
        headers,
        body: payload,
      });
    }

    const contentType = response.headers.get("content-type");
    let responseData: any = {};

    if (contentType && contentType.includes("application/json")) {
      try {
        responseData = await response.json();
      } catch {
        const textResponse = await response.text();
        throw new Error(`Server error: ${textResponse.substring(0, 200)}`);
      }
    } else {
      const textResponse = await response.text();
      const vercelId = response.headers.get("x-vercel-id");
      if (response.status === 403 && (vercelId || textResponse.toLowerCase().includes("forbidden"))) {
        throw new Error(
          "Request blocked by deployment protection. If this is a Vercel-protected dev domain, add NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS."
        );
      }
      throw new Error(`Server returned: ${textResponse.substring(0, 200)}`);
    }

    if (!response.ok) {
      throw new Error(responseData.error || `Email request failed (${response.status})`);
    }
  };

  const buildAutoFollowUpEmail = (quote: Quote, step: 1 | 2 | 3) => {
    const quoteNumber = quote.reference || "Quotation";
    const service = quote.subject || quote.items?.[0]?.description || "our service";
    const expiryDate = formatDateForDisplay(quote.validUntil) || quote.validUntil || "";
    const greeting = quote.recipientName ? `Hi ${quote.recipientName},` : "Hi,";

    if (step === 1) {
      return {
        subject: `Reminder: Quotation ${quoteNumber} expires on ${expiryDate}`,
        message: `${greeting}
I hope you are doing well. Just a quick note that your quotation (${quoteNumber}) for ${service} is scheduled to expire on ${expiryDate}.

If you have any questions regarding pricing, turnaround time, prep requirements, or shipping workflow, I would be happy to walk you through everything so you can move forward with full clarity.

We can also:
- adjust volumes
- align with your shipment plan
- reserve receiving slots

Let me know if you would like me to hold space for your upcoming inventory.

Best regards,
Arshad Iqbal
info@prepservicesfba.com | +1 347 661 3010 (WhatsApp)
www.prepservicesfba.com
7000 Atrium Way B05, Mount Laurel, NJ 08054`,
      };
    }

    if (step === 2) {
      return {
        subject: `Action Needed: Secure Capacity for Quotation ${quoteNumber}`,
        message: `${greeting}
As we are scheduling next week's inbound shipments, I wanted to check if you would like us to secure receiving capacity for your inventory under the current quotation (${quoteNumber}).

Your quoted rates are valid until ${expiryDate}, and after that availability will depend on the inbound schedule.

If your shipment timeline is confirmed, I can:
- reserve your intake window
- prepare the team in advance
- ensure faster turnaround on arrival

Just reply "Approve" and I will activate everything from our side.

Best regards,
Arshad Iqbal`,
      };
    }

    return {
      subject: `Final Reminder: Quotation ${quoteNumber} expires today`,
      message: `${greeting}
This is a quick reminder that your quotation (${quoteNumber}) for ${service} expires today.

To proceed and lock in the current pricing and priority receiving:
- Reply to this email with your approval, or
- Request the invoice and onboarding link.

Once approved, we will immediately:
- schedule your inbound
- allocate space
- prepare your workflow in our system

I would love to support your next shipment.

Best regards,
Arshad Iqbal`,
    };
  };

  const autoFollowUpLockRef = useRef(false);
  const autoFollowUpLastRunRef = useRef(0);

  useEffect(() => {
    if (loading || !quotes.length || !user) return;
    if (autoFollowUpLockRef.current) return;
    if (Date.now() - autoFollowUpLastRunRef.current < FOLLOW_UP_THROTTLE_MS) return;

    autoFollowUpLockRef.current = true;
    autoFollowUpLastRunRef.current = Date.now();

    const runAutoFollowUps = async () => {
      const todayNJ = getTodayDateInputInNJ();
      let sentCount = 0;

      const candidates = quotes.filter((quote) => {
        if (quote.status !== "sent") return false;
        if (!quote.recipientEmail || !quote.validUntil || !quote.quoteDate) return false;
        if (isQuoteExpired(quote.validUntil) && quote.validUntil !== todayNJ) return false;
        return true;
      });

      for (const quote of candidates) {
        try {
          const schedule = getAutoFollowUpPlan(quote.quoteDate, quote.validUntil);
          const todayStep = schedule.find((entry) => entry.sendDate === todayNJ);
          if (!todayStep) continue;

          const alreadySentThisStep = (quote.emailLog || []).some(
            (entry) => entry.type === "follow_up" && entry.followUpStep === todayStep.step
          );
          if (alreadySentThisStep) continue;

          const followUpCount = quote.followUpCount ?? 0;
          if (followUpCount >= FOLLOW_UP_LIMIT) continue;

          const email = buildAutoFollowUpEmail(quote, todayStep.step);
          await sendEmailRequest({
            to: quote.recipientEmail,
            subject: email.subject,
            message: email.message,
            attachments: [],
          });

          const logEntry: QuoteEmailLog = {
            type: "follow_up",
            to: quote.recipientEmail,
            subject: email.subject,
            message: email.message,
            attachments: [],
            sentAt: new Date(),
            sentBy: userProfile?.uid || "system-auto",
            followUpStep: todayStep.step,
            autoFollowUp: true,
          };

          await updateDoc(doc(db, "quotes", quote.id), {
            status: "sent",
            emailLog: [...(quote.emailLog || []), logEntry],
            followUpCount: Math.max(followUpCount, todayStep.step),
            lastFollowUpAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          sentCount += 1;
        } catch (error) {
          console.error(`Auto follow-up failed for quote ${quote.id}:`, error);
        }
      }

      if (sentCount > 0) {
        toast({
          title: `${sentCount} follow-up email(s) sent`,
          description: "Automated follow-ups were sent for quotes in the final 3-day window.",
        });
      }
    };

    runAutoFollowUps().finally(() => {
      autoFollowUpLockRef.current = false;
    });
  }, [loading, quotes, toast, user, userProfile?.uid]);

  const handleSendEmail = async () => {
    if (!activeEmailQuote) return;
    if (!emailForm.to.trim()) {
      toast({ variant: "destructive", title: "Recipient email is required." });
      return;
    }
    if (!emailForm.subject.trim()) {
      toast({ variant: "destructive", title: "Email subject is required." });
      return;
    }
    setIsSendingEmail(true);
    let restoreState: {
      activeTab: string;
      formData: typeof formData;
      editingQuoteId: string | null;
    } | null = null;
    try {
      let attachmentsToSend = emailForm.attachments;

      if (emailMode === "send") {
        const needsTemplateRefresh =
          activeTab !== "new" ||
          !quoteTemplateRef.current ||
          formData.reference !== activeEmailQuote.reference;
        if (needsTemplateRefresh) {
          restoreState = { activeTab, formData, editingQuoteId };
          setFormData(mapQuoteToFormData(activeEmailQuote));
          setEditingQuoteId(activeEmailQuote.id);
          if (activeTab !== "new") {
            setActiveTab("new");
          }
          await new Promise((resolve) => setTimeout(resolve, 120));
        }

        const autoAttachment = await generateQuotePdfFile(
          activeEmailQuote.reference || formData.reference
        );
        if (!autoAttachment) {
          throw new Error("Failed to generate quote PDF attachment.");
        }
        attachmentsToSend = [autoAttachment, ...emailForm.attachments];
      }

      if (emailMode === "invoice") {
        const invoiceData = buildInvoiceDataFromQuote(activeEmailQuote);
        const recipientCityStateZip = [
          activeEmailQuote.recipientCity,
          activeEmailQuote.recipientState,
          activeEmailQuote.recipientZip
        ].filter(Boolean).join(", ");
        
        const invoiceBlob = await generateQuoteInvoicePdfBlob({
          invoiceNumber: invoiceData.invoiceNumber,
          invoiceDate: typeof invoiceData.date === 'string' ? invoiceData.date : formatDateForDisplay(activeEmailQuote.quoteDate) || new Date().toISOString().slice(0, 10),
          company: {
            name: COMPANY_INFO.name,
            email: COMPANY_INFO.email,
            phone: COMPANY_INFO.phone,
            addressLine: COMPANY_INFO.addressLines[0] || "",
            cityStateZip: COMPANY_INFO.addressLines[1] || "",
            country: "United States",
          },
          soldTo: {
            name: activeEmailQuote.recipientName || "",
            email: activeEmailQuote.recipientEmail || "",
            phone: activeEmailQuote.recipientPhone || "",
            addressLine: activeEmailQuote.recipientAddress || "",
            cityStateZip: recipientCityStateZip,
            country: activeEmailQuote.recipientCountry || "",
          },
          items: invoiceData.items,
          subtotal: invoiceData.subtotal,
          salesTax: invoiceData.salesTax,
          shippingCost: invoiceData.shippingCost,
          total: invoiceData.total,
          terms: INVOICE_TERMS,
        });
        const invoiceFile = new File(
          [invoiceBlob],
          `Invoice-${invoiceData.invoiceNumber}.pdf`,
          { type: "application/pdf" }
        );
        attachmentsToSend = [invoiceFile, ...emailForm.attachments];
      }

      await sendEmailRequest({
        to: emailForm.to.trim(),
        subject: emailForm.subject.trim(),
        message: emailForm.message || "",
        attachments: attachmentsToSend,
      });

      const logEntry: QuoteEmailLog = {
        type: emailMode,
        to: emailForm.to.trim(),
        subject: emailForm.subject.trim(),
        message: emailForm.message || "",
        attachments: attachmentsToSend.map((file) => ({
          name: file.name,
          size: file.size,
        })),
        sentAt: new Date(),
        sentBy: userProfile?.uid || "",
        ...(emailMode === "follow_up"
          ? {
              followUpStep: Math.min((activeEmailQuote.followUpCount ?? 0) + 1, FOLLOW_UP_LIMIT) as 1 | 2 | 3,
              autoFollowUp: false,
            }
          : {}),
      };

      const updatePayload: Partial<Quote> = {
        emailLog: [...(activeEmailQuote.emailLog || []), logEntry],
        updatedAt: serverTimestamp(),
      };

      if (emailMode !== "invoice") {
        const followUpCount = Math.min(
          (activeEmailQuote.followUpCount ?? 0) + (emailMode === "follow_up" ? 1 : 0),
          FOLLOW_UP_LIMIT
        );
        updatePayload.status = "sent";
        updatePayload.sentAt = activeEmailQuote.sentAt || new Date();
        updatePayload.followUpCount = followUpCount;
        updatePayload.lastFollowUpAt =
          emailMode === "follow_up"
            ? new Date()
            : activeEmailQuote.lastFollowUpAt ?? null;
      }

      if (emailMode === "invoice") {
        const inv = buildInvoiceDataFromQuote(activeEmailQuote);
        const invoiceDate =
          /^\d{4}-\d{2}-\d{2}$/.test(activeEmailQuote.quoteDate || "")
            ? (activeEmailQuote.quoteDate as string)
            : new Date().toISOString().slice(0, 10);
        const dueDate =
          emailForm.invoiceDueDate?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(emailForm.invoiceDueDate.trim())
            ? emailForm.invoiceDueDate.trim()
            : /^\d{4}-\d{2}-\d{2}$/.test(activeEmailQuote.validUntil || "")
              ? (activeEmailQuote.validUntil as string)
              : (() => {
                  const d = new Date();
                  d.setDate(d.getDate() + 2);
                  return d.toISOString().slice(0, 10);
                })();
        const externalInvoicePayload = {
          status: "sent",
          invoiceNumber: inv.invoiceNumber,
          invoiceDate,
          dueDate,
          clientName: activeEmailQuote.recipientName || "",
          clientEmail: activeEmailQuote.recipientEmail || "",
          clientPhone: activeEmailQuote.recipientPhone || "",
          clientAddress: activeEmailQuote.recipientAddress || "",
          clientCity: activeEmailQuote.recipientCity || "",
          clientState: activeEmailQuote.recipientState || "",
          clientZip: activeEmailQuote.recipientZip || "",
          clientCountry: activeEmailQuote.recipientCountry || "",
          // Use invoice terms (not quotation terms) for converted invoices
          terms: INVOICE_TERMS,
          items: activeEmailQuote.items.map((item) => ({
            id: item.id || crypto.randomUUID(),
            description: item.description || "",
            quantity: Number(item.quantity || 0),
            unitPrice: Number(item.unitPrice || 0),
            amount: Number(item.amount || 0),
          })),
          subtotal: activeEmailQuote.subtotal,
          salesTax: activeEmailQuote.salesTax || 0,
          shippingCost: activeEmailQuote.shippingCost || 0,
          total: activeEmailQuote.total,
          amountPaid: 0,
          outstandingBalance: activeEmailQuote.total,
          payments: [],
          sentAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          sourceQuoteId: activeEmailQuote.id,
        };
        const existing = await getDocs(
          query(
            collection(db, "external_invoices"),
            where("sourceQuoteId", "==", activeEmailQuote.id)
          )
        );
        if (existing.docs.length > 0) {
          await updateDoc(doc(db, "external_invoices", existing.docs[0].id), {
            status: "sent",
            dueDate,
            sentAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, "external_invoices"), {
            ...externalInvoicePayload,
            createdAt: serverTimestamp(),
          });
        }
        updatePayload.invoiceSentAt = serverTimestamp();
      }

      await updateDoc(doc(db, "quotes", activeEmailQuote.id), updatePayload);
      toast({
        title:
          emailMode === "invoice"
            ? "Invoice send."
            : emailMode === "send"
            ? "Quote send."
            : "Follow-up send.",
      });
      setEmailDialogOpen(false);
      setActiveEmailQuote(null);
      if (emailMode !== "invoice") {
        resetForm();
        setActiveTab("sent");
      }
    } catch (error) {
      console.error("Failed to send email:", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to send email. Please check your SMTP configuration.";
      if (restoreState) {
        setActiveTab(restoreState.activeTab);
        setFormData(restoreState.formData);
        setEditingQuoteId(restoreState.editingQuoteId);
      }
      toast({ 
        variant: "destructive", 
        title: "Failed to send email.",
        description: errorMessage
      });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const handleDecision = (quote: Quote, status: "accepted" | "lost") => {
    setDecisionQuote(quote);
    setDecisionStatus(status);
    setDecisionDetails({});
    setDecisionDialogOpen(true);
  };

  const buildInvoiceDataFromQuote = (quote: Quote) => {
    const invoiceNumber = quote.convertedInvoiceNumber || `INV-${quote.reference}`;
    const recipientCityStateZip = [quote.recipientCity, quote.recipientState, quote.recipientZip]
      .filter(Boolean)
      .join(", ");
    const invoiceDate = quote.convertedAt ? formatDate(quote.convertedAt) : formatDateForDisplay(quote.quoteDate);
    return {
      invoiceNumber,
      date: invoiceDate || formatDateForDisplay(quote.quoteDate) || "—",
      orderNumber: `ORD-${quote.reference}`,
      soldTo: {
        name: quote.recipientName || "",
        email: quote.recipientEmail || "",
        phone: quote.recipientPhone || "",
        addressLine: quote.recipientAddress || "",
        cityStateZip: recipientCityStateZip,
        country: quote.recipientCountry || "",
      },
      items: quote.items.map((item) => ({
        description: item.description || "",
        quantity: Number(item.quantity || 0),
        unitPrice: Number(item.unitPrice || 0),
        amount: Number(item.amount || 0),
      })),
      subtotal: quote.subtotal,
      salesTax: quote.salesTax || 0,
      shippingCost: quote.shippingCost || 0,
      total: quote.total,
    };
  };

  const submitDecision = async () => {
    if (!decisionQuote) return;
    setSaving(true);
    try {
      const payload =
        decisionStatus === "accepted"
          ? { acceptedDetails: { ...decisionDetails, decidedAt: new Date(), decidedBy: userProfile?.uid || "" } }
          : { lostDetails: { ...decisionDetails, decidedAt: new Date(), decidedBy: userProfile?.uid || "" } };
      await updateDoc(doc(db, "quotes", decisionQuote.id), {
        status: decisionStatus,
        ...payload,
        updatedAt: serverTimestamp(),
      });
      toast({ title: `Quote marked as ${decisionStatus}.` });
      setDecisionDialogOpen(false);
    } catch (error) {
      console.error("Failed to update decision:", error);
      toast({ variant: "destructive", title: "Failed to update quote." });
    } finally {
      setSaving(false);
    }
  };

  const handleConvertToInvoice = async (quote: Quote) => {
    setSaving(true);
    try {
      const invoiceNumber = quote.convertedInvoiceNumber || `INV-${quote.reference}`;
      const invoiceDate = new Date().toISOString().slice(0, 10);
      const invoiceDoc = await addDoc(collection(db, "quote_invoices"), {
        quoteId: quote.id,
        invoiceNumber,
        invoiceDate,
        orderNumber: `ORD-${quote.reference}`,
        reference: quote.reference,
        quoteDate: quote.quoteDate,
        validUntil: quote.validUntil,
        recipientName: quote.recipientName,
        recipientEmail: quote.recipientEmail,
        recipientAddress: quote.recipientAddress || "",
        recipientCity: quote.recipientCity || "",
        recipientState: quote.recipientState || "",
        recipientZip: quote.recipientZip || "",
        recipientPhone: quote.recipientPhone || "",
        items: quote.items,
        subtotal: quote.subtotal,
        salesTax: quote.salesTax || 0,
        shippingCost: quote.shippingCost || 0,
        total: quote.total,
        notes: quote.notes || "",
        terms: quote.terms || "",
        preparedBy: quote.preparedBy || "",
        approvedBy: quote.approvedBy || "",
        preparedDate: quote.preparedDate || "",
        approvedDate: quote.approvedDate || "",
        createdAt: serverTimestamp(),
        createdBy: userProfile?.uid || "",
      });
      await updateDoc(doc(db, "quotes", quote.id), {
        convertedInvoiceId: invoiceDoc.id,
        convertedInvoiceNumber: invoiceNumber,
        convertedAt: serverTimestamp(),
      });
      toast({ title: "Quote converted to invoice." });
    } catch (error) {
      console.error("Failed to convert quote:", error);
      toast({ variant: "destructive", title: "Failed to convert quote." });
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPdf = async () => {
    if (!quoteContentRef.current || !quoteFooterRef.current) return;
    setIsPrintMode(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 80));
      const contentCanvas = await html2canvas(quoteContentRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      const footerCanvas = await html2canvas(quoteFooterRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
      });
      const contentImgData = contentCanvas.toDataURL("image/png");
      const footerImgData = footerCanvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const marginPt = 40;
      const contentWidth = pageWidth - 2 * marginPt;
      const contentHeight = pageHeight - 2 * marginPt;
      const contentImgHeight = (contentCanvas.height * contentWidth) / contentCanvas.width;
      const footerImgHeight = (footerCanvas.height * contentWidth) / contentCanvas.width;
      const footerGap = 20;
      let y = marginPt;
      let contentBottomY = marginPt;

      if (contentImgHeight <= contentHeight) {
        pdf.addImage(contentImgData, "PNG", marginPt, marginPt, contentWidth, contentImgHeight);
        contentBottomY = marginPt + contentImgHeight;
      } else {
        let remainingHeight = contentImgHeight;
        while (remainingHeight > 0) {
          pdf.addImage(contentImgData, "PNG", marginPt, y, contentWidth, contentImgHeight);
          remainingHeight -= contentHeight;
          contentBottomY = y + contentImgHeight;
          y -= contentHeight;
          if (remainingHeight > 0) pdf.addPage();
        }
      }

      const spaceLeft = pageHeight - marginPt - contentBottomY;
      if (spaceLeft >= footerImgHeight + footerGap) {
        pdf.addImage(footerImgData, "PNG", marginPt, contentBottomY + footerGap, contentWidth, footerImgHeight);
      } else {
        pdf.addPage();
        pdf.addImage(footerImgData, "PNG", marginPt, marginPt, contentWidth, footerImgHeight);
      }

      pdf.save(`${formData.reference || "quotation"}.pdf`);
    } catch (error) {
      console.error("Failed to generate PDF:", error);
      toast({ variant: "destructive", title: "Failed to export PDF." });
    } finally {
      setIsPrintMode(false);
    }
  };

  const handleViewPdf = async (quote: Quote) => {
    const restoreState = {
      activeTab,
      formData,
      editingQuoteId,
    };
    try {
      setFormData(mapQuoteToFormData(quote));
      setEditingQuoteId(quote.id);
      if (activeTab !== "new") {
        setActiveTab("new");
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      const pdfFile = await generateQuotePdfFile(quote.reference);
      if (!pdfFile) {
        throw new Error("Failed to generate quote PDF.");
      }
      const pdfUrl = URL.createObjectURL(pdfFile);
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
    } catch (error) {
      console.error("Failed to preview PDF:", error);
      toast({ variant: "destructive", title: "Failed to preview PDF." });
    } finally {
      setActiveTab(restoreState.activeTab);
      setFormData(restoreState.formData);
      setEditingQuoteId(restoreState.editingQuoteId);
    }
  };

  const handleDownloadQuotePdf = async (quote: Quote) => {
    const restoreState = {
      activeTab,
      formData,
      editingQuoteId,
    };
    try {
      setFormData(mapQuoteToFormData(quote));
      setEditingQuoteId(quote.id);
      if (activeTab !== "new") {
        setActiveTab("new");
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      const pdfFile = await generateQuotePdfFile(quote.reference);
      if (!pdfFile) {
        throw new Error("Failed to generate quote PDF.");
      }
      const pdfUrl = URL.createObjectURL(pdfFile);
      const link = document.createElement("a");
      link.href = pdfUrl;
      link.download = pdfFile.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
    } catch (error) {
      console.error("Failed to download PDF:", error);
      toast({ variant: "destructive", title: "Failed to download PDF." });
    } finally {
      setActiveTab(restoreState.activeTab);
      setFormData(restoreState.formData);
      setEditingQuoteId(restoreState.editingQuoteId);
    }
  };

  const mapDeleteLogToFormData = (log: any) => ({
    reference: log.reference || "",
    quoteDate: log.quoteDate || "",
    validUntil: log.validUntil || "",
    recipientName: log.recipientName || "",
    recipientEmail: log.recipientEmail || "",
    recipientAddress: log.recipientAddress || "",
    recipientCity: log.recipientCity || "",
    recipientState: log.recipientState || "",
    recipientZip: log.recipientZip || "",
    recipientCountry: log.recipientCountry || "",
    recipientPhone: log.recipientPhone || "",
    subject: "",
    message: "",
    notes: "",
    terms: log.terms || "",
    items: log.items?.length ? log.items : [createEmptyItem()],
    subtotal: log.subtotal || 0,
    salesTax: log.salesTax || 0,
    shippingCost: log.shippingCost || 0,
    total: log.total || 0,
    preparedBy: log.preparedBy || "",
    approvedBy: log.approvedBy || "",
    preparedDate: "",
    approvedDate: "",
    sentAt: log.sentAt,
    followUpCount: log.followUpCount ?? 0,
    lastFollowUpAt: log.lastFollowUpAt,
    emailLog: [],
    acceptedDetails: undefined,
    lostDetails: undefined,
    convertedInvoiceId: undefined,
    convertedAt: undefined,
  });

  const handleViewDeletedQuote = async (log: any) => {
    const restoreState = {
      activeTab,
      formData,
      editingQuoteId,
    };
    try {
      const formDataFromLog = mapDeleteLogToFormData(log);
      setFormData(formDataFromLog);
      setEditingQuoteId(null);
      if (activeTab !== "new") {
        setActiveTab("new");
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
      const pdfFile = await generateQuotePdfFile(log.reference || "deleted-quote");
      if (!pdfFile) {
        throw new Error("Failed to generate quote PDF.");
      }
      const pdfUrl = URL.createObjectURL(pdfFile);
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
    } catch (error) {
      console.error("Failed to preview PDF:", error);
      toast({ variant: "destructive", title: "Failed to preview PDF." });
    } finally {
      setActiveTab(restoreState.activeTab);
      setFormData(restoreState.formData);
      setEditingQuoteId(restoreState.editingQuoteId);
    }
  };

  const handleRestoreQuote = async (log: any) => {
    if (!userProfile) {
      toast({ variant: "destructive", title: "You must be logged in to restore quotes." });
      return;
    }

    setSaving(true);
    try {
      // Convert log data to quote format
      const quoteData: Omit<Quote, "id"> = {
        reference: log.reference || "",
        quoteDate: log.quoteDate || new Date().toISOString().slice(0, 10),
        validUntil: log.validUntil || "",
        recipientName: log.recipientName || "",
        recipientEmail: log.recipientEmail || "",
        recipientAddress: log.recipientAddress || "",
        recipientCity: log.recipientCity || "",
        recipientState: log.recipientState || "",
        recipientZip: log.recipientZip || "",
        recipientCountry: log.recipientCountry || "",
        recipientPhone: log.recipientPhone || "",
        subject: "",
        message: "",
        notes: "",
        terms: log.terms || "",
        items: log.items?.length ? log.items : [createEmptyItem()],
        subtotal: log.subtotal || 0,
        salesTax: log.salesTax || 0,
        shippingCost: log.shippingCost || 0,
        total: log.total || 0,
        preparedBy: log.preparedBy || "",
        approvedBy: log.approvedBy || "",
        preparedDate: "",
        approvedDate: "",
        status: (log.status as QuoteStatus) || "draft",
        sentAt: log.sentAt,
        followUpCount: log.followUpCount ?? 0,
        lastFollowUpAt: log.lastFollowUpAt,
        emailLog: log.emailLog || [],
        acceptedDetails: log.acceptedDetails,
        lostDetails: log.lostDetails,
        convertedInvoiceId: log.convertedInvoiceId,
        convertedAt: log.convertedAt,
        convertedInvoiceNumber: log.convertedInvoiceNumber,
        createdAt: log.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Remove undefined values
      const cleanQuoteData = Object.fromEntries(
        Object.entries(quoteData).filter(([_, value]) => value !== undefined)
      ) as any;

      // Create the restored quote in Firestore
      await addDoc(collection(db, "quotes"), cleanQuoteData);

      toast({ 
        title: "Quote restored successfully", 
        description: `Quote ${log.reference || ""} has been restored to ${log.status || "draft"} status.`
      });

      // Navigate to the appropriate tab based on status
      const restoredStatus = (log.status as QuoteStatus) || "draft";
      if (restoredStatus === "draft") {
        setActiveTab("draft");
      } else if (restoredStatus === "sent") {
        setActiveTab("sent");
      } else if (restoredStatus === "accepted") {
        setActiveTab("accepted");
      } else if (restoredStatus === "lost") {
        setActiveTab("lost");
      } else {
        setActiveTab("draft");
      }
    } catch (error) {
      console.error("Failed to restore quote:", error);
      toast({ 
        variant: "destructive", 
        title: "Failed to restore quote.",
        description: error instanceof Error ? error.message : "An error occurred while restoring the quote."
      });
    } finally {
      setSaving(false);
    }
  };

  const handleViewInvoicePdf = async (quote: Quote) => {
    try {
      const invoiceData = buildInvoiceDataFromQuote(quote);
      const pdfBlob = await generateQuoteInvoicePdfBlob({
        invoiceNumber: invoiceData.invoiceNumber,
        invoiceDate: invoiceData.date,
        company: {
          name: COMPANY_INFO.name,
          email: COMPANY_INFO.email,
          phone: COMPANY_INFO.phone,
          addressLine: COMPANY_INFO.addressLines[0] || "",
          cityStateZip: COMPANY_INFO.addressLines[1] || "",
        },
        soldTo: invoiceData.soldTo,
        items: invoiceData.items,
        subtotal: invoiceData.subtotal,
        salesTax: invoiceData.salesTax,
        shippingCost: invoiceData.shippingCost,
        total: invoiceData.total,
        terms: INVOICE_TERMS,
      });
      const pdfUrl = URL.createObjectURL(pdfBlob);
      window.open(pdfUrl, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
    } catch (error) {
      console.error("Failed to preview invoice PDF:", error);
      toast({ variant: "destructive", title: "Failed to preview invoice." });
    }
  };

  const handleDownloadInvoicePdf = async (quote: Quote) => {
    try {
      const invoiceData = buildInvoiceDataFromQuote(quote);
      const pdfBlob = await generateQuoteInvoicePdfBlob({
        invoiceNumber: invoiceData.invoiceNumber,
        invoiceDate: invoiceData.date,
        company: {
          name: COMPANY_INFO.name,
          email: COMPANY_INFO.email,
          phone: COMPANY_INFO.phone,
          addressLine: COMPANY_INFO.addressLines[0] || "",
          cityStateZip: COMPANY_INFO.addressLines[1] || "",
        },
        soldTo: invoiceData.soldTo,
        items: invoiceData.items,
        subtotal: invoiceData.subtotal,
        salesTax: invoiceData.salesTax,
        shippingCost: invoiceData.shippingCost,
        total: invoiceData.total,
        terms: INVOICE_TERMS,
      });
      const pdfUrl = URL.createObjectURL(pdfBlob);
      const link = document.createElement("a");
      link.href = pdfUrl;
      link.download = `Invoice-${invoiceData.invoiceNumber}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
    } catch (error) {
      console.error("Failed to download invoice PDF:", error);
      toast({ variant: "destructive", title: "Failed to download invoice." });
    }
  };

  const downloadCsv = (rows: Quote[], filename: string) => {
    if (!rows.length) {
      toast({ variant: "destructive", title: "No data to export." });
      return;
    }
    const header = [
      "Reference",
      "Recipient Name",
      "Recipient Email",
      "Recipient Address",
      "Recipient City",
      "Recipient State",
      "Recipient Zip",
      "Recipient Country",
      "Recipient Phone",
      "Status",
      "Quote Date",
      "Valid Until",
      "Send At",
      "Follow Ups",
      "Subtotal",
      "Sales Tax",
      "Shipping Cost",
      "Total",
      "Client Name",
      "Client Email",
      "Client Contact",
      "Client Company",
      "Notes",
    ];
    const data = rows.map((quote) => {
      const details = quote.status === "accepted" ? quote.acceptedDetails : quote.lostDetails;
      return [
        quote.reference,
        quote.recipientName,
        quote.recipientEmail,
        quote.recipientAddress || "",
        quote.recipientCity || "",
        quote.recipientState || "",
        quote.recipientZip || "",
        quote.recipientCountry || "",
        quote.recipientPhone || "",
        quote.status === "lost" ? "rejected" : quote.status,
        formatDateForDisplay(quote.quoteDate),
        formatDateForDisplay(quote.validUntil),
        formatDate(quote.sentAt),
        `${quote.followUpCount ?? 0}/${FOLLOW_UP_LIMIT}`,
        quote.subtotal || 0,
        quote.salesTax || 0,
        quote.shippingCost || 0,
        quote.total || 0,
        details?.clientName || "",
        details?.clientEmail || "",
        details?.clientContact || "",
        details?.clientCompany || "",
        details?.notes || "",
      ];
    });
    const csv = [header, ...data]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAddressBookCsv = (rows: Quote[], filename: string) => {
    if (!rows.length) {
      toast({ variant: "destructive", title: "No data to export." });
      return;
    }
    const header = [
      "Reference",
      "Recipient Name",
      "Recipient Email",
      "Recipient Address",
      "Recipient City",
      "Recipient State",
      "Recipient Zip",
      "Recipient Country",
      "Recipient Phone",
      "Status",
      "Notes",
    ];
    const data = rows.map((quote) => {
      const details = quote.status === "accepted" ? quote.acceptedDetails : quote.lostDetails;
      const statusLabel = quote.status === "lost" ? "rejected" : quote.status;
      const notes = quote.notes ?? details?.notes ?? "";
      return [
        quote.reference,
        quote.recipientName,
        quote.recipientEmail,
        quote.recipientAddress || "",
        quote.recipientCity || "",
        quote.recipientState || "",
        quote.recipientZip || "",
        quote.recipientCountry || "",
        quote.recipientPhone || "",
        statusLabel,
        notes,
      ];
    });
    const csv = [header, ...data]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleAddressBookDownload = () => {
    let dataToDownload: Quote[] = [];
    let filename = "";

    switch (downloadType) {
      case "all":
        dataToDownload = quotes;
        filename = "all-quotes.csv";
        break;
      case "draft":
        dataToDownload = draftQuotes;
        filename = "draft-quotes.csv";
        break;
      case "sent":
        dataToDownload = sentQuotes;
        filename = "sent-quotes.csv";
        break;
      case "accepted":
        dataToDownload = acceptedQuotes;
        filename = "accepted-quotes.csv";
        break;
      case "rejected":
        dataToDownload = lostQuotes;
        filename = "rejected-quotes.csv";
        break;
    }

    downloadAddressBookCsv(dataToDownload, filename);
  };

  const updateItem = (index: number, field: keyof QuoteLineItem, value: string) => {
    const updated = [...formData.items];
    if (field === "quantity" || field === "unitPrice") {
      updated[index][field] = Number(value);
    } else {
      updated[index][field] = value as never;
    }
    const { items, subtotal, salesTax, total } = calculateTotals(
      updated,
      formData.shippingCost,
      formData.salesTax
    );
    setFormData((prev) => ({ ...prev, items, subtotal, salesTax, total }));
  };

  const addItem = () => {
    const updated = [...formData.items, createEmptyItem()];
    const { items, subtotal, salesTax, total } = calculateTotals(
      updated,
      formData.shippingCost,
      formData.salesTax
    );
    setFormData((prev) => ({ ...prev, items, subtotal, salesTax, total }));
  };

  const removeItem = (index: number) => {
    const updated = formData.items.filter((_, idx) => idx !== index);
    const fallback = updated.length ? updated : [createEmptyItem()];
    const { items, subtotal, salesTax, total } = calculateTotals(
      fallback,
      formData.shippingCost,
      formData.salesTax
    );
    setFormData((prev) => ({ ...prev, items, subtotal, salesTax, total }));
  };

  const statusLabel =
    decisionStatus === "lost" ? "rejected" : decisionStatus;
  const getQuoteStatusLabel = (quote: Quote, followUpCount: number) => {
    if (quote.status === "sent" && followUpCount > 0) return "Follow Up";
    if (quote.status === "lost") return "Rejected";
    return quote.status;
  };

  const renderQuoteRow = (quote: Quote, options?: { showActions?: boolean; showFollowUp?: boolean; showConvert?: boolean }) => {
    const followUpCount = quote.followUpCount ?? 0;
    const followUpLimitReached = followUpCount >= FOLLOW_UP_LIMIT;
    const isDraft = quote.status === "draft";
    const isExpired = isQuoteExpired(quote.validUntil);
    
    // Get status color scheme
    const getStatusColor = () => {
      if (isExpired) return "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10";
      if (quote.status === "accepted") return "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/10";
      if (quote.status === "lost") return "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10";
      if (quote.status === "sent") return "border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/10";
      return "border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10";
    };
    
    return (
      <Card
        key={quote.id}
        className={cn(
          "group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:scale-[1.01] border-2",
          getStatusColor(),
          followUpLimitReached && options?.showFollowUp && "ring-2 ring-red-300 dark:ring-red-700"
        )}
      >
        {/* Decorative gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-br from-white/50 to-transparent dark:from-gray-900/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
        
        <CardContent className="p-5 relative z-10">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            {/* Left Section - Client Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 shadow-md group-hover:scale-110 transition-transform">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100 truncate">
                    {quote.recipientName || "—"}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 truncate mt-0.5">
                    {quote.recipientEmail || "—"}
                  </p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                      {quote.reference}
                    </span>
                    {!isDraft && (
                      <span className="text-xs text-gray-500 dark:text-gray-400">
                        • Send {formatDate(quote.sentAt)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Middle Section - Status & Info */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge 
                    variant={quote.status === "accepted" ? "default" : quote.status === "lost" ? "destructive" : "secondary"}
                    className={cn(
                      "capitalize font-medium",
                      quote.status === "accepted" && "bg-gradient-to-r from-green-500 to-emerald-600 text-white",
                      quote.status === "lost" && "bg-gradient-to-r from-red-500 to-rose-600 text-white"
                    )}
                  >
                    {getQuoteStatusLabel(quote, followUpCount)}
                  </Badge>
                  {isExpired && (
                    <Badge variant="destructive" className="text-xs animate-pulse">
                      Expired
                    </Badge>
                  )}
                </div>
                {!isDraft && (
                  <div className="flex items-center gap-1 text-xs text-gray-600 dark:text-gray-400">
                    <Mail className="h-3 w-3" />
                    <span className={cn(
                      "font-medium",
                      followUpLimitReached && "text-red-600 dark:text-red-400 font-bold"
                    )}>
                      {followUpCount}/{FOLLOW_UP_LIMIT} follow ups
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Section - Actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => handleViewPdf(quote)}
                className="hover:bg-blue-500 hover:text-white hover:border-blue-500 dark:hover:bg-blue-600 transition-all shadow-sm hover:shadow-md"
              >
                <Eye className="h-4 w-4 mr-1" />
                View
              </Button>

              {options?.showConvert && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleConvertToInvoice(quote)}
                  disabled={Boolean(quote.convertedInvoiceId)}
                  className={cn(
                    "hover:bg-green-500 hover:text-white hover:border-green-500 dark:hover:bg-green-600 transition-all shadow-sm hover:shadow-md",
                    quote.convertedInvoiceId && "opacity-60 cursor-not-allowed"
                  )}
                >
                  <FileText className="h-4 w-4 mr-1" />
                  {quote.convertedInvoiceId ? "Converted" : "Convert to Invoice"}
                </Button>
              )}

              {options?.showConvert && quote.convertedInvoiceId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEmailDialog(quote, "invoice")}
                  disabled={!!quote.invoiceSentAt}
                  className="hover:bg-indigo-500 hover:text-white hover:border-indigo-500 dark:hover:bg-indigo-600 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Mail className="h-4 w-4 mr-1" />
                  {quote.invoiceSentAt ? "Invoice sent" : "Send Invoice"}
                </Button>
              )}
              
              {options?.showActions && (
                <>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleEditQuote(quote)}
                    className="hover:bg-blue-500 hover:text-white hover:border-blue-500 dark:hover:bg-blue-600 transition-all shadow-sm hover:shadow-md"
                  >
                    <Pencil className="h-4 w-4 mr-1" />
                    Edit
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => openEmailDialog(quote, "send")}
                    className="hover:bg-purple-500 hover:text-white hover:border-purple-500 dark:hover:bg-purple-600 transition-all shadow-sm hover:shadow-md"
                  >
                    <Send className="h-4 w-4 mr-1" />
                    Send
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm" 
                    onClick={() => handleDeleteQuote(quote)}
                    className="bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white shadow-md hover:shadow-lg transition-all"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete
                  </Button>
                </>
              )}
              
              {options?.showFollowUp && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={followUpLimitReached}
                    onClick={() => openEmailDialog(quote, "follow_up")}
                    className={cn(
                      "hover:bg-orange-500 hover:text-white hover:border-orange-500 dark:hover:bg-orange-600 transition-all shadow-sm hover:shadow-md",
                      followUpLimitReached && "opacity-50 cursor-not-allowed"
                    )}
                  >
                    <Mail className="h-4 w-4 mr-1" />
                    Follow Up
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleDecision(quote, "accepted")}
                    className="hover:bg-green-500 hover:text-white hover:border-green-500 dark:hover:bg-green-600 transition-all shadow-sm hover:shadow-md"
                  >
                    <CheckCircle className="h-4 w-4 mr-1" />
                    Accepted
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleDecision(quote, "lost")}
                    className="hover:bg-red-500 hover:text-white hover:border-red-500 dark:hover:bg-red-600 transition-all shadow-sm hover:shadow-md"
                  >
                    <XCircle className="h-4 w-4 mr-1" />
                    Reject
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="container mx-auto py-6 space-y-6">
      {/* Header Section */}
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-amber-50 via-orange-50 to-amber-100 dark:from-amber-950/20 dark:via-orange-950/20 dark:to-amber-900/20 border border-amber-200/50 dark:border-amber-800/50 p-6 shadow-lg">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-md">
              <FileText className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-amber-900 to-orange-900 dark:from-amber-100 dark:to-orange-100 bg-clip-text text-transparent">
              Quote Management
            </h1>
          </div>
          <p className="text-amber-800/80 dark:text-amber-200/80 ml-12">
            Create, send, and track quotation follow-ups with ease
          </p>
        </div>
        <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-amber-200/30 to-orange-200/30 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
      </div>

      {/* Status Cards */}
      <div className="space-y-4">
        {/* First Row: Accepted and Rejected */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card 
            className="relative overflow-hidden border-2 border-green-200 dark:border-green-800 bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 hover:shadow-xl transition-all duration-300 group cursor-pointer"
            onClick={() => handleTabChange("accepted")}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-green-200/40 to-emerald-200/40 rounded-full blur-2xl"></div>
            <CardHeader className="relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-green-700 dark:text-green-300 flex items-center gap-2">
                    <CheckCircle className="h-5 w-5" />
                    Accepted
                  </CardTitle>
                  <CardDescription className="text-green-600/80 dark:text-green-400/80">Won quotations</CardDescription>
                </div>
                <div className="p-3 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-md group-hover:scale-110 transition-transform">
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-4xl font-bold text-green-700 dark:text-green-300">{statusCounts.accepted}</div>
            </CardContent>
          </Card>
          
          <Card 
            className="relative overflow-hidden border-2 border-red-200 dark:border-red-800 bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 hover:shadow-xl transition-all duration-300 group cursor-pointer"
            onClick={() => handleTabChange("lost")}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-red-200/40 to-rose-200/40 rounded-full blur-2xl"></div>
            <CardHeader className="relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-red-700 dark:text-red-300 flex items-center gap-2">
                    <X className="h-5 w-5" />
                    Rejected
                  </CardTitle>
                  <CardDescription className="text-red-600/80 dark:text-red-400/80">Closed quotations</CardDescription>
                </div>
                <div className="p-3 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 shadow-md group-hover:scale-110 transition-transform">
                  <XCircle className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-4xl font-bold text-red-700 dark:text-red-300">{statusCounts.lost}</div>
            </CardContent>
          </Card>
        </div>
        
        {/* Second Row: Draft, Send, and Follow Up */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card 
            className="relative overflow-hidden border-2 border-blue-200 dark:border-blue-800 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 hover:shadow-xl transition-all duration-300 group cursor-pointer"
            onClick={() => handleTabChange("draft")}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-blue-200/40 to-cyan-200/40 rounded-full blur-2xl"></div>
            <CardHeader className="relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-blue-700 dark:text-blue-300 flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Draft
                  </CardTitle>
                  <CardDescription className="text-blue-600/80 dark:text-blue-400/80">Saved but not sent</CardDescription>
                </div>
                <div className="p-3 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 shadow-md group-hover:scale-110 transition-transform">
                  <Archive className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-4xl font-bold text-blue-700 dark:text-blue-300">{statusCounts.draft}</div>
            </CardContent>
          </Card>
          
          <Card 
            className="relative overflow-hidden border-2 border-purple-200 dark:border-purple-800 bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 hover:shadow-xl transition-all duration-300 group cursor-pointer"
            onClick={() => handleTabChange("sent")}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-purple-200/40 to-pink-200/40 rounded-full blur-2xl"></div>
            <CardHeader className="relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-purple-700 dark:text-purple-300 flex items-center gap-2">
                    <Send className="h-5 w-5" />
                    Send
                  </CardTitle>
                  <CardDescription className="text-purple-600/80 dark:text-purple-400/80">Awaiting response</CardDescription>
                </div>
                <div className="p-3 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 shadow-md group-hover:scale-110 transition-transform">
                  <Mail className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-4xl font-bold text-purple-700 dark:text-purple-300">{activeSentQuotes.length}</div>
            </CardContent>
          </Card>
          
          <Card 
            className="relative overflow-hidden border-2 border-orange-200 dark:border-orange-800 bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 hover:shadow-xl transition-all duration-300 group cursor-pointer"
            onClick={() => handleTabChange("follow_up")}
          >
            <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-orange-200/40 to-amber-200/40 rounded-full blur-2xl"></div>
            <CardHeader className="relative z-10">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-orange-700 dark:text-orange-300 flex items-center gap-2">
                    <Clock className="h-5 w-5" />
                    Follow Up
                  </CardTitle>
                  <CardDescription className="text-orange-600/80 dark:text-orange-400/80">Active follow-ups</CardDescription>
                </div>
                <div className="p-3 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 shadow-md group-hover:scale-110 transition-transform">
                  <Mail className="h-6 w-6 text-white" />
                </div>
              </div>
            </CardHeader>
            <CardContent className="relative z-10">
              <div className="text-4xl font-bold text-orange-700 dark:text-orange-300">
                {activeSentQuotes.filter((q) => (q.followUpCount ?? 0) > 0).length}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-4">
        <div className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-800 p-1.5 sm:p-2 shadow-sm overflow-hidden">
          <TabsList className="flex flex-wrap gap-1.5 sm:gap-2 bg-transparent h-auto min-h-0 w-full justify-start">
            <TabsTrigger
              value="new"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Plus className="shrink-0" />
              New
            </TabsTrigger>
            <TabsTrigger
              value="draft"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-blue-500 data-[state=active]:to-cyan-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <FileText className="shrink-0" />
              Draft
            </TabsTrigger>
            <TabsTrigger
              value="sent"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-purple-500 data-[state=active]:to-pink-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Send className="shrink-0" />
              Send
            </TabsTrigger>
            <TabsTrigger
              value="follow_up"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-amber-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Clock className="shrink-0" />
              <span className="hidden sm:inline">Follow Up</span>
              <span className="sm:hidden">Follow</span>
            </TabsTrigger>
            <TabsTrigger
              value="follow_up_logs"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-orange-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Mail className="shrink-0" />
              <span className="hidden md:inline">Follow Up Logs</span>
              <span className="md:hidden">FU Logs</span>
            </TabsTrigger>
            <TabsTrigger
              value="expired"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-gray-600 data-[state=active]:to-slate-700 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Archive className="shrink-0" />
              Expired
            </TabsTrigger>
            <TabsTrigger
              value="accepted"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <CheckCircle className="shrink-0" />
              Accepted
            </TabsTrigger>
            <TabsTrigger
              value="lost"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-red-500 data-[state=active]:to-rose-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <XCircle className="shrink-0" />
              Rejected
            </TabsTrigger>
            <TabsTrigger
              value="convert"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <FileText className="shrink-0" />
              <span className="hidden md:inline">Convert to Invoice</span>
              <span className="md:hidden">Convert</span>
            </TabsTrigger>
            <TabsTrigger
              value="deleted"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-gray-500 data-[state=active]:to-gray-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Archive className="shrink-0" />
              Deleted
            </TabsTrigger>
            <TabsTrigger
              value="address_book"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-orange-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <BookOpen className="shrink-0" />
              <span className="hidden md:inline">Address Book</span>
              <span className="md:hidden">Addresses</span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="new" className="space-y-4">
          <Card className="border-2 border-gray-200 dark:border-gray-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border-b border-gray-200 dark:border-gray-800">
              <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 shadow-md">
                  <Plus className="h-5 w-5 text-white" />
                </div>
                {editingQuoteId ? "Edit Quote" : "New Quote"}
              </CardTitle>
              <CardDescription className="text-blue-600/80 dark:text-blue-400/80">
                Fill out the quotation template and save or send it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <style jsx global>{`
                .quote-print-mode input,
                .quote-print-mode textarea {
                  border-color: transparent !important;
                  background: transparent !important;
                  box-shadow: none !important;
                  padding-left: 0 !important;
                  padding-right: 0 !important;
                }

                .quote-print-mode textarea {
                  resize: none !important;
                }

                .quote-print-mode .quote-remove-column,
                .quote-print-mode .quote-actions {
                  display: none !important;
                }

                @media print {
                  @page {
                    size: A4;
                    margin: 18mm 15mm 25mm 15mm; /* top right bottom left — footer margin so Prepared By / closing line not clipped */
                  }
                  body {
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                  }
                  .quote-print-mode {
                    max-width: 100% !important;
                    box-shadow: none !important;
                    border: 1px solid #d4a574 !important;
                    padding-top: 4mm !important;
                    padding-bottom: 12mm !important;
                  }
                  .quote-print-mode * {
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                  }
                  .quote-print-actions {
                    display: none !important;
                  }
                }
              `}</style>
              <div
                ref={quoteTemplateRef}
                className={cn(
                  "bg-white border-2 border-amber-700/70 rounded-md p-6 shadow-sm max-w-[794px] mx-auto space-y-6",
                  isPrintMode && "quote-print-mode",
                  isPrintMode && "pb-24"
                )}
              >
                <div ref={quoteContentRef}>
                {isPrintMode && (
                  <div className="border-b border-amber-300 pb-3 mb-2">
                    <p className="text-xs font-semibold text-amber-800">Prep Services FBA — Sales Quotation</p>
                  </div>
                )}
                <div className="space-y-4">
                  <h2 className="text-center text-2xl font-bold tracking-wide text-amber-800">SALES QUOTATION</h2>
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex justify-center sm:justify-start">
                      <img
                        src="/quote-logo.png"
                        alt="Prep Services FBA"
                        className="h-20 w-auto object-contain"
                      />
                    </div>
                    <div className="text-sm text-muted-foreground space-y-2 sm:text-right">
                      <div className="flex flex-col gap-2 sm:items-end">
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                          <span>Quotation Number:</span>
                          {isPrintMode ? (
                            <span className="font-semibold text-amber-900">{formData.reference || "—"}</span>
                          ) : (
                            <Input
                              value={formData.reference}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, reference: event.target.value }))
                              }
                              className="h-8 w-44 text-center"
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                          <span>Date:</span>
                          {isPrintMode ? (
                            <span className="font-semibold text-amber-900">{formatDateForDisplay(formData.quoteDate) || "—"}</span>
                          ) : (
                            <Input
                              type="date"
                              value={formData.quoteDate}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, quoteDate: event.target.value }))
                              }
                              className="h-8 w-40 text-center"
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                          <span>Valid Until:</span>
                          {isPrintMode ? (
                            <span className="font-semibold text-amber-900">{formatDateForDisplay(formData.validUntil) || "—"}</span>
                          ) : (
                            <Input
                              type="date"
                              value={formData.validUntil}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, validUntil: event.target.value }))
                              }
                              className="h-8 w-40 text-center"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="border border-amber-200/70 rounded-md p-4 text-sm space-y-1">
                    <p className="text-xs uppercase text-amber-700 font-semibold">From</p>
                    <p className="font-semibold">{COMPANY_INFO.name}</p>
                    {COMPANY_INFO.addressLines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                    <p>Phone: {COMPANY_INFO.phone}</p>
                    <p>Email: {COMPANY_INFO.email}</p>
                  </div>
                  <div className="border border-amber-200/70 rounded-md p-4 text-sm space-y-3">
                    <p className="text-xs uppercase text-amber-700 font-semibold">To</p>
                    {isPrintMode ? (
                      <div className="space-y-1">
                        <p className="font-semibold">{formData.recipientName || "—"}</p>
                        {formData.recipientAddress && <p>{formData.recipientAddress}</p>}
                        {(formData.recipientCity || formData.recipientState || formData.recipientZip || formData.recipientCountry) && (
                          <p>
                            {[formData.recipientCity, formData.recipientState, formData.recipientZip, formData.recipientCountry]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {formData.recipientPhone && <p>Phone: {formData.recipientPhone}</p>}
                        {formData.recipientEmail && <p>Email: {formData.recipientEmail}</p>}
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <div>
                          <Label className="text-xs text-muted-foreground">Client Name</Label>
                          <Input
                            value={formData.recipientName}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, recipientName: event.target.value }))
                            }
                            placeholder="Client name"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Address</Label>
                          <Input
                            value={formData.recipientAddress}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, recipientAddress: event.target.value }))
                            }
                            placeholder="Client address"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Country</Label>
                          <Input
                            value={formData.recipientCountry}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, recipientCountry: event.target.value }))
                            }
                            placeholder="Country"
                            className="h-9"
                          />
                        </div>
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">City</Label>
                            <Input
                              value={formData.recipientCity}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, recipientCity: event.target.value }))
                              }
                              placeholder="City"
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">State</Label>
                            <Input
                              value={formData.recipientState}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, recipientState: event.target.value }))
                              }
                              placeholder="State"
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Zip Code</Label>
                            <Input
                              value={formData.recipientZip}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, recipientZip: event.target.value }))
                              }
                              placeholder="Zip"
                              className="h-9"
                            />
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">Phone</Label>
                            <Input
                              value={formData.recipientPhone}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, recipientPhone: event.target.value }))
                              }
                              placeholder="Phone"
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Email</Label>
                            <Input
                              value={formData.recipientEmail}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, recipientEmail: event.target.value }))
                              }
                              placeholder="client@email.com"
                              type="email"
                              className="h-9"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-amber-800 uppercase tracking-wide">Itemized Quotation Details</h3>
                    <Button variant="outline" size="sm" onClick={addItem} className="quote-actions">
                      <Plus className="h-4 w-4 mr-1" />
                      Add Item
                    </Button>
                  </div>
                  {/* Mobile: stacked cards with labeled fields */}
                  <div className="md:hidden space-y-3">
                    {formData.items.map((item, index) => (
                      <div key={item.id} className="border border-amber-200/70 rounded-md p-3 space-y-3 bg-amber-50/30">
                        <div className="space-y-1 pr-2 min-w-0 overflow-hidden">
                          <label className="text-xs font-semibold text-amber-800">Item Description</label>
                          {isPrintMode ? (
                            <span className="text-sm block whitespace-pre-wrap break-words">{item.description || "—"}</span>
                          ) : (
                            <Textarea
                              value={item.description}
                              onChange={(event) => updateItem(index, "description", event.target.value)}
                              placeholder="Manual field"
                              rows={2}
                              className="min-h-8 w-full max-w-full resize-y border-amber-200/70 break-words"
                              style={{ overflowWrap: "break-word" }}
                            />
                          )}
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-amber-800">Quantity</label>
                            {isPrintMode ? (
                              <span className="text-sm block">{item.quantity || 0}</span>
                            ) : (
                              <Input
                                type="number"
                                min="0"
                                value={item.quantity}
                                onChange={(event) => updateItem(index, "quantity", event.target.value)}
                                className="h-8 w-full"
                              />
                            )}
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-semibold text-amber-800">Unit Price ($)</label>
                            {isPrintMode ? (
                              <span className="text-sm block">${(item.unitPrice || 0).toFixed(2)}</span>
                            ) : (
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={item.unitPrice}
                                onChange={(event) => updateItem(index, "unitPrice", event.target.value)}
                                className="h-8 w-full"
                              />
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-amber-100">
                          <span className="text-xs font-semibold text-amber-800">Total Price ($)</span>
                          <span className="text-sm font-medium">${item.amount.toFixed(2)}</span>
                        </div>
                        {!isPrintMode && (
                          <div className="flex justify-end quote-actions">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeItem(index)}
                              className="text-destructive h-8 quote-actions"
                            >
                              <Trash2 className="h-4 w-4 mr-1" />
                              Remove
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Desktop: table */}
                  <div className="hidden md:block border border-amber-200/70 rounded-md overflow-hidden">
                    <table className="w-full text-sm table-fixed">
                      <thead className="bg-amber-50 text-amber-900">
                        <tr className="text-left">
                          <th className="px-3 py-2 font-semibold pr-4 w-[50%]">Item Description</th>
                          <th className="px-3 py-2 font-semibold w-24">Quantity</th>
                          <th className="px-3 py-2 font-semibold w-32">Unit Price ($)</th>
                          <th className="px-3 py-2 font-semibold w-32 text-right">Total Price ($)</th>
                          {!isPrintMode && <th className="px-3 py-2 font-semibold w-10 text-right quote-remove-column"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {formData.items.map((item, index) => (
                          <tr key={item.id} className="border-t border-amber-100">
                            <td className="px-3 py-2 pr-4 min-w-0 w-[50%] overflow-hidden">
                              {isPrintMode ? (
                                <span className="text-sm whitespace-pre-wrap break-words block min-w-0">{item.description || "—"}</span>
                              ) : (
                                <Textarea
                                  value={item.description}
                                  onChange={(event) => updateItem(index, "description", event.target.value)}
                                  placeholder="Manual field"
                                  rows={2}
                                  className="min-h-8 w-full max-w-full resize-y border-amber-200/70 break-words"
                                  style={{ overflowWrap: "break-word" }}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isPrintMode ? (
                                <span className="text-sm">{item.quantity || 0}</span>
                              ) : (
                                <Input
                                  type="number"
                                  min="0"
                                  value={item.quantity}
                                  onChange={(event) => updateItem(index, "quantity", event.target.value)}
                                  className="h-8"
                                />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              {isPrintMode ? (
                                <span className="text-sm">${(item.unitPrice || 0).toFixed(2)}</span>
                              ) : (
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  value={item.unitPrice}
                                  onChange={(event) => updateItem(index, "unitPrice", event.target.value)}
                                  className="h-8"
                                />
                              )}
                            </td>
                            <td className="px-3 py-2 text-right font-medium">
                              ${item.amount.toFixed(2)}
                            </td>
                            {!isPrintMode && (
                              <td className="px-3 py-2 text-right quote-remove-column">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => removeItem(index)}
                                  className="text-destructive h-8 w-8 quote-actions"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex justify-end">
                  <div className="w-full max-w-xs space-y-2 text-sm">
                    <div className="flex items-center justify-between border-b border-amber-100 pb-2">
                      <span>Subtotal</span>
                      <span className="font-semibold">${formData.subtotal.toFixed(2)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Sales Tax (6.625%)</span>
                      {isPrintMode ? (
                        <span className="font-semibold">${formData.salesTax.toFixed(2)}</span>
                      ) : (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.salesTax}
                          onChange={(event) => {
                            const salesTax = Number(event.target.value || 0);
                            const { items, subtotal, total } = calculateTotals(
                              formData.items,
                              formData.shippingCost,
                              salesTax
                            );
                            setFormData((prev) => ({ ...prev, salesTax, items, subtotal, total }));
                          }}
                          className="h-8 w-28 text-right"
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Shipping Cost</span>
                      {isPrintMode ? (
                        <span className="font-semibold">${formData.shippingCost.toFixed(2)}</span>
                      ) : (
                        <Input
                          type="number"
                          min="0"
                          step="0.01"
                          value={formData.shippingCost}
                          onChange={(event) => {
                            const shippingCost = Number(event.target.value || 0);
                            const { items, subtotal, salesTax, total } = calculateTotals(
                              formData.items,
                              shippingCost,
                              formData.salesTax
                            );
                            setFormData((prev) => ({ ...prev, shippingCost, items, subtotal, salesTax, total }));
                          }}
                          className="h-8 w-28 text-right"
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-between border-t border-amber-200 pt-2 text-amber-900 font-semibold">
                      <span>Grand Total</span>
                      <span>${formData.total.toFixed(2)}</span>
                    </div>
                  </div>
                </div>

                <div className="border border-amber-200/70 rounded-md p-4 space-y-2 mt-6">
                  <p className="text-xs uppercase text-amber-700 font-semibold">Terms &amp; Conditions</p>
                  {isPrintMode ? (
                    <ul className="text-xs leading-5 space-y-1 list-disc list-inside text-amber-900">
                      {formatTermsAsBullets(formData.terms).map((term, idx) => (
                        <li key={idx}>{term}</li>
                      ))}
                    </ul>
                  ) : (
                    <Textarea
                      value={formData.terms}
                      onChange={(event) =>
                        setFormData((prev) => ({ ...prev, terms: event.target.value }))
                      }
                      rows={6}
                      className="text-xs leading-5"
                    />
                  )}
                </div>

                {isPrintMode && (
                  <div className="min-h-[120px]" aria-hidden />
                )}
                </div>

                {isPrintMode ? (
                  <div ref={quoteFooterRef} className="border-t border-amber-300 pt-4 mt-2 pb-2">
                    <div className="grid gap-4 md:grid-cols-2 text-sm mb-3">
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Prepared By</p>
                        <p className="text-sm font-medium">{formData.preparedBy || "—"}</p>
                        {formData.preparedDate && (
                          <p className="text-xs text-muted-foreground">{formatDateForDisplay(formData.preparedDate)}</p>
                        )}
                      </div>
                      <div className="space-y-1">
                        <p className="text-xs text-muted-foreground">Approved By</p>
                        <p className="text-sm font-medium">{formData.approvedBy || "—"}</p>
                        {formData.approvedDate && (
                          <p className="text-xs text-muted-foreground">{formatDateForDisplay(formData.approvedDate)}</p>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-center text-amber-700">We appreciate the opportunity to do business with you.</p>
                  </div>
                ) : null}
                {!isPrintMode && (
                  <>
                    <div className="grid gap-4 md:grid-cols-2 text-sm">
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Prepared By</Label>
                        <Input
                          value={formData.preparedBy}
                          onChange={(event) =>
                            setFormData((prev) => ({ ...prev, preparedBy: event.target.value }))
                          }
                          className="h-9"
                        />
                        <Label className="text-xs text-muted-foreground">Date</Label>
                        <Input
                          type="date"
                          value={formData.preparedDate}
                          onChange={(event) =>
                            setFormData((prev) => ({ ...prev, preparedDate: event.target.value }))
                          }
                          className="h-9"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Approved By</Label>
                        <Input
                          value={formData.approvedBy}
                          onChange={(event) =>
                            setFormData((prev) => ({ ...prev, approvedBy: event.target.value }))
                          }
                          className="h-9"
                        />
                        <Label className="text-xs text-muted-foreground">Date</Label>
                        <Input
                          type="date"
                          value={formData.approvedDate}
                          onChange={(event) =>
                            setFormData((prev) => ({ ...prev, approvedDate: event.target.value }))
                          }
                          className="h-9"
                        />
                      </div>
                    </div>
                    <p className="text-center text-sm text-amber-900">
                      We appreciate the opportunity to do business with you.
                    </p>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-3 quote-print-actions">
                <Button 
                  variant="outline" 
                  onClick={handleSaveDraft} 
                  disabled={saving}
                  className="border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950/30 hover:border-blue-300 dark:hover:border-blue-700 transition-all"
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                  Save as Draft
                </Button>
                <Button 
                  onClick={handleSendFromForm} 
                  disabled={saving}
                  className="bg-gradient-to-r from-purple-500 to-pink-600 hover:from-purple-600 hover:to-pink-700 text-white shadow-md hover:shadow-lg transition-all"
                >
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                  Send
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleDownloadPdf}
                  className="border-amber-200 dark:border-amber-800 hover:bg-amber-50 dark:hover:bg-amber-950/30 hover:border-amber-300 dark:hover:border-amber-700 transition-all"
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download PDF
                </Button>
                {editingQuoteId && (
                  <Button 
                    variant="ghost" 
                    onClick={resetForm}
                    className="hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                  >
                    Cancel Edit
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="draft" className="space-y-4">
          <Card className="border-2 border-blue-200 dark:border-blue-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-blue-50 to-cyan-50 dark:from-blue-950/30 dark:to-cyan-950/30 border-b border-blue-200 dark:border-blue-800">
              <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 shadow-md">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                Draft Quotes
              </CardTitle>
              <CardDescription className="text-blue-600/80 dark:text-blue-400/80">Edit, send, or delete draft quotations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Search by name, email, or reference"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredDraftQuotes.length ? (
                <>
                  <div className="space-y-4">
                    {getPaginatedData(filteredDraftQuotes, currentPage).paginatedData.map((quote) => renderQuoteRow(quote, { showActions: true }))}
                  </div>
                  {filteredDraftQuotes.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(filteredDraftQuotes, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredDraftQuotes, currentPage).endIndex, filteredDraftQuotes.length)} of {filteredDraftQuotes.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(filteredDraftQuotes, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredDraftQuotes, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(filteredDraftQuotes, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No draft quotes yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sent" className="space-y-4">
          <Card className="border-2 border-purple-200 dark:border-purple-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30 border-b border-purple-200 dark:border-purple-800">
              <CardTitle className="flex items-center gap-2 text-purple-700 dark:text-purple-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 shadow-md">
                  <Send className="h-5 w-5 text-white" />
                </div>
                Send Quotes
              </CardTitle>
              <CardDescription className="text-purple-600/80 dark:text-purple-400/80">All send quotations with recipient details.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Search by name, email, or reference"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="flex-1"
                />
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredSentQuotes.length ? (
                <>
                  <div className="space-y-4">
                    {getPaginatedData(filteredSentQuotes, currentPage).paginatedData.map((quote) => renderQuoteRow(quote))}
                  </div>
                  {filteredSentQuotes.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(filteredSentQuotes, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredSentQuotes, currentPage).endIndex, filteredSentQuotes.length)} of {filteredSentQuotes.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(filteredSentQuotes, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredSentQuotes, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(filteredSentQuotes, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No send quotes yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="follow_up" className="space-y-4">
          <Card className="border-2 border-orange-200 dark:border-orange-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border-b border-orange-200 dark:border-orange-800">
              <CardTitle className="flex items-center gap-2 text-orange-700 dark:text-orange-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 shadow-md">
                  <Clock className="h-5 w-5 text-white" />
                </div>
                Follow Up
              </CardTitle>
              <CardDescription className="text-orange-600/80 dark:text-orange-400/80">
                Send follow-ups or mark the quote as accepted or rejected.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Search by name, email, or reference"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="flex-1"
                />
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (() => {
                const followUpFiltered = filteredSentQuotes;
                return followUpFiltered.length ? (
                  <>
                    <div className="space-y-4">
                      {getPaginatedData(followUpFiltered, currentPage).paginatedData.map((quote) => renderQuoteRow(quote, { showFollowUp: true }))}
                    </div>
                    {followUpFiltered.length > itemsPerPage && (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                        <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                          Showing {getPaginatedData(followUpFiltered, currentPage).startIndex + 1} to {Math.min(getPaginatedData(followUpFiltered, currentPage).endIndex, followUpFiltered.length)} of {followUpFiltered.length} records
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="text-xs sm:text-sm px-2">
                            {currentPage} / {getPaginatedData(followUpFiltered, currentPage).totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(followUpFiltered, currentPage).totalPages, p + 1))}
                            disabled={currentPage >= getPaginatedData(followUpFiltered, currentPage).totalPages}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No quotes to follow up.</p>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="follow_up_logs" className="space-y-4">
          <Card className="border-2 border-amber-200 dark:border-amber-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-b border-amber-200 dark:border-amber-800">
              <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-md">
                  <Mail className="h-5 w-5 text-white" />
                </div>
                Follow Up Logs
              </CardTitle>
              <CardDescription className="text-amber-600/80 dark:text-amber-400/80">
                Track which follow-up was sent to which client and when.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Search by client, email, quote reference, or subject"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="flex-1"
                />
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredFollowUpLogRows.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(filteredFollowUpLogRows, currentPage).paginatedData.map((row) => (
                      <Card key={row.id} className="border border-amber-200/70 dark:border-amber-800/60">
                        <CardContent className="pt-4">
                          <div className="flex flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
                                {row.followUpStep ? `Follow Up ${row.followUpStep}` : "Follow Up"}
                              </Badge>
                              <Badge variant="outline">
                                {row.autoFollowUp ? "Auto" : "Manual"}
                              </Badge>
                              <span className="text-xs text-muted-foreground">{formatDateTime(row.sentAt)}</span>
                            </div>
                            <p className="text-sm">
                              <span className="font-medium">{row.clientName}</span> ({row.clientEmail})
                            </p>
                            <p className="text-sm text-muted-foreground">Quote: {row.quoteReference}</p>
                            <p className="text-sm font-medium">{row.subject}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {filteredFollowUpLogRows.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(filteredFollowUpLogRows, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredFollowUpLogRows, currentPage).endIndex, filteredFollowUpLogRows.length)} of {filteredFollowUpLogRows.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(filteredFollowUpLogRows, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredFollowUpLogRows, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(filteredFollowUpLogRows, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No follow-up logs yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="expired" className="space-y-4">
          <Card className="border-2 border-gray-300 dark:border-gray-700 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30 border-b border-gray-300 dark:border-gray-700">
              <CardTitle className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-gray-600 to-slate-700 shadow-md">
                  <Archive className="h-5 w-5 text-white" />
                </div>
                Expired Quotes
              </CardTitle>
              <CardDescription className="text-gray-600/80 dark:text-gray-400/80">
                Quotes with passed validity date are moved here automatically.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Search by name, email, or reference"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="flex-1"
                />
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (() => {
                const filteredExpiredQuotes = expiredQuotes.filter((quote) => {
                  const query = searchQuery.trim().toLowerCase();
                  if (!query) return true;
                  return [quote.reference, quote.recipientName, quote.recipientEmail]
                    .filter(Boolean)
                    .some((value) => value!.toLowerCase().includes(query));
                });

                return filteredExpiredQuotes.length ? (
                  <>
                    <div className="space-y-4">
                      {getPaginatedData(filteredExpiredQuotes, currentPage).paginatedData.map((quote) =>
                        renderQuoteRow(quote, { showFollowUp: false })
                      )}
                    </div>
                    {filteredExpiredQuotes.length > itemsPerPage && (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                        <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                          Showing {getPaginatedData(filteredExpiredQuotes, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredExpiredQuotes, currentPage).endIndex, filteredExpiredQuotes.length)} of {filteredExpiredQuotes.length} records
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                            disabled={currentPage === 1}
                          >
                            Previous
                          </Button>
                          <span className="text-xs sm:text-sm px-2">
                            {currentPage} / {getPaginatedData(filteredExpiredQuotes, currentPage).totalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredExpiredQuotes, currentPage).totalPages, p + 1))}
                            disabled={currentPage >= getPaginatedData(filteredExpiredQuotes, currentPage).totalPages}
                          >
                            Next
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No expired quotes.</p>
                );
              })()}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="accepted" className="space-y-4">
          <Card className="border-2 border-green-200 dark:border-green-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border-b border-green-200 dark:border-green-800 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-emerald-600 shadow-md">
                  <CheckCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-green-700 dark:text-green-300">Accepted Quotes</CardTitle>
                  <CardDescription className="text-green-600/80 dark:text-green-400/80">Quotes marked as accepted.</CardDescription>
                </div>
              </div>
              <Button variant="outline" className="bg-white dark:bg-gray-800 hover:bg-green-50 dark:hover:bg-green-950/30 border-green-200 dark:border-green-800" onClick={() => downloadCsv(acceptedQuotes, "accepted-quotes.csv")}>
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Search by name, email, or reference"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="flex-1"
                />
                <Select value={acceptedStatusFilter} onValueChange={(value: "all" | "active" | "expired") => setAcceptedStatusFilter(value)}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredAcceptedQuotes.length ? (
                <>
                  <div className="space-y-4">
                    {getPaginatedData(filteredAcceptedQuotes, currentPage).paginatedData.map((quote) =>
                      renderQuoteRow(quote, { showConvert: true })
                    )}
                  </div>
                  {filteredAcceptedQuotes.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(filteredAcceptedQuotes, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredAcceptedQuotes, currentPage).endIndex, filteredAcceptedQuotes.length)} of {filteredAcceptedQuotes.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(filteredAcceptedQuotes, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredAcceptedQuotes, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(filteredAcceptedQuotes, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No accepted quotes yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lost" className="space-y-4">
          <Card className="border-2 border-red-200 dark:border-red-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 border-b border-red-200 dark:border-red-800 flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-gradient-to-br from-red-500 to-rose-600 shadow-md">
                  <XCircle className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-red-700 dark:text-red-300">Rejected Quotes</CardTitle>
                  <CardDescription className="text-red-600/80 dark:text-red-400/80">Quotes marked as rejected.</CardDescription>
                </div>
              </div>
              <Button variant="outline" className="bg-white dark:bg-gray-800 hover:bg-red-50 dark:hover:bg-red-950/30 border-red-200 dark:border-red-800" onClick={() => downloadCsv(lostQuotes, "rejected-quotes.csv")}>
                <Download className="h-4 w-4 mr-1" />
                Download
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Search by name, email, or reference"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="flex-1"
                />
                <Select value={rejectedStatusFilter} onValueChange={(value: "all" | "active" | "expired") => setRejectedStatusFilter(value)}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredLostQuotes.length ? (
                <>
                  <div className="space-y-4">
                    {getPaginatedData(filteredLostQuotes, currentPage).paginatedData.map((quote) => renderQuoteRow(quote))}
                  </div>
                  {filteredLostQuotes.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(filteredLostQuotes, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredLostQuotes, currentPage).endIndex, filteredLostQuotes.length)} of {filteredLostQuotes.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(filteredLostQuotes, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredLostQuotes, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(filteredLostQuotes, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No rejected quotes yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="convert" className="space-y-4">
          <Card className="border-2 border-indigo-200 dark:border-indigo-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30 border-b border-indigo-200 dark:border-indigo-800">
              <CardTitle className="flex items-center gap-2 text-indigo-700 dark:text-indigo-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 shadow-md">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                Convert to Invoice
              </CardTitle>
              <CardDescription className="text-indigo-600/80 dark:text-indigo-400/80">Convert accepted quotations into invoices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Input
                  placeholder="Search by name, email, or reference"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className="flex-1"
                />
                <Select value={convertStatusFilter} onValueChange={(value: "all" | "active" | "expired") => setConvertStatusFilter(value)}>
                  <SelectTrigger className="w-full sm:w-[180px]">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="expired">Expired</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center justify-end">
                <Button
                  variant={showConvertedOnly ? "default" : "outline"}
                  size="sm"
                  onClick={() => setShowConvertedOnly((prev) => !prev)}
                >
                  {showConvertedOnly ? "Showing Converted" : "Show Converted Only"}
                </Button>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredConvertibleQuotes.length ? (
                <>
                  <div className="space-y-4">
                    {getPaginatedData(filteredConvertibleQuotes, currentPage).paginatedData.map((quote) => {
                      const isExpired = isQuoteExpired(quote.validUntil);
                      return (
                        <Card
                          key={quote.id}
                          className={cn(
                            "group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:scale-[1.01] border-2",
                            quote.convertedInvoiceId 
                              ? "border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-950/10"
                              : isExpired
                              ? "border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10"
                              : "border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/10"
                          )}
                        >
                          <div className="absolute inset-0 bg-gradient-to-br from-white/50 to-transparent dark:from-gray-900/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                          <CardContent className="p-5 relative z-10">
                            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start gap-3">
                                  <div className={cn(
                                    "p-2 rounded-lg shadow-md group-hover:scale-110 transition-transform",
                                    quote.convertedInvoiceId
                                      ? "bg-gradient-to-br from-indigo-500 to-purple-600"
                                      : "bg-gradient-to-br from-green-500 to-emerald-600"
                                  )}>
                                    <FileText className="h-5 w-5 text-white" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100 truncate">
                                      {quote.recipientName || "—"}
                                    </h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 truncate mt-0.5">
                                      {quote.recipientEmail || "—"}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2">
                                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                                        {quote.reference}
                                      </span>
                                      {quote.convertedInvoiceId && (
                                        <Badge className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white">
                                          Converted
                                        </Badge>
                                      )}
                                      {isExpired && (
                                        <Badge variant="destructive" className="text-xs animate-pulse">
                                          Expired
                                        </Badge>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 flex-wrap">
                                {quote.convertedInvoiceId ? (
                                  <>
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      onClick={() => handleViewInvoicePdf(quote)}
                                      className="hover:bg-indigo-500 hover:text-white hover:border-indigo-500 dark:hover:bg-indigo-600 transition-all shadow-sm hover:shadow-md"
                                    >
                                      <Eye className="h-4 w-4 mr-1" />
                                      View Invoice
                                    </Button>
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      onClick={() => handleDownloadInvoicePdf(quote)}
                                      className="hover:bg-indigo-500 hover:text-white hover:border-indigo-500 dark:hover:bg-indigo-600 transition-all shadow-sm hover:shadow-md"
                                    >
                                      <Download className="h-4 w-4 mr-1" />
                                      Download
                                    </Button>
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      onClick={() => openEmailDialog(quote, "invoice")}
                                      disabled={!!quote.invoiceSentAt}
                                      className="hover:bg-indigo-500 hover:text-white hover:border-indigo-500 dark:hover:bg-indigo-600 transition-all shadow-sm hover:shadow-md disabled:opacity-50 disabled:pointer-events-none"
                                    >
                                      <Mail className="h-4 w-4 mr-1" />
                                      {quote.invoiceSentAt ? "Invoice sent" : "Send Invoice"}
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <Button 
                                      variant="outline" 
                                      size="sm" 
                                      onClick={() => handleViewPdf(quote)}
                                      className="hover:bg-blue-500 hover:text-white hover:border-blue-500 dark:hover:bg-blue-600 transition-all shadow-sm hover:shadow-md"
                                    >
                                      <Eye className="h-4 w-4 mr-1" />
                                      View Quote
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => handleConvertToInvoice(quote)}
                                      className="hover:bg-green-500 hover:text-white hover:border-green-500 dark:hover:bg-green-600 transition-all shadow-sm hover:shadow-md"
                                    >
                                      <FileText className="h-4 w-4 mr-1" />
                                      Convert
                                    </Button>
                                  </>
                                )}
                              </div>
                            </div>
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  {filteredConvertibleQuotes.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(filteredConvertibleQuotes, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredConvertibleQuotes, currentPage).endIndex, filteredConvertibleQuotes.length)} of {filteredConvertibleQuotes.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(filteredConvertibleQuotes, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredConvertibleQuotes, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(filteredConvertibleQuotes, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No accepted quotes to convert.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="deleted" className="space-y-4">
          <Card className="border-2 border-gray-200 dark:border-gray-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-gray-50 to-slate-50 dark:from-gray-950/30 dark:to-slate-950/30 border-b border-gray-200 dark:border-gray-800">
              <CardTitle className="flex items-center gap-2 text-gray-700 dark:text-gray-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-gray-500 to-slate-600 shadow-md">
                  <Archive className="h-5 w-5 text-white" />
                </div>
                Deleted Quotes
              </CardTitle>
              <CardDescription className="text-gray-600/80 dark:text-gray-400/80">View deletion logs for removed quotations.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Input
                placeholder="Search by name, email, or reference"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
              {deleteLogsLoading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : filteredDeleteLogs.length ? (
                <>
                  <div className="space-y-4">
                    {getPaginatedData(filteredDeleteLogs, currentPage).paginatedData.map((log) => (
                      <Card
                        key={log.id}
                        className="group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:scale-[1.01] border-2 border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/10"
                      >
                        <div className="absolute inset-0 bg-gradient-to-br from-white/50 to-transparent dark:from-gray-900/50 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
                        <CardContent className="p-5 relative z-10 space-y-4">
                          <div className="flex items-start justify-between">
                            <div className="flex items-start gap-3 flex-1">
                              <div className="p-2 rounded-lg bg-gradient-to-br from-gray-500 to-slate-600 shadow-md group-hover:scale-110 transition-transform">
                                <Archive className="h-5 w-5 text-white" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100">
                                  {log.reference || "—"}
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                                  {log.recipientName || "—"} ({log.recipientEmail || "—"})
                                </p>
                              </div>
                            </div>
                            <div className="flex flex-col items-end gap-1">
                              <Badge variant="destructive" className="bg-gradient-to-r from-red-500 to-rose-600 text-white">
                                Deleted
                              </Badge>
                              {log.autoDeleted && (
                                <Badge variant="outline" className="text-xs">
                                  Auto-deleted
                                </Badge>
                              )}
                            </div>
                          </div>
                          
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-100/50 dark:bg-gray-800/50">
                              <span className="font-medium text-gray-700 dark:text-gray-300">Deleted By:</span>
                              <span className="text-gray-600 dark:text-gray-400">{log.deletedByName || "Unknown"}</span>
                            </div>
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-100/50 dark:bg-gray-800/50">
                              <span className="font-medium text-gray-700 dark:text-gray-300">Deleted At:</span>
                              <span className="text-gray-600 dark:text-gray-400">{formatDate(log.deletedAt)}</span>
                            </div>
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-100/50 dark:bg-gray-800/50">
                              <span className="font-medium text-gray-700 dark:text-gray-300">Original Status:</span>
                              <Badge variant="secondary" className="capitalize">
                                {log.status || "—"}
                              </Badge>
                            </div>
                            <div className="flex items-center gap-2 p-2 rounded-lg bg-gray-100/50 dark:bg-gray-800/50">
                              <span className="font-medium text-gray-700 dark:text-gray-300">Total Amount:</span>
                              <span className="text-gray-600 dark:text-gray-400 font-semibold">${(log.total || 0).toFixed(2)}</span>
                            </div>
                          </div>
                          
                          <div className="border-t border-gray-200 dark:border-gray-700 pt-4">
                            <p className="text-sm font-semibold mb-2 text-gray-700 dark:text-gray-300">Deletion Reason:</p>
                            <p className="text-sm text-gray-600 dark:text-gray-400 bg-white dark:bg-gray-900 p-3 rounded-lg border border-gray-200 dark:border-gray-800 shadow-sm">
                              {log.reason || "No reason provided"}
                            </p>
                          </div>
                          
                          <div className="flex justify-end gap-2 pt-2">
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleViewDeletedQuote(log)}
                              className="hover:bg-blue-500 hover:text-white hover:border-blue-500 dark:hover:bg-blue-600 transition-all shadow-sm hover:shadow-md"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View Quote
                            </Button>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              onClick={() => handleRestoreQuote(log)}
                              disabled={saving}
                              className="hover:bg-green-500 hover:text-white hover:border-green-500 dark:hover:bg-green-600 transition-all shadow-sm hover:shadow-md"
                            >
                              {saving ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                  Restoring...
                                </>
                              ) : (
                                <>
                                  <RotateCcw className="h-4 w-4 mr-1" />
                                  Restore
                                </>
                              )}
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {filteredDeleteLogs.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(filteredDeleteLogs, currentPage).startIndex + 1} to {Math.min(getPaginatedData(filteredDeleteLogs, currentPage).endIndex, filteredDeleteLogs.length)} of {filteredDeleteLogs.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(filteredDeleteLogs, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(filteredDeleteLogs, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(filteredDeleteLogs, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No deleted quotes found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="address_book" className="space-y-4">
          <Card className="border-2 border-amber-200 dark:border-amber-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 border-b border-amber-200 dark:border-amber-800">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 shadow-md">
                      <BookOpen className="h-5 w-5 text-white" />
                    </div>
                    Address Book
                  </CardTitle>
                  <CardDescription className="text-amber-600/80 dark:text-amber-400/80">View all quotes with filters and search.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2 items-center">
                  <Badge variant="secondary" className="text-amber-700 bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2 rounded-full">
                    Total: {statusCounts.draft + statusCounts.sent + statusCounts.accepted + statusCounts.lost}
                  </Badge>
                  <Badge variant="secondary" className="text-blue-600 bg-blue-100 dark:text-blue-300 dark:bg-blue-900/30 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2 rounded-full">
                    Draft: {statusCounts.draft}
                  </Badge>
                  <Badge variant="secondary" className="text-purple-600 bg-purple-100 dark:text-purple-300 dark:bg-purple-900/30 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2 rounded-full">
                    Send: {statusCounts.sent}
                  </Badge>
                  <Badge variant="secondary" className="text-green-600 bg-green-100 dark:text-green-300 dark:bg-green-900/30 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2 rounded-full">
                    Accepted: {statusCounts.accepted}
                  </Badge>
                  <Badge variant="secondary" className="text-red-600 bg-red-100 dark:text-red-300 dark:bg-red-900/30 text-xs sm:text-base font-semibold px-3 py-1 sm:px-4 sm:py-2 rounded-full">
                    Rejected: {statusCounts.lost}
                  </Badge>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1">
                  <Input
                    placeholder="Search by name, email, or reference"
                    value={addressBookSearch}
                    onChange={(event) => {
                      setAddressBookSearch(event.target.value);
                      setCurrentPage(1);
                    }}
                  />
                </div>
                <Select
                  value={addressBookFilter}
                  onValueChange={(value: "all" | "draft" | "sent" | "accepted" | "rejected") => {
                    setAddressBookFilter(value);
                    setCurrentPage(1);
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="sent">Send</SelectItem>
                    <SelectItem value="accepted">Accepted</SelectItem>
                    <SelectItem value="rejected">Rejected</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-2">
                  <Select
                    value={downloadType}
                    onValueChange={(value: "all" | "draft" | "sent" | "accepted" | "rejected") => {
                      setDownloadType(value);
                    }}
                  >
                    <SelectTrigger className="w-[150px]">
                      <SelectValue placeholder="Download type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All</SelectItem>
                      <SelectItem value="draft">Draft</SelectItem>
                      <SelectItem value="sent">Send</SelectItem>
                      <SelectItem value="accepted">Accepted</SelectItem>
                      <SelectItem value="rejected">Rejected</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button variant="outline" onClick={handleAddressBookDownload}>
                    <Download className="h-4 w-4 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
              {loading ? (
                <div className="flex items-center justify-center py-6">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : addressBookQuotes.length ? (
                <>
                  <div className="space-y-4">
                    {getPaginatedData(addressBookQuotes, currentPage).paginatedData.map((quote) => renderQuoteRow(quote))}
                  </div>
                  {addressBookQuotes.length > itemsPerPage && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
                      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
                        Showing {getPaginatedData(addressBookQuotes, currentPage).startIndex + 1} to {Math.min(getPaginatedData(addressBookQuotes, currentPage).endIndex, addressBookQuotes.length)} of {addressBookQuotes.length} records
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                          disabled={currentPage === 1}
                        >
                          Previous
                        </Button>
                        <span className="text-xs sm:text-sm px-2">
                          {currentPage} / {getPaginatedData(addressBookQuotes, currentPage).totalPages}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setCurrentPage((p) => Math.min(getPaginatedData(addressBookQuotes, currentPage).totalPages, p + 1))}
                          disabled={currentPage >= getPaginatedData(addressBookQuotes, currentPage).totalPages}
                        >
                          Next
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No quotes found.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {emailMode === "invoice" ? "Send Invoice" : emailMode === "send" ? "Send Quote" : "Send Follow Up"}
            </DialogTitle>
            <DialogDescription>
              Compose the email to send to the recipient.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="emailTo">To</Label>
              <Input
                id="emailTo"
                value={emailForm.to}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, to: event.target.value }))}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emailSubject">Subject</Label>
              <Input
                id="emailSubject"
                value={emailForm.subject}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, subject: event.target.value }))}
              />
            </div>
            {emailMode === "invoice" && (
              <div className="space-y-2">
                <Label htmlFor="invoiceDueDate">Invoice due date</Label>
                <Input
                  id="invoiceDueDate"
                  type="date"
                  value={emailForm.invoiceDueDate ?? ""}
                  onChange={(event) =>
                    setEmailForm((prev) => ({ ...prev, invoiceDueDate: event.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">
                  This due date will be used for the invoice in Invoice Management.
                </p>
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="emailMessage">Message</Label>
              <Textarea
                id="emailMessage"
                value={emailForm.message}
                onChange={(event) => setEmailForm((prev) => ({ ...prev, message: event.target.value }))}
                rows={6}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="emailAttachments">Attachments</Label>
              <Input
                id="emailAttachments"
                type="file"
                multiple
                onChange={(event) => {
                  const files = event.target.files ? Array.from(event.target.files) : [];
                  setEmailForm((prev) => ({ ...prev, attachments: files }));
                }}
              />
              {emailMode === "send" && (
                <div className="text-xs text-muted-foreground">
                  The quotation PDF will be attached automatically when you send.
                </div>
              )}
              {emailForm.attachments.length > 0 && (
                <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                  {emailForm.attachments.map((file) => (
                    <Badge key={file.name} variant="secondary">
                      {file.name}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSendEmail} disabled={isSendingEmail}>
              {isSendingEmail ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={decisionDialogOpen} onOpenChange={setDecisionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">Mark as {statusLabel}</DialogTitle>
            <DialogDescription>
              Add optional client details for this quote.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-2">
              <Label>Client Name</Label>
              <Input
                value={decisionDetails.clientName || ""}
                onChange={(event) =>
                  setDecisionDetails((prev) => ({ ...prev, clientName: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Client Email</Label>
              <Input
                type="email"
                value={decisionDetails.clientEmail || ""}
                onChange={(event) =>
                  setDecisionDetails((prev) => ({ ...prev, clientEmail: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Client Contact</Label>
              <Input
                value={decisionDetails.clientContact || ""}
                onChange={(event) =>
                  setDecisionDetails((prev) => ({ ...prev, clientContact: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Client Company</Label>
              <Input
                value={decisionDetails.clientCompany || ""}
                onChange={(event) =>
                  setDecisionDetails((prev) => ({ ...prev, clientCompany: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Notes</Label>
              <Textarea
                value={decisionDetails.notes || ""}
                onChange={(event) =>
                  setDecisionDetails((prev) => ({ ...prev, notes: event.target.value }))
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => setDecisionDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitDecision} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Quote</DialogTitle>
            <DialogDescription>
              Please provide a reason for deleting this quote. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteQuote && (
            <div className="space-y-4">
              <div className="p-3 bg-muted rounded-md space-y-1 text-sm">
                <p className="font-medium">Quote Reference: {deleteQuote.reference}</p>
                <p className="text-muted-foreground">
                  {deleteQuote.recipientName} ({deleteQuote.recipientEmail})
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="deleteReason">Deletion Reason *</Label>
                <Textarea
                  id="deleteReason"
                  value={deleteReason}
                  onChange={(event) => setDeleteReason(event.target.value)}
                  placeholder="Enter the reason for deleting this quote..."
                  rows={4}
                  className="resize-none"
                />
              </div>
            </div>
          )}
          <DialogFooter className="flex gap-2">
            <Button variant="outline" onClick={() => {
              setDeleteDialogOpen(false);
              setDeleteQuote(null);
              setDeleteReason("");
            }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteQuote} disabled={saving || !deleteReason.trim()}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Trash2 className="h-4 w-4 mr-1" />}
              Delete Quote
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
