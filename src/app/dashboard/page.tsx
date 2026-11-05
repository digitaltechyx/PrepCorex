"use client";

import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { InventoryItem, ShippedItem, Invoice, DisposeRequest } from "@/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Boxes,
  Clock3,
  DollarSign,
  AlertTriangle,
  Truck,
  PlugZap,
  FileText,
  Copy,
  Pencil,
  Check,
  X,
  Loader2,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { hasRole } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  getDefaultInboundShippingName,
  getInboundShippingName,
  hasCustomInboundShippingName,
} from "@/lib/inbound-shipping-name";
import { db } from "@/lib/firebase";
import { doc, updateDoc, deleteField } from "firebase/firestore";
import { useToast } from "@/hooks/use-toast";
import { useDashboardNav } from "@/contexts/dashboard-nav-context";
import { DateRangePicker } from "@/components/ui/date-range-picker";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Area, AreaChart, Bar, BarChart, Pie, PieChart, CartesianGrid, XAxis, Cell } from "recharts";

type InventoryRequestLite = {
  id?: string;
  status?: string;
  productName?: string;
  rejectionReason?: string;
  addDate?: { seconds: number; nanoseconds: number } | string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
};

type DocumentRequestLite = {
  id?: string;
  status?: string;
  documentType?: string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
};

type ProductReturnLite = {
  id: string;
  productName?: string;
  status?: string;
  createdAt?: { seconds: number; nanoseconds: number } | string;
};

type ShipmentRequestLite = {
  id?: string;
  status?: string;
  requestedAt?: { seconds: number; nanoseconds: number } | string;
  date?: { seconds: number; nanoseconds: number } | string;
  shipTo?: string;
  shipments?: Array<{
    productName?: string;
    quantity?: number;
    packOf?: number;
  }>;
};

type InventoryItemWithSource = InventoryItem & {
  source?: "shopify" | "ebay";
};

type WarehouseLocationDoc = {
  id: string;
  name?: string;
  country?: string;
  stateOrProvince?: string;
  active?: boolean;
  shippingName?: string;
  street1?: string;
  street2?: string;
  city?: string;
  zip?: string;
  state?: string;
};

function normalizeDate(value: ShippedItem["date"]): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function normalizeInventoryDate(value: InventoryItem["dateAdded"]): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function normalizeRequestDate(
  value?: { seconds: number; nanoseconds: number } | string
): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === "object" && "seconds" in value) {
    return new Date(value.seconds * 1000);
  }
  return null;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
}
function isDateInRange(date: Date | null, from?: Date, to?: Date): boolean {
  if (!date) return false;
  if (!from && !to) return true;
  const t = date.getTime();
  if (from && t < startOfDay(from).getTime()) return false;
  if (to && t > endOfDay(to).getTime()) return false;
  return true;
}

