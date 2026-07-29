"use client";

import { useMemo, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { format } from "date-fns";
import { Loader2, Package, Plus, Search, ShieldAlert, X } from "lucide-react";

import { db } from "@/lib/firebase";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { QuarantineRequestDialog } from "@/components/inventory/quarantine-request-dialog";
import {
  QUARANTINE_REQUESTS,
  cancelQuarantineRequest,
  openQuarantineProductIds,
  quarantineRequestKindLabel,
  requestSortMs,
} from "@/lib/quarantine-request-ops";
import type { InventoryItem, QuarantineRequest } from "@/types";

const STATUS_CLASS: Record<QuarantineRequest["status"], string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  approved: "bg-sky-100 text-sky-900 border-sky-200",
  completed: "bg-emerald-100 text-emerald-900 border-emerald-200",
  rejected: "bg-red-100 text-red-900 border-red-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

const STATUS_HELP: Record<QuarantineRequest["status"], string> = {
  pending: "Waiting for approval",
  approved: "Approved — warehouse is moving the stock",
  completed: "Done — stock has been moved",
  rejected: "Declined",
  cancelled: "Withdrawn",
};

function formatWhen(value: QuarantineRequest["requestedAt"]): string {
  if (!value) return "—";
  const ms = typeof value === "string" ? new Date(value).getTime() : (value.seconds ?? 0) * 1000;
  if (!ms || Number.isNaN(ms)) return "—";
  return format(new Date(ms), "MMM dd, yyyy · h:mm a");
}

function formatInventoryWhen(
  value: InventoryItem["quarantineAt"] | InventoryItem["receivingDate"] | InventoryItem["dateAdded"]
): string {
  if (!value) return "—";
  const ms =
    value instanceof Date
      ? value.getTime()
      : typeof value === "string"
        ? new Date(value).getTime()
        : (value.seconds ?? 0) * 1000;
  if (!ms || Number.isNaN(ms)) return "—";
  return format(new Date(ms), "MMM dd, yyyy · h:mm a");
}

export default function QuarantinePage() {
  const { userProfile } = useAuth();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  const uid = userProfile?.uid ?? "";

  const { data: inventory, loading: inventoryLoading } = useCollection<InventoryItem>(
    uid ? `users/${uid}/inventory` : ""
  );

  const requestsQuery = useMemo(
    () =>
      uid
        ? query(collection(db, QUARANTINE_REQUESTS), where("userId", "==", uid))
        : undefined,
    [uid]
  );
  const { data: requests, loading: requestsLoading } = useCollection<QuarantineRequest>(
    uid ? QUARANTINE_REQUESTS : "",
    requestsQuery
  );

  const sortedRequests = useMemo(
    () => [...requests].sort((a, b) => requestSortMs(b) - requestSortMs(a)),
    [requests]
  );
  const openIds = useMemo(() => openQuarantineProductIds(requests), [requests]);

  const quarantinedItems = useMemo(
    () =>
      inventory
        .filter((item) => (Number(item.damagedQuantity) || 0) > 0)
        .sort((a, b) => (Number(b.damagedQuantity) || 0) - (Number(a.damagedQuantity) || 0)),
    [inventory]
  );

  const totalQuarantined = quarantinedItems.reduce(
    (sum, item) => sum + (Number(item.damagedQuantity) || 0),
    0
  );
  const openCount = sortedRequests.filter(
    (r) => r.status === "pending" || r.status === "approved"
  ).length;

  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedRequests;
    return sortedRequests.filter((r) =>
      `${r.productName} ${r.sku} ${r.reason} ${r.status}`.toLowerCase().includes(q)
    );
  }, [search, sortedRequests]);

  const handleCancel = async (request: QuarantineRequest) => {
    setCancellingId(request.id);
    try {
      await cancelQuarantineRequest(request.id);
      toast({
        title: "Request withdrawn",
        description: `Your request for "${request.productName}" was cancelled.`,
      });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not cancel request",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-amber-500 to-orange-600 text-white pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <ShieldAlert className="h-6 w-6" />
                Quarantine
              </CardTitle>
              <CardDescription className="text-amber-50 mt-2">
                Hold stock away from orders, release it back, or scrap it — the warehouse does the
                physical move once your request is approved.
              </CardDescription>
            </div>
            <Button
              variant="secondary"
              className="bg-white/20 text-white border border-white/30 hover:bg-white/30"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1" />
              New request
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 space-y-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-lg border bg-amber-50/60 p-4">
              <p className="text-xs font-medium text-amber-800">Units in quarantine</p>
              <p className="text-2xl font-bold text-amber-900">{totalQuarantined}</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-4">
              <p className="text-xs font-medium text-slate-600">Products affected</p>
              <p className="text-2xl font-bold text-slate-900">{quarantinedItems.length}</p>
            </div>
            <div className="rounded-lg border bg-sky-50 p-4">
              <p className="text-xs font-medium text-sky-700">Requests in progress</p>
              <p className="text-2xl font-bold text-sky-900">{openCount}</p>
            </div>
          </div>

          <Tabs defaultValue="stock" className="w-full">
            <TabsList className="mb-6">
              <TabsTrigger value="stock">
                Quarantined stock ({quarantinedItems.length})
              </TabsTrigger>
              <TabsTrigger value="requests">
                My requests ({sortedRequests.length})
                {openCount > 0 ? (
                  <Badge className="ml-2 bg-amber-500 text-white text-[10px]">
                    {openCount} open
                  </Badge>
                ) : null}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stock" className="mt-0">
              {inventoryLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 bg-muted animate-pulse rounded-xl" />
                  ))}
                </div>
              ) : quarantinedItems.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50/30 overflow-hidden">
                  <Table containerClassName="overflow-x-auto mouse-h-scroll">
                    <TableHeader className="bg-amber-100/70">
                      <TableRow>
                        <TableHead className="min-w-[260px]">Product</TableHead>
                        <TableHead className="min-w-[140px]">SKU</TableHead>
                        <TableHead className="min-w-[140px]">In quarantine</TableHead>
                        <TableHead className="min-w-[140px]">Sellable</TableHead>
                        <TableHead className="min-w-[210px]">Date &amp; time</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {quarantinedItems.map((item) => (
                        <TableRow key={item.id} className="bg-white/70">
                          <TableCell className="font-semibold text-slate-900">
                            {item.productName}
                          </TableCell>
                          <TableCell className="text-slate-700">{item.sku || "—"}</TableCell>
                          <TableCell>
                            <Badge className="bg-amber-500 text-white text-[10px]">
                              {item.damagedQuantity} units
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-700">{item.quantity}</TableCell>
                          <TableCell className="text-slate-700 whitespace-nowrap">
                            {formatInventoryWhen(
                              item.quarantineAt ?? item.receivingDate ?? item.dateAdded
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="mx-auto h-20 w-20 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                    <Package className="h-10 w-10 text-amber-600" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">Nothing in quarantine</h3>
                  <p className="text-muted-foreground mb-4">
                    None of your stock is currently on hold at the warehouse.
                  </p>
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    Request quarantine
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="requests" className="mt-0 space-y-4">
              <div className="relative max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search product, SKU, reason…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-10 h-11 shadow-sm"
                />
                {search ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                    onClick={() => setSearch("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                ) : null}
              </div>

              {requestsLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-20 bg-muted animate-pulse rounded-xl" />
                  ))}
                </div>
              ) : filteredRequests.length > 0 ? (
                <div className="rounded-lg border overflow-hidden">
                  <Table containerClassName="overflow-x-auto mouse-h-scroll">
                    <TableHeader className="bg-muted/60">
                      <TableRow>
                        <TableHead className="min-w-[240px]">Product</TableHead>
                        <TableHead className="min-w-[170px]">Action</TableHead>
                        <TableHead className="min-w-[90px]">Qty</TableHead>
                        <TableHead className="min-w-[220px]">Reason</TableHead>
                        <TableHead className="min-w-[180px]">Requested</TableHead>
                        <TableHead className="min-w-[150px]">Status</TableHead>
                        <TableHead className="min-w-[260px]">Warehouse outcome</TableHead>
                        <TableHead className="min-w-[120px] text-right">Action</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRequests.map((request) => (
                        <TableRow key={request.id}>
                          <TableCell className="font-semibold text-slate-900">
                            {request.productName}
                            {request.sku ? (
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                SKU {request.sku}
                              </span>
                            ) : null}
                            {request.onBehalf ? (
                              <span className="block text-[11px] font-normal text-muted-foreground">
                                Filed by {request.requestedByName || "admin"} on your behalf
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="text-slate-700">
                            {quarantineRequestKindLabel(request.kind)}
                          </TableCell>
                          <TableCell>{request.quantity}</TableCell>
                          <TableCell className="text-slate-700">{request.reason}</TableCell>
                          <TableCell className="text-slate-700">
                            {formatWhen(request.requestedAt)}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={`text-[10px] capitalize ${STATUS_CLASS[request.status]}`}
                              title={STATUS_HELP[request.status]}
                            >
                              {request.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-slate-700 text-xs">
                            {request.status === "completed" ? (
                              <div className="space-y-0.5">
                                <p className="font-medium text-emerald-800">
                                  {request.completedQty ?? request.quantity} units moved
                                </p>
                                {request.destBinPath || request.destAreaCode ? (
                                  <p>
                                    Location {request.destBinPath || request.destAreaCode}
                                    {request.warehouseCode ? ` · ${request.warehouseCode}` : ""}
                                  </p>
                                ) : null}
                                <p className="text-muted-foreground">
                                  by {request.completedByName || "warehouse"} ·{" "}
                                  {formatWhen(request.completedAt)}
                                </p>
                              </div>
                            ) : request.status === "rejected" ? (
                              request.adminFeedback || "No reason given"
                            ) : request.status === "approved" ? (
                              `Approved by ${request.approvedByName || "admin"} — awaiting the floor`
                            ) : (
                              "—"
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {request.status === "pending" || request.status === "approved" ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleCancel(request)}
                                disabled={cancellingId === request.id}
                              >
                                {cancellingId === request.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  "Withdraw"
                                )}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <div className="text-center py-16">
                  <div className="mx-auto h-20 w-20 rounded-full bg-amber-100 flex items-center justify-center mb-4">
                    <ShieldAlert className="h-10 w-10 text-amber-600" />
                  </div>
                  <h3 className="text-xl font-bold mb-2">
                    {sortedRequests.length === 0
                      ? "No quarantine requests yet"
                      : "No requests match your search"}
                  </h3>
                  <p className="text-muted-foreground mb-4">
                    Raise a request and the warehouse will move the stock once it is approved.
                  </p>
                  <Button onClick={() => setDialogOpen(true)}>
                    <Plus className="h-4 w-4 mr-1" />
                    New request
                  </Button>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {userProfile ? (
        <QuarantineRequestDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          userId={userProfile.uid}
          userName={userProfile.name || userProfile.email || "Client"}
          inventory={inventory}
          submitterUid={userProfile.uid}
          submitterName={userProfile.name || "User"}
          openProductIds={openIds}
        />
      ) : null}
    </div>
  );
}
