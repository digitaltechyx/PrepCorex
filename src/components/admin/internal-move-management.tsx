"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  ArrowRightLeft,
  Check,
  Loader2,
  Plus,
  Search,
  X,
  Eye,
  Warehouse,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { useToast } from "@/hooks/use-toast";
import { hasRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import {
  cancelInternalMoveRequest,
  createInternalMoveRequest,
  internalMoveRequestsPath,
  processInternalMoveRequest,
  qtyAtLocation,
} from "@/lib/internal-move-ops";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type {
  InternalMoveRequest,
  InternalMoveUserScope,
  InventoryItem,
  Location,
  WarehouseDoc,
} from "@/types";

function toMs(v: InternalMoveRequest["createdAt"]): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof (v as { seconds?: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function formatWhen(v: InternalMoveRequest["createdAt"]): string {
  const ms = toMs(v);
  if (!ms) return "—";
  return format(new Date(ms), "PP p");
}

const STATUS_CLASS: Record<InternalMoveRequest["status"], string> = {
  pending: "bg-amber-100 text-amber-900 border-amber-200",
  in_progress: "bg-blue-100 text-blue-900 border-blue-200",
  awaiting_putaway: "bg-indigo-100 text-indigo-900 border-indigo-200",
  completed: "bg-emerald-100 text-emerald-900 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-700 border-slate-200",
};

type DraftLine = {
  key: string;
  userId: string;
  userName: string;
  inventoryId: string;
  productName: string;
  sku: string;
  quantity: number;
  maxQty: number;
};

export function InternalMoveManagement() {
  const { toast } = useToast();
  const { userProfile: adminProfile } = useAuth();
  const { managedUsers, loading: usersLoading } = useManagedUsers();
  const { data: locations } = useCollection<Location>("locations");
  const { data: warehouses } = useCollection<WarehouseDoc>("warehouses");
  const { data: requests, loading: requestsLoading } = useCollection<InternalMoveRequest>(
    internalMoveRequestsPath()
  );

  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [viewRequest, setViewRequest] = useState<InternalMoveRequest | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);

  // Create form state
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [userScope, setUserScope] = useState<InternalMoveUserScope>("one");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [userSearch, setUserSearch] = useState("");
  const [reason, setReason] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Product picker
  const [pickerUserId, setPickerUserId] = useState("");
  const [inventoryByUser, setInventoryByUser] = useState<Record<string, InventoryItem[]>>({});
  const [loadingInventory, setLoadingInventory] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [pickQty, setPickQty] = useState("1");

  const activeLocations = useMemo(
    () => locations.filter((l) => l.active !== false).sort((a, b) => a.name.localeCompare(b.name)),
    [locations]
  );

  const warehouseByLocation = useMemo(() => {
    const map = new Map<string, WarehouseDoc>();
    for (const w of warehouses) {
      const linked = String(w.linkedLocationId || "").trim();
      if (linked) map.set(linked, w);
    }
    return map;
  }, [warehouses]);

  const selectableUsers = useMemo(() => {
    return managedUsers
      .filter((u) => {
        if (hasRole(u, "admin")) return false;
        const isApproved = u.status === "approved" || !u.status;
        return isApproved && u.status !== "deleted";
      })
      .sort((a, b) =>
        formatUserDisplayName(a).toLowerCase().localeCompare(formatUserDisplayName(b).toLowerCase())
      );
  }, [managedUsers]);

  const resolvedUserIds = useMemo(() => {
    if (userScope === "all") return selectableUsers.map((u) => u.uid);
    return Array.from(selectedUserIds);
  }, [userScope, selectedUserIds, selectableUsers]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return selectableUsers;
    return selectableUsers.filter((u) => {
      const name = formatUserDisplayName(u).toLowerCase();
      const email = (u.email || "").toLowerCase();
      return name.includes(q) || email.includes(q);
    });
  }, [selectableUsers, userSearch]);

  useEffect(() => {
    if (!createOpen) return;
    if (userScope === "one" && selectedUserIds.size > 1) {
      const first = Array.from(selectedUserIds)[0];
      setSelectedUserIds(new Set(first ? [first] : []));
    }
  }, [userScope, createOpen, selectedUserIds]);

  useEffect(() => {
    if (!pickerUserId && resolvedUserIds.length === 1) {
      setPickerUserId(resolvedUserIds[0]);
    }
  }, [resolvedUserIds, pickerUserId]);

  // Load inventory for selected users when from-site is set
  useEffect(() => {
    if (!createOpen || !fromLocationId || resolvedUserIds.length === 0) return;
    let cancelled = false;
    setLoadingInventory(true);
    void (async () => {
      const next: Record<string, InventoryItem[]> = { ...inventoryByUser };
      for (const uid of resolvedUserIds) {
        if (next[uid]) continue;
        try {
          const snap = await getDocs(collection(db, `users/${uid}/inventory`));
          next[uid] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as InventoryItem));
        } catch {
          next[uid] = [];
        }
      }
      if (!cancelled) {
        setInventoryByUser(next);
        setLoadingInventory(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen, fromLocationId, resolvedUserIds.join("|")]);

  const pickerInventory = useMemo(() => {
    if (!pickerUserId || !fromLocationId) return [];
    const items = inventoryByUser[pickerUserId] || [];
    const q = productSearch.trim().toLowerCase();
    return items
      .filter((item) => qtyAtLocation(item, fromLocationId) > 0)
      .filter((item) => {
        if (!q) return true;
        return (
          item.productName.toLowerCase().includes(q) ||
          (item.sku || "").toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.productName.localeCompare(b.productName));
  }, [pickerUserId, fromLocationId, inventoryByUser, productSearch]);

  const sortedRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...requests]
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .filter((r) => {
        if (!q) return true;
        return (
          (r.fromLocationName || "").toLowerCase().includes(q) ||
          (r.toLocationName || "").toLowerCase().includes(q) ||
          (r.reason || "").toLowerCase().includes(q) ||
          (r.createdByName || "").toLowerCase().includes(q) ||
          r.lines.some((l) => l.productName.toLowerCase().includes(q))
        );
      })
      .sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt));
  }, [requests, statusFilter, search]);

  const resetCreateForm = () => {
    setFromLocationId("");
    setToLocationId("");
    setUserScope("one");
    setSelectedUserIds(new Set());
    setUserSearch("");
    setReason("");
    setDraftLines([]);
    setPickerUserId("");
    setProductSearch("");
    setPickQty("1");
  };

  const toggleUser = (uid: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (userScope === "one") {
        return new Set([uid]);
      }
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const addProductLine = (item: InventoryItem) => {
    if (!pickerUserId || !fromLocationId) return;
    const maxQty = qtyAtLocation(item, fromLocationId);
    const qty = Math.min(maxQty, Math.max(1, parseInt(pickQty, 10) || 1));
    if (qty < 1 || maxQty < 1) {
      toast({
        variant: "destructive",
        title: "No quantity at source",
        description: "This product has no units at the selected from-site.",
      });
      return;
    }
    const user = selectableUsers.find((u) => u.uid === pickerUserId);
    const key = `${pickerUserId}:${item.id}`;
    setDraftLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key
            ? { ...l, quantity: Math.min(l.maxQty, l.quantity + qty) }
            : l
        );
      }
      return [
        ...prev,
        {
          key,
          userId: pickerUserId,
          userName: formatUserDisplayName(user || { uid: pickerUserId }),
          inventoryId: item.id,
          productName: item.productName,
          sku: item.sku || "",
          quantity: qty,
          maxQty,
        },
      ];
    });
  };

  const handleCreate = async () => {
    if (!adminProfile) return;
    if (!fromLocationId || !toLocationId) {
      toast({
        variant: "destructive",
        title: "Select sites",
        description: "Choose both From and To sites.",
      });
      return;
    }
    if (resolvedUserIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Select users",
        description: "Pick at least one user (or All).",
      });
      return;
    }
    if (draftLines.length === 0) {
      toast({
        variant: "destructive",
        title: "Add products",
        description: "Add at least one product line to move.",
      });
      return;
    }

    const fromWh = warehouseByLocation.get(fromLocationId);
    const toWh = warehouseByLocation.get(toLocationId);
    if (!fromWh || !toWh) {
      toast({
        variant: "destructive",
        title: "Warehouse link required",
        description:
          "Each site must be linked to a warehouse. Link them under Warehouses first.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const fromName = activeLocations.find((l) => l.id === fromLocationId)?.name || fromLocationId;
      const toName = activeLocations.find((l) => l.id === toLocationId)?.name || toLocationId;
      await createInternalMoveRequest({
        fromLocationId,
        toLocationId,
        fromLocationName: fromName,
        toLocationName: toName,
        userScope,
        userIds: resolvedUserIds,
        lines: draftLines.map((l) => ({
          userId: l.userId,
          userName: l.userName,
          inventoryId: l.inventoryId,
          productName: l.productName,
          sku: l.sku,
          quantity: l.quantity,
        })),
        reason,
        createdBy: adminProfile.uid,
        createdByName: adminProfile.name || "Admin",
      });
      toast({
        title: "Internal move created",
        description: "Request is pending. Approve it here or let warehouse ops confirm moved out.",
      });
      setCreateOpen(false);
      resetCreateForm();
      setStatusFilter("pending");
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not create request",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (request: InternalMoveRequest) => {
    if (!adminProfile) return;
    setProcessingId(request.id);
    try {
      await processInternalMoveRequest({
        requestId: request.id,
        operatorId: adminProfile.uid,
        operatorName: adminProfile.name || "Admin",
        processMode: "admin_approve",
      });
      toast({
        title: "Move processed",
        description: `Labels transferred to ${request.toWarehouseCode || request.toLocationName}. They appear in destination Putaway.`,
      });
      setViewRequest(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Process failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const handleCancel = async (request: InternalMoveRequest) => {
    setProcessingId(request.id);
    try {
      await cancelInternalMoveRequest({ requestId: request.id });
      toast({ title: "Request cancelled" });
      setViewRequest(null);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Cancel failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setProcessingId(null);
    }
  };

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <>
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-fuchsia-600 to-violet-600 text-white">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/20">
                <ArrowRightLeft className="h-6 w-6" />
              </div>
              <div>
                <CardTitle className="text-xl text-white">Internal Move</CardTitle>
                <CardDescription className="text-fuchsia-100">
                  Site-to-site inventory moves — labels reuse existing CTN/PKG codes for destination putaway
                </CardDescription>
              </div>
            </div>
            <Button
              variant="secondary"
              className="bg-white/20 text-white border-white/30 hover:bg-white/30"
              onClick={() => {
                resetCreateForm();
                setCreateOpen(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" />
              Create move request
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 p-6">
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="bg-amber-50 border-amber-200 text-amber-900">
              {pendingCount} pending
            </Badge>
            <Badge variant="outline">{requests.length} total</Badge>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search sites, products, reason…"
                className="pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="awaiting_putaway">Awaiting putaway</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {requestsLoading || usersLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : sortedRequests.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              No internal move requests yet.
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <Table containerClassName="overflow-x-auto mouse-h-scroll">
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead>From → To</TableHead>
                    <TableHead>Lines</TableHead>
                    <TableHead>Users</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRequests.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1 flex-wrap text-sm">
                          <span>{r.fromLocationName || r.fromWarehouseCode}</span>
                          <ArrowRightLeft className="h-3.5 w-3.5 text-muted-foreground" />
                          <span>{r.toLocationName || r.toWarehouseCode}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          {r.fromWarehouseCode} → {r.toWarehouseCode}
                        </p>
                      </TableCell>
                      <TableCell>{r.lines?.length || 0}</TableCell>
                      <TableCell>{r.userIds?.length || 0}</TableCell>
                      <TableCell className="text-sm">{formatWhen(r.createdAt)}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={`text-[10px] capitalize ${STATUS_CLASS[r.status]}`}
                        >
                          {r.status.replace(/_/g, " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right space-x-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setViewRequest(r)}
                        >
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Button>
                        {r.status === "pending" ? (
                          <Button
                            size="sm"
                            onClick={() => handleApprove(r)}
                            disabled={processingId === r.id}
                          >
                            {processingId === r.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              "Approve"
                            )}
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreateForm();
        }}
      >
        <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Create internal move</DialogTitle>
            <DialogDescription>
              Move selected products from one site to another. On approve (or ops confirm),
              existing carton labels transfer to the destination putaway queue.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>From site</Label>
                <Select value={fromLocationId || undefined} onValueChange={setFromLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select source site" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((loc) => {
                      const wh = warehouseByLocation.get(loc.id);
                      return (
                        <SelectItem key={loc.id} value={loc.id} disabled={!wh}>
                          {loc.name}
                          {wh ? ` (${wh.code})` : " — no warehouse"}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>To site</Label>
                <Select value={toLocationId || undefined} onValueChange={setToLocationId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select destination site" />
                  </SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((loc) => {
                      const wh = warehouseByLocation.get(loc.id);
                      return (
                        <SelectItem
                          key={loc.id}
                          value={loc.id}
                          disabled={!wh || loc.id === fromLocationId}
                        >
                          {loc.name}
                          {wh ? ` (${wh.code})` : " — no warehouse"}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Users</Label>
              <Select
                value={userScope}
                onValueChange={(v) => setUserScope(v as InternalMoveUserScope)}
              >
                <SelectTrigger className="w-full sm:w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="one">Specific user</SelectItem>
                  <SelectItem value="some">Some users</SelectItem>
                  <SelectItem value="all">All managed users</SelectItem>
                </SelectContent>
              </Select>

              {userScope !== "all" ? (
                <div className="rounded-lg border p-3 space-y-2 max-h-48 overflow-y-auto">
                  <Input
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Search users…"
                    className="h-8"
                  />
                  {filteredUsers.map((u) => (
                    <label
                      key={u.uid}
                      className="flex items-center gap-2 text-sm cursor-pointer py-1"
                    >
                      <Checkbox
                        checked={selectedUserIds.has(u.uid)}
                        onCheckedChange={() => toggleUser(u.uid)}
                      />
                      <span className="truncate">{formatUserDisplayName(u)}</span>
                      {u.email ? (
                        <span className="text-xs text-muted-foreground truncate">
                          {u.email}
                        </span>
                      ) : null}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Will include {selectableUsers.length} managed user
                  {selectableUsers.length === 1 ? "" : "s"} at create time.
                </p>
              )}
            </div>

            <div className="space-y-2 border rounded-lg p-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <Label className="flex items-center gap-1">
                  <Warehouse className="h-4 w-4" /> Add products at from-site
                </Label>
                {resolvedUserIds.length > 1 ? (
                  <Select value={pickerUserId || undefined} onValueChange={setPickerUserId}>
                    <SelectTrigger className="w-[200px] h-8">
                      <SelectValue placeholder="User for products" />
                    </SelectTrigger>
                    <SelectContent>
                      {resolvedUserIds.map((uid) => {
                        const u = selectableUsers.find((x) => x.uid === uid);
                        return (
                          <SelectItem key={uid} value={uid}>
                            {formatUserDisplayName(u || { uid, name: uid })}
                          </SelectItem>
                        );
                      })}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Input
                  value={productSearch}
                  onChange={(e) => setProductSearch(e.target.value)}
                  placeholder="Search product / SKU…"
                  className="flex-1 min-w-[160px]"
                  disabled={!fromLocationId || !pickerUserId}
                />
                <Input
                  type="number"
                  min={1}
                  value={pickQty}
                  onChange={(e) => setPickQty(e.target.value)}
                  className="w-20"
                  title="Qty to add"
                />
              </div>
              {loadingInventory ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Loading inventory…
                </p>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {!fromLocationId || !pickerUserId ? (
                    <p className="text-xs text-muted-foreground">
                      Select from-site and a user first.
                    </p>
                  ) : pickerInventory.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No products with quantity at this site for the selected user.
                    </p>
                  ) : (
                    pickerInventory.slice(0, 40).map((item) => {
                      const avail = qtyAtLocation(item, fromLocationId);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-left text-sm hover:bg-accent"
                          onClick={() => addProductLine(item)}
                        >
                          <span className="truncate font-medium">{item.productName}</span>
                          <Badge variant="outline" className="text-[10px] shrink-0">
                            {avail} at site
                          </Badge>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>

            {draftLines.length > 0 ? (
              <div className="rounded-lg border overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Qty</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draftLines.map((l) => (
                      <TableRow key={l.key}>
                        <TableCell className="text-xs">{l.userName}</TableCell>
                        <TableCell>
                          <span className="font-medium text-sm">{l.productName}</span>
                          {l.sku ? (
                            <span className="block text-[11px] text-muted-foreground">
                              {l.sku}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <Input
                            type="number"
                            min={1}
                            max={l.maxQty}
                            value={l.quantity}
                            className="w-20 h-8"
                            onChange={(e) => {
                              const n = Math.min(
                                l.maxQty,
                                Math.max(1, parseInt(e.target.value, 10) || 1)
                              );
                              setDraftLines((prev) =>
                                prev.map((x) => (x.key === l.key ? { ...x, quantity: n } : x))
                              );
                            }}
                          />
                          <span className="text-[10px] text-muted-foreground ml-1">
                            / {l.maxQty}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() =>
                              setDraftLines((prev) => prev.filter((x) => x.key !== l.key))
                            }
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label>Reason (optional)</Label>
              <Textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Why is stock moving sites?"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={submitting}>
              {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* View / process dialog */}
      <Dialog open={!!viewRequest} onOpenChange={(o) => !o && setViewRequest(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Internal move request</DialogTitle>
            <DialogDescription>
              {viewRequest?.status === "pending"
                ? "Approve to transfer labels to the destination putaway queue, or cancel."
                : "Request details."}
            </DialogDescription>
          </DialogHeader>
          {viewRequest ? (
            <div className="space-y-3 text-sm">
              <div className="rounded-lg border bg-muted/40 p-3 space-y-1">
                <p>
                  <span className="text-muted-foreground">Route:</span>{" "}
                  <strong>
                    {viewRequest.fromLocationName} → {viewRequest.toLocationName}
                  </strong>
                </p>
                <p>
                  <span className="text-muted-foreground">Warehouses:</span>{" "}
                  {viewRequest.fromWarehouseCode} → {viewRequest.toWarehouseCode}
                </p>
                <p>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <Badge
                    variant="outline"
                    className={`text-[10px] capitalize ${STATUS_CLASS[viewRequest.status]}`}
                  >
                    {viewRequest.status.replace(/_/g, " ")}
                  </Badge>
                </p>
                <p>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  {formatWhen(viewRequest.createdAt)} by {viewRequest.createdByName || "—"}
                </p>
                {viewRequest.reason ? (
                  <p>
                    <span className="text-muted-foreground">Reason:</span> {viewRequest.reason}
                  </p>
                ) : null}
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Qty</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {viewRequest.lines.map((l, i) => (
                      <TableRow key={`${l.inventoryId}-${i}`}>
                        <TableCell className="text-xs">{l.userName || l.userId}</TableCell>
                        <TableCell className="text-sm">{l.productName}</TableCell>
                        <TableCell>{l.quantity}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {viewRequest.movedCartonRefs && viewRequest.movedCartonRefs.length > 0 ? (
                <div className="text-xs text-muted-foreground">
                  Dest labels:{" "}
                  {viewRequest.movedCartonRefs.map((c) => c.cartonCode).join(", ")}
                </div>
              ) : null}
              {viewRequest.status === "pending" ? (
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button
                    variant="outline"
                    onClick={() => handleCancel(viewRequest)}
                    disabled={processingId === viewRequest.id}
                  >
                    Cancel request
                  </Button>
                  <Button
                    onClick={() => handleApprove(viewRequest)}
                    disabled={processingId === viewRequest.id}
                  >
                    {processingId === viewRequest.id ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Approve & transfer
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