export default function DashboardPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const nav = useDashboardNav();
  const [trendRange, setTrendRange] = useState<7 | 14 | 30>(14);
  const dateRangeFrom = nav?.dateRangeFrom;
  const dateRangeTo = nav?.dateRangeTo;
  const sourceFilter = nav?.sourceFilter ?? "all";

  useEffect(() => {
    if (userProfile && hasRole(userProfile, "commission_agent") && !hasRole(userProfile, "user")) {
      router.replace("/dashboard/agent");
    }
  }, [userProfile, router]);

  const {
    data: inventoryData,
    loading: inventoryLoading,
  } = useCollection<InventoryItem>(
    userProfile ? `users/${userProfile.uid}/inventory` : ""
  );
  const {
    data: shippedData,
    loading: shippedLoading,
  } = useCollection<ShippedItem>(
    userProfile ? `users/${userProfile.uid}/shipped` : ""
  );
  const {
    data: invoices,
    loading: invoicesLoading,
  } = useCollection<Invoice>(
    userProfile ? `users/${userProfile.uid}/invoices` : ""
  );
  const { data: inventoryRequests, loading: inventoryRequestsLoading } = useCollection<InventoryRequestLite>(
    userProfile ? `users/${userProfile.uid}/inventoryRequests` : ""
  );
  const { data: shipmentRequests, loading: shipmentRequestsLoading } = useCollection<ShipmentRequestLite>(
    userProfile ? `users/${userProfile.uid}/shipmentRequests` : ""
  );
  const { data: shopifyConnections, loading: shopifyConnectionsLoading } = useCollection<Record<string, unknown>>(
    userProfile ? `users/${userProfile.uid}/shopifyConnections` : ""
  );
  const { data: ebayConnections, loading: ebayConnectionsLoading } = useCollection<Record<string, unknown>>(
    userProfile ? `users/${userProfile.uid}/ebayConnections` : ""
  );
  const { data: documentRequestsLite, loading: documentRequestsLoading } = useCollection<DocumentRequestLite>(
    userProfile ? `users/${userProfile.uid}/documentRequests` : ""
  );
  const { data: productReturns, loading: productReturnsLoading } = useCollection<ProductReturnLite>(
    userProfile ? `users/${userProfile.uid}/productReturns` : ""
  );
  const { data: disposeRequests, loading: disposeRequestsLoading } = useCollection<DisposeRequest>(
    userProfile ? `users/${userProfile.uid}/disposeRequests` : ""
  );
  const { data: warehouseLocations } = useCollection<WarehouseLocationDoc>("locations");
  const [selectedWarehouseId, setSelectedWarehouseId] = useState("");

  useEffect(() => {
    if (!userProfile?.uid) return;
    const key = `warehouseSelection:${userProfile.uid}`;
    const read = () => {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) {
          setSelectedWarehouseId("");
          return;
        }
        const parsed = JSON.parse(raw) as { locationId?: string };
        setSelectedWarehouseId(parsed.locationId || "");
      } catch {
        setSelectedWarehouseId("");
      }
    };
    read();
    const onChange = () => read();
    window.addEventListener("storage", onChange);
    window.addEventListener("warehouse-selection-changed", onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener("warehouse-selection-changed", onChange);
    };
  }, [userProfile?.uid]);

  const selectedWarehouse = useMemo(
    () => warehouseLocations.find((loc) => loc.id === selectedWarehouseId) || null,
    [warehouseLocations, selectedWarehouseId]
  );
  const assignedLocationIds = useMemo(
    () => new Set((userProfile?.locations ?? []).filter(Boolean)),
    [userProfile?.locations]
  );
  const isSelectedWarehouseAssigned = selectedWarehouseId
    ? assignedLocationIds.has(selectedWarehouseId)
    : true;
  const selectedWarehouseStateDisplay = useMemo(() => {
    if (!selectedWarehouse) return "-";
    const raw = (selectedWarehouse.stateOrProvince || selectedWarehouse.state || "").trim();
    return raw || "-";
  }, [selectedWarehouse]);

  const shipmentAddressBorderClass = useMemo(() => {
    if (!selectedWarehouse) {
      return "border-[1.5px] border-solid border-orange-400";
    }
    if (!isSelectedWarehouseAssigned) {
      return "border-[1.5px] border-solid border-red-500";
    }
    return "border-[1.5px] border-solid border-green-500";
  }, [selectedWarehouse, isSelectedWarehouseAssigned]);

  const shippingName = useMemo(() => getInboundShippingName(userProfile), [userProfile]);
  const defaultShippingName = useMemo(
    () => getDefaultInboundShippingName(userProfile),
    [userProfile]
  );
  const [isEditingShippingName, setIsEditingShippingName] = useState(false);
  const [shippingNameDraft, setShippingNameDraft] = useState("");
  const [savingShippingName, setSavingShippingName] = useState(false);

  useEffect(() => {
    if (!isEditingShippingName) {
      setShippingNameDraft(shippingName === "-" ? "" : shippingName);
    }
  }, [shippingName, isEditingShippingName]);

  const startEditingShippingName = useCallback(() => {
    setShippingNameDraft(shippingName === "-" ? defaultShippingName : shippingName);
    setIsEditingShippingName(true);
  }, [defaultShippingName, shippingName]);

  const cancelEditingShippingName = useCallback(() => {
    setShippingNameDraft(shippingName === "-" ? "" : shippingName);
    setIsEditingShippingName(false);
  }, [shippingName]);

  const saveShippingName = useCallback(async () => {
    if (!userProfile?.uid) return;
    const trimmed = shippingNameDraft.trim();
    const normalizedDefault = defaultShippingName.trim();

    if (!trimmed) {
      toast({
        title: "Shipping name required",
        description: "Enter a name for your inbound shipments or cancel to keep the current value.",
        variant: "destructive",
      });
      return;
    }

    setSavingShippingName(true);
    try {
      const userRef = doc(db, "users", userProfile.uid);
      if (trimmed === normalizedDefault) {
        await updateDoc(userRef, { inboundShippingName: deleteField() });
      } else {
        await updateDoc(userRef, { inboundShippingName: trimmed });
      }
      setIsEditingShippingName(false);
      toast({
        title: trimmed === normalizedDefault ? "Using default name" : "Shipping name saved",
        description:
          trimmed === normalizedDefault
            ? `Your shipment address will show ${normalizedDefault}.`
            : "Suppliers will see this name on your inbound shipment address.",
      });
    } catch {
      toast({
        title: "Could not save shipping name",
        description: "Please try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSavingShippingName(false);
    }
  }, [defaultShippingName, shippingNameDraft, toast, userProfile?.uid]);

  const hasDateRange = Boolean(dateRangeFrom && dateRangeTo);

  const shippedDataInRange = useMemo(() => {
    if (!hasDateRange) return shippedData;
    return shippedData.filter((row) => isDateInRange(normalizeDate(row.date), dateRangeFrom, dateRangeTo));
  }, [shippedData, hasDateRange, dateRangeFrom, dateRangeTo]);

  const shipmentRequestsInRange = useMemo(() => {
    if (!hasDateRange) return shipmentRequests;
    return shipmentRequests.filter((req) =>
      isDateInRange(normalizeRequestDate(req.requestedAt || req.date), dateRangeFrom, dateRangeTo)
    );
  }, [shipmentRequests, hasDateRange, dateRangeFrom, dateRangeTo]);

  const totalItemsInInventory = useMemo(() => {
    return inventoryData.reduce((sum, item) => sum + (item.quantity || 0), 0);
  }, [inventoryData]);

  const lowStockItems = useMemo(() => {
    return inventoryData
      .filter((item) => (item.quantity || 0) > 0 && (item.quantity || 0) <= 10)
      .sort((a, b) => (a.quantity || 0) - (b.quantity || 0));
  }, [inventoryData]);

  const totalPendingAmount = useMemo(() => {
    const pendingInvoices = invoices.filter((inv) => inv.status === "pending");
    return pendingInvoices.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
  }, [invoices]);

  const pendingFulfillmentCount = useMemo(() => {
    return shipmentRequests.filter((r) => {
      const s = (r.status || "").toLowerCase();
      return s === "pending" || s === "confirmed" || s === "awaiting_label_upload";
    }).length;
  }, [shipmentRequests]);

  const rejectedInventoryRequests = useMemo(() => {
    return inventoryRequests.filter((r) => (r.status || "").toLowerCase() === "rejected");
  }, [inventoryRequests]);

  const [currentDate, setCurrentDate] = useState(() => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate()
    ).padStart(2, "0")}`;
  });

  useEffect(() => {
    const updateDate = () => {
      const today = new Date();
      const todayString = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(today.getDate()).padStart(2, "0")}`;
      setCurrentDate(todayString);
    };
    updateDate();
    const interval = setInterval(updateDate, 60000);
    return () => clearInterval(interval);
  }, []);

  const todaysShippedOrders = useMemo(() => {
    if (hasDateRange) return shippedDataInRange.length;
    return shippedData.filter((item) => {
      const itemDate = normalizeDate(item.date);
      if (!itemDate) return false;
      const itemDateString = `${itemDate.getFullYear()}-${String(itemDate.getMonth() + 1).padStart(
        2,
        "0"
      )}-${String(itemDate.getDate()).padStart(2, "0")}`;
      return itemDateString === currentDate;
    }).length;
  }, [shippedData, currentDate, hasDateRange, shippedDataInRange.length]);

  const integrationHealth = useMemo(() => {
    const hasShopify = shopifyConnections.length > 0;
    const hasEbay = ebayConnections.length > 0;
    if (hasShopify && hasEbay) return { label: "Healthy", pct: 100 };
    if (hasShopify || hasEbay) return { label: "Partial", pct: 70 };
    return { label: "Not Connected", pct: 20 };
  }, [shopifyConnections.length, ebayConnections.length]);

  const openDocumentRequestsCount = useMemo(
    () => documentRequestsLite.filter((r) => (r.status || "").toLowerCase() === "pending").length,
    [documentRequestsLite]
  );

  const recentActivityRows = useMemo(() => {
    type Row = {
      id: string;
      type: string;
      detail: string;
      dateLabel: string;
      status: string;
      ms: number;
      href: string;
    };
    const rows: Row[] = [];

    const inRange = (d: Date | null) => {
      if (!d) return false;
      if (!hasDateRange) return true;
      return isDateInRange(d, dateRangeFrom, dateRangeTo);
    };

    const push = (id: string, type: string, detail: string, date: Date | null, status: string, href: string) => {
      if (!date || !inRange(date)) return;
      const label = (detail || "—").trim() || "—";
      rows.push({
        id,
        type,
        detail: label.length > 100 ? `${label.slice(0, 97)}…` : label,
        dateLabel: date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        status: status || "—",
        ms: date.getTime(),
        href,
      });
    };

    shipmentRequests.forEach((req, i) => {
      const d = normalizeRequestDate(req.requestedAt || req.date);
      const first = req.shipments?.[0];
      const detail =
        first?.productName ||
        (req.shipments && req.shipments.length > 1
          ? `${req.shipments.length} products`
          : "Shipment request");
      push(`ship-${req.id ?? i}`, "Shipment", detail, d, req.status || "—", "/dashboard/shipped-orders?status=pending");
    });

    inventoryRequests.forEach((req, i) => {
      const d = normalizeRequestDate(req.requestedAt || req.addDate);
      push(`inv-${req.id ?? i}`, "Inventory", req.productName || "Inventory request", d, req.status || "—", "/dashboard/inventory");
    });

    productReturns.forEach((r) => {
      const d = normalizeRequestDate(r.createdAt);
      push(`ret-${r.id}`, "Return", r.productName || "Product return", d, r.status || "—", "/dashboard/product-returns");
    });

    disposeRequests.forEach((r, i) => {
      const d = normalizeRequestDate(r.requestedAt);
      push(`dis-${r.id ?? i}`, "Dispose", r.productName || "Dispose request", d, r.status || "—", "/dashboard/recycle-bin");
    });

    documentRequestsLite.forEach((r, i) => {
      const d = normalizeRequestDate(r.requestedAt);
      const st = (r.status || "").toLowerCase();
      const docHref =
        st === "complete" ? "/dashboard/documents?status=complete" : "/dashboard/documents?status=pending";
      push(`doc-${r.id ?? i}`, "Document", r.documentType || "Document request", d, r.status || "—", docHref);
    });

    rows.sort((a, b) => b.ms - a.ms);
    return rows.slice(0, 10);
  }, [
    shipmentRequests,
    inventoryRequests,
    productReturns,
    disposeRequests,
    documentRequestsLite,
    hasDateRange,
    dateRangeFrom,
    dateRangeTo,
  ]);

  const activityLoading =
    inventoryRequestsLoading ||
    shipmentRequestsLoading ||
    documentRequestsLoading ||
    productReturnsLoading ||
    disposeRequestsLoading;

  const sourceSplit = useMemo(() => {
    const rows = inventoryData as InventoryItemWithSource[];
    const filtered =
      hasDateRange && dateRangeFrom && dateRangeTo
        ? rows.filter((r) =>
            isDateInRange(normalizeInventoryDate(r.dateAdded), dateRangeFrom, dateRangeTo)
          )
        : rows;
    const shopify = filtered.filter((r) => r.source === "shopify").length;
    const ebay = filtered.filter((r) => r.source === "ebay").length;
    const manual = filtered.length - shopify - ebay;
    return { shopify, ebay, manual };
  }, [inventoryData, hasDateRange, dateRangeFrom, dateRangeTo]);

  const inventoryAndShipmentTrend = useMemo(() => {
    const buckets = new Map<string, { label: string; shipped: number; added: number }>();

    if (hasDateRange && dateRangeFrom && dateRangeTo) {
      const start = startOfDay(dateRangeFrom);
      const end = endOfDay(dateRangeTo);
      for (let t = start.getTime(); t <= end.getTime(); t += 86400000) {
        const d = new Date(t);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        buckets.set(key, { label, shipped: 0, added: 0 });
      }
    } else {
      const days = trendRange;
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(now.getDate() - i);
        const key = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
        buckets.set(key, { label, shipped: 0, added: 0 });
      }
    }

    for (const row of shippedDataInRange) {
      const d = normalizeDate(row.date);
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      if (!buckets.has(key)) continue;
      const qty = Number(row.shippedQty ?? 0);
      buckets.get(key)!.shipped += Number.isFinite(qty) ? qty : 0;
    }

    const inventoryFiltered = hasDateRange && dateRangeFrom && dateRangeTo
      ? inventoryData.filter((row) =>
          isDateInRange(normalizeInventoryDate(row.dateAdded), dateRangeFrom, dateRangeTo)
        )
      : inventoryData;
    for (const row of inventoryFiltered) {
      const d = normalizeInventoryDate(row.dateAdded);
      if (!d) continue;
      const key = d.toISOString().slice(0, 10);
      if (!buckets.has(key)) continue;
      const qty = Number(row.quantity ?? 0);
      buckets.get(key)!.added += Number.isFinite(qty) ? qty : 0;
    }

    return Array.from(buckets.values());
  }, [inventoryData, shippedDataInRange, trendRange, hasDateRange, dateRangeFrom, dateRangeTo]);

  const orderStatusData = useMemo(() => {
    const statusCounts = {
      pending: 0,
      shipped: shippedDataInRange.length,
      rejected: 0,
      processing: 0,
    };

    for (const req of shipmentRequestsInRange) {
      const status = (req.status || "").toLowerCase();
      if (status === "pending") statusCounts.pending += 1;
      else if (status === "rejected") statusCounts.rejected += 1;
      else if (status === "approved" || status === "in_progress" || status === "confirmed") statusCounts.processing += 1;
    }

    return [
      { name: "Shipped", value: statusCounts.shipped, fill: "var(--color-shipped)" },
      { name: "Pending", value: statusCounts.pending, fill: "var(--color-pending)" },
      { name: "Processing", value: statusCounts.processing, fill: "var(--color-processing)" },
      { name: "Rejected", value: statusCounts.rejected, fill: "var(--color-rejected)" },
    ];
  }, [shipmentRequestsInRange, shippedDataInRange.length]);

  const sourceSplitData = useMemo(
    () => [
      { source: "Shopify", count: sourceSplit.shopify, fill: "var(--color-shopify)" },
      { source: "eBay", count: sourceSplit.ebay, fill: "var(--color-ebay)" },
      { source: "Manual", count: sourceSplit.manual, fill: "var(--color-manual)" },
    ],
    [sourceSplit]
  );

  const trendChartConfig = {
    shipped: { label: "Shipped Units", color: "#3b82f6" },
    added: { label: "Inventory Added", color: "#22c55e" },
  } satisfies ChartConfig;

  const orderStatusChartConfig = {
    shipped: { label: "Shipped", color: "#22c55e" },
    pending: { label: "Pending", color: "#f59e0b" },
    processing: { label: "Processing", color: "#3b82f6" },
    rejected: { label: "Rejected", color: "#ef4444" },
    // Capitalized for legend lookup (Pie sends name: "Shipped" etc.)
    Shipped: { label: "Shipped", color: "#22c55e" },
    Pending: { label: "Pending", color: "#f59e0b" },
    Processing: { label: "Processing", color: "#3b82f6" },
    Rejected: { label: "Rejected", color: "#ef4444" },
  } satisfies ChartConfig;

  const sourceSplitChartConfig = {
    shopify: { label: "Shopify", color: "#2563eb" },
    ebay: { label: "eBay", color: "#22c55e" },
    manual: { label: "Manual", color: "#f59e0b" },
  } satisfies ChartConfig;

  const topMovingProducts = useMemo(() => {
    const moved = new Map<string, number>();

    for (const row of shippedDataInRange) {
      if (Array.isArray(row.items) && row.items.length > 0) {
        for (const item of row.items) {
          const name = item.productName || "Unknown Product";
          const qty = Number(item.shippedQty ?? item.quantity ?? 0);
          moved.set(name, (moved.get(name) || 0) + (Number.isFinite(qty) ? qty : 0));
        }
      } else if (row.productName) {
        const qty = Number(row.shippedQty ?? 0);
        moved.set(row.productName, (moved.get(row.productName) || 0) + (Number.isFinite(qty) ? qty : 0));
      }
    }

    const inventoryMap = new Map(
      inventoryData.map((inv) => [inv.productName.toLowerCase(), inv.quantity || 0])
    );

    return Array.from(moved.entries())
      .map(([name, units]) => ({
        name,
        units,
        stockLeft: inventoryMap.get(name.toLowerCase()) ?? 0,
      }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 8);
  }, [shippedDataInRange, inventoryData]);

  const kpiCards = [
    { title: "Total Inventory", value: String(totalItemsInInventory), hint: "Units across all products", icon: Boxes, iconBg: "bg-blue-500/10 text-blue-600", href: "/dashboard/inventory" },
    { title: "Low Stock SKUs", value: String(lowStockItems.length), hint: "Qty ≤ 10", icon: AlertTriangle, iconBg: "bg-amber-500/10 text-amber-600", href: "/dashboard/inventory?status=low-stock" },
    { title: "Pending Orders", value: String(pendingFulfillmentCount), hint: "Awaiting fulfillment", icon: Clock3, iconBg: "bg-orange-500/10 text-orange-600", href: "/dashboard/shipped-orders?status=pending" },
    {
      title: hasDateRange ? "Shipped in period" : "Today Shipped Orders",
      value: String(todaysShippedOrders),
      hint: hasDateRange ? "In selected date range" : "Shipments recorded",
      icon: Truck,
      iconBg: "bg-violet-500/10 text-violet-600",
      href: hasDateRange
        ? "/dashboard/shipped-orders?status=shipped"
        : "/dashboard/shipped-orders?status=shipped&date=today",
    },
    { title: "Pending Invoice", value: invoicesLoading ? "..." : `$${Number(totalPendingAmount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, hint: "Outstanding balance", icon: DollarSign, iconBg: "bg-emerald-500/10 text-emerald-600", href: "/dashboard/invoices" },
    {
      title: "Open Documents Requests",
      value: String(openDocumentRequestsCount),
      hint: "Awaiting admin",
      icon: FileText,
      iconBg: "bg-teal-500/10 text-teal-600",
      href: "/dashboard/documents?status=pending",
    },
  ];

  const activityStatusClass = (status: string) => {
    const s = status.toLowerCase();
    if (s === "pending") return "bg-amber-100 text-amber-800";
    if (s === "approved" || s === "complete") return "bg-blue-100 text-blue-800";
    if (s === "rejected") return "bg-red-100 text-red-800";
    if (s === "in_progress") return "bg-sky-100 text-sky-800";
    if (s === "closed" || s === "shipped") return "bg-emerald-100 text-emerald-800";
    if (s === "cancelled") return "bg-rose-100 text-rose-800";
    return "bg-neutral-100 text-neutral-700";
  };

  const cardPad = "px-3 pb-3 pt-3 sm:px-6 sm:pb-6 sm:pt-6";
  const cardHeaderPad = "px-3 pb-2 pt-3 sm:px-6 sm:pt-6";

  return (
    <div className="min-h-full min-w-0 bg-neutral-50/80">
      <div className="mx-auto max-w-[1600px] space-y-3 pb-20 sm:space-y-6 sm:pb-8">
        {userProfile?.clientId && (
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-card px-2.5 py-1.5 text-xs text-muted-foreground shadow-sm sm:px-3 sm:py-2 sm:text-sm">
            <span className="shrink-0">Client ID:</span>
            <span className="truncate font-mono font-semibold text-foreground">#{userProfile.clientId}</span>
          </div>
        )}

        {/* Date picker */}
        {nav && (
          <div className="flex min-w-0 flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2">
            <span className="text-xs font-medium text-neutral-600 sm:text-sm">Date range</span>
            <DateRangePicker
              fromDate={nav.dateRangeFrom}
              toDate={nav.dateRangeTo}
              setFromDate={nav.setDateRangeFrom}
              setToDate={nav.setDateRangeTo}
              className="h-9 w-full min-w-0 border-neutral-200 bg-white text-sm shadow-[0_1px_2px_rgba(0,0,0,0.05)] sm:w-[280px]"
            />
          </div>
        )}

        {/* KPI cards — horizontal strip on mobile */}
        <section className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {kpiCards.map((kpi) => {
            const Icon = kpi.icon;
            const href = "href" in kpi ? kpi.href : undefined;
            const cardContent = (
              <Card
                className={cn(
                  "h-full min-w-0 overflow-hidden rounded-xl border-neutral-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition-shadow hover:shadow-[0_4px_12px_rgba(0,0,0,0.08)]",
                  href && "cursor-pointer hover:border-neutral-300/80"
                )}
              >
                <CardContent className="px-3 py-2.5 sm:p-5">
                  <div className="flex items-center gap-3 sm:block">
                    <div
                      className={cn(
                        "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10 sm:rounded-xl",
                        kpi.iconBg
                      )}
                    >
                      <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
                    </div>
                    <div className="flex min-w-0 flex-1 items-center justify-between gap-3 sm:mt-3 sm:block">
                      <p className="order-2 shrink-0 text-xl font-semibold tracking-tight text-neutral-900 sm:order-none sm:text-2xl">
                        {kpi.value}
                      </p>
                      <div className="order-1 min-w-0 sm:order-none sm:mt-0.5">
                        <p className="text-sm font-medium text-neutral-700 sm:text-neutral-600">{kpi.title}</p>
                        <p className="mt-0.5 text-[11px] leading-snug text-neutral-500 sm:mt-1 sm:text-xs">
                          {kpi.hint}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
            if (href) {
              return (
                <Link
                  key={kpi.title}
                  href={href}
                  className="block min-w-0 rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  {cardContent}
                </Link>
              );
            }
            return (
              <span key={kpi.title} className="block min-w-0">
                {cardContent}
              </span>
            );
          })}
        </section>

        {/* Analytics: trend chart + shipment address */}
        <section className="grid gap-3 sm:gap-4 xl:grid-cols-12 xl:gap-6">
          <Card className="min-w-0 overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm xl:col-span-7">
            <CardHeader className={cardHeaderPad}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0">
                  <CardTitle className="text-sm font-semibold text-neutral-900 sm:text-base">
                    Inventory & Shipment Activity
                  </CardTitle>
                  <CardDescription className="text-xs text-neutral-500 sm:text-sm">
                    {hasDateRange ? "Shipped vs added in selected date range" : "Shipped vs added inventory over time"}
                  </CardDescription>
                </div>
                {!hasDateRange && (
                  <div className="inline-flex self-start rounded-lg border border-neutral-200 bg-neutral-50/80 p-1">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setTrendRange(d)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-xs font-medium transition sm:px-3 sm:py-1.5",
                          trendRange === d
                            ? "bg-white text-neutral-900 shadow-sm"
                            : "text-neutral-500 hover:text-neutral-700"
                        )}
                      >
                        {d}d
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className={cn(cardPad, "pt-0")}>
              <ChartContainer config={trendChartConfig} className="h-[200px] w-full sm:h-[280px]">
                <AreaChart data={inventoryAndShipmentTrend}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(229 231 235)" />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area dataKey="added" type="monotone" fill="var(--color-added)" fillOpacity={0.2} stroke="var(--color-added)" strokeWidth={2} />
                  <Area dataKey="shipped" type="monotone" fill="var(--color-shipped)" fillOpacity={0.2} stroke="var(--color-shipped)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>
          <Card
            className={cn(
              "min-w-0 rounded-xl bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm xl:col-span-5",
              shipmentAddressBorderClass,
              !isSelectedWarehouseAssigned && selectedWarehouse && "opacity-70"
            )}
          >
            <CardHeader className={cardHeaderPad}>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold sm:text-base">Shipment address</CardTitle>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={async () => {
                    if (!selectedWarehouse) return;
                    const stateLine = (
                      selectedWarehouse.stateOrProvince ||
                      selectedWarehouse.state ||
                      ""
                    ).trim();
                    const street2WithClientId = [
                      selectedWarehouse.street2?.trim(),
                      userProfile?.clientId?.trim(),
                    ]
                      .filter(Boolean)
                      .join(", ");

                    const text = [
                      shippingName !== "-" ? shippingName : "",
                      selectedWarehouse.street1 || "",
                      street2WithClientId || "",
                      selectedWarehouse.city || "",
                      stateLine,
                      selectedWarehouse.zip || "",
                      selectedWarehouse.country || "",
                    ]
                      .filter(Boolean)
                      .join("\n");
                    if (!text) return;
                    try {
                      await navigator.clipboard.writeText(text);
                    } catch {
                      // ignore clipboard errors
                    }
                  }}
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className={cn(cardPad, "pt-0")}>
              {selectedWarehouse ? (
                <>
                  <div className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-[110px_1fr] sm:gap-y-1">
                    <span className="text-xs text-muted-foreground sm:text-sm">Shipping Name</span>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      {isEditingShippingName ? (
                        <>
                          <Input
                            value={shippingNameDraft}
                            onChange={(e) => setShippingNameDraft(e.target.value)}
                            className="h-8 min-w-0 flex-1 text-sm"
                            placeholder={defaultShippingName}
                            disabled={savingShippingName}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") void saveShippingName();
                              if (e.key === "Escape") cancelEditingShippingName();
                            }}
                            autoFocus
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-emerald-600"
                            onClick={() => void saveShippingName()}
                            disabled={savingShippingName}
                            aria-label="Save shipping name"
                          >
                            {savingShippingName ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Check className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={cancelEditingShippingName}
                            disabled={savingShippingName}
                            aria-label="Cancel editing shipping name"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="min-w-0 break-words font-medium text-primary">{shippingName}</span>
                          {hasCustomInboundShippingName(userProfile) ? (
                            <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
                              Custom
                            </Badge>
                          ) : null}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0 text-muted-foreground"
                            onClick={startEditingShippingName}
                            aria-label="Edit shipping name"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground sm:text-sm">Street1</span>
                    <span className="break-words">{selectedWarehouse.street1 || "-"}</span>
                    <span className="text-xs text-muted-foreground sm:text-sm">Street2</span>
                    <span className="break-words">
                      {[selectedWarehouse.street2?.trim(), userProfile?.clientId?.trim()]
                        .filter(Boolean)
                        .join(", ") || "-"}
                    </span>
                    <span className="text-xs text-muted-foreground sm:text-sm">City</span>
                    <span>{selectedWarehouse.city || "-"}</span>
                    <span className="text-xs text-muted-foreground sm:text-sm">Zip</span>
                    <span>{selectedWarehouse.zip || "-"}</span>
                    <span className="text-xs text-muted-foreground sm:text-sm">State</span>
                    <span>{selectedWarehouseStateDisplay}</span>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground sm:mt-4 sm:text-sm">
                    To ensure accurate processing and avoid any misplacement, all shipments to our warehouse should use
                    the shipping name above (default: Prep Services FBA). You can edit it if your supplier must use a
                    different label.
                  </p>
                  {!isSelectedWarehouseAssigned && (
                    <div className="mt-3 rounded-md bg-white p-2.5 text-center shadow-sm sm:mt-4 sm:p-3">
                      <p className="font-semibold text-red-600">Inbound shipping disabled</p>
                      <p className="text-xs text-foreground sm:text-sm">Do not ship inventory to this address</p>
                      <p className="text-xs text-foreground sm:text-sm">If you need this location contact with admin</p>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Select a warehouse location from the sidebar to view your shipment address.
                </p>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Request status + alerts */}
        <section className="grid gap-3 sm:gap-4 xl:grid-cols-2 xl:gap-6">
          <Card className="min-w-0 overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <CardHeader className={cardHeaderPad}>
              <CardTitle className="text-sm font-semibold text-neutral-900 sm:text-base">
                Request Processing Status
              </CardTitle>
              <CardDescription className="text-xs text-neutral-500 sm:text-sm">
                Shipped, pending, processing, rejected
              </CardDescription>
            </CardHeader>
            <CardContent className={cn(cardPad, "pt-0")}>
              <ChartContainer config={orderStatusChartConfig} className="h-[220px] w-full sm:h-[280px]">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend
                    content={
                      <ChartLegendContent
                        nameKey="name"
                        className="grid grid-cols-2 justify-items-start gap-x-4 gap-y-1.5 sm:gap-x-6 sm:gap-y-2"
                      />
                    }
                  />
                  <Pie
                    data={orderStatusData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={76}
                    paddingAngle={2}
                  >
                    {orderStatusData.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                </PieChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <CardHeader className={cardHeaderPad}>
              <CardTitle className="text-sm font-semibold text-neutral-900 sm:text-base">Alerts</CardTitle>
              <CardDescription className="text-xs text-neutral-500 sm:text-sm">Needs attention</CardDescription>
            </CardHeader>
            <CardContent className={cn(cardPad, "pt-0")}>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-3">
                <Link
                  href="/dashboard/inventory?status=low-stock"
                  className="block min-w-0 rounded-lg border border-amber-200/80 bg-amber-50/60 p-2.5 transition-colors hover:bg-amber-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 sm:p-3"
                >
                  <p className="text-sm font-medium text-amber-900">Low Stock ({lowStockItems.length})</p>
                  {lowStockItems.length === 0 ? (
                    <p className="mt-1 text-xs text-amber-700">All good</p>
                  ) : (
                    lowStockItems.slice(0, 3).map((item) => (
                      <p key={item.id} className="mt-1 truncate text-xs text-amber-800">
                        {item.productName}: {item.quantity} left
                      </p>
                    ))
                  )}
                  {lowStockItems.length > 0 && (
                    <p className="mt-2 text-xs font-medium text-amber-700 underline-offset-2 hover:underline">
                      View filtered inventory →
                    </p>
                  )}
                </Link>
                <div className="min-w-0 rounded-lg border border-rose-200/80 bg-rose-50/60 p-2.5 sm:p-3">
                  <p className="text-sm font-medium text-rose-900">
                    Rejected Requests ({rejectedInventoryRequests.length})
                  </p>
                  {rejectedInventoryRequests.length === 0 ? (
                    <p className="mt-1 text-xs text-rose-700">None</p>
                  ) : (
                    rejectedInventoryRequests.slice(0, 2).map((req, idx) => (
                      <p key={`${req.productName}-${idx}`} className="mt-1 truncate text-xs text-rose-800">
                        {req.productName || "Item"}: {req.rejectionReason || "Rejected"}
                      </p>
                    ))
                  )}
                </div>
                <div className="min-w-0 rounded-lg border border-blue-200/80 bg-blue-50/60 p-2.5 sm:p-3">
                  <p className="text-sm font-medium text-blue-900">
                    Pending Fulfillment ({pendingFulfillmentCount})
                  </p>
                  <p className="mt-1 text-xs text-blue-700">Shipment requests waiting</p>
                  <Link
                    href="/dashboard/shipped-orders?status=pending"
                    className="mt-2 inline-block text-xs font-medium text-blue-600 hover:underline"
                  >
                    Review →
                  </Link>
                </div>
                <div className="min-w-0 rounded-lg border border-emerald-200/80 bg-emerald-50/60 p-2.5 sm:p-3">
                  <p className="text-sm font-medium text-emerald-900">Integrations</p>
                  <p className="mt-1 text-xs text-emerald-800">
                    Shopify: {shopifyConnections.length > 0 ? "Connected" : "Not connected"}
                  </p>
                  <p className="text-xs text-emerald-800">
                    eBay: {ebayConnections.length > 0 ? "Connected" : "Not connected"}
                  </p>
                  <Link
                    href="/dashboard/integrations"
                    className="mt-2 inline-block text-xs font-medium text-emerald-600 hover:underline"
                  >
                    Settings →
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Integration health */}
        <div className="min-w-0 rounded-xl border border-neutral-200/80 bg-white/90 px-3 py-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm sm:px-4 sm:py-3">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 sm:h-9 sm:w-9">
                <PlugZap className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-neutral-900">Integration health</p>
                <p className="truncate text-xs text-neutral-500">
                  Shopify: {shopifyConnections.length > 0 ? "Connected" : "Not connected"}
                  <span className="mx-1.5 text-neutral-300">·</span>
                  eBay: {ebayConnections.length > 0 ? "Connected" : "Not connected"}
                </p>
              </div>
            </div>
            <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-md sm:flex-initial sm:gap-3">
              {shopifyConnectionsLoading || ebayConnectionsLoading ? (
                <Skeleton className="h-2 flex-1 rounded-full" />
              ) : (
                <>
                  <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all",
                        integrationHealth.pct >= 100 && "bg-emerald-500",
                        integrationHealth.pct === 70 && "bg-amber-500",
                        integrationHealth.pct < 70 && "bg-rose-400"
                      )}
                      style={{ width: `${integrationHealth.pct}%` }}
                    />
                  </div>
                  <span className="shrink-0 text-sm font-semibold tabular-nums text-neutral-800">
                    {integrationHealth.pct}%
                  </span>
                  <Badge variant="secondary" className="shrink-0 text-xs font-medium">
                    {integrationHealth.label}
                  </Badge>
                </>
              )}
            </div>
            <Link
              href="/dashboard/integrations"
              className="text-sm font-medium text-teal-700 hover:text-teal-800 hover:underline sm:shrink-0"
            >
              Manage →
            </Link>
          </div>
        </div>

        {/* Source split + Top moving products */}
        <section className="grid gap-3 sm:gap-4 xl:grid-cols-12 xl:items-stretch xl:gap-6">
          <Card className="flex min-w-0 flex-col overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm xl:col-span-5 xl:min-h-0">
            <CardHeader className={cn(cardHeaderPad, "shrink-0")}>
              <CardTitle className="text-sm font-semibold text-neutral-900 sm:text-base">
                Inventory Sources
              </CardTitle>
              <CardDescription className="text-xs text-neutral-500 sm:text-sm">
                {hasDateRange ? "Inventory added in selected range by channel" : "Inventory by channel"}
              </CardDescription>
            </CardHeader>
            <CardContent className={cn(cardPad, "flex min-h-0 flex-1 flex-col pt-0")}>
              <ChartContainer config={sourceSplitChartConfig} className="min-h-[200px] w-full flex-1 sm:min-h-[260px]">
                <BarChart data={sourceSplitData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgb(229 231 235)" />
                  <XAxis dataKey="source" tickLine={false} axisLine={false} tickMargin={8} tick={{ fontSize: 11 }} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="count" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card className="flex min-w-0 flex-col overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm xl:col-span-7 xl:min-h-0">
            <CardHeader className={cn(cardHeaderPad, "shrink-0")}>
              <CardTitle className="text-sm font-semibold text-neutral-900 sm:text-base">
                Top Moving Products
              </CardTitle>
              <CardDescription className="text-xs text-neutral-500 sm:text-sm">
                Highest shipped volume
              </CardDescription>
            </CardHeader>
            <CardContent className={cn(cardPad, "flex min-h-0 flex-1 flex-col pt-0")}>
              {shippedLoading || inventoryLoading ? (
                <Skeleton className="h-40 w-full rounded-lg" />
              ) : topMovingProducts.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">No data yet</p>
              ) : (
                <>
                  {/* Mobile cards */}
                  <div className="space-y-2 md:hidden">
                    {topMovingProducts.map((item) => (
                      <div
                        key={item.name}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-neutral-200/80 bg-neutral-50/50 px-3 py-2.5"
                      >
                        <p className="min-w-0 truncate text-sm font-medium text-neutral-900">{item.name}</p>
                        <div className="flex shrink-0 items-center gap-2">
                          <span className="text-xs tabular-nums text-neutral-600">{item.units} shipped</span>
                          <Badge
                            variant={item.stockLeft <= 10 ? "destructive" : "secondary"}
                            className="font-medium"
                          >
                            {item.stockLeft}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                  {/* Desktop table */}
                  <div className="hidden overflow-hidden rounded-xl border border-neutral-200/80 md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-neutral-200 bg-neutral-50/80 hover:bg-neutral-50/80">
                          <TableHead className="font-medium text-neutral-600">Product</TableHead>
                          <TableHead className="text-right font-medium text-neutral-600">Shipped</TableHead>
                          <TableHead className="text-right font-medium text-neutral-600">Stock</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topMovingProducts.map((item) => (
                          <TableRow key={item.name} className="border-neutral-100">
                            <TableCell className="font-medium text-neutral-900">{item.name}</TableCell>
                            <TableCell className="text-right text-neutral-600">{item.units}</TableCell>
                            <TableCell className="text-right">
                              <Badge
                                variant={item.stockLeft <= 10 ? "destructive" : "secondary"}
                                className="font-medium"
                              >
                                {item.stockLeft}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>

        {/* Recent activity */}
        <section>
          <Card className="min-w-0 overflow-hidden rounded-xl border-neutral-200/80 bg-white/90 shadow-[0_1px_3px_rgba(0,0,0,0.08)] backdrop-blur-sm">
            <CardHeader className={cardHeaderPad}>
              <CardTitle className="text-sm font-semibold text-neutral-900 sm:text-base">
                Recent activity
              </CardTitle>
              <CardDescription className="text-xs text-neutral-500 sm:text-sm">
                {hasDateRange
                  ? "Latest requests in your selected date range"
                  : "Your latest requests and updates (up to 10)"}
              </CardDescription>
            </CardHeader>
            <CardContent className={cn(cardPad, "pt-0")}>
              {activityLoading ? (
                <Skeleton className="h-[180px] w-full rounded-lg sm:h-[220px]" />
              ) : recentActivityRows.length === 0 ? (
                <p className="py-8 text-center text-sm text-neutral-500">
                  {hasDateRange ? "No activity in this date range" : "No recent activity yet"}
                </p>
              ) : (
                <>
                  <div className="space-y-2 md:hidden">
                    {recentActivityRows.map((row) => (
                      <Link
                        key={row.id}
                        href={row.href}
                        className="block min-w-0 rounded-lg border border-neutral-200/80 bg-neutral-50/50 px-3 py-2.5 transition-colors hover:bg-neutral-50"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-neutral-900">{row.type}</p>
                            <p className="mt-0.5 truncate text-xs text-neutral-600">{row.detail}</p>
                          </div>
                          <span
                            className={cn(
                              "shrink-0 inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
                              activityStatusClass(row.status)
                            )}
                          >
                            {row.status}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[11px] text-neutral-500">{row.dateLabel}</p>
                      </Link>
                    ))}
                  </div>
                  <div className="hidden overflow-x-auto rounded-lg border border-neutral-200/80 md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-neutral-200 bg-neutral-50/80 hover:bg-neutral-50/80">
                          <TableHead className="whitespace-nowrap font-medium text-neutral-600">Type</TableHead>
                          <TableHead className="font-medium text-neutral-600">Details</TableHead>
                          <TableHead className="whitespace-nowrap font-medium text-neutral-600">Date</TableHead>
                          <TableHead className="font-medium text-neutral-600">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {recentActivityRows.map((row) => (
                          <TableRow key={row.id} className="border-neutral-100">
                            <TableCell className="whitespace-nowrap font-medium text-neutral-900">
                              <Link href={row.href} className="hover:underline">
                                {row.type}
                              </Link>
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-neutral-600 sm:max-w-xs">
                              {row.detail}
                            </TableCell>
                            <TableCell className="whitespace-nowrap text-neutral-600">
                              {row.dateLabel}
                            </TableCell>
                            <TableCell>
                              <span
                                className={cn(
                                  "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
                                  activityStatusClass(row.status)
                                )}
                              >
                                {row.status}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </section>
      </div>
    </div>
  );
}
