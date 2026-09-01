"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import jsPDF from "jspdf";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { generateQuoteInvoicePdfBlob } from "@/lib/quote-invoice-generator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckCircle,
  CircleArrowLeft,
  Clock,
  Download,
  FileText,
  Loader2,
  Mail,
  Percent,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";

type ExternalInvoiceStatus =
  | "draft"
  | "sent"
  | "partially_paid"
  | "paid"
  | "overdue"
  | "disputed"
  | "cancelled";

type PaymentMethod = "Zelle" | "ACH" | "Wire" | "Other";

type InvoiceEmailLogType =
  | "invoice_sent"
  | "reminder_24h"
  | "overdue"
  | "second_reminder"
  | "payment_confirmation"
  | "resend"
  | "discount_update";
interface InvoiceEmailLogEntry {
  id: string;
  to: string;
  subject?: string;
  type: InvoiceEmailLogType;
  invoiceNumber?: string;
  clientName?: string;
  sentAt: any;
  sentBy?: string;
}

interface ExternalInvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface ExternalInvoicePayment {
  id: string;
  amount: number;
  date: string;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
  createdAt?: any;
}

interface ExternalInvoiceDispute {
  reason?: string;
  notes?: string;
  status?: "Open" | "Resolved";
  updatedAt?: any;
}

interface ExternalInvoiceCancel {
  reason?: string;
  cancelledAt?: any;
}

interface ExternalInvoice {
  id: string;
  status: ExternalInvoiceStatus;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  clientAddress?: string;
  clientCity?: string;
  clientState?: string;
  clientZip?: string;
  clientCountry?: string;
  terms?: string;
  items: ExternalInvoiceItem[];
  subtotal: number;
  salesTax: number;
  shippingCost: number;
  total: number;
  amountPaid: number;
  outstandingBalance: number;
  payments: ExternalInvoicePayment[];
  sentAt?: any;
  reminderSentAt?: any;
  dispute?: ExternalInvoiceDispute;
  cancelled?: ExternalInvoiceCancel;
  discountType?: "percentage" | "amount";
  discountValue?: number;
  lateFee?: number;
  lateFeeEmailSentAt?: any;
  secondOverdueReminderSentAt?: any;
  createdAt?: any;
  updatedAt?: any;
}

const TAX_RATE = 0.06625;

const COMPANY_INFO = {
  name: "Prep Services FBA",
  addressLines: ["7000 Atrium Way B05", "Mount Laurel, NJ, 08054"],
  phone: "+1-347-661-3010",
  email: "info@prepservicesfba.com",
};

const INVOICE_TERMS = [
  "Invoices must be paid in full before work begins unless written credit terms are approved by management.",
  "Unpaid invoices after the due time may incur a $19 late fee per invoice.",
  "Prep Services FBA may pause receiving, prep, storage, and shipments until payment is completed.",
  "All completed labor services are non-refundable.",
  "Client is responsible for product compliance, labeling accuracy, and marketplace requirements.",
  "Any billing concern must be reported within 48 hours of invoice receipt. Unauthorized chargebacks may result in service suspension.",
].join("\n");

const createEmptyItem = (): ExternalInvoiceItem => ({
  id: crypto.randomUUID(),
  description: "",
  quantity: 1,
  unitPrice: 0,
  amount: 0,
});

const createInvoiceNumber = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const randomNum = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return `INV-${year}${month}-${randomNum}`;
};

const formatDateInputLocal = (date: Date): string => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const parseDateOnlyLocal = (value?: string): Date | null => {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, monthIndex, day);
  return Number.isFinite(date.getTime()) ? date : null;
};

const formatDateOnlyDisplay = (
  value?: string,
  options: Intl.DateTimeFormatOptions = { year: "numeric", month: "short", day: "numeric" }
): string | undefined => {
  if (!value) return undefined;
  const localDate = parseDateOnlyLocal(String(value).trim());
  if (!localDate) return undefined;
  return localDate.toLocaleDateString("en-US", options);
};

const TZ_NEW_JERSEY = "America/New_York";

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
  if (!year || !month || !day) return formatDateInputLocal(new Date());
  return `${year}-${month}-${day}`;
};

const addDaysToDateInput = (value: string, days: number): string => {
  const base = parseDateOnlyLocal(value);
  if (!base) return value;
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  return formatDateInputLocal(next);
};

const createEmptyInvoiceForm = (): Omit<ExternalInvoice, "id"> => {
  const today = new Date();
  const due = new Date(today);
  due.setDate(today.getDate() + 2);
  return {
    status: "draft",
    invoiceNumber: createInvoiceNumber(),
    invoiceDate: formatDateInputLocal(today),
    dueDate: formatDateInputLocal(due),
    clientName: "",
    clientEmail: "",
    clientPhone: "",
    clientAddress: "",
    clientCity: "",
    clientState: "",
    clientZip: "",
    clientCountry: "",
    terms: INVOICE_TERMS,
    items: [createEmptyItem()],
    subtotal: 0,
    salesTax: 0,
    shippingCost: 0,
    total: 0,
    amountPaid: 0,
    outstandingBalance: 0,
    payments: [],
  };
};

const formatDate = (value?: any) => {
  if (!value) return "—";
  try {
    if (typeof value === "string") {
      const dateOnly = formatDateOnlyDisplay(value, {});
      if (dateOnly) return dateOnly;
    }
    const date = typeof value === "string" ? new Date(value) : value?.toDate?.() || new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleDateString();
  } catch {
    return "—";
  }
};

const toNumber = (value: string | number) => {
  if (typeof value === "number") return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const isOverdueInvoice = (invoice: ExternalInvoice) => {
  if (isFullyPaidInvoice(invoice)) return false;
  const dueDateInput = String(invoice.dueDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDateInput)) return false;
  const todayNJ = getTodayDateInputInNJ();
  return (invoice.status === "sent" || invoice.status === "partially_paid") && dueDateInput < todayNJ;
};

const getDiscountAmount = (invoice: ExternalInvoice): number => {
  if (!invoice.discountType || invoice.discountValue == null) return 0;
  // Calculate discount based on grand total (invoice + late fee) if late fee exists
  const invoiceTotal = Number(invoice.total ?? 0);
  const lateFee = Number(invoice.lateFee ?? 0);
  const baseTotal = lateFee > 0 ? invoiceTotal + lateFee : invoiceTotal;
  if (invoice.discountType === "percentage") {
    return Number((baseTotal * (invoice.discountValue / 100)).toFixed(2));
  }
  return Math.min(Number(invoice.discountValue), baseTotal);
};

const getEffectiveTotal = (invoice: ExternalInvoice): number => {
  const total = Number(invoice.total ?? 0);
  const discount = getDiscountAmount(invoice);
  return Number((total - discount).toFixed(2));
};

const getGrandTotalWithLateFee = (invoice: ExternalInvoice): number => {
  const effectiveTotal = getEffectiveTotal(invoice);
  const lateFee = Number(invoice.lateFee ?? 0);
  return Number((effectiveTotal + lateFee).toFixed(2));
};

/** True when invoice is fully paid — workflow (overdue, late fee, reminders) must not run. */
const isFullyPaidInvoice = (invoice: ExternalInvoice): boolean => {
  if (invoice.status === "paid" || invoice.status === "cancelled" || invoice.status === "disputed") return true;
  const total = getGrandTotalWithLateFee(invoice);
  const paid = Number(invoice.amountPaid ?? 0);
  return paid >= total;
};

