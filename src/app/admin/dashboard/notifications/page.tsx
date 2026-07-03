"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useManagedUsers } from "@/hooks/use-managed-users";
import type {
  UserProfile,
  ShipmentRequest,
  InventoryRequest,
  ProductReturn,
  DisposeRequest,
  InboundTrackingEntry,
} from "@/types";
import { summarizeInboundTrackings } from "@/lib/inbound-tracking";
import { db } from "@/lib/firebase";
import { collection, collectionGroup, getDocs, query } from "firebase/firestore";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  format,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
} from "date-fns";
import { hasRole } from "@/lib/permissions";
import { DatePicker } from "@/components/ui/date-picker";
import { useToast } from "@/hooks/use-toast";
import { Bell, Truck, Package, RotateCcw, Trash2, User, Calendar, ChevronRight, ChevronLeft, Loader2, Eye } from "lucide-react";
import { cn } from "@/lib/utils";

type NotificationType = "shipment_request" | "inventory_request" | "product_return" | "dispose_request";
type StatusFilter = "all" | "pending" | "paid" | "approved" | "confirmed" | "rejected" | "in_progress" | "closed" | "cancelled";

type NotificationRow = {
  type: NotificationType;
  id: string;
  userId: string;
  status: string;
  createdAtMs: number;
  title: string;
  subtitle?: string;
  /** Inventory requests only — inbound carrier tracking from client inventory. */
  inboundTrackings?: InboundTrackingEntry[];
};

function cancelReasonSubtitle(reason: unknown, fallback: string): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (!text) return fallback;
  return `Reason: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`;
}

function normStatus(v: any): string {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^\w]/g, "")
    .replace(/_+/g, "_");
}

function toMs(v: any): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (typeof v === "object" && typeof v.seconds === "number") return v.seconds * 1000;
  if (v instanceof Date) return v.getTime();
  return 0;
}

function inRange(ms: number, from?: Date, to?: Date): boolean {
  if (!from && !to) return true;
  const fromMs = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0).getTime() : null;
  const toMs = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate() + 1, 0, 0, 0, 0).getTime() - 1 : null;
  if (fromMs !== null && ms < fromMs) return false;
  if (toMs !== null && ms > toMs) return false;
  return true;
}

/** Quick date-range presets for the notifications list (local calendar). Week = Monday–Sunday. */
type NotificationDateRangePreset = "all" | "today" | "this_week" | "this_month" | "this_year";

function rangeForDatePreset(preset: Exclude<NotificationDateRangePreset, "all">, now = new Date()): { from: Date; to: Date } {
  switch (preset) {
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "this_week":
      return {
        from: startOfWeek(now, { weekStartsOn: 1 }),
        to: endOfWeek(now, { weekStartsOn: 1 }),
      };
    case "this_month":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "this_year":
      return { from: startOfYear(now), to: endOfYear(now) };
  }
}

const NOTIFICATION_TYPE_URL_VALUES = new Set<string>([
  "all",
  "shipment_request",
  "inventory_request",
  "product_return",
  "dispose_request",
]);

const PERIOD_URL_VALUES = new Set<string>(["all", "today", "this_week", "this_month", "this_year"]);

function isNotificationTypeParam(v: string): v is NotificationType {
  return v === "shipment_request" || v === "inventory_request" || v === "product_return" || v === "dispose_request";
}

