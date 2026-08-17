import type { LabelSavingsBenchmarks } from "@/lib/label-savings-benchmarks";

export type ClientReportTab = "overview" | "inventory" | "invoices" | "savings";

export type ClientReportInventoryRow = {
  id: string;
  productName: string;
  sku: string | null;
  source: string;
  quantity: number;
  damagedQuantity: number;
  status: string;
  receivingDate: string | null;
};

export type ClientReportInvoiceRow = {
  id: string;
  invoiceNumber: string;
  date: string;
  status: string;
  subtotal: number;
  grandTotal: number;
};

export type ClientReportLabelRow = {
  id: string;
  purchasedAt: string;
  trackingNumber: string | null;
  carrier: string;
  service: string;
  paid: number;
  isGofo: boolean;
  estimatedUsps: number;
  estimatedUps: number;
  estimatedFedex: number;
  savedVsUsps: number;
  savedVsUps: number;
  savedVsFedex: number;
};

export type ClientReportSummary = {
  period: { from: string; to: string; label: string; allTime: boolean };
  overview: {
    unitsReceived: number;
    unitsShipped: number;
    currentOnHand: number;
    currentDamaged: number;
    returnsHandled: number;
    unitsReturned: number;
    unitsDisposed: number;
    invoicesBilled: number;
    invoicesPaid: number;
    invoicesPending: number;
    invoiceCount: number;
    paidCount: number;
    pendingCount: number;
  };
  charts: {
    activityByDay: { label: string; received: number; shipped: number }[];
  };
  inventory: ClientReportInventoryRow[];
  invoices: ClientReportInvoiceRow[];
  savings: {
    benchmarks: LabelSavingsBenchmarks;
    gofoLabelCount: number;
    otherLabelCount: number;
    paidGofo: number;
    estimatedUsps: number;
    estimatedUps: number;
    estimatedFedex: number;
    savedVsUsps: number;
    savedVsUps: number;
    savedVsFedex: number;
    averagePaidGofo: number;
    rows: ClientReportLabelRow[];
  };
};