export function InvoiceManagementPortal() {
  const { userProfile, user } = useAuth();
  const { toast } = useToast();

  const invoiceTemplateRef = useRef<HTMLDivElement | null>(null);
  const [isPrintMode, setIsPrintMode] = useState(false);
  const lastOverdueWorkflowRunRef = useRef<number>(0);
  const overdueWorkflowRunningRef = useRef<boolean>(false);
  const emailLogBackfillRunningRef = useRef<boolean>(false);
  const emailLogBackfilledKeysRef = useRef<Set<string>>(new Set());
  const OVERDUE_WORKFLOW_THROTTLE_MS = 15 * 60 * 1000; // 15 minutes – prevent duplicate emails
  const enableClientInvoiceAutomation = process.env.NEXT_PUBLIC_ENABLE_CLIENT_INVOICE_AUTOMATION === "true";

  const toBase64 = (buffer: ArrayBuffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    bytes.forEach((b) => (binary += String.fromCharCode(b)));
    return btoa(binary);
  };

  const invoicesQuery = useMemo(
    () => query(collection(db, "external_invoices"), orderBy("createdAt", "desc")),
    []
  );
  const { data: invoices, loading } = useCollection<ExternalInvoice>("external_invoices", invoicesQuery);

  const deleteLogsQuery = useMemo(
    () => query(collection(db, "external_invoice_delete_logs"), orderBy("deletedAt", "desc")),
    []
  );
  const { data: deleteLogs } = useCollection<{ id: string; restored?: boolean; [k: string]: any }>(
    "external_invoice_delete_logs",
    deleteLogsQuery
  );
  const nonRestoredDeleteLogs = useMemo(
    () => (deleteLogs || []).filter((log) => !log.restored),
    [deleteLogs]
  );

  const emailLogsQuery = useMemo(
    () => query(collection(db, "external_invoice_email_logs"), orderBy("sentAt", "desc")),
    []
  );
  const { data: emailLogs } = useCollection<InvoiceEmailLogEntry>(
    "external_invoice_email_logs",
    emailLogsQuery
  );

  const [activeTab, setActiveTab] = useState("new");
  const [formData, setFormData] = useState(createEmptyInvoiceForm());
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [emailLogSearch, setEmailLogSearch] = useState("");

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailForm, setEmailForm] = useState({
    to: "",
    subject: "",
    message: "",
    attachments: [] as File[],
  });
  const [activeEmailInvoice, setActiveEmailInvoice] = useState<ExternalInvoice | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteInvoice, setDeleteInvoice] = useState<ExternalInvoice | null>(null);

  const [partialDialogOpen, setPartialDialogOpen] = useState(false);
  const [partialAmount, setPartialAmount] = useState("");
  const [partialInvoice, setPartialInvoice] = useState<ExternalInvoice | null>(null);

  const [paidDialogOpen, setPaidDialogOpen] = useState(false);
  const [paidInvoice, setPaidInvoice] = useState<ExternalInvoice | null>(null);
  const [paidForm, setPaidForm] = useState({
    paymentDate: new Date().toISOString().slice(0, 10),
    amountPaid: "",
    method: "Zelle" as PaymentMethod,
    reference: "",
    notes: "",
  });

  const [disputeDialogOpen, setDisputeDialogOpen] = useState(false);
  const [disputeInvoice, setDisputeInvoice] = useState<ExternalInvoice | null>(null);
  const [disputeForm, setDisputeForm] = useState({
    reason: "",
    notes: "",
    status: "Open" as "Open" | "Resolved",
  });

  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelInvoice, setCancelInvoice] = useState<ExternalInvoice | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  const [discountDialogOpen, setDiscountDialogOpen] = useState(false);
  const [discountInvoice, setDiscountInvoice] = useState<ExternalInvoice | null>(null);
  const [discountType, setDiscountType] = useState<"percentage" | "amount">("percentage");
  const [discountValue, setDiscountValue] = useState("");
  const [lateFeeAction, setLateFeeAction] = useState<"keep" | "remove" | "change">("keep");
  const [lateFeeCustomAmount, setLateFeeCustomAmount] = useState("");
  const [discountShowResendButton, setDiscountShowResendButton] = useState(false);
  const [lateFeeWasRemoved, setLateFeeWasRemoved] = useState(false);
  const [isSendingResend, setIsSendingResend] = useState(false);

  const [paymentHistoryPage, setPaymentHistoryPage] = useState(1);
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [cancelledViewFilter, setCancelledViewFilter] = useState<"all" | "cancelled" | "deleted">("all");

  const [testOverdueDialogOpen, setTestOverdueDialogOpen] = useState(false);
  const [testOverdueInvoiceId, setTestOverdueInvoiceId] = useState<string>("");
  const [isTestingOverdue, setIsTestingOverdue] = useState(false);

  const recalculateTotals = (
    items: ExternalInvoiceItem[],
    shippingCostValue: number,
    currentSalesTax?: number
  ) => {
    const updatedItems = items.map((item) => ({
      ...item,
      amount: Number(item.quantity || 0) * Number(item.unitPrice || 0),
    }));
    const subtotal = updatedItems.reduce((sum, item) => sum + item.amount, 0);
    // Use current sales tax if provided, otherwise calculate from TAX_RATE
    const salesTax = currentSalesTax !== undefined 
      ? Number(currentSalesTax) 
      : Number((subtotal * TAX_RATE).toFixed(2));
    const total = Number((subtotal + salesTax + shippingCostValue).toFixed(2));
    const amountPaid = formData.amountPaid || 0;
    const outstandingBalance = Math.max(0, Number((total - amountPaid).toFixed(2)));
    return {
      items: updatedItems,
      subtotal,
      salesTax,
      total,
      amountPaid,
      outstandingBalance,
    };
  };

  const statusCounts = useMemo(() => {
    const counts = {
      draft: 0,
      sent: 0,
      partiallyPaid: 0,
      paid: 0,
      overdue: 0,
      disputed: 0,
      cancelled: 0,
    };
    invoices.forEach((invoice) => {
      if (isOverdueInvoice(invoice)) {
        counts.overdue += 1;
        return;
      }
      switch (invoice.status) {
        case "draft":
          counts.draft += 1;
          break;
        case "sent":
          counts.sent += 1;
          break;
        case "partially_paid":
          counts.partiallyPaid += 1;
          break;
        case "paid":
          counts.paid += 1;
          break;
        case "disputed":
          counts.disputed += 1;
          break;
        case "cancelled":
          counts.cancelled += 1;
          break;
        default:
          break;
      }
    });
    return counts;
  }, [invoices]);

  const filteredInvoices = useMemo(() => {
    let list = invoices;
    const queryText = searchQuery.trim().toLowerCase();
    if (queryText) {
      list = list.filter((invoice) =>
        [invoice.invoiceNumber, invoice.clientName, invoice.clientEmail]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(queryText))
      );
    }
    if (dateFrom) {
      list = list.filter((inv) => (inv.invoiceDate || "") >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((inv) => (inv.invoiceDate || "") <= dateTo);
    }
    return list;
  }, [invoices, searchQuery, dateFrom, dateTo]);

  const draftInvoices = filteredInvoices.filter((invoice) => invoice.status === "draft");
  const sentInvoices = filteredInvoices.filter(
    (invoice) => invoice.status === "sent" && !isOverdueInvoice(invoice)
  );
  const partiallyPaidInvoices = filteredInvoices.filter(
    (invoice) => invoice.status === "partially_paid" && !isOverdueInvoice(invoice)
  );
  const paidInvoices = filteredInvoices.filter((invoice) => invoice.status === "paid");
  const overdueInvoices = filteredInvoices.filter((invoice) => isOverdueInvoice(invoice));
  const disputedInvoices = filteredInvoices.filter((invoice) => invoice.status === "disputed");
  const cancelledInvoices = filteredInvoices.filter((invoice) => invoice.status === "cancelled");

  const filteredEmailLogs = useMemo(() => {
    const list = emailLogs ?? [];
    const q = emailLogSearch.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (log) =>
        (log.to ?? "").toLowerCase().includes(q) ||
        (log.clientName ?? "").toLowerCase().includes(q) ||
        (log.invoiceNumber ?? "").toLowerCase().includes(q) ||
        (log.subject ?? "").toLowerCase().includes(q)
    );
  }, [emailLogs, emailLogSearch]);

  const emailLogsByRecipient = useMemo(() => {
    const map = new Map<string, { count: number; logs: InvoiceEmailLogEntry[] }>();
    filteredEmailLogs.forEach((log) => {
      const to = log.to || "—";
      const existing = map.get(to);
      if (existing) {
        existing.count += 1;
        existing.logs.push(log);
      } else {
        map.set(to, { count: 1, logs: [log] });
      }
    });
    return Array.from(map.entries()).map(([to, data]) => ({ to, ...data }));
  }, [filteredEmailLogs]);

  const filteredDeleteLogs = useMemo(() => {
    let list = nonRestoredDeleteLogs;
    const queryText = searchQuery.trim().toLowerCase();
    if (queryText) {
      list = list.filter(
        (log) =>
          [log.invoiceNumber, log.clientName, log.clientEmail]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(queryText))
      );
    }
    if (dateFrom || dateTo) {
      list = list.filter((log) => {
        const d = log.deletedAt;
        const dateStr =
          d?.toDate?.()?.toISOString?.().slice(0, 10) ?? (typeof d === "string" ? d.slice(0, 10) : "");
        if (dateFrom && dateStr < dateFrom) return false;
        if (dateTo && dateStr > dateTo) return false;
        return true;
      });
    }
    return list;
  }, [nonRestoredDeleteLogs, searchQuery, dateFrom, dateTo]);

  const cancelledCombined = useMemo(
    () => [
      ...cancelledInvoices.map((inv) => ({ type: "cancelled" as const, item: inv })),
      ...filteredDeleteLogs.map((log) => ({ type: "deleted" as const, item: log })),
    ],
    [cancelledInvoices, filteredDeleteLogs]
  );

  const cancelledFilteredByType = useMemo(() => {
    if (cancelledViewFilter === "all") return cancelledCombined;
    return cancelledCombined.filter((entry) => entry.type === cancelledViewFilter);
  }, [cancelledCombined, cancelledViewFilter]);

  const paymentHistory = useMemo(() => {
    const list: Array<ExternalInvoicePayment & { invoiceNumber: string; clientName: string; total: number }> = [];
    invoices.forEach((invoice) => {
      invoice.payments?.forEach((payment) => {
        list.push({
          ...payment,
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.clientName,
          total: invoice.total,
        });
      });
    });
    return list.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [invoices]);

  const filteredPaymentHistory = useMemo(() => {
    let list = paymentHistory;
    const queryText = searchQuery.trim().toLowerCase();
    if (queryText) {
      list = list.filter(
        (p) =>
          [p.invoiceNumber, p.clientName].filter(Boolean).some((v) => String(v).toLowerCase().includes(queryText))
      );
    }
    if (dateFrom) {
      list = list.filter((p) => (p.date || "").slice(0, 10) >= dateFrom);
    }
    if (dateTo) {
      list = list.filter((p) => (p.date || "").slice(0, 10) <= dateTo);
    }
    return list;
  }, [paymentHistory, searchQuery, dateFrom, dateTo]);

  const getPaginatedData = <T,>(data: T[], page: number) => {
    const totalPages = Math.max(1, Math.ceil(data.length / itemsPerPage));
    const startIndex = (page - 1) * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return {
      paginatedData: data.slice(startIndex, endIndex),
      totalPages,
      startIndex,
      endIndex,
    };
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setCurrentPage(1);
    if (value === "receipts") setPaymentHistoryPage(1);
  };

  const resetForm = () => {
    setFormData(createEmptyInvoiceForm());
    setEditingInvoiceId(null);
  };

  const updateItem = (id: string, field: keyof ExternalInvoiceItem, value: string) => {
    setFormData((prev) => {
      const nextItems = prev.items.map((item) =>
        item.id === id
          ? {
              ...item,
              [field]: field === "description" ? value : toNumber(value),
            }
          : item
      );
      return {
        ...prev,
        ...recalculateTotals(nextItems, toNumber(prev.shippingCost), prev.salesTax),
      };
    });
  };

  const addItem = () => {
    setFormData((prev) => {
      const nextItems = [...prev.items, createEmptyItem()];
      return {
        ...prev,
        ...recalculateTotals(nextItems, toNumber(prev.shippingCost), prev.salesTax),
      };
    });
  };

  const removeItem = (id: string) => {
    setFormData((prev) => {
      const nextItems = prev.items.length > 1 ? prev.items.filter((item) => item.id !== id) : prev.items;
      return {
        ...prev,
        ...recalculateTotals(nextItems, toNumber(prev.shippingCost), prev.salesTax),
      };
    });
  };

  const buildInvoicePdfData = (invoice: ExternalInvoice) => {
    const formatDateForPdf = (dateStr?: string) => {
      const formatted = formatDateOnlyDisplay(dateStr);
      if (formatted) return formatted;
      if (!dateStr) return undefined;
      try {
        const date = new Date(dateStr);
        if (Number.isNaN(date.getTime())) return dateStr;
        return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
      } catch {
        return dateStr;
      }
    };
    return {
      invoiceNumber: invoice.invoiceNumber,
      invoiceDate: formatDateForPdf(invoice.invoiceDate) || invoice.invoiceDate,
      dueDate: formatDateForPdf(invoice.dueDate),
    company: {
      name: COMPANY_INFO.name,
      email: COMPANY_INFO.email,
      phone: COMPANY_INFO.phone,
      addressLine: COMPANY_INFO.addressLines[0] || "",
      cityStateZip: COMPANY_INFO.addressLines[1] || "",
      country: "United States",
    },
    soldTo: {
      name: invoice.clientName || "",
      email: invoice.clientEmail || "",
      phone: invoice.clientPhone || "",
      addressLine: invoice.clientAddress || "",
      cityStateZip: [invoice.clientCity, invoice.clientState, invoice.clientZip].filter(Boolean).join(", "),
      country: invoice.clientCountry || "",
    },
    items: invoice.items.map((item) => ({
      description: item.description || "",
      quantity: Number(item.quantity || 0),
      unitPrice: Number(item.unitPrice || 0),
      amount: Number(item.amount || 0),
    })),
    subtotal: invoice.subtotal,
    salesTax: invoice.salesTax || 0,
    shippingCost: invoice.shippingCost || 0,
    discount: getDiscountAmount(invoice),
    lateFee: invoice.lateFee || 0,
    total: getGrandTotalWithLateFee(invoice),
    terms: invoice.terms,
  };
  };

  const logInvoiceEmail = useCallback(
    async (payload: {
      to: string;
      subject?: string;
      type: InvoiceEmailLogType;
      invoiceNumber?: string;
      clientName?: string;
    }) => {
      if (!user) return;
      const idToken = await user.getIdToken();
      const vercelBypass = process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
      const headers: HeadersInit = {
        Authorization: `Bearer ${idToken}`,
        "Content-Type": "application/json",
      };
      if (vercelBypass) {
        headers["x-vercel-protection-bypass"] = vercelBypass;
      }

      try {
        const res = await fetch("/api/email/log", {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          throw new Error(await res.text());
        }
      } catch (error) {
        // Fallback to direct client write if server-side log route fails.
        console.error("Primary email log route failed, using direct client log write:", error);
        await addDoc(collection(db, "external_invoice_email_logs"), {
          ...payload,
          sentAt: serverTimestamp(),
          sentBy: user.email ?? user.uid ?? "",
        });
      }
    },
    [user]
  );

  useEffect(() => {
    if (loading || !user || !invoices.length) return;
    if (emailLogBackfillRunningRef.current) return;

    const existingLogKeys = new Set(
      (emailLogs || []).map((log) => `${log.type}|${(log.invoiceNumber || "").trim()}|${(log.to || "").trim().toLowerCase()}`)
    );

    const inferredAutoLogs: Array<{
      key: string;
      to: string;
      subject: string;
      type: InvoiceEmailLogType;
      invoiceNumber: string;
      clientName?: string;
    }> = [];

    for (const invoice of invoices) {
      const to = (invoice.clientEmail || "").trim();
      const invoiceNumber = (invoice.invoiceNumber || "").trim();
      if (!to || !invoiceNumber) continue;

      const reminder24hKey = `reminder_24h|${invoiceNumber}|${to.toLowerCase()}`;
      if (
        invoice.reminderSentAt &&
        !existingLogKeys.has(reminder24hKey) &&
        !emailLogBackfilledKeysRef.current.has(reminder24hKey)
      ) {
        inferredAutoLogs.push({
          key: reminder24hKey,
          to,
          subject: `Reminder: Invoice ${invoiceNumber} – payment due`,
          type: "reminder_24h",
          invoiceNumber,
          clientName: invoice.clientName,
        });
      }

      const overdueKey = `overdue|${invoiceNumber}|${to.toLowerCase()}`;
      if (
        invoice.lateFeeEmailSentAt &&
        !existingLogKeys.has(overdueKey) &&
        !emailLogBackfilledKeysRef.current.has(overdueKey)
      ) {
        inferredAutoLogs.push({
          key: overdueKey,
          to,
          subject: `Late Fee Added - Invoice ${invoiceNumber}`,
          type: "overdue",
          invoiceNumber,
          clientName: invoice.clientName,
        });
      }

      const secondReminderKey = `second_reminder|${invoiceNumber}|${to.toLowerCase()}`;
      if (
        invoice.secondOverdueReminderSentAt &&
        !existingLogKeys.has(secondReminderKey) &&
        !emailLogBackfilledKeysRef.current.has(secondReminderKey)
      ) {
        inferredAutoLogs.push({
          key: secondReminderKey,
          to,
          subject: `Final Reminder: Unpaid Invoice ${invoiceNumber}`,
          type: "second_reminder",
          invoiceNumber,
          clientName: invoice.clientName,
        });
      }
    }

    if (!inferredAutoLogs.length) return;

    emailLogBackfillRunningRef.current = true;
    (async () => {
      try {
        for (const payload of inferredAutoLogs) {
          emailLogBackfilledKeysRef.current.add(payload.key);
          try {
            await logInvoiceEmail({
              to: payload.to,
              subject: payload.subject,
              type: payload.type,
              invoiceNumber: payload.invoiceNumber,
              clientName: payload.clientName,
            });
          } catch (error) {
            emailLogBackfilledKeysRef.current.delete(payload.key);
            console.error("Failed to backfill missing email log entry:", payload, error);
          }
        }
      } finally {
        emailLogBackfillRunningRef.current = false;
      }
    })();
  }, [emailLogs, invoices, loading, logInvoiceEmail, user]);

  const sendOverdueEmail = useCallback(async (invoice: ExternalInvoice) => {
    if (!user || !invoice.clientEmail) {
      console.warn(`Cannot send overdue email for invoice ${invoice.invoiceNumber}: missing user or client email`);
      return;
    }

    try {
      const invoiceBlob = await generateQuoteInvoicePdfBlob(buildInvoicePdfData(invoice));
      const invoiceFile = new File([invoiceBlob], `Invoice-${invoice.invoiceNumber}.pdf`, {
        type: "application/pdf",
      });

      const idToken = await user.getIdToken();
      const headers: HeadersInit = {
        Authorization: `Bearer ${idToken}`,
      };
      const externalEmailApi = process.env.NEXT_PUBLIC_EMAIL_API_URL;
      const vercelBypass = process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
      if (vercelBypass) {
        headers["x-vercel-protection-bypass"] = vercelBypass;
      }

      const lateFeeMessage = `Hi,

We'd like to inform you that a late fee of $19 has been added to your invoice, as payment was not received by the due date, in accordance with our billing terms.

If payment has already been made, please disregard this message. Otherwise, we kindly request you to complete the payment at your earliest convenience so services can continue without interruption.

If you have any questions or believe this was applied in error, feel free to reach out—we're happy to assist.

Thank you for your understanding.

Best regards,
Prep Services FBA Team`;

      let response: Response;
      if (externalEmailApi) {
        const attachmentsPayload = await Promise.all(
          [invoiceFile].map(async (file) => ({
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
            to: invoice.clientEmail.trim(),
            subject: `Late Fee Added - Invoice ${invoice.invoiceNumber}`,
            message: lateFeeMessage,
            attachments: attachmentsPayload,
          }),
        });
      } else {
        const payload = new FormData();
        payload.append("to", invoice.clientEmail.trim());
        payload.append("subject", `Late Fee Added - Invoice ${invoice.invoiceNumber}`);
        payload.append("message", lateFeeMessage);
        payload.append("attachments", invoiceFile);
        const apiUrl = vercelBypass
          ? `/api/email/send?x-vercel-protection-bypass=${encodeURIComponent(vercelBypass)}`
          : "/api/email/send";
        response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: payload,
        });
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to send overdue email.");
      }

      // Mark email as sent
      await updateDoc(doc(db, "external_invoices", invoice.id), {
        lateFeeEmailSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await logInvoiceEmail({
        to: invoice.clientEmail.trim(),
        subject: `Late Fee Added - Invoice ${invoice.invoiceNumber}`,
        type: "overdue",
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
      });
      console.log(`Overdue email sent for invoice ${invoice.invoiceNumber}`);
    } catch (error) {
      console.error(`Failed to send overdue email for invoice ${invoice.invoiceNumber}:`, error);
    }
  }, [user, toBase64, buildInvoicePdfData, logInvoiceEmail]);

  const sendSecondOverdueReminder = useCallback(async (invoice: ExternalInvoice) => {
    if (!user || !invoice.clientEmail) {
      console.warn(`Cannot send second overdue reminder for invoice ${invoice.invoiceNumber}: missing user or client email`);
      return;
    }

    try {
      const idToken = await user.getIdToken();
      const headers: HeadersInit = {
        Authorization: `Bearer ${idToken}`,
      };
      const externalEmailApi = process.env.NEXT_PUBLIC_EMAIL_API_URL;
      const vercelBypass = process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
      if (vercelBypass) {
        headers["x-vercel-protection-bypass"] = vercelBypass;
      }

      const secondOverdueMessage = `Hi,

Our records show that your invoice is still unpaid, even after the late fee was applied. As per our terms, services—including receiving, prep, storage, and shipments—may be temporarily paused until payment is completed.

We'd really appreciate it if you could settle the outstanding balance as soon as possible to avoid any disruption. If you've already made the payment, please disregard this message.

And of course, if you have any questions or concerns, we're always here to help.

Thank you for your attention.

Best regards,
Prep Services FBA Team`;

      let response: Response;
      if (externalEmailApi) {
        response = await fetch(externalEmailApi, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to: invoice.clientEmail.trim(),
            subject: `Final Reminder: Unpaid Invoice ${invoice.invoiceNumber}`,
            message: secondOverdueMessage,
            attachments: [],
          }),
        });
      } else {
        const payload = new FormData();
        payload.append("to", invoice.clientEmail.trim());
        payload.append("subject", `Final Reminder: Unpaid Invoice ${invoice.invoiceNumber}`);
        payload.append("message", secondOverdueMessage);
        const apiUrl = vercelBypass
          ? `/api/email/send?x-vercel-protection-bypass=${encodeURIComponent(vercelBypass)}`
          : "/api/email/send";
        response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: payload,
        });
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to send second overdue reminder.");
      }

      await updateDoc(doc(db, "external_invoices", invoice.id), {
        secondOverdueReminderSentAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await logInvoiceEmail({
        to: invoice.clientEmail.trim(),
        subject: `Final Reminder: Unpaid Invoice ${invoice.invoiceNumber}`,
        type: "second_reminder",
        invoiceNumber: invoice.invoiceNumber,
        clientName: invoice.clientName,
      });
      console.log(`Second overdue reminder sent for invoice ${invoice.invoiceNumber}`);
    } catch (error) {
      console.error(`Failed to send second overdue reminder for invoice ${invoice.invoiceNumber}:`, error);
    }
  }, [user, logInvoiceEmail]);

  const REMINDER_24H_MS = 24 * 60 * 60 * 1000;
  const getSentAtMs = (invoice: ExternalInvoice): number | null => {
    const s = invoice.sentAt;
    if (!s) return null;
    try {
      let date: Date;
      if (typeof (s as any)?.toDate === "function") date = (s as any).toDate();
      else if (typeof s === "string") date = new Date(s);
      else if (typeof (s as any)?.seconds === "number") date = new Date((s as any).seconds * 1000);
      else date = new Date(s as any);
      return Number.isFinite(date.getTime()) ? date.getTime() : null;
    } catch {
      return null;
    }
  };

  const send24HourReminder = useCallback(
    async (invoice: ExternalInvoice) => {
      if (!user || !invoice.clientEmail) {
        console.warn(`Cannot send 24h reminder for invoice ${invoice.invoiceNumber}: missing user or client email`);
        return;
      }
      try {
        const idToken = await user.getIdToken();
        const headers: HeadersInit = { Authorization: `Bearer ${idToken}` };
        const externalEmailApi = process.env.NEXT_PUBLIC_EMAIL_API_URL;
        const vercelBypass = process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
        if (vercelBypass) headers["x-vercel-protection-bypass"] = vercelBypass;

        const dueDateStr = invoice.dueDate
          ? (() => {
              try {
                const d = parseDateOnlyLocal(invoice.dueDate) ?? new Date(invoice.dueDate);
                return Number.isFinite(d.getTime())
                  ? d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                  : invoice.dueDate;
              } catch {
                return invoice.dueDate;
              }
            })()
          : "the due date";

        const reminder24hMessage = `Hi,

We sent you an invoice (${invoice.invoiceNumber}) 24 hours ago. This is a friendly reminder to complete payment by ${dueDateStr} to avoid a $19 late fee.

If you've already paid, please disregard this message. If you have any questions, we're here to help.

Best regards,
Prep Services FBA Team`;

        const subject = `Reminder: Invoice ${invoice.invoiceNumber} – payment due`;

        if (externalEmailApi) {
          const res = await fetch(externalEmailApi, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({
              to: invoice.clientEmail.trim(),
              subject,
              message: reminder24hMessage,
              attachments: [],
            }),
          });
          if (!res.ok) throw new Error(await res.text());
        } else {
          const payload = new FormData();
          payload.append("to", invoice.clientEmail.trim());
          payload.append("subject", subject);
          payload.append("message", reminder24hMessage);
          const apiUrl = vercelBypass
            ? `/api/email/send?x-vercel-protection-bypass=${encodeURIComponent(vercelBypass)}`
            : "/api/email/send";
          const res = await fetch(apiUrl, { method: "POST", headers, body: payload });
          if (!res.ok) throw new Error(await res.text());
        }

        await updateDoc(doc(db, "external_invoices", invoice.id), {
          reminderSentAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await logInvoiceEmail({
          to: invoice.clientEmail.trim(),
          subject,
          type: "reminder_24h",
          invoiceNumber: invoice.invoiceNumber,
          clientName: invoice.clientName,
        });
        console.log(`24h reminder sent for invoice ${invoice.invoiceNumber}`);
      } catch (error) {
        console.error(`Failed to send 24h reminder for invoice ${invoice.invoiceNumber}:`, error);
      }
    },
    [user, logInvoiceEmail]
  );

  const sendPaymentConfirmationEmail = useCallback(
    async (
      invoice: ExternalInvoice,
      newStatus: "partially_paid" | "paid",
      outstandingBalance: number
    ): Promise<void> => {
      const to = (invoice.clientEmail || "").trim();
      if (!user || !to) return;
      const invNum = invoice.invoiceNumber || invoice.id;
      const isPaidInFull = newStatus === "paid";
      const subject = isPaidInFull
        ? `Invoice ${invNum} Paid in Full – Thank You`
        : `Payment Received – Invoice ${invNum} (Partial)`;
      const message = isPaidInFull
        ? `Hi,

Thank you for your payment. We have received the full amount for Invoice ${invNum}, and this invoice is now paid in full.

No further action is needed. If you have any questions, we're happy to help.

Best regards,
Prep Services FBA Team`
        : `Hi,

Thank you for your payment. We have received the amount you sent and applied it to Invoice ${invNum}.

Your remaining balance on this invoice is $${outstandingBalance.toFixed(2)}. If you have any questions, just let us know.

Best regards,
Prep Services FBA Team`;

      try {
        const idToken = await user.getIdToken();
        const headers: HeadersInit = { Authorization: `Bearer ${idToken}` };
        const externalEmailApi = process.env.NEXT_PUBLIC_EMAIL_API_URL;
        const vercelBypass = process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
        if (vercelBypass) headers["x-vercel-protection-bypass"] = vercelBypass;

        if (externalEmailApi) {
          const res = await fetch(externalEmailApi, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ to, subject, message, attachments: [] }),
          });
          if (!res.ok) throw new Error(await res.text());
        } else {
          const payload = new FormData();
          payload.append("to", to);
          payload.append("subject", subject);
          payload.append("message", message);
          const apiUrl = vercelBypass
            ? `/api/email/send?x-vercel-protection-bypass=${encodeURIComponent(vercelBypass)}`
            : "/api/email/send";
          const res = await fetch(apiUrl, { method: "POST", headers, body: payload });
          if (!res.ok) throw new Error(await res.text());
        }
        await logInvoiceEmail({
          to,
          subject,
          type: "payment_confirmation",
          invoiceNumber: invNum,
          clientName: invoice.clientName,
        });
        console.log(`Payment confirmation email sent for invoice ${invNum} (${newStatus})`);
      } catch (err) {
        console.error(`Failed to send payment confirmation email for invoice ${invNum}:`, err);
        throw err;
      }
    },
    [user, logInvoiceEmail]
  );

  const LATE_FEE_REMOVED_MESSAGE = `Hi,

We'd like to let you know that the late fee on your invoice has been removed as a courtesy.

Please note that the original invoice balance remains due. We kindly ask you to complete the payment at your earliest convenience so we can continue services without interruption.

If you have any questions or need clarification, feel free to reach out—we're happy to help.

Thank you for your cooperation.

Best regards,
Prep Services FBA Team`;

  const sendInvoiceUpdateEmail = useCallback(async (
    invoice: ExternalInvoice,
    options: {
      reason: "discount_applied" | "late_fee_removed" | "late_fee_changed";
      logType: "discount_update" | "resend";
    }
  ) => {
    if (!user || !invoice.clientEmail) {
      throw new Error("Missing user or client email.");
    }

    const invoiceBlob = await generateQuoteInvoicePdfBlob(buildInvoicePdfData(invoice));
    const invoiceFile = new File([invoiceBlob], `Invoice-${invoice.invoiceNumber}.pdf`, { type: "application/pdf" });
    const idToken = await user.getIdToken();
    const headers: HeadersInit = { Authorization: `Bearer ${idToken}` };
    const vercelBypass = process.env.NEXT_PUBLIC_VERCEL_PROTECTION_BYPASS;
    if (vercelBypass) headers["x-vercel-protection-bypass"] = vercelBypass;
    const externalEmailApi = process.env.NEXT_PUBLIC_EMAIL_API_URL;

    const subject = `Updated Invoice - ${invoice.invoiceNumber}`;
    const discountAmount = getDiscountAmount(invoice);
    const revisedTotal = getGrandTotalWithLateFee(invoice);
    const revisedOutstanding = Number(invoice.outstandingBalance ?? revisedTotal);
    const message =
      options.reason === "late_fee_removed"
        ? LATE_FEE_REMOVED_MESSAGE
        : options.reason === "late_fee_changed"
          ? `Hi,\n\nWe'd like to let you know that the late fee on your invoice has been updated. Please see the attached invoice for the new balance.\n\nIf you have any questions, feel free to reach out.\n\nBest regards,\nPrep Services FBA Team`
          : `Hi,\n\nWe've applied a discount${discountAmount > 0 ? ` of $${discountAmount.toFixed(2)}` : ""} to your invoice. Please see the attached revised invoice.\n\nUpdated invoice total: $${revisedTotal.toFixed(2)}\nUpdated outstanding balance: $${revisedOutstanding.toFixed(2)}\n\nIf you have any questions, feel free to reach out.\n\nBest regards,\nPrep Services FBA Team`;

    if (externalEmailApi) {
      const attachmentsPayload = await Promise.all(
        [invoiceFile].map(async (file) => ({
          name: file.name,
          type: file.type,
          size: file.size,
          dataBase64: toBase64(await file.arrayBuffer()),
        }))
      );
      const response = await fetch(externalEmailApi, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          to: invoice.clientEmail.trim(),
          subject,
          message,
          attachments: attachmentsPayload,
        }),
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Email API returned ${response.status}`);
      }
    } else {
      const payload = new FormData();
      payload.append("to", invoice.clientEmail.trim());
      payload.append("subject", subject);
      payload.append("message", message);
      payload.append("attachments", invoiceFile);
      const apiUrl = vercelBypass
        ? `/api/email/send?x-vercel-protection-bypass=${encodeURIComponent(vercelBypass)}`
        : "/api/email/send";
      const response = await fetch(apiUrl, { method: "POST", headers, body: payload });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(errText || `Email API returned ${response.status}`);
      }
    }

    await logInvoiceEmail({
      to: invoice.clientEmail.trim(),
      subject,
      type: options.logType,
      invoiceNumber: invoice.invoiceNumber,
      clientName: invoice.clientName,
    });
  }, [user, toBase64, buildInvoicePdfData, logInvoiceEmail]);

  const sendResendAfterLateFeeUpdate = useCallback(async (invoice: ExternalInvoice, wasRemoved: boolean) => {
    if (!user || !invoice.clientEmail) {
      toast({ variant: "destructive", title: "Missing user or client email." });
      return;
    }
    setIsSendingResend(true);
    try {
      await sendInvoiceUpdateEmail(invoice, {
        reason: wasRemoved ? "late_fee_removed" : "late_fee_changed",
        logType: "resend",
      });
      toast({ title: "Invoice resent with updated totals." });
      setDiscountDialogOpen(false);
      setDiscountInvoice(null);
      setDiscountShowResendButton(false);
      setDiscountType("percentage");
      setDiscountValue("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to resend invoice.";
      console.error("Failed to resend invoice:", error);
      toast({ variant: "destructive", title: "Failed to resend invoice.", description: message });
    } finally {
      setIsSendingResend(false);
    }
  }, [user, sendInvoiceUpdateEmail]);

  // Automatically apply late fee when invoice becomes overdue and send email.
  // SAFEGUARDS so 566-duplicate-email bug cannot happen again:
  // 1. Throttle: run at most once per 15 minutes (effect re-runs on every Firestore snapshot).
  // 2. Running lock: skip if a run is already in progress (overdueWorkflowRunningRef).
  // 3. Fully paid: isFullyPaidInvoice() excludes paid/cancelled/disputed and amountPaid >= total.
  // 4. Sent flags: reminderSentAt, lateFeeEmailSentAt and secondOverdueReminderSentAt ensure at most 1 of each per invoice.
  useEffect(() => {
    // Server-side cron in Firebase Functions owns invoice automation by default.
    // Keep this client workflow opt-in only for local debugging.
    if (!enableClientInvoiceAutomation) return;
    if (!invoices.length || loading || !user) return;
    const now = Date.now();
    if (overdueWorkflowRunningRef.current) return;
    if (now - lastOverdueWorkflowRunRef.current < OVERDUE_WORKFLOW_THROTTLE_MS) return;

    const send24HourReminders = async () => {
      const needReminder = invoices.filter(
        (invoice) =>
          !isFullyPaidInvoice(invoice) &&
          (invoice.status === "sent" || invoice.status === "partially_paid") &&
          !invoice.reminderSentAt &&
          (() => {
            const sentMs = getSentAtMs(invoice);
            return sentMs != null && now - sentMs >= REMINDER_24H_MS;
          })()
      );
      for (const invoice of needReminder) {
        await send24HourReminder(invoice);
      }
    };

    const applyLateFeeToOverdue = async () => {
      const overdueWithoutLateFee = invoices.filter(
        (invoice) =>
          !isFullyPaidInvoice(invoice) &&
          isOverdueInvoice(invoice) &&
          (!invoice.lateFee || invoice.lateFee === 0) &&
          !invoice.lateFeeEmailSentAt // Only send email if not already sent
      );

      if (overdueWithoutLateFee.length === 0) return;

      for (const invoice of overdueWithoutLateFee) {
        try {
          // When invoice becomes overdue: invoice date = today, due date = tomorrow (one day)
          const invoiceDateStr = getTodayDateInputInNJ();
          const dueDateStr = addDaysToDateInput(invoiceDateStr, 1);

          // Create updated invoice object with late fee and new dates for PDF generation
          const updatedInvoice: ExternalInvoice = {
            ...invoice,
            lateFee: 19,
            invoiceDate: invoiceDateStr,
            dueDate: dueDateStr,
          };
          const amountPaid = Number(invoice.amountPaid ?? 0);
          const newOutstanding = Math.max(
            0,
            Number((getGrandTotalWithLateFee(updatedInvoice) - amountPaid).toFixed(2))
          );

          // Apply late fee and new dates to database
          await updateDoc(doc(db, "external_invoices", invoice.id), {
            lateFee: 19,
            invoiceDate: invoiceDateStr,
            dueDate: dueDateStr,
            outstandingBalance: newOutstanding,
            updatedAt: serverTimestamp(),
          });

          // Send email with updated invoice (includes late fee and new dates in PDF)
          await sendOverdueEmail(updatedInvoice);
        } catch (error) {
          console.error(`Failed to apply late fee to invoice ${invoice.invoiceNumber}:`, error);
        }
      }
    };

    const sendSecondOverdueReminders = async () => {
      // Second time overdue: first overdue email already sent, but final reminder not sent yet.
      // This should still work even if admin later removed/changed late fee.
      const overdueSecondTime = invoices.filter(
        (invoice) =>
          !isFullyPaidInvoice(invoice) &&
          isOverdueInvoice(invoice) &&
          invoice.lateFeeEmailSentAt &&
          !invoice.secondOverdueReminderSentAt
      );

      for (const invoice of overdueSecondTime) {
        await sendSecondOverdueReminder(invoice);
      }
    };

    overdueWorkflowRunningRef.current = true;
    lastOverdueWorkflowRunRef.current = now;
    (async () => {
      try {
        await send24HourReminders();
        await applyLateFeeToOverdue();
        await sendSecondOverdueReminders();
      } finally {
        overdueWorkflowRunningRef.current = false;
      }
    })();
  }, [enableClientInvoiceAutomation, invoices, loading, user, sendOverdueEmail, sendSecondOverdueReminder, send24HourReminder]);

  const downloadInvoicePdf = async (invoice: ExternalInvoice) => {
    try {
      const blob = await generateQuoteInvoicePdfBlob(buildInvoicePdfData(invoice));
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `Invoice-${invoice.invoiceNumber}.pdf`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      console.error("Failed to download invoice PDF:", error);
      toast({ variant: "destructive", title: "Failed to download invoice PDF." });
    }
  };

  const saveInvoiceRecord = async (status: ExternalInvoiceStatus) => {
    const payload: Omit<ExternalInvoice, "id"> = {
      ...formData,
      status,
      amountPaid: formData.amountPaid || 0,
      outstandingBalance: formData.outstandingBalance || 0,
      updatedAt: serverTimestamp(),
    };

    if (editingInvoiceId) {
      await updateDoc(doc(db, "external_invoices", editingInvoiceId), payload as any);
      return { ...payload, id: editingInvoiceId } as ExternalInvoice;
    }

    const docRef = await addDoc(collection(db, "external_invoices"), {
      ...payload,
      createdAt: serverTimestamp(),
    });
    return { ...payload, id: docRef.id } as ExternalInvoice;
  };

  const viewInvoicePdf = async (invoice: ExternalInvoice) => {
    try {
      const blob = await generateQuoteInvoicePdfBlob(buildInvoicePdfData(invoice));
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (error) {
      console.error("Failed to preview invoice PDF:", error);
      toast({ variant: "destructive", title: "Failed to preview invoice PDF." });
    }
  };

  const downloadInvoicesCsv = (invoices: ExternalInvoice[], filenamePrefix: string) => {
    if (!invoices.length) {
      toast({ variant: "destructive", title: "No data to export." });
      return;
    }
    const headers = [
      "Invoice Number",
      "Client Name",
      "Client Email",
      "Invoice Date",
      "Due Date",
      "Status",
      "Total",
      "Late Fee",
      "Amount Paid",
      "Outstanding Balance",
      "Payment Count",
      "Last Payment Date",
    ];
    const rows = invoices.map((invoice) => {
      const lastPayment = invoice.payments?.length
        ? invoice.payments[invoice.payments.length - 1]
        : undefined;
      const displayOutstanding = Math.max(
        0,
        Number((getGrandTotalWithLateFee(invoice) - Number(invoice.amountPaid ?? 0)).toFixed(2))
      );
      return [
        invoice.invoiceNumber,
        invoice.clientName,
        invoice.clientEmail,
        invoice.invoiceDate ?? "",
        invoice.dueDate ?? "",
        invoice.status ?? "",
        Number(invoice.total ?? 0).toFixed(2),
        Number(invoice.lateFee ?? 0).toFixed(2),
        Number(invoice.amountPaid ?? 0).toFixed(2),
        displayOutstanding.toFixed(2),
        String(invoice.payments?.length || 0),
        lastPayment?.date ?? "",
      ];
    });
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => `"${String(value || "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${filenamePrefix}-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  const downloadPaidInvoicesCsv = () => downloadInvoicesCsv(paidInvoices, "paid-invoices");

  const downloadReceiptPdf = (
    payment: ExternalInvoicePayment & { invoiceNumber: string; clientName: string; total: number }
  ) => {
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text("Payment Receipt", 14, 20);
    doc.setFontSize(11);
    doc.text(`Invoice: ${payment.invoiceNumber}`, 14, 32);
    doc.text(`Client: ${payment.clientName}`, 14, 40);
    doc.text(`Payment Date: ${payment.date}`, 14, 48);
    doc.text(`Payment Method: ${payment.method}`, 14, 56);
    doc.text(`Amount Paid: $${payment.amount.toFixed(2)}`, 14, 64);
    doc.text(`Invoice Total: $${payment.total.toFixed(2)}`, 14, 72);
    if (payment.reference) {
      doc.text(`Reference: ${payment.reference}`, 14, 80);
    }
    if (payment.notes) {
      doc.text("Notes:", 14, 88);
      doc.text(payment.notes, 14, 96);
    }
    doc.save(`Receipt-${payment.invoiceNumber}-${payment.date}.pdf`);
  };

  const saveInvoice = async (status: ExternalInvoiceStatus) => {
    if (!userProfile) {
      toast({ variant: "destructive", title: "You must be logged in to save invoices." });
      return;
    }

    setSaving(true);
    try {
      await saveInvoiceRecord(status);

      toast({ title: status === "draft" ? "Invoice saved as draft." : "Invoice saved." });
      resetForm();
      if (status === "draft") {
        setActiveTab("draft");
      }
    } catch (error) {
      console.error("Failed to save invoice:", error);
      toast({ variant: "destructive", title: "Failed to save invoice." });
    } finally {
      setSaving(false);
    }
  };

  const handleSendFromForm = async () => {
    if (!userProfile) {
      toast({ variant: "destructive", title: "You must be logged in to send invoices." });
      return;
    }
    setSaving(true);
    try {
      const savedInvoice = await saveInvoiceRecord("draft");
      setEditingInvoiceId(savedInvoice.id);
      setActiveTab("draft");
      openEmailDialog(savedInvoice);
    } catch (error) {
      console.error("Failed to prepare invoice for sending:", error);
      toast({ variant: "destructive", title: "Failed to prepare invoice for sending." });
    } finally {
      setSaving(false);
    }
  };

  const handleEditInvoice = (invoice: ExternalInvoice) => {
    const normalizedItems = (invoice.items || []).map((it: ExternalInvoiceItem, i: number) => ({
      id: it.id || crypto.randomUUID(),
      description: String(it.description ?? ""),
      quantity: Number(it.quantity ?? 0),
      unitPrice: Number(it.unitPrice ?? 0),
      amount: Number(it.amount ?? 0),
    }));
    setFormData({
      ...invoice,
      items: normalizedItems.length ? normalizedItems : [createEmptyItem()],
    });
    setEditingInvoiceId(invoice.id);
    setActiveTab("new");
  };

  const handleDeleteInvoice = (invoice: ExternalInvoice) => {
    setDeleteInvoice(invoice);
    setDeleteReason("");
    setDeleteDialogOpen(true);
  };

  const confirmDeleteInvoice = async () => {
    if (!deleteInvoice) return;
    setSaving(true);
    try {
      const { id: _id, ...rest } = deleteInvoice;
      await addDoc(collection(db, "external_invoice_delete_logs"), {
        ...rest,
        invoiceId: deleteInvoice.id,
        deletedBy: userProfile?.uid || "",
        deletedByName: userProfile?.name || userProfile?.email || "Unknown",
        deletedAt: serverTimestamp(),
        reason: deleteReason.trim(),
      });
      await deleteDoc(doc(db, "external_invoices", deleteInvoice.id));
      toast({ title: "Invoice deleted and logged." });
      setDeleteDialogOpen(false);
      setDeleteInvoice(null);
      setDeleteReason("");
    } catch (error) {
      console.error("Failed to delete invoice:", error);
      toast({ variant: "destructive", title: "Failed to delete invoice." });
    } finally {
      setSaving(false);
    }
  };

  const handleRestoreInvoice = async (log: { id: string; [k: string]: any }) => {
    if (!userProfile) {
      toast({ variant: "destructive", title: "You must be logged in to restore invoices." });
      return;
    }
    setSaving(true);
    try {
      const {
        id: _logId,
        invoiceId: _invoiceId,
        deletedBy,
        deletedByName,
        deletedAt,
        reason,
        restored: _r,
        restoredAt: _ra,
        restoredInvoiceId: _ri,
        ...invoiceData
      } = log;
      const cleanInvoice = {
        ...invoiceData,
        status: (log.status as ExternalInvoiceStatus) || "draft",
        items:
          Array.isArray(log.items) && log.items.length
            ? log.items.map((it: any) => ({ ...it, id: it.id || crypto.randomUUID() }))
            : [createEmptyItem()],
        payments: Array.isArray(log.payments) ? log.payments : [],
        amountPaid: Number(log.amountPaid ?? 0),
        outstandingBalance: Number(log.outstandingBalance ?? 0),
      };
      const docRef = await addDoc(collection(db, "external_invoices"), {
        ...cleanInvoice,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, "external_invoice_delete_logs", log.id), {
        restored: true,
        restoredAt: serverTimestamp(),
        restoredInvoiceId: docRef.id,
      });
      toast({
        title: "Invoice restored",
        description: `${log.invoiceNumber ?? "Invoice"} has been restored to ${log.status ?? "draft"} status.`,
      });
      setActiveTab(log.status === "draft" ? "draft" : "new");
    } catch (error) {
      console.error("Failed to restore invoice:", error);
      toast({ variant: "destructive", title: "Failed to restore invoice." });
    } finally {
      setSaving(false);
    }
  };

  const openEmailDialog = (invoice: ExternalInvoice) => {
    setActiveEmailInvoice(invoice);
    setEmailForm({
      to: invoice.clientEmail || "",
      subject: `Prep Services FBA - Invoice ${invoice.invoiceNumber}`,
      message: "",
      attachments: [],
    });
    setEmailDialogOpen(true);
  };

  const sendInvoiceEmail = async () => {
    if (!activeEmailInvoice || !user) return;
    setIsSendingEmail(true);
    try {
      const invoiceBlob = await generateQuoteInvoicePdfBlob(buildInvoicePdfData(activeEmailInvoice));
      const invoiceFile = new File([invoiceBlob], `Invoice-${activeEmailInvoice.invoiceNumber}.pdf`, {
        type: "application/pdf",
      });
      const attachmentsToSend = [invoiceFile, ...emailForm.attachments];

      const idToken = await user.getIdToken();
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
          attachmentsToSend.map(async (file) => ({
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
            to: emailForm.to.trim(),
            subject: emailForm.subject.trim(),
            message: emailForm.message || "",
            attachments: attachmentsPayload,
          }),
        });
      } else {
        const payload = new FormData();
        payload.append("to", emailForm.to.trim());
        payload.append("subject", emailForm.subject.trim());
        payload.append("message", emailForm.message || "");
        attachmentsToSend.forEach((file) => payload.append("attachments", file));
        const apiUrl = vercelBypass
          ? `/api/email/send?x-vercel-protection-bypass=${encodeURIComponent(vercelBypass)}`
          : "/api/email/send";
        response = await fetch(apiUrl, {
          method: "POST",
          headers,
          body: payload,
        });
      }

      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to send invoice.");
      }

      await updateDoc(doc(db, "external_invoices", activeEmailInvoice.id), {
        status: "sent",
        sentAt: activeEmailInvoice.sentAt || new Date(),
        updatedAt: serverTimestamp(),
      });

      await logInvoiceEmail({
        to: emailForm.to.trim(),
        subject: emailForm.subject.trim(),
        type: "invoice_sent",
        invoiceNumber: activeEmailInvoice.invoiceNumber,
        clientName: activeEmailInvoice.clientName,
      });
      toast({ title: "Invoice send." });
      setEmailDialogOpen(false);
      setActiveEmailInvoice(null);
      setActiveTab("sent");
    } catch (error) {
      console.error("Failed to send invoice:", error);
      toast({ variant: "destructive", title: "Failed to send invoice." });
    } finally {
      setIsSendingEmail(false);
    }
  };

  const openMarkPaidDialog = (invoice: ExternalInvoice) => {
    const outstanding = Math.max(
      0,
      Number((getGrandTotalWithLateFee(invoice) - Number(invoice.amountPaid ?? 0)).toFixed(2))
    );
    setPaidInvoice(invoice);
    setPaidForm({
      paymentDate: new Date().toISOString().slice(0, 10),
      amountPaid: outstanding > 0 ? String(outstanding) : "",
      method: "Zelle",
      reference: "",
      notes: "",
    });
    setPaidDialogOpen(true);
  };

  const applyPartialPayment = async () => {
    if (!partialInvoice) return;
    const amount = toNumber(partialAmount);
    if (amount <= 0) {
      toast({ variant: "destructive", title: "Enter a valid payment amount." });
      return;
    }
    setSaving(true);
    try {
      const currentPaid = Number(partialInvoice.amountPaid ?? 0);
      const invoiceTotal = getGrandTotalWithLateFee(partialInvoice);
      const updatedPaid = Number((currentPaid + amount).toFixed(2));
      const outstanding = Math.max(0, Number((invoiceTotal - updatedPaid).toFixed(2)));
      const existingPayments = Array.isArray(partialInvoice.payments) ? partialInvoice.payments : [];
      const newPayment = {
        id: crypto.randomUUID(),
        amount: Number(amount.toFixed(2)),
        date: new Date().toISOString().slice(0, 10),
        method: "Other",
        reference: "",
        notes: "",
        createdAt: new Date().toISOString(),
      };
      const payments = [...existingPayments, newPayment];
      if (!Number.isFinite(updatedPaid) || !Number.isFinite(outstanding)) {
        toast({ variant: "destructive", title: "Invalid amounts. Please check invoice total and payment." });
        return;
      }

      await updateDoc(doc(db, "external_invoices", partialInvoice.id), {
        amountPaid: updatedPaid,
        outstandingBalance: outstanding,
        status: outstanding === 0 ? "paid" : "partially_paid",
        payments,
        updatedAt: serverTimestamp(),
      });

      const newStatus = outstanding === 0 ? "paid" : "partially_paid";
      sendPaymentConfirmationEmail(partialInvoice, newStatus, outstanding).catch(() => {
        toast({ variant: "destructive", title: "Payment applied, but notification email failed." });
      });

      toast({ title: "Partial payment applied." });
      setPartialDialogOpen(false);
      setPartialAmount("");
      setPartialInvoice(null);
    } catch (error) {
      console.error("Failed to apply partial payment:", error);
      const msg = error instanceof Error ? error.message : "Failed to apply payment.";
      toast({ variant: "destructive", title: "Failed to apply payment.", description: msg });
    } finally {
      setSaving(false);
    }
  };

  const applyPaidPayment = async () => {
    if (!paidInvoice) return;
    if (!paidForm.paymentDate || !paidForm.amountPaid) {
      toast({ variant: "destructive", title: "Payment date and amount are required." });
      return;
    }
    const amount = toNumber(paidForm.amountPaid);
    if (amount <= 0) {
      toast({ variant: "destructive", title: "Enter a valid payment amount." });
      return;
    }
    setSaving(true);
    try {
      const wasDraft = paidInvoice.status === "draft";
      const currentPaid = Number(paidInvoice.amountPaid ?? 0);
      const invoiceTotal = getGrandTotalWithLateFee(paidInvoice);
      const updatedPaid = Number((currentPaid + amount).toFixed(2));
      const outstanding = Math.max(0, Number((invoiceTotal - updatedPaid).toFixed(2)));
      const existingPayments = Array.isArray(paidInvoice.payments) ? paidInvoice.payments : [];
      const newPayment = {
        id: crypto.randomUUID(),
        amount: Number(amount.toFixed(2)),
        date: String(paidForm.paymentDate),
        method: paidForm.method,
        reference: String(paidForm.reference ?? ""),
        notes: String(paidForm.notes ?? ""),
        createdAt: new Date().toISOString(),
      };
      const payments = [...existingPayments, newPayment];
      if (!Number.isFinite(updatedPaid) || !Number.isFinite(outstanding)) {
        toast({ variant: "destructive", title: "Invalid amounts. Please check invoice total and payment." });
        return;
      }

      await updateDoc(doc(db, "external_invoices", paidInvoice.id), {
        amountPaid: updatedPaid,
        outstandingBalance: outstanding,
        status: outstanding === 0 ? "paid" : "partially_paid",
        payments,
        updatedAt: serverTimestamp(),
      });

      const newStatus = outstanding === 0 ? "paid" : "partially_paid";
      sendPaymentConfirmationEmail(paidInvoice, newStatus, outstanding).catch(() => {
        toast({ variant: "destructive", title: "Payment recorded, but notification email failed." });
      });

      toast({ title: "Payment recorded." });
      if (newStatus === "paid" && wasDraft) {
        setActiveTab("paid");
      }
      setPaidDialogOpen(false);
      setPaidInvoice(null);
      setPaidForm({
        paymentDate: new Date().toISOString().slice(0, 10),
        amountPaid: "",
        method: "Zelle",
        reference: "",
        notes: "",
      });
    } catch (error) {
      console.error("Failed to record payment:", error);
      const msg = error instanceof Error ? error.message : "Failed to record payment.";
      toast({ variant: "destructive", title: "Failed to record payment.", description: msg });
    } finally {
      setSaving(false);
    }
  };

  const applyDispute = async () => {
    if (!disputeInvoice) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "external_invoices", disputeInvoice.id), {
        status: "disputed",
        dispute: {
          reason: disputeForm.reason,
          notes: disputeForm.notes,
          status: "Open",
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Invoice marked as disputed." });
      setDisputeDialogOpen(false);
      setDisputeInvoice(null);
      setDisputeForm({ reason: "", notes: "", status: "Open" });
    } catch (error) {
      console.error("Failed to mark dispute:", error);
      toast({ variant: "destructive", title: "Failed to mark disputed." });
    } finally {
      setSaving(false);
    }
  };

  const resolveDisputeStatus = async (invoice: ExternalInvoice, status: "sent") => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "external_invoices", invoice.id), {
        status,
        dispute: {
          ...(invoice.dispute || {}),
          status: "Resolved",
          updatedAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Dispute resolved." });
    } catch (error) {
      console.error("Failed to resolve dispute:", error);
      toast({ variant: "destructive", title: "Failed to resolve dispute." });
    } finally {
      setSaving(false);
    }
  };

  const applyCancel = async () => {
    if (!cancelInvoice) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "external_invoices", cancelInvoice.id), {
        status: "cancelled",
        cancelled: {
          reason: cancelReason.trim(),
          cancelledAt: serverTimestamp(),
        },
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Invoice cancelled." });
      setCancelDialogOpen(false);
      setCancelInvoice(null);
      setCancelReason("");
    } catch (error) {
      console.error("Failed to cancel invoice:", error);
      toast({ variant: "destructive", title: "Failed to cancel invoice." });
    } finally {
      setSaving(false);
    }
  };

  const handleTestOverdue = async () => {
    if (!testOverdueInvoiceId) {
      toast({ variant: "destructive", title: "Please select an invoice." });
      return;
    }
    setIsTestingOverdue(true);
    try {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = formatDateInputLocal(yesterday);
      
      await updateDoc(doc(db, "external_invoices", testOverdueInvoiceId), {
        dueDate: yesterdayStr,
        updatedAt: serverTimestamp(),
      });
      toast({ title: "Invoice due date set to yesterday. It should now appear in Overdue tab." });
      setTestOverdueDialogOpen(false);
      setTestOverdueInvoiceId("");
    } catch (error) {
      console.error("Failed to test overdue:", error);
      toast({ variant: "destructive", title: "Failed to set due date." });
    } finally {
      setIsTestingOverdue(false);
    }
  };

  const applyDiscount = async () => {
    if (!discountInvoice) return;

    const hasLateFeeSection = discountInvoice.lateFee != null && discountInvoice.lateFee > 0;
    const isLateFeeUpdate = hasLateFeeSection && (lateFeeAction === "remove" || lateFeeAction === "change");

    let newLateFee = discountInvoice.lateFee ?? 0;
    if (hasLateFeeSection) {
      if (lateFeeAction === "remove") {
        newLateFee = 0;
      } else if (lateFeeAction === "change") {
        const custom = Number(lateFeeCustomAmount);
        newLateFee = Number.isFinite(custom) && custom >= 0 ? Number(custom.toFixed(2)) : 0;
      }
    }

    let discountAmount = 0;
    let payload: Record<string, unknown> = { updatedAt: serverTimestamp() };

    const raw = discountValue.trim();
    if (raw) {
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) {
        toast({ variant: "destructive", title: "Enter a valid discount value." });
        return;
      }
      if (discountType === "percentage" && (num > 100 || num <= 0)) {
        toast({ variant: "destructive", title: "Percentage must be between 0 and 100." });
        return;
      }
      const grandTotalForDiscount = Number(discountInvoice.total ?? 0) + newLateFee;
      discountAmount =
        discountType === "percentage"
          ? Number((grandTotalForDiscount * (num / 100)).toFixed(2))
          : Math.min(num, grandTotalForDiscount);
      payload.discountType = discountType;
      payload.discountValue = discountType === "percentage" ? num : Number(num.toFixed(2));
    } else if (!isLateFeeUpdate) {
      toast({ variant: "destructive", title: "Enter a discount value or remove/change late fee." });
      return;
    }

    const effectiveTotal = raw
      ? Number(discountInvoice.total ?? 0) - discountAmount
      : getEffectiveTotal(discountInvoice);
    const newGrandTotal = Number((effectiveTotal + newLateFee).toFixed(2));
    const amountPaid = Number(discountInvoice.amountPaid ?? 0);
    const outstanding = Math.max(0, Number((newGrandTotal - amountPaid).toFixed(2)));

    payload.lateFee = newLateFee;
    payload.outstandingBalance = outstanding;

    setSaving(true);
    try {
      await updateDoc(doc(db, "external_invoices", discountInvoice.id), payload as any);
      const updatedInvoice: ExternalInvoice = {
        ...discountInvoice,
        lateFee: newLateFee,
        outstandingBalance: outstanding,
        ...(payload.discountType != null && { discountType: payload.discountType as "percentage" | "amount" }),
        ...(payload.discountValue != null && { discountValue: payload.discountValue as number }),
      };

      const updateReason: "discount_applied" | "late_fee_removed" | "late_fee_changed" =
        isLateFeeUpdate
          ? newLateFee === 0
            ? "late_fee_removed"
            : "late_fee_changed"
          : "discount_applied";

      let updateEmailSent = true;
      try {
        await sendInvoiceUpdateEmail(updatedInvoice, {
          reason: updateReason,
          logType: "discount_update",
        });
      } catch (emailError) {
        updateEmailSent = false;
        console.error("Failed to send discount/late-fee update email:", emailError);
      }

      if (isLateFeeUpdate) {
        setDiscountInvoice(updatedInvoice);
        setDiscountShowResendButton(!updateEmailSent);
        setLateFeeWasRemoved(newLateFee === 0);
        if (updateEmailSent) {
          toast({ title: "Late fee and totals updated. Updated invoice email sent." });
          setDiscountDialogOpen(false);
          setDiscountInvoice(null);
          setDiscountShowResendButton(false);
          setLateFeeAction("keep");
          setLateFeeCustomAmount("");
          setDiscountType("percentage");
          setDiscountValue("");
        } else {
          toast({
            variant: "destructive",
            title: "Late fee updated, but email failed.",
            description: "Please click Resend invoice.",
          });
        }
      } else {
        setDiscountInvoice(updatedInvoice);
        setDiscountShowResendButton(!updateEmailSent);
        setLateFeeWasRemoved(newLateFee === 0);
        if (updateEmailSent) {
          toast({ title: "Discount applied and updated invoice email sent." });
          setDiscountDialogOpen(false);
          setDiscountInvoice(null);
          setDiscountType("percentage");
          setDiscountValue("");
        } else {
          toast({
            variant: "destructive",
            title: "Discount applied, but email failed.",
            description: "Please click Resend invoice.",
          });
        }
      }
    } catch (error) {
      console.error("Failed to apply discount:", error);
      toast({ variant: "destructive", title: "Failed to apply discount." });
    } finally {
      setSaving(false);
    }
  };

  const renderInvoiceRow = (
    invoice: ExternalInvoice,
    options?: { showActions?: boolean; allowDisputeActions?: boolean; hideSendAndDownload?: boolean; showDisputeOnly?: boolean; showDiscount?: boolean; showViewOnly?: boolean }
  ) => {
    const overdue = isOverdueInvoice(invoice);
    const displayOutstanding = Math.max(
      0,
      Number((getGrandTotalWithLateFee(invoice) - Number(invoice.amountPaid ?? 0)).toFixed(2))
    );
    const lastPayment = invoice.payments?.length ? invoice.payments[invoice.payments.length - 1] : undefined;
    const paymentsDisabled = invoice.status === "cancelled";
    const btnClass = "h-8 w-8 p-0 shrink-0";
    return (
      <Card
        key={invoice.id}
        className={cn(
          "group relative overflow-hidden transition-all duration-300 hover:shadow-xl hover:scale-[1.01] border-2",
          overdue ? "border-red-300 bg-red-50/50 dark:border-red-800 dark:bg-red-950/10" : "border-gray-200 dark:border-gray-800"
        )}
      >
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1 min-w-0 flex flex-col gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 shadow-md shrink-0">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 min-w-0 space-y-1">
                  <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100 truncate">
                    {invoice.clientName || "—"}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 truncate">
                    {invoice.clientEmail || "—"}
                  </p>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 items-center text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-mono bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                      {invoice.invoiceNumber}
                    </span>
                    <span>Due {formatDate(invoice.dueDate)}</span>
                    {invoice.sentAt && <span>Sent {formatDate(invoice.sentAt)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5 items-center">
                <Badge variant="secondary" className="capitalize text-xs">
                  {overdue ? "Overdue" : invoice.status.replace("_", " ")}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  Total ${getEffectiveTotal(invoice).toFixed(2)}
                </Badge>
                {getDiscountAmount(invoice) > 0 && (
                  <Badge variant="outline" className="text-xs text-green-600 dark:text-green-400">
                    Discount -${getDiscountAmount(invoice).toFixed(2)}
                  </Badge>
                )}
                {invoice.lateFee && invoice.lateFee > 0 && (
                  <Badge variant="outline" className="text-xs text-red-600 dark:text-red-400">
                    Late Fee ${invoice.lateFee.toFixed(2)}
                  </Badge>
                )}
                {invoice.status === "partially_paid" && (
                  <Badge variant="outline" className="text-xs">
                    Paid ${invoice.amountPaid.toFixed(2)}
                  </Badge>
                )}
                <Badge variant="outline" className="text-xs">
                  Outstanding ${displayOutstanding.toFixed(2)}
                </Badge>
                {invoice.status === "partially_paid" && lastPayment?.date && (
                  <Badge variant="outline" className="text-xs">
                    Last Payment {formatDate(lastPayment.date)}
                  </Badge>
                )}
              </div>
            </div>
            {options?.showActions && (
              <div className="flex flex-wrap gap-1.5 justify-end items-center shrink-0 self-center md:self-auto">
                {options?.showViewOnly ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className={`${btnClass} hover:bg-indigo-500 hover:text-white`}
                    title="View"
                    onClick={() => viewInvoicePdf(invoice)}
                  >
                    <FileText className="h-4 w-4" />
                  </Button>
                ) : options?.showDisputeOnly ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-indigo-500 hover:text-white`}
                      title="View"
                      onClick={() => viewInvoicePdf(invoice)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-orange-500 hover:text-white`}
                      title="Disputed"
                      onClick={() => {
                        setDisputeInvoice(invoice);
                        setDisputeForm({ reason: "", notes: "", status: "Open" });
                        setDisputeDialogOpen(true);
                      }}
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </Button>
                  </>
                ) : options?.allowDisputeActions ? (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-indigo-500 hover:text-white`}
                      title="View"
                      onClick={() => viewInvoicePdf(invoice)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-amber-500 hover:text-white`}
                      title="Partially Paid"
                      disabled={paymentsDisabled}
                      onClick={() => {
                        setPartialInvoice(invoice);
                        setPartialAmount("");
                        setPartialDialogOpen(true);
                      }}
                    >
                      <BadgeDollarSign className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-green-500 hover:text-white`}
                      title="Paid"
                      disabled={paymentsDisabled}
                      onClick={() => {
                        openMarkPaidDialog(invoice);
                      }}
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-red-500 hover:text-white`}
                      title="Cancel / Void"
                      onClick={() => {
                        setCancelInvoice(invoice);
                        setCancelDialogOpen(true);
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    {options?.showDiscount && (
                      <Button
                        variant="outline"
                        size="sm"
                        className={`${btnClass} hover:bg-emerald-500 hover:text-white`}
                        title="Discount"
                        onClick={() => {
                          setDiscountInvoice(invoice);
                          setDiscountType(invoice.discountType ?? "percentage");
                          setDiscountValue(invoice.discountValue != null ? String(invoice.discountValue) : "");
                          setLateFeeAction("keep");
                          setLateFeeCustomAmount(invoice.lateFee != null && invoice.lateFee > 0 ? String(invoice.lateFee) : "");
                          setDiscountShowResendButton(false);
                          setLateFeeWasRemoved(false);
                          setDiscountDialogOpen(true);
                        }}
                      >
                        <Percent className="h-4 w-4" />
                      </Button>
                    )}
                    {(!options?.hideSendAndDownload || (options?.showDiscount && getDiscountAmount(invoice) > 0)) && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`${btnClass} hover:bg-purple-500 hover:text-white`}
                          title={getDiscountAmount(invoice) > 0 ? "Resend (discounted invoice)" : "Send"}
                          onClick={() => openEmailDialog(invoice)}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className={`${btnClass} hover:bg-blue-500 hover:text-white`}
                          title="Download"
                          onClick={() => downloadInvoicePdf(invoice)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                      </>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-indigo-500 hover:text-white`}
                      title="View"
                      onClick={() => viewInvoicePdf(invoice)}
                    >
                      <FileText className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-amber-500 hover:text-white`}
                      title="Partially Paid"
                      disabled={paymentsDisabled}
                      onClick={() => {
                        setPartialInvoice(invoice);
                        setPartialAmount("");
                        setPartialDialogOpen(true);
                      }}
                    >
                      <BadgeDollarSign className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-green-500 hover:text-white`}
                      title="Paid"
                      disabled={paymentsDisabled}
                      onClick={() => {
                        openMarkPaidDialog(invoice);
                      }}
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-orange-500 hover:text-white`}
                      title="Disputed"
                      onClick={() => {
                        setDisputeInvoice(invoice);
                        setDisputeForm({ reason: "", notes: "", status: "Open" });
                        setDisputeDialogOpen(true);
                      }}
                    >
                      <AlertTriangle className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className={`${btnClass} hover:bg-red-500 hover:text-white`}
                      title="Cancel"
                      onClick={() => {
                        setCancelInvoice(invoice);
                        setCancelDialogOpen(true);
                      }}
                    >
                      <XCircle className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const searchAndDateFilterBar = (
    <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/30">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by name, email, invoice #"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setCurrentPage(1);
            setPaymentHistoryPage(1);
          }}
          className="pl-9"
        />
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => {
            setDateFrom(e.target.value);
            setCurrentPage(1);
            setPaymentHistoryPage(1);
          }}
          className="w-[140px]"
        />
        <span className="text-muted-foreground text-sm">to</span>
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => {
            setDateTo(e.target.value);
            setCurrentPage(1);
            setPaymentHistoryPage(1);
          }}
          className="w-[140px]"
        />
      </div>
    </div>
  );

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-fuchsia-50 via-purple-50 to-fuchsia-100 dark:from-fuchsia-950/20 dark:via-purple-950/20 dark:to-fuchsia-900/20 border border-fuchsia-200/50 dark:border-fuchsia-800/50 p-6 shadow-lg">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-md">
              <Receipt className="h-6 w-6 text-white" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight bg-gradient-to-r from-fuchsia-900 to-purple-900 dark:from-fuchsia-100 dark:to-purple-100 bg-clip-text text-transparent">
              Invoice Management
            </h1>
          </div>
          <p className="text-fuchsia-800/80 dark:text-fuchsia-200/80 ml-12">
            Create, send, and track invoices for external customers
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card
          className="border-2 border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => handleTabChange("draft")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-blue-700 dark:text-blue-300 flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Draft
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-blue-700 dark:text-blue-300">{statusCounts.draft}</CardContent>
        </Card>
        <Card
          className="border-2 border-purple-200 dark:border-purple-800 bg-purple-50/50 dark:bg-purple-950/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => handleTabChange("sent")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-purple-700 dark:text-purple-300 flex items-center gap-2">
              <Send className="h-4 w-4" />
              Sent
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-purple-700 dark:text-purple-300">{statusCounts.sent}</CardContent>
        </Card>
        <Card
          className="border-2 border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => handleTabChange("partially_paid")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-700 dark:text-amber-300 flex items-center gap-2">
              <BadgeDollarSign className="h-4 w-4" />
              Partially Paid
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-amber-700 dark:text-amber-300">{statusCounts.partiallyPaid}</CardContent>
        </Card>
        <Card
          className="border-2 border-green-200 dark:border-green-800 bg-green-50/50 dark:bg-green-950/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => handleTabChange("paid")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-green-700 dark:text-green-300 flex items-center gap-2">
              <CheckCircle className="h-4 w-4" />
              Paid
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-green-700 dark:text-green-300">{statusCounts.paid}</CardContent>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Card
          className="border-2 border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => handleTabChange("overdue")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-700 dark:text-red-300 flex items-center gap-2">
              <Clock className="h-4 w-4" />
              Overdue
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-red-700 dark:text-red-300">{statusCounts.overdue}</CardContent>
        </Card>
        <Card
          className="border-2 border-orange-200 dark:border-orange-800 bg-orange-50/50 dark:bg-orange-950/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => handleTabChange("disputed")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-orange-700 dark:text-orange-300 flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Disputed
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-orange-700 dark:text-orange-300">{statusCounts.disputed}</CardContent>
        </Card>
        <Card
          className="border-2 border-gray-200 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/10 cursor-pointer transition-all hover:shadow-md hover:scale-[1.02]"
          onClick={() => handleTabChange("cancelled")}
        >
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-gray-700 dark:text-gray-300 flex items-center gap-2">
              <X className="h-4 w-4" />
              Cancelled / Void
            </CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-bold text-gray-700 dark:text-gray-300">
            {statusCounts.cancelled + nonRestoredDeleteLogs.length}
          </CardContent>
        </Card>
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
              Sent
            </TabsTrigger>
            <TabsTrigger
              value="partially_paid"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-orange-500 data-[state=active]:to-amber-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <BadgeDollarSign className="shrink-0" />
              <span className="hidden sm:inline">Partially Paid</span>
              <span className="sm:hidden">Partial</span>
            </TabsTrigger>
            <TabsTrigger
              value="paid"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-green-500 data-[state=active]:to-emerald-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <CheckCircle className="shrink-0" />
              Paid
            </TabsTrigger>
            <TabsTrigger
              value="overdue"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-red-500 data-[state=active]:to-rose-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Clock className="shrink-0" />
              Overdue
            </TabsTrigger>
            <TabsTrigger
              value="disputed"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-amber-500 data-[state=active]:to-orange-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <AlertTriangle className="shrink-0" />
              Disputed
            </TabsTrigger>
            <TabsTrigger
              value="cancelled"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-gray-500 data-[state=active]:to-gray-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <XCircle className="shrink-0" />
              <span className="hidden md:inline">Cancelled / Void</span>
              <span className="md:hidden">Cancelled</span>
            </TabsTrigger>
            <TabsTrigger
              value="receipts"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-indigo-500 data-[state=active]:to-purple-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Receipt className="shrink-0" />
              Receipts
            </TabsTrigger>
            <TabsTrigger
              value="email_log"
              className="flex-shrink-0 text-xs sm:text-sm px-2 py-1.5 sm:px-3 sm:py-1.5 min-h-[44px] sm:min-h-0 data-[state=active]:bg-gradient-to-r data-[state=active]:from-slate-500 data-[state=active]:to-blue-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all [&_svg]:h-3.5 [&_svg]:w-3.5 sm:[&_svg]:h-4 sm:[&_svg]:w-4 [&_svg]:mr-1.5 sm:[&_svg]:mr-2"
            >
              <Mail className="shrink-0" />
              Email Log
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="new" className="space-y-4">
          <Card className="border-2 border-fuchsia-200 dark:border-fuchsia-800 shadow-lg">
            <CardHeader className="bg-gradient-to-r from-fuchsia-50 to-purple-50 dark:from-fuchsia-950/30 dark:to-purple-950/30 border-b border-fuchsia-200 dark:border-fuchsia-800">
              <CardTitle className="flex items-center gap-2 text-fuchsia-700 dark:text-fuchsia-300">
                <div className="p-2 rounded-lg bg-gradient-to-br from-fuchsia-500 to-purple-600 shadow-md">
                  <FileText className="h-5 w-5 text-white" />
                </div>
                {editingInvoiceId ? "Edit Invoice" : "New Invoice"}
              </CardTitle>
              <CardDescription className="text-fuchsia-600/80 dark:text-fuchsia-400/80">
                Fill out the invoice template and save or send it. Due date defaults to 48 hours.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <style jsx global>{`
                .invoice-print-mode input,
                .invoice-print-mode textarea {
                  border-color: transparent !important;
                  background: transparent !important;
                  box-shadow: none !important;
                  padding-left: 0 !important;
                  padding-right: 0 !important;
                }

                .invoice-print-mode textarea {
                  resize: none !important;
                }

                .invoice-print-mode .invoice-remove-column,
                .invoice-print-mode .invoice-actions {
                  display: none !important;
                }

                @media print {
                  @page {
                    size: A4;
                    margin: 18mm 15mm 25mm 15mm; /* top right bottom left — footer margin so content not clipped */
                  }
                  body {
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                  }
                  .invoice-print-mode {
                    max-width: 100% !important;
                    box-shadow: none !important;
                    border: 1px solid #d4a574 !important;
                    padding-top: 4mm !important;
                    padding-bottom: 12mm !important;
                  }
                  .invoice-print-mode * {
                    print-color-adjust: exact;
                    -webkit-print-color-adjust: exact;
                  }
                  .invoice-print-actions {
                    display: none !important;
                  }
                }
              `}</style>
              <div
                ref={invoiceTemplateRef}
                className={cn(
                  "bg-white border-2 border-amber-700/70 rounded-md p-6 shadow-sm max-w-[794px] mx-auto space-y-6",
                  isPrintMode && "invoice-print-mode"
                )}
              >
                <div className="space-y-4">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex justify-center sm:justify-start">
                      <img
                        src="/quote-logo.png"
                        alt="Prep Services FBA"
                        className="h-20 w-auto object-contain"
                      />
                    </div>
                    <div className="text-sm text-muted-foreground space-y-2 sm:text-right">
                      <h2 className="text-center sm:text-right text-2xl font-bold tracking-wide text-amber-800">INVOICE</h2>
                      <div className="flex flex-col gap-2 sm:items-end">
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                          <span>Invoice #:</span>
                          {isPrintMode ? (
                            <span className="font-semibold text-amber-900">{formData.invoiceNumber || "—"}</span>
                          ) : (
                            <Input
                              value={formData.invoiceNumber}
                              disabled
                              className="h-8 w-44 text-center"
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                          <span>Date:</span>
                          {isPrintMode ? (
                            <span className="font-semibold text-amber-900">{formatDate(formData.invoiceDate) || "—"}</span>
                          ) : (
                            <Input
                              type="date"
                              value={formData.invoiceDate}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, invoiceDate: event.target.value }))
                              }
                              className="h-8 w-40 text-center"
                            />
                          )}
                        </div>
                        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:justify-end">
                          <span>Due Date:</span>
                          {isPrintMode ? (
                            <span className="font-semibold text-amber-900">{formatDate(formData.dueDate) || "—"}</span>
                          ) : (
                            <Input
                              type="date"
                              value={formData.dueDate}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, dueDate: event.target.value }))
                              }
                              className="h-8 w-40 text-center"
                            />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-t border-amber-200/70 pt-4"></div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="border border-amber-200/70 rounded-md p-4 text-sm space-y-1">
                    <p className="text-xs uppercase text-amber-700 font-semibold">Company Details</p>
                    <p className="font-semibold">{COMPANY_INFO.name}</p>
                    {COMPANY_INFO.addressLines.map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                    <p>Phone: {COMPANY_INFO.phone}</p>
                    <p>Email: {COMPANY_INFO.email}</p>
                  </div>
                  <div className="border border-amber-200/70 rounded-md p-4 text-sm space-y-3">
                    <p className="text-xs uppercase text-amber-700 font-semibold">Sold To</p>
                    {isPrintMode ? (
                      <div className="space-y-1">
                        <p className="font-semibold">{formData.clientName || "—"}</p>
                        {formData.clientAddress && <p>{formData.clientAddress}</p>}
                        {(formData.clientCity || formData.clientState || formData.clientZip || formData.clientCountry) && (
                          <p>
                            {[formData.clientCity, formData.clientState, formData.clientZip, formData.clientCountry]
                              .filter(Boolean)
                              .join(", ")}
                          </p>
                        )}
                        {formData.clientPhone && <p>Phone: {formData.clientPhone}</p>}
                        {formData.clientEmail && <p>Email: {formData.clientEmail}</p>}
                      </div>
                    ) : (
                      <div className="grid gap-2">
                        <div>
                          <Label className="text-xs text-muted-foreground">Client Name</Label>
                          <Input
                            value={formData.clientName}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, clientName: event.target.value }))
                            }
                            placeholder="Client name"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Address</Label>
                          <Input
                            value={formData.clientAddress}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, clientAddress: event.target.value }))
                            }
                            placeholder="Client address"
                            className="h-9"
                          />
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <Label className="text-xs text-muted-foreground">City</Label>
                            <Input
                              value={formData.clientCity}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, clientCity: event.target.value }))
                              }
                              placeholder="City"
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">State</Label>
                            <Input
                              value={formData.clientState}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, clientState: event.target.value }))
                              }
                              placeholder="State"
                              className="h-9"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">ZIP</Label>
                            <Input
                              value={formData.clientZip}
                              onChange={(event) =>
                                setFormData((prev) => ({ ...prev, clientZip: event.target.value }))
                              }
                              placeholder="ZIP"
                              className="h-9"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Country</Label>
                          <Input
                            value={formData.clientCountry}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, clientCountry: event.target.value }))
                            }
                            placeholder="Country"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Phone</Label>
                          <Input
                            value={formData.clientPhone}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, clientPhone: event.target.value }))
                            }
                            placeholder="Phone"
                            className="h-9"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Email</Label>
                          <Input
                            value={formData.clientEmail}
                            onChange={(event) =>
                              setFormData((prev) => ({ ...prev, clientEmail: event.target.value }))
                            }
                            placeholder="Email"
                            className="h-9"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2 text-sm">
                  <p className="font-semibold text-amber-800">
                    NOTE: Please make all payments to Prep Services FBA LLC. All prices are F.O.B.
                  </p>
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="font-semibold">FOB POINT:</span> <span>NEW JERSEY</span>
                    </div>
                    <div>
                      <span className="font-semibold">TERMS:</span> <span>NET</span>
                    </div>
                    <div>
                      <span className="font-semibold">SHIPPED VIA:</span> <span>Standard</span>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {/* Desktop header - hidden on mobile where each row has its own labels */}
                  <div className="hidden md:grid grid-cols-12 gap-2 items-center border-b border-amber-200/70 pb-2">
                    <div className="col-span-6 pr-2">
                      <h3 className="font-semibold text-amber-800">Item Description</h3>
                    </div>
                    <div className="col-span-2 text-center">
                      <span className="text-sm font-semibold text-amber-800">Qty</span>
                    </div>
                    <div className="col-span-2 text-right">
                      <span className="text-sm font-semibold text-amber-800">Unit Price</span>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className="text-sm font-semibold text-amber-800">Amount</span>
                    </div>
                    <div className="col-span-1" />
                  </div>
                  {formData.items.map((item, index) => (
                    <div key={item.id} className="grid grid-cols-1 md:grid-cols-12 gap-3 md:gap-2 items-center border-b border-amber-100/50 pb-3 md:pb-2 invoice-actions">
                      <div className="md:col-span-6 space-y-1 min-w-0 pr-2 md:pr-3">
                        <label className="text-xs font-medium text-amber-800 md:hidden">Item Description</label>
                        {isPrintMode ? (
                          <p className="text-sm whitespace-pre-wrap break-words">{item.description || "—"}</p>
                        ) : (
                          <Textarea
                            value={item.description}
                            onChange={(event) => updateItem(item.id, "description", event.target.value)}
                            placeholder="Item description"
                            rows={2}
                            className="min-h-9 border-amber-200/70 w-full resize-y"
                          />
                        )}
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs font-medium text-amber-800 md:hidden">Qty</label>
                        {isPrintMode ? (
                          <p className="text-sm text-center">{Number(item.quantity ?? 0)}</p>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step={1}
                            value={item.quantity != null ? String(item.quantity) : ""}
                            onChange={(event) => updateItem(item.id, "quantity", event.target.value)}
                            className="h-9 text-center border-amber-200/70 w-full"
                          />
                        )}
                      </div>
                      <div className="md:col-span-2 space-y-1">
                        <label className="text-xs font-medium text-amber-800 md:hidden">Unit Price ($)</label>
                        {isPrintMode ? (
                          <p className="text-sm text-right">${Number(item.unitPrice ?? 0).toFixed(2)}</p>
                        ) : (
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={item.unitPrice != null ? String(item.unitPrice) : ""}
                            onChange={(event) => updateItem(item.id, "unitPrice", event.target.value)}
                            className="h-9 text-right border-amber-200/70 w-full"
                            placeholder="0.00"
                          />
                        )}
                      </div>
                      <div className="md:col-span-1 flex items-center justify-between md:justify-end gap-2">
                        <label className="text-xs font-medium text-amber-800 md:hidden">Amount</label>
                        <p className="text-sm text-right font-semibold">${Number(item.amount ?? 0).toFixed(2)}</p>
                      </div>
                      <div className="md:col-span-1 flex justify-end invoice-remove-column">
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => removeItem(item.id)}
                          disabled={formData.items.length === 1}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                  <div className="invoice-actions pt-2">
                    <Button variant="outline" size="sm" onClick={addItem}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Item
                    </Button>
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
                            const totals = recalculateTotals(formData.items, formData.shippingCost, salesTax);
                            setFormData((prev) => ({ ...prev, ...totals }));
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
                            const totals = recalculateTotals(formData.items, shippingCost, formData.salesTax);
                            setFormData((prev) => ({ ...prev, shippingCost, ...totals }));
                          }}
                          className="h-8 w-28 text-right"
                        />
                      )}
                    </div>
                    {editingInvoiceId && invoices.find((inv) => inv.id === editingInvoiceId)?.lateFee ? (
                      <div className="flex items-center justify-between">
                        <span className="text-red-600 dark:text-red-400">Late Fee</span>
                        <span className="font-semibold text-red-600 dark:text-red-400">
                          ${Number(invoices.find((inv) => inv.id === editingInvoiceId)?.lateFee ?? 0).toFixed(2)}
                        </span>
                      </div>
                    ) : null}
                    <div className="flex items-center justify-between border-t border-amber-200 pt-2 text-amber-900 font-semibold">
                      <span>Grand Total</span>
                      <span className="font-semibold">
                        {editingInvoiceId && invoices.find((inv) => inv.id === editingInvoiceId)?.lateFee
                          ? `$${getGrandTotalWithLateFee(invoices.find((inv) => inv.id === editingInvoiceId)!).toFixed(2)}`
                          : `$${formData.total.toFixed(2)}`}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="border-t border-amber-200/70 pt-4 mt-6">
                  <p className="text-xs uppercase text-amber-700 font-semibold mb-2">Terms & Conditions</p>
                  {isPrintMode ? (
                    <div className="text-xs text-amber-900 whitespace-pre-line">{formData.terms || "—"}</div>
                  ) : (
                    <Textarea
                      rows={6}
                      value={formData.terms}
                      onChange={(event) => setFormData((prev) => ({ ...prev, terms: event.target.value }))}
                      className="border-amber-200/70 text-xs"
                    />
                  )}
                </div>

                <p className="text-center text-amber-700 text-sm mt-6 pt-4 border-t border-amber-200/50">
                  We appreciate the opportunity to do business with you.
                </p>
              </div>

              <div className="flex flex-wrap gap-2 justify-center invoice-print-actions">
                <Button onClick={() => saveInvoice("draft")} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <FileText className="h-4 w-4 mr-1" />}
                  Save as Draft
                </Button>
                <Button
                  variant="outline"
                  onClick={handleSendFromForm}
                  disabled={saving}
                >
                  <Send className="h-4 w-4 mr-1" />
                  Send
                </Button>
                <Button
                  variant="outline"
                  onClick={() => downloadInvoicePdf({ ...formData, id: "preview" })}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download PDF
                </Button>
                <Button variant="outline" onClick={resetForm}>
                  Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="draft" className="space-y-4">
          {searchAndDateFilterBar}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Draft Invoices</CardTitle>
                  <CardDescription>Saved invoices that are not sent.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadInvoicesCsv(draftInvoices, "draft-invoices")}
                  disabled={!draftInvoices.length}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {draftInvoices.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(draftInvoices, currentPage).paginatedData.map((invoice) => (
                      <Card key={invoice.id} className="border-2 border-blue-200 dark:border-blue-800">
                        <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                          <div>
                            <div className="font-semibold">{invoice.clientName || "—"}</div>
                            <div className="text-sm text-muted-foreground">{invoice.invoiceNumber}</div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => viewInvoicePdf(invoice)}>
                              View
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => handleEditInvoice(invoice)}>
                              Edit
                            </Button>
                            <Button variant="outline" size="sm" onClick={() => openEmailDialog(invoice)}>
                              Send
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-950/30"
                              onClick={() => openMarkPaidDialog(invoice)}
                            >
                              Paid
                            </Button>
                            <Button variant="destructive" size="sm" onClick={() => handleDeleteInvoice(invoice)}>
                              Delete
                            </Button>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {draftInvoices.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {currentPage} / {getPaginatedData(draftInvoices, currentPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) =>
                            Math.min(getPaginatedData(draftInvoices, currentPage).totalPages, p + 1)
                          )
                        }
                        disabled={currentPage >= getPaginatedData(draftInvoices, currentPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No draft invoices yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="sent" className="space-y-4">
          {searchAndDateFilterBar}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Sent Invoices</CardTitle>
                  <CardDescription>All sent invoices with outstanding balances.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadInvoicesCsv(sentInvoices, "sent-invoices")}
                  disabled={!sentInvoices.length}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {sentInvoices.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(sentInvoices, currentPage).paginatedData.map((invoice) =>
                      renderInvoiceRow(invoice, { showActions: true, hideSendAndDownload: true, showDiscount: true })
                    )}
                  </div>
                  {sentInvoices.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {currentPage} / {getPaginatedData(sentInvoices, currentPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) =>
                            Math.min(getPaginatedData(sentInvoices, currentPage).totalPages, p + 1)
                          )
                        }
                        disabled={currentPage >= getPaginatedData(sentInvoices, currentPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No sent invoices yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="partially_paid" className="space-y-4">
          {searchAndDateFilterBar}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Partially Paid</CardTitle>
                  <CardDescription>Invoices with partial payments and outstanding balance.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadInvoicesCsv(partiallyPaidInvoices, "partially-paid-invoices")}
                  disabled={!partiallyPaidInvoices.length}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {partiallyPaidInvoices.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(partiallyPaidInvoices, currentPage).paginatedData.map((invoice) =>
                      renderInvoiceRow(invoice, { showActions: true })
                    )}
                  </div>
                  {partiallyPaidInvoices.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {currentPage} / {getPaginatedData(partiallyPaidInvoices, currentPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) =>
                            Math.min(getPaginatedData(partiallyPaidInvoices, currentPage).totalPages, p + 1)
                          )
                        }
                        disabled={currentPage >= getPaginatedData(partiallyPaidInvoices, currentPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No partially paid invoices.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paid" className="space-y-4">
          {searchAndDateFilterBar}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Paid Invoices</CardTitle>
                  <CardDescription>Invoices fully paid with zero balance.</CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={downloadPaidInvoicesCsv}>
                  <Download className="h-4 w-4 mr-1" />
                  Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {paidInvoices.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(paidInvoices, currentPage).paginatedData.map((invoice) =>
                      renderInvoiceRow(invoice, { showActions: true, showDisputeOnly: true })
                    )}
                  </div>
                  {paidInvoices.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {currentPage} / {getPaginatedData(paidInvoices, currentPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) =>
                            Math.min(getPaginatedData(paidInvoices, currentPage).totalPages, p + 1)
                          )
                        }
                        disabled={currentPage >= getPaginatedData(paidInvoices, currentPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No paid invoices.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overdue" className="space-y-4">
          {searchAndDateFilterBar}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Overdue Invoices</CardTitle>
                  <CardDescription>Invoices past their due date.</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadInvoicesCsv(overdueInvoices, "overdue-invoices")}
                    disabled={!overdueInvoices.length}
                  >
                    <Download className="h-4 w-4 mr-1" />
                    Download CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setTestOverdueDialogOpen(true)}
                    className="text-orange-600 border-orange-300 hover:bg-orange-50"
                  >
                    Test Overdue
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {overdueInvoices.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(overdueInvoices, currentPage).paginatedData.map((invoice) =>
                      renderInvoiceRow(invoice, { showActions: true, hideSendAndDownload: true, showDiscount: true })
                    )}
                  </div>
                  {overdueInvoices.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {currentPage} / {getPaginatedData(overdueInvoices, currentPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) =>
                            Math.min(getPaginatedData(overdueInvoices, currentPage).totalPages, p + 1)
                          )
                        }
                        disabled={currentPage >= getPaginatedData(overdueInvoices, currentPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No overdue invoices.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="disputed" className="space-y-4">
          {searchAndDateFilterBar}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Disputed Invoices</CardTitle>
                  <CardDescription>Invoices marked as disputed.</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadInvoicesCsv(disputedInvoices, "disputed-invoices")}
                  disabled={!disputedInvoices.length}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {disputedInvoices.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(disputedInvoices, currentPage).paginatedData.map((invoice) =>
                      renderInvoiceRow(invoice, { showActions: true, allowDisputeActions: true })
                    )}
                  </div>
                  {disputedInvoices.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {currentPage} / {getPaginatedData(disputedInvoices, currentPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) =>
                            Math.min(getPaginatedData(disputedInvoices, currentPage).totalPages, p + 1)
                          )
                        }
                        disabled={currentPage >= getPaginatedData(disputedInvoices, currentPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No disputed invoices.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="cancelled" className="space-y-4">
          {searchAndDateFilterBar}
          <div className="flex flex-wrap items-center gap-3 p-3 rounded-lg border bg-muted/30">
            <Label className="text-sm font-medium shrink-0">Show:</Label>
            <Select
              value={cancelledViewFilter}
              onValueChange={(v: "all" | "cancelled" | "deleted") => {
                setCancelledViewFilter(v);
                setCurrentPage(1);
              }}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All (Cancelled & Deleted)</SelectItem>
                <SelectItem value="cancelled">Cancelled / Void only</SelectItem>
                <SelectItem value="deleted">Deleted drafts only</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <CardTitle>Cancelled / Void</CardTitle>
                  <CardDescription>Voided or cancelled invoices, and deleted drafts (restore from here).</CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadInvoicesCsv(cancelledInvoices, "cancelled-invoices")}
                  disabled={!cancelledInvoices.length}
                >
                  <Download className="h-4 w-4 mr-1" />
                  Download CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {cancelledFilteredByType.length ? (
                <>
                  <div className="space-y-3">
                        {getPaginatedData(cancelledFilteredByType, currentPage).paginatedData.map((entry) =>
                          entry.type === "cancelled" ? (
                            <div key={entry.item.id}>{renderInvoiceRow(entry.item, { showActions: true, showViewOnly: true })}</div>
                          ) : (
                        <Card
                          key={entry.item.id}
                          className="border-2 border-amber-200/70 dark:border-amber-800/50 bg-amber-50/30 dark:bg-amber-950/20"
                        >
                          <CardContent className="p-5">
                            <div className="flex flex-col lg:flex-row lg:items-center gap-4">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-start gap-3">
                                  <div className="p-2 rounded-lg bg-amber-500/80 shadow-md">
                                    <FileText className="h-5 w-5 text-white" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100">
                                      {entry.item.clientName || "—"}
                                    </h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-0.5">
                                      {entry.item.clientEmail || "—"}
                                    </p>
                                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                                      <span className="text-xs font-mono text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                                        {entry.item.invoiceNumber || entry.item.invoiceId || "—"}
                                      </span>
                                      <Badge variant="secondary" className="capitalize">
                                        Deleted {entry.item.status || "draft"}
                                      </Badge>
                                      {entry.item.reason && (
                                        <span className="text-xs text-muted-foreground">• {entry.item.reason}</span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2 items-center">
                                <Badge variant="outline" className="text-xs">
                                  Total ${Number(entry.item.total ?? 0).toFixed(2)}
                                </Badge>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleRestoreInvoice(entry.item)}
                                  disabled={saving}
                                  className="hover:bg-green-500 hover:text-white hover:border-green-500 dark:hover:bg-green-600 transition-all shadow-sm"
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
                            </div>
                          </CardContent>
                        </Card>
                      )
                    )}
                  </div>
                  {cancelledFilteredByType.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {currentPage} / {getPaginatedData(cancelledFilteredByType, currentPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) =>
                            Math.min(getPaginatedData(cancelledFilteredByType, currentPage).totalPages, p + 1)
                          )
                        }
                        disabled={currentPage >= getPaginatedData(cancelledFilteredByType, currentPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {cancelledViewFilter === "all"
                    ? "No cancelled or deleted invoices."
                    : cancelledViewFilter === "cancelled"
                      ? "No cancelled / void invoices."
                      : "No deleted drafts."}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="receipts" className="space-y-4">
          {searchAndDateFilterBar}
          <Card>
            <CardHeader>
              <CardTitle>Receipts / Payment History</CardTitle>
              <CardDescription>All payments logged against invoices.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {filteredPaymentHistory.length ? (
                <>
                  <div className="space-y-3">
                    {getPaginatedData(filteredPaymentHistory, paymentHistoryPage).paginatedData.map((payment) => (
                      <Card key={payment.id} className="border-2 border-gray-200 dark:border-gray-800">
                        <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                          <div>
                            <div className="font-semibold">{payment.clientName}</div>
                            <div className="text-sm text-muted-foreground">{payment.invoiceNumber}</div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {payment.method} • {formatDate(payment.date)}
                          </div>
                          <div className="font-semibold">${payment.amount.toFixed(2)}</div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => downloadReceiptPdf(payment)}
                          >
                            <Receipt className="h-4 w-4 mr-1" />
                            Receipt
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                  {filteredPaymentHistory.length > itemsPerPage && (
                    <div className="flex items-center justify-between pt-3 border-t">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPaymentHistoryPage((p) => Math.max(1, p - 1))}
                        disabled={paymentHistoryPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-xs text-muted-foreground">
                        {paymentHistoryPage} / {getPaginatedData(filteredPaymentHistory, paymentHistoryPage).totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPaymentHistoryPage((p) =>
                            Math.min(getPaginatedData(filteredPaymentHistory, paymentHistoryPage).totalPages, p + 1)
                          )
                        }
                        disabled={paymentHistoryPage >= getPaginatedData(filteredPaymentHistory, paymentHistoryPage).totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">No payment history yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="email_log" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Email Log
              </CardTitle>
              <CardDescription>
                All emails sent from the invoice portal — by recipient and date.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by email, client name, or invoice..."
                    value={emailLogSearch}
                    onChange={(e) => setEmailLogSearch(e.target.value)}
                    className="pl-8"
                  />
                </div>
              </div>
              {loading && !emailLogs?.length ? (
                <p className="text-sm text-muted-foreground">Loading email log…</p>
              ) : filteredEmailLogs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No email logs yet.</p>
              ) : (
                <>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Total emails sent</span>
                      <div className="text-xl font-semibold">{filteredEmailLogs.length}</div>
                    </div>
                    <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                      <span className="text-muted-foreground">Recipients</span>
                      <div className="text-xl font-semibold">{emailLogsByRecipient.length}</div>
                    </div>
                  </div>
                  <div className="rounded-md border overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          <th className="text-left p-2 font-medium">To</th>
                          <th className="text-left p-2 font-medium">Client</th>
                          <th className="text-left p-2 font-medium">Type</th>
                          <th className="text-left p-2 font-medium">Invoice / Subject</th>
                          <th className="text-left p-2 font-medium">Sent</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredEmailLogs.map((log) => (
                          <tr key={log.id} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="p-2">{log.to || "—"}</td>
                            <td className="p-2">{log.clientName || "—"}</td>
                            <td className="p-2">
                              <Badge variant="secondary" className="text-xs">
                                {log.type === "invoice_sent"
                                  ? "Invoice sent"
                                  : log.type === "reminder_24h"
                                    ? "24h reminder"
                                    : log.type === "overdue"
                                      ? "Overdue"
                                      : log.type === "second_reminder"
                                        ? "Final reminder"
                                        : log.type === "discount_update"
                                          ? "Discount update"
                                        : log.type === "payment_confirmation"
                                          ? "Payment confirmation"
                                          : "Resend"}
                              </Badge>
                            </td>
                            <td className="p-2 max-w-[200px] truncate" title={log.subject}>
                              {log.invoiceNumber || log.subject || "—"}
                            </td>
                            <td className="p-2 text-muted-foreground">{formatDate(log.sentAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="rounded-lg border p-3 space-y-2">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Emails per recipient</p>
                    <ul className="space-y-1.5 text-sm">
                      {emailLogsByRecipient
                        .sort((a, b) => b.count - a.count)
                        .map(({ to, count }) => (
                          <li key={to} className="flex justify-between items-center">
                            <span className="truncate">{to}</span>
                            <Badge variant="outline">{count}</Badge>
                          </li>
                        ))}
                    </ul>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Draft Invoice</DialogTitle>
            <DialogDescription>Provide a reason for deleting this draft.</DialogDescription>
          </DialogHeader>
          <Textarea value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteInvoice} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={emailDialogOpen} onOpenChange={setEmailDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Send Invoice</DialogTitle>
            <DialogDescription>Compose the email to send the invoice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>To</Label>
              <Input value={emailForm.to} onChange={(event) => setEmailForm((prev) => ({ ...prev, to: event.target.value }))} />
            </div>
            <div>
              <Label>Subject</Label>
              <Input value={emailForm.subject} onChange={(event) => setEmailForm((prev) => ({ ...prev, subject: event.target.value }))} />
            </div>
            <div>
              <Label>Message</Label>
              <Textarea rows={5} value={emailForm.message} onChange={(event) => setEmailForm((prev) => ({ ...prev, message: event.target.value }))} />
            </div>
            <div>
              <Label>Attachments</Label>
              <Input
                type="file"
                multiple
                onChange={(event) =>
                  setEmailForm((prev) => ({ ...prev, attachments: Array.from(event.target.files || []) }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={sendInvoiceEmail} disabled={isSendingEmail}>
              {isSendingEmail ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
              Send
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={partialDialogOpen} onOpenChange={setPartialDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Partially Paid</DialogTitle>
            <DialogDescription>Enter the amount received.</DialogDescription>
          </DialogHeader>
          <Input
            type="number"
            value={partialAmount}
            onChange={(event) => setPartialAmount(event.target.value)}
            placeholder="Amount"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPartialDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyPartialPayment} disabled={saving}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paidDialogOpen} onOpenChange={setPaidDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark Paid</DialogTitle>
            <DialogDescription>Record payment details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Payment Date</Label>
              <Input
                type="date"
                value={paidForm.paymentDate}
                onChange={(event) => setPaidForm((prev) => ({ ...prev, paymentDate: event.target.value }))}
              />
            </div>
            <div>
              <Label>Amount Paid</Label>
              <Input
                type="number"
                value={paidForm.amountPaid}
                onChange={(event) => setPaidForm((prev) => ({ ...prev, amountPaid: event.target.value }))}
              />
            </div>
            <div>
              <Label>Payment Method</Label>
              <Select
                value={paidForm.method}
                onValueChange={(value: PaymentMethod) => setPaidForm((prev) => ({ ...prev, method: value }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Zelle">Zelle</SelectItem>
                  <SelectItem value="ACH">ACH</SelectItem>
                  <SelectItem value="Wire">Wire</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reference / Transaction ID</Label>
              <Input
                value={paidForm.reference}
                onChange={(event) => setPaidForm((prev) => ({ ...prev, reference: event.target.value }))}
              />
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={3}
                value={paidForm.notes}
                onChange={(event) => setPaidForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaidDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyPaidPayment} disabled={saving}>
              Save Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={disputeDialogOpen} onOpenChange={setDisputeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark as Disputed</DialogTitle>
            <DialogDescription>Provide dispute details.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Reason</Label>
              <Select value={disputeForm.reason} onValueChange={(value) => setDisputeForm((prev) => ({ ...prev, reason: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select reason" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="billing">Billing Issue</SelectItem>
                  <SelectItem value="service">Service Dispute</SelectItem>
                  <SelectItem value="chargeback">Chargeback</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea
                rows={3}
                value={disputeForm.notes}
                onChange={(event) => setDisputeForm((prev) => ({ ...prev, notes: event.target.value }))}
              />
            </div>
            <p className="text-xs text-muted-foreground">Status will be set to Open when you save.</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisputeDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={applyDispute} disabled={saving}>
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelDialogOpen} onOpenChange={setCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel / Void Invoice</DialogTitle>
            <DialogDescription>Provide an optional reason for voiding.</DialogDescription>
          </DialogHeader>
          <Textarea value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={applyCancel} disabled={saving}>
              Void Invoice
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discountDialogOpen} onOpenChange={setDiscountDialogOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col gap-4 p-6 overflow-hidden">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>Apply Discount</DialogTitle>
            <DialogDescription>
              Choose discount by percentage or fixed amount. Invoice total and outstanding balance will be updated.
            </DialogDescription>
          </DialogHeader>
          {discountInvoice && (
            <div className="space-y-4 overflow-y-auto overflow-x-hidden pr-2 min-h-0 flex-1">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Invoice total: ${Number(discountInvoice.total ?? 0).toFixed(2)}
                </p>
                {discountInvoice.lateFee && discountInvoice.lateFee > 0 && (
                  <p className="text-sm text-red-600 dark:text-red-400">
                    Late fee: ${Number(discountInvoice.lateFee ?? 0).toFixed(2)}
                  </p>
                )}
                <p className="text-sm font-semibold">
                  Grand total: ${getGrandTotalWithLateFee(discountInvoice).toFixed(2)}
                </p>
              </div>
              {discountInvoice.lateFee != null && discountInvoice.lateFee > 0 && (
                <div className="space-y-2 p-3 rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                  <Label>Late fee</Label>
                  <div className="flex flex-wrap gap-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="lateFeeAction"
                        checked={lateFeeAction === "keep"}
                        onChange={() => setLateFeeAction("keep")}
                        className="rounded"
                      />
                      <span className="text-sm">Keep current (${Number(discountInvoice.lateFee ?? 0).toFixed(2)})</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="lateFeeAction"
                        checked={lateFeeAction === "remove"}
                        onChange={() => setLateFeeAction("remove")}
                        className="rounded"
                      />
                      <span className="text-sm">Remove</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="lateFeeAction"
                        checked={lateFeeAction === "change"}
                        onChange={() => setLateFeeAction("change")}
                        className="rounded"
                      />
                      <span className="text-sm">Change to $</span>
                      <Input
                        type="number"
                        min={0}
                        step={0.01}
                        className="w-20 h-8"
                        value={lateFeeAction === "change" ? lateFeeCustomAmount : ""}
                        onChange={(e) => setLateFeeCustomAmount(e.target.value)}
                        onClick={(e) => { e.stopPropagation(); setLateFeeAction("change"); }}
                      />
                    </label>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label>Discount type</Label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="discountType"
                      checked={discountType === "percentage"}
                      onChange={() => setDiscountType("percentage")}
                      className="rounded"
                    />
                    <span className="text-sm">Percentage (%)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="discountType"
                      checked={discountType === "amount"}
                      onChange={() => setDiscountType("amount")}
                      className="rounded"
                    />
                    <span className="text-sm">Amount ($)</span>
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="discountValue">
                  {discountType === "percentage" ? "Percentage (0–100)" : "Amount ($)"}
                </Label>
                <Input
                  id="discountValue"
                  type="number"
                  min={discountType === "percentage" ? 0 : 0}
                  max={discountType === "percentage" ? 100 : undefined}
                  step={discountType === "percentage" ? 1 : 0.01}
                  placeholder={discountType === "percentage" ? "e.g. 10" : "e.g. 50.00"}
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                />
              </div>
              {(() => {
                const hasLateFee = discountInvoice.lateFee != null && discountInvoice.lateFee > 0;
                const isLateFeeChange = hasLateFee && (lateFeeAction === "remove" || lateFeeAction === "change");
                const invoiceTotal = Number(discountInvoice.total ?? 0);
                const currentLateFee = Number(discountInvoice.lateFee ?? 0);
                const displayLateFeeAfterAction =
                  !hasLateFee
                    ? 0
                    : lateFeeAction === "keep"
                      ? currentLateFee
                      : lateFeeAction === "remove"
                        ? 0
                        : Number(lateFeeCustomAmount) >= 0
                          ? Number(lateFeeCustomAmount)
                          : currentLateFee;
                // When not changing late fee, base = current grand total (includes existing discount). When changing late fee, base = invoice total + new late fee.
                const displayGrandTotalAfterLateFee = Number((invoiceTotal + displayLateFeeAfterAction).toFixed(2));
                const displayBaseForCalculation = isLateFeeChange ? displayGrandTotalAfterLateFee : getGrandTotalWithLateFee(discountInvoice);
                const hasDiscount = discountValue.trim() !== "" && Number(discountValue) > 0;
                const displayDiscountAmount = hasDiscount
                  ? discountType === "percentage"
                    ? Number((displayBaseForCalculation * (Number(discountValue) / 100)).toFixed(2))
                    : Math.min(Number(discountValue), displayBaseForCalculation)
                  : 0;
                const displayNewGrandTotal = Number((displayBaseForCalculation - displayDiscountAmount).toFixed(2));
                const showSummary = hasDiscount || isLateFeeChange;
                if (!showSummary) return null;
                return (
                  <div className="space-y-2 p-3 bg-gray-50 dark:bg-gray-900 rounded-md border">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Previous grand total:</span>
                      <span className="text-sm font-semibold">${getGrandTotalWithLateFee(discountInvoice).toFixed(2)}</span>
                    </div>
                    {isLateFeeChange && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">
                          {lateFeeAction === "remove" ? "Late fee removed" : "Late fee changed"}:
                        </span>
                        <span className="text-sm font-semibold">
                          ${displayGrandTotalAfterLateFee.toFixed(2)}
                          {hasDiscount ? " (before discount)" : ""}
                        </span>
                      </div>
                    )}
                    {hasDiscount && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Discount:</span>
                        <span className="text-sm font-semibold text-green-600 dark:text-green-400">
                          -${displayDiscountAmount.toFixed(2)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-t pt-2">
                      <span className="text-sm font-semibold">New grand total:</span>
                      <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                        ${displayNewGrandTotal.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}
          <DialogFooter className="flex-shrink-0 flex flex-col sm:flex-row gap-2">
            {discountShowResendButton && discountInvoice && (
              <Button
                className="order-first sm:order-none w-full sm:w-auto"
                onClick={() => sendResendAfterLateFeeUpdate(discountInvoice, lateFeeWasRemoved)}
                disabled={isSendingResend}
              >
                {isSendingResend ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Resend invoice
              </Button>
            )}
            <Button variant="outline" onClick={() => setDiscountDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={applyDiscount}
              disabled={saving || (lateFeeAction === "change" && (!lateFeeCustomAmount.trim() || Number(lateFeeCustomAmount) < 0))}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {discountInvoice?.lateFee != null && discountInvoice.lateFee > 0 && (lateFeeAction === "remove" || lateFeeAction === "change")
                ? "Update late fee / discount"
                : "Apply Discount"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={testOverdueDialogOpen} onOpenChange={setTestOverdueDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Test Overdue Invoice</DialogTitle>
            <DialogDescription>
              Select a sent invoice to set its due date to yesterday. This will make it appear in the Overdue tab for testing.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Select Invoice</Label>
              <Select value={testOverdueInvoiceId} onValueChange={setTestOverdueInvoiceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose an invoice" />
                </SelectTrigger>
                <SelectContent>
                  {sentInvoices.map((invoice) => (
                    <SelectItem key={invoice.id} value={invoice.id}>
                      {invoice.invoiceNumber} - {invoice.clientName} (Due: {formatDate(invoice.dueDate)})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {sentInvoices.length === 0 && (
              <p className="text-sm text-muted-foreground">No sent invoices available for testing.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTestOverdueDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleTestOverdue}
              disabled={isTestingOverdue || !testOverdueInvoiceId || sentInvoices.length === 0}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {isTestingOverdue ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Set Due Date to Yesterday
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