function statusBadgeClass(status: string): string {
  const s = normStatus(status);
  switch (s) {
    case "pending": return "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700";
    case "approved": case "confirmed": case "closed": return "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700";
    case "rejected": case "cancelled": return "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700";
    case "in_progress": return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700";
    case "paid": return "bg-violet-100 text-violet-800 border-violet-200 dark:bg-violet-900/30 dark:text-violet-300 dark:border-violet-700";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

const TRACKING_STATUS_CLASS: Record<
  ReturnType<typeof summarizeInboundTrackings>["variant"],
  string
> = {
  none: "bg-slate-100 text-slate-600 border-slate-200",
  pending: "bg-amber-50 text-amber-800 border-amber-200",
  transit: "bg-blue-50 text-blue-800 border-blue-200",
  delivered: "bg-emerald-50 text-emerald-800 border-emerald-200",
  error: "bg-red-50 text-red-800 border-red-200",
  unknown: "bg-slate-100 text-slate-600 border-slate-200",
};

function InventoryRequestTrackingLines({ trackings }: { trackings: InboundTrackingEntry[] }) {
  if (!trackings.length) return null;
  return (
    <div className="flex flex-col gap-1.5 w-full">
      {trackings.map((t) => {
        const summary = summarizeInboundTrackings([t]);
        return (
          <div
            key={t.id || t.trackingNumber}
            className="flex flex-wrap items-center gap-2 text-xs"
          >
            <span className="font-mono text-foreground">{t.trackingNumber}</span>
            <Badge
              variant="outline"
              className={cn(
                "text-[10px] font-medium",
                TRACKING_STATUS_CLASS[summary.variant]
              )}
            >
              {summary.label}
            </Badge>
          </div>
        );
      })}
    </div>
  );
}

function typeIcon(type: NotificationType) {
  switch (type) {
    case "shipment_request": return <Truck className="h-4 w-4 shrink-0" />;
    case "inventory_request": return <Package className="h-4 w-4 shrink-0" />;
    case "product_return": return <RotateCcw className="h-4 w-4 shrink-0" />;
    case "dispose_request": return <Trash2 className="h-4 w-4 shrink-0" />;
  }
}

/** True when this request type is in a terminal/completed state (hide Process button). */
function isProcessComplete(type: NotificationType, status: string): boolean {
  const s = normStatus(status);
  switch (type) {
    case "shipment_request":
      return ["confirmed", "closed", "rejected", "cancelled", "paid"].includes(s);
    case "inventory_request":
      return ["approved", "rejected", "cancelled"].includes(s);
    case "product_return":
      return ["confirmed", "closed", "rejected", "cancelled"].includes(s);
    case "dispose_request":
      return ["approved", "rejected"].includes(s);
    default:
      return false;
  }
}

export default function AdminNotificationsPage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const { managedUsers: users, managedUserIds, loading: usersLoading } = useManagedUsers();
  const canSeeAdminNotifications =
    hasRole(userProfile, "admin") ||
    hasRole(userProfile, "sub_admin") ||
    (userProfile as any)?.features?.includes?.("admin_dashboard");

  const usersById = useMemo(() => {
    const map = new Map<string, UserProfile>();
    users.forEach((u: any) => {
      const id = u?.uid || u?.id;
      if (id) map.set(String(id), u);
    });
    return map;
  }, [users]);

  const NOTIFICATION_ITEMS_PER_PAGE = 10;

  const searchParams = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const [activeTab, setActiveTab] = useState<"all" | Exclude<StatusFilter, "all">>(
    (tabFromUrl as "all" | Exclude<StatusFilter, "all">) && ["all", "pending", "paid", "approved", "confirmed", "rejected", "in_progress", "closed", "cancelled"].includes(tabFromUrl)
      ? (tabFromUrl as "all" | Exclude<StatusFilter, "all">)
      : "pending"
  );

  useEffect(() => {
    if (tabFromUrl && ["all", "pending", "paid", "approved", "confirmed", "rejected", "in_progress", "closed", "cancelled"].includes(tabFromUrl)) {
      setActiveTab(tabFromUrl as "all" | Exclude<StatusFilter, "all">);
    }
  }, [tabFromUrl]);

  const [typeFilter, setTypeFilter] = useState<"all" | NotificationType>("all");
  const [userIdFilter, setUserIdFilter] = useState<string>("all");
  const [dateRangePreset, setDateRangePreset] = useState<NotificationDateRangePreset>("all");
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date | undefined>(undefined);

  /** Deep-link filters (e.g. Today Shipped Orders KPI → ?type=shipment_request&user=all&period=today). Only applies when each param is present so ?tab=pending alone is unchanged. */
  const filterParamsKey = [
    searchParams.get("type") ?? "",
    searchParams.get("user") ?? searchParams.get("userId") ?? "",
    searchParams.get("period") ?? "",
  ].join("|");

  useEffect(() => {
    const type = searchParams.get("type");
    if (type !== null && NOTIFICATION_TYPE_URL_VALUES.has(type)) {
      setTypeFilter(type === "all" || !isNotificationTypeParam(type) ? "all" : type);
    }

    const user = searchParams.get("user") ?? searchParams.get("userId");
    if (user !== null) {
      setUserIdFilter(user === "all" || user === "" ? "all" : user);
    }

    const period = searchParams.get("period");
    if (period !== null && PERIOD_URL_VALUES.has(period)) {
      if (period === "all" || period === "") {
        setDateRangePreset("all");
        setFromDate(undefined);
        setToDate(undefined);
      } else {
        const p = period as Exclude<NotificationDateRangePreset, "all">;
        setDateRangePreset(p);
        const { from, to } = rangeForDatePreset(p);
        setFromDate(from);
        setToDate(to);
      }
    }
  }, [filterParamsKey, searchParams]);
  const [notificationPage, setNotificationPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [shipmentRequests, setShipmentRequests] = useState<NotificationRow[]>([]);
  const [inventoryRequests, setInventoryRequests] = useState<NotificationRow[]>([]);
  const [productReturns, setProductReturns] = useState<NotificationRow[]>([]);
  const [disposeRequests, setDisposeRequests] = useState<NotificationRow[]>([]);

  const router = useRouter();

  useEffect(() => {
    if (!canSeeAdminNotifications) return;

    const userIds = users
      .map((u: any) => String(u?.uid || u?.id || ""))
      .filter((id) => id && id.trim() !== "");

    const run = async () => {
      setLoading(true);
      try {
        let anyFailed = false;

        // Shipment Requests
        {
          try {
            const base = collectionGroup(db, "shipmentRequests");
            const q = query(base);
            const snap = await getDocs(q);
            const rows: NotificationRow[] = snap.docs.map((d) => {
              const userId = d.ref.path.split("/")[1];
              const data = d.data() as any as ShipmentRequest;
              const dateMs = toMs((data as any).requestedAt) || toMs((data as any).date) || 0;
              const shipTo = (data as any).shipTo || "";
              return {
                type: "shipment_request",
                id: d.id,
                userId,
                status: String((data as any).status || ""),
                createdAtMs: dateMs,
                title: `Shipment Request • ${shipTo ? shipTo.substring(0, 40) : "N/A"}`,
                subtitle:
                  String((data as any).status || "").toLowerCase() === "cancelled"
                    ? cancelReasonSubtitle(
                        (data as any).cancellationReason,
                        `Items: ${(data as any).shipments?.length ?? 0}`
                      )
                    : `Items: ${(data as any).shipments?.length ?? 0}`,
              };
            });
            setShipmentRequests(rows);
          } catch (e) {
            // Fallback per-user (avoids collectionGroup limitations)
            anyFailed = true;
            const results = await Promise.all(userIds.map(async (uid) => {
              const base = collection(db, `users/${uid}/shipmentRequests`);
              const q = query(base);
              const snap = await getDocs(q);
              return snap.docs.map((d) => {
                const data = d.data() as any as ShipmentRequest;
                const dateMs = toMs((data as any).requestedAt) || toMs((data as any).date) || 0;
                const shipTo = (data as any).shipTo || "";
                const row: NotificationRow = {
                  type: "shipment_request",
                  id: d.id,
                  userId: uid,
                  status: String((data as any).status || ""),
                  createdAtMs: dateMs,
                  title: `Shipment Request • ${shipTo ? shipTo.substring(0, 40) : "N/A"}`,
                  subtitle:
                    String((data as any).status || "").toLowerCase() === "cancelled"
                      ? cancelReasonSubtitle(
                          (data as any).cancellationReason,
                          `Items: ${(data as any).shipments?.length ?? 0}`
                        )
                      : `Items: ${(data as any).shipments?.length ?? 0}`,
                };
                return row;
              });
            }));
            setShipmentRequests(results.flat());
          }
        }

        // Inventory Requests
        {
          try {
            const base = collectionGroup(db, "inventoryRequests");
            const q = query(base);
            const snap = await getDocs(q);
            const rows: NotificationRow[] = snap.docs.map((d) => {
              const userId = d.ref.path.split("/")[1];
              const data = d.data() as any as InventoryRequest;
              const dateMs = toMs((data as any).requestedAt) || toMs((data as any).addDate) || 0;
              const productName = (data as any).productName || (data as any).newProductName || "Inventory Request";
              return {
                type: "inventory_request",
                id: d.id,
                userId,
                status: String((data as any).status || ""),
                createdAtMs: dateMs,
                title: `Inventory Request • ${String(productName).substring(0, 50)}`,
                subtitle:
                  String((data as any).status || "").toLowerCase() === "cancelled"
                    ? cancelReasonSubtitle(
                        (data as any).cancellationReason,
                        `Qty: ${(data as any).quantity ?? (data as any).requestedQty ?? "N/A"}`
                      )
                    : `Qty: ${(data as any).quantity ?? (data as any).requestedQty ?? "N/A"}`,
                inboundTrackings: Array.isArray((data as any).inboundTrackings)
                  ? ((data as any).inboundTrackings as InboundTrackingEntry[])
                  : undefined,
              };
            });
            setInventoryRequests(rows);
          } catch (e) {
            anyFailed = true;
            const results = await Promise.all(userIds.map(async (uid) => {
              const base = collection(db, `users/${uid}/inventoryRequests`);
              const q = query(base);
              const snap = await getDocs(q);
              return snap.docs.map((d) => {
                const data = d.data() as any as InventoryRequest;
                const dateMs = toMs((data as any).requestedAt) || toMs((data as any).addDate) || 0;
                const productName = (data as any).productName || (data as any).newProductName || "Inventory Request";
                const row: NotificationRow = {
                  type: "inventory_request",
                  id: d.id,
                  userId: uid,
                  status: String((data as any).status || ""),
                  createdAtMs: dateMs,
                  title: `Inventory Request • ${String(productName).substring(0, 50)}`,
                  subtitle:
                    String((data as any).status || "").toLowerCase() === "cancelled"
                      ? cancelReasonSubtitle(
                          (data as any).cancellationReason,
                          `Qty: ${(data as any).quantity ?? (data as any).requestedQty ?? "N/A"}`
                        )
                      : `Qty: ${(data as any).quantity ?? (data as any).requestedQty ?? "N/A"}`,
                  inboundTrackings: Array.isArray((data as any).inboundTrackings)
                    ? ((data as any).inboundTrackings as InboundTrackingEntry[])
                    : undefined,
                };
                return row;
              });
            }));
            setInventoryRequests(results.flat());
          }
        }

        // Product Returns
        {
          try {
            const base = collectionGroup(db, "productReturns");
            const q = query(base);
            const snap = await getDocs(q);
            const rows: NotificationRow[] = snap.docs.map((d) => {
              const userId = d.ref.path.split("/")[1];
              const data = d.data() as any as ProductReturn;
              const dateMs = toMs((data as any).createdAt) || toMs((data as any).updatedAt) || 0;
              const productName = (data as any).productName || (data as any).newProductName || "Product Return";
              return {
                type: "product_return",
                id: d.id,
                userId,
                status: String((data as any).status || ""),
                createdAtMs: dateMs,
                title: `Product Return • ${String(productName).substring(0, 50)}`,
                subtitle: `Req: ${(data as any).requestedQuantity ?? "N/A"} | Rec: ${(data as any).receivedQuantity ?? 0}`,
              };
            });
            setProductReturns(rows);
          } catch (e) {
            anyFailed = true;
            const results = await Promise.all(userIds.map(async (uid) => {
              const base = collection(db, `users/${uid}/productReturns`);
              const q = query(base);
              const snap = await getDocs(q);
              return snap.docs.map((d) => {
                const data = d.data() as any as ProductReturn;
                const dateMs = toMs((data as any).createdAt) || toMs((data as any).updatedAt) || 0;
                const productName = (data as any).productName || (data as any).newProductName || "Product Return";
                const row: NotificationRow = {
                  type: "product_return",
                  id: d.id,
                  userId: uid,
                  status: String((data as any).status || ""),
                  createdAtMs: dateMs,
                  title: `Product Return • ${String(productName).substring(0, 50)}`,
                  subtitle: `Req: ${(data as any).requestedQuantity ?? "N/A"} | Rec: ${(data as any).receivedQuantity ?? 0}`,
                };
                return row;
              });
            }));
            setProductReturns(results.flat());
          }
        }

        // Dispose Requests (per-user; no collectionGroup for disposeRequests)
        {
          try {
            const results = await Promise.all(userIds.map(async (uid) => {
              const base = collection(db, `users/${uid}/disposeRequests`);
              const q = query(base);
              const snap = await getDocs(q);
              return snap.docs.map((d) => {
                const data = d.data() as any as DisposeRequest;
                const dateMs = toMs(data.requestedAt) || 0;
                return {
                  type: "dispose_request" as const,
                  id: d.id,
                  userId: uid,
                  status: String(data.status || ""),
                  createdAtMs: dateMs,
                  title: `Dispose Request • ${String(data.productName || "").substring(0, 40)}`,
                  subtitle: `Qty: ${data.quantity ?? 0} • ${(data.reason || "").substring(0, 30)}`,
                };
              });
            }));
            setDisposeRequests(results.flat());
          } catch (e) {
            console.warn("Notifications: Could not fetch dispose requests.", e);
            setDisposeRequests([]);
          }
        }

        // Note: If anyFailed is true, we used per-user fallback instead of collectionGroup
        // This is expected when collectionGroup queries are blocked by Firestore security rules
        // The fallback works correctly and loads all notifications
        if (anyFailed) {
          console.log("Notifications: Using per-user fallback (collectionGroup queries not available)");
        }
      } catch (err) {
        console.error("Notifications: Error loading notifications.", err);
        setShipmentRequests((prev) => prev.length ? prev : []);
        setInventoryRequests((prev) => prev.length ? prev : []);
        setProductReturns((prev) => prev.length ? prev : []);
        setDisposeRequests([]);
      } finally {
        setLoading(false);
      }
    };

    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userProfile, users, managedUserIds, toast]);

  const allRows = useMemo(() => {
    return [...shipmentRequests, ...inventoryRequests, ...productReturns, ...disposeRequests]
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  }, [shipmentRequests, inventoryRequests, productReturns, disposeRequests]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: allRows.length };
    const statuses: Exclude<StatusFilter, "all">[] = ["pending", "paid", "approved", "confirmed", "rejected", "in_progress", "closed", "cancelled"];
    statuses.forEach((s) => {
      counts[s] = allRows.filter((r) => normStatus(r.status) === s).length;
    });
    return counts;
  }, [allRows]);

  const filteredRows = useMemo(() => {
    const byTab = (r: NotificationRow) => activeTab === "all" ? true : normStatus(r.status) === activeTab;
    const byType = (r: NotificationRow) => typeFilter === "all" ? true : r.type === typeFilter;
    const byUser = (r: NotificationRow) => {
      if (!userIdFilter || userIdFilter === "all") return true;
      return r.userId === userIdFilter;
    };
    const byDate = (r: NotificationRow) => inRange(r.createdAtMs, fromDate, toDate);

    return allRows.filter((r) => byTab(r) && byType(r) && byUser(r) && byDate(r));
  }, [activeTab, allRows, fromDate, toDate, typeFilter, userIdFilter]);

  // Reset to page 1 when filters or tab change
  useEffect(() => {
    setNotificationPage(1);
  }, [activeTab, typeFilter, userIdFilter, fromDate, toDate, dateRangePreset]);

  const onDateRangePresetChange = (value: NotificationDateRangePreset) => {
    setDateRangePreset(value);
    if (value === "all") {
      setFromDate(undefined);
      setToDate(undefined);
      return;
    }
    const { from, to } = rangeForDatePreset(value);
    setFromDate(from);
    setToDate(to);
  };

  const paginatedResult = useMemo(() => {
    const totalPages = Math.max(1, Math.ceil(filteredRows.length / NOTIFICATION_ITEMS_PER_PAGE));
    const startIndex = (notificationPage - 1) * NOTIFICATION_ITEMS_PER_PAGE;
    const paginatedRows = filteredRows.slice(startIndex, startIndex + NOTIFICATION_ITEMS_PER_PAGE);
    const endIndex = Math.min(startIndex + NOTIFICATION_ITEMS_PER_PAGE, filteredRows.length);
    return { paginatedRows, totalPages, startIndex, endIndex };
  }, [filteredRows, notificationPage]);

  const openRequest = (row: NotificationRow, viewOnly: boolean) => {
    const params = new URLSearchParams({
      userId: row.userId,
      section: "user-requests",
      tab: row.type,
      requestId: row.id,
    });
    if (viewOnly) params.set("view", "1");
    router.push(`/admin/dashboard/inventory?${params.toString()}`);
  };

  const renderList = (rows: NotificationRow[]) => (
    <div className="space-y-3 sm:space-y-2">
      {rows.map((r) => {
        const u = usersById.get(r.userId);
        const date = r.createdAtMs ? format(new Date(r.createdAtMs), "PP") : "N/A";
        return (
          <div
            key={`${r.type}-${r.userId}-${r.id}`}
            className={cn(
              "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-xl border bg-card p-4 shadow-sm transition-shadow hover:shadow-md",
              "min-h-[44px] touch-manipulation"
            )}
          >
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2 gap-y-1">
                <span className="text-muted-foreground">{typeIcon(r.type)}</span>
                <span className="font-semibold text-foreground truncate text-sm sm:text-base">{r.title}</span>
                <Badge variant="outline" className={cn("shrink-0 text-xs font-medium border", statusBadgeClass(r.status))}>
                  {r.status}
                </Badge>
                <Badge variant="outline" className="shrink-0 text-xs bg-muted/50">
                  {r.type === "shipment_request" ? "Shipment" : r.type === "inventory_request" ? "Inventory" : r.type === "product_return" ? "Return" : "Dispose"}
                </Badge>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <User className="h-3.5 w-3.5 shrink-0" />
                  {u?.name || "Unknown"}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 shrink-0" />
                  {date}
                </span>
                {r.subtitle && <span className="w-full sm:w-auto">{r.subtitle}</span>}
              </div>
              {r.type === "inventory_request" && (r.inboundTrackings?.length ?? 0) > 0 ? (
                <InventoryRequestTrackingLines trackings={r.inboundTrackings!} />
              ) : null}
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
              {!isProcessComplete(r.type, r.status) ? (
                <Button
                  size="sm"
                  variant="default"
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-9 shrink-0 gap-1"
                  onClick={() => openRequest(r, false)}
                >
                  Process
                  <ChevronRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="w-full sm:w-auto min-h-[44px] sm:min-h-9 shrink-0 gap-1"
                  onClick={() => openRequest(r, true)}
                >
                  <Eye className="h-4 w-4" />
                  View
                </Button>
              )}
            </div>
          </div>
        );
      })}
      {rows.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          {loading ? (
            <Loader2 className="h-10 w-10 animate-spin text-muted-foreground mb-3" />
          ) : (
            <Bell className="h-10 w-10 text-muted-foreground/50 mb-3" />
          )}
          <p className="text-sm text-muted-foreground">
          {loading ? "Loading..." : "No notifications found."}
          </p>
        </div>
      )}
    </div>
  );

  const paginationUI = filteredRows.length > NOTIFICATION_ITEMS_PER_PAGE ? (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-4 pt-4 border-t">
      <div className="text-xs sm:text-sm text-muted-foreground text-center sm:text-left">
        Showing {paginatedResult.startIndex + 1}–{paginatedResult.endIndex} of {filteredRows.length}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] sm:min-h-9"
          onClick={() => setNotificationPage((p) => Math.max(1, p - 1))}
          disabled={notificationPage === 1}
        >
          <ChevronLeft className="h-4 w-4" /> Previous
        </Button>
        <span className="text-sm tabular-nums px-1">{notificationPage} / {paginatedResult.totalPages}</span>
        <Button
          variant="outline"
          size="sm"
          className="min-h-[44px] sm:min-h-9"
          onClick={() => setNotificationPage((p) => Math.min(paginatedResult.totalPages, p + 1))}
          disabled={notificationPage >= paginatedResult.totalPages}
        >
          Next <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <div className="space-y-4 sm:space-y-6 p-2 sm:p-0">
      <Card className="overflow-hidden border-2 shadow-lg">
        <CardHeader className="bg-gradient-to-r from-indigo-600 via-violet-600 to-purple-600 text-white pb-6 pt-6 sm:pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/20 backdrop-blur-sm">
                <Bell className="h-7 w-7" />
              </div>
              <div>
                <CardTitle className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                  Notifications
          </CardTitle>
                <CardDescription className="text-indigo-100 mt-0.5 text-sm">
                  Process shipment, inventory & return requests
                </CardDescription>
              </div>
            </div>
            <Badge variant="secondary" className="w-fit bg-white/20 text-white border-white/30 text-sm font-semibold px-3 py-1.5">
              Total: {allRows.length}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 sm:space-y-5 pt-4 sm:pt-5">
          {/* Filters: Type, User, Period preset, manual From/To */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Type</label>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
                <SelectTrigger className="w-full min-h-[44px] sm:min-h-10">
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="shipment_request">Shipment Requests</SelectItem>
                  <SelectItem value="inventory_request">Inventory Requests</SelectItem>
                  <SelectItem value="product_return">Product Returns</SelectItem>
                  <SelectItem value="dispose_request">Dispose Requests</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">User</label>
              <Select value={userIdFilter} onValueChange={setUserIdFilter}>
                <SelectTrigger className="w-full min-h-[44px] sm:min-h-10">
                  <SelectValue placeholder="All users" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All users</SelectItem>
                  {Array.from(usersById.entries())
                    .sort((a, b) => ((a[1].name || "").toLowerCase()).localeCompare((b[1].name || "").toLowerCase()))
                    .map(([id, u]) => (
                      <SelectItem key={id} value={id}>
                        <span className="truncate">{(u.name || "Unknown")} {u.email ? `(${u.email})` : ""}</span>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Period</label>
              <Select value={dateRangePreset} onValueChange={(v) => onDateRangePresetChange(v as NotificationDateRangePreset)}>
                <SelectTrigger className="w-full min-h-[44px] sm:min-h-10">
                  <SelectValue placeholder="Period" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All time</SelectItem>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="this_week">This week</SelectItem>
                  <SelectItem value="this_month">This month</SelectItem>
                  <SelectItem value="this_year">This year</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:col-span-2 lg:col-span-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <DatePicker
                  date={fromDate}
                  setDate={(d) => {
                    setDateRangePreset("all");
                    setFromDate(d);
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <DatePicker
                  date={toDate}
                  setDate={(d) => {
                    setDateRangePreset("all");
                    setToDate(d);
                  }}
                />
              </div>
            </div>
          </div>

          {/* Status tabs: horizontal scroll on mobile/tablet, wrap on large screens */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "all" | Exclude<StatusFilter, "all">)} className="w-full">
            <ScrollArea className="w-full rounded-lg border bg-muted/30 p-1 md:overflow-visible">
              <TabsList className="inline-flex h-auto w-max gap-1 bg-transparent p-0 md:flex-wrap md:min-w-0">
                <TabsTrigger value="all" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-slate-300 data-[state=active]:bg-slate-100 data-[state=active]:text-slate-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-slate-700 dark:data-[state=active]:bg-slate-900/40 dark:data-[state=active]:text-slate-100">
                  All <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.all}</Badge>
                </TabsTrigger>
                <TabsTrigger value="pending" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-amber-300 data-[state=active]:bg-amber-100 data-[state=active]:text-amber-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-amber-700 dark:data-[state=active]:bg-amber-900/30 dark:data-[state=active]:text-amber-200">
                  Pending <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.pending ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="approved" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-emerald-300 data-[state=active]:bg-emerald-100 data-[state=active]:text-emerald-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-emerald-700 dark:data-[state=active]:bg-emerald-900/30 dark:data-[state=active]:text-emerald-200">
                  Approved <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.approved ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="in_progress" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-blue-300 data-[state=active]:bg-blue-100 data-[state=active]:text-blue-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-blue-700 dark:data-[state=active]:bg-blue-900/30 dark:data-[state=active]:text-blue-200">
                  In Progress <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.in_progress ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="confirmed" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-green-300 data-[state=active]:bg-green-100 data-[state=active]:text-green-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-green-700 dark:data-[state=active]:bg-green-900/30 dark:data-[state=active]:text-green-200">
                  Confirmed <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.confirmed ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="rejected" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-red-300 data-[state=active]:bg-red-100 data-[state=active]:text-red-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-red-700 dark:data-[state=active]:bg-red-900/30 dark:data-[state=active]:text-red-200">
                  Rejected <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.rejected ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="closed" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-zinc-300 data-[state=active]:bg-zinc-100 data-[state=active]:text-zinc-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-zinc-700 dark:data-[state=active]:bg-zinc-900/40 dark:data-[state=active]:text-zinc-200">
                  Closed <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.closed ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="cancelled" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-rose-300 data-[state=active]:bg-rose-100 data-[state=active]:text-rose-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-rose-700 dark:data-[state=active]:bg-rose-900/30 dark:data-[state=active]:text-rose-200">
                  Cancelled <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.cancelled ?? 0}</Badge>
                </TabsTrigger>
                <TabsTrigger value="paid" className="flex-shrink-0 rounded-md border border-transparent px-3 py-2 text-xs sm:text-sm data-[state=active]:border-violet-300 data-[state=active]:bg-violet-100 data-[state=active]:text-violet-900 data-[state=active]:shadow-sm dark:data-[state=active]:border-violet-700 dark:data-[state=active]:bg-violet-900/30 dark:data-[state=active]:text-violet-200">
                  Paid <Badge variant="secondary" className="ml-1.5 text-[10px] sm:text-xs">{statusCounts.paid ?? 0}</Badge>
                </TabsTrigger>
            </TabsList>
              <ScrollBar orientation="horizontal" />
            </ScrollArea>

            <TabsContent value="all" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="pending" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="approved" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="in_progress" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="confirmed" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="rejected" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="closed" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="cancelled" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
            <TabsContent value="paid" className="mt-4 focus-visible:outline-none">
              {renderList(paginatedResult.paginatedRows)}
              {paginationUI}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

