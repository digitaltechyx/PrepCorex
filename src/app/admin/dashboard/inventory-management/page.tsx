"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile, InventoryItem, ShippedItem } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTrigger, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Package, Users, ChevronsUpDown, Check, Boxes, AlertTriangle, Truck, Clock } from "lucide-react";
import { AdminInventoryManagement } from "@/components/admin/admin-inventory-management";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUserDisplayName } from "@/lib/format-user-display";

type ShipmentRequestLite = { status?: string };

export default function AdminInventoryManagementPage() {
  const { userProfile: adminUser } = useAuth();
  const { user: authUser } = useAuth();
  const { managedUsers: users, loading: usersLoading } = useManagedUsers();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");

  const approvedUsers = useMemo(() => {
    if (!users || users.length === 0) return [];
    if (!adminUser?.uid) return users.filter((user) => user.status !== "deleted" && (user.status === "approved" || !user.status));

    const filtered = users
      .filter((user) => user.status !== "deleted")
      .filter((user) => user.status === "approved" || !user.status);

    const admin = filtered.find((user) => user.uid === adminUser.uid);
    const others = filtered.filter((user) => user.uid !== adminUser.uid);
    const sortedOthers = others.sort((a, b) => {
      const nameA = (a.name || "").toLowerCase();
      const nameB = (b.name || "").toLowerCase();
      return nameA.localeCompare(nameB);
    });
    return admin ? [admin, ...sortedOthers] : sortedOthers;
  }, [users, adminUser]);

  useEffect(() => {
    if (selectedUserId) return;
    if (adminUser?.uid && approvedUsers.length > 0) {
      const admin = approvedUsers.find((user) => user.uid === adminUser.uid);
      if (admin) {
        setSelectedUserId(admin.uid);
        return;
      }
    }
    if (approvedUsers.length > 0) {
      setSelectedUserId(approvedUsers[0].uid);
    }
  }, [approvedUsers, adminUser, selectedUserId]);

  const selectedUser = approvedUsers.find((u) => u.uid === selectedUserId) || null;
  const inventoryPath = selectedUser?.uid ? `users/${selectedUser.uid}/inventory` : "";
  const shippedPath = selectedUser?.uid ? `users/${selectedUser.uid}/shipped` : "";

  const { data: inventory, loading: inventoryLoading } = useCollection<InventoryItem>(inventoryPath);
  const { data: shipped, loading: shippedLoading } = useCollection<ShippedItem>(shippedPath);
  const shipmentRequestsPath = selectedUser?.uid ? `users/${selectedUser.uid}/shipmentRequests` : "";
  const { data: shipmentRequests } = useCollection<ShipmentRequestLite>(shipmentRequestsPath);

  const stats = useMemo(() => {
    const inv = inventory ?? [];
    const ship = shipped ?? [];
    const totalUnits = inv.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const lowStockSkus = inv.filter((item) => (Number(item.quantity) || 0) <= 10).length;
    const pendingRequests = (shipmentRequests ?? []).filter(
      (r) => (r.status || "").toLowerCase() === "pending"
    ).length;
    return {
      totalUnits,
      skuCount: inv.length,
      lowStockSkus,
      shippedOrders: ship.length,
      pendingRequests,
    };
  }, [inventory, shipped, shipmentRequests]);

  const ebayRefreshDoneForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!authUser || !selectedUser?.uid || inventoryLoading || !inventory?.length) return;
    const items = inventory as (InventoryItem & { source?: string; ebayConnectionId?: string })[];
    const connectionIds = [...new Set(items.filter((i) => i.source === "ebay" && i.ebayConnectionId).map((i) => i.ebayConnectionId!))];
    if (connectionIds.length === 0) return;
    if (ebayRefreshDoneForUser.current === selectedUser.uid) return;
    ebayRefreshDoneForUser.current = selectedUser.uid;
    (async () => {
      const token = await authUser.getIdToken();
      for (const connectionId of connectionIds) {
        try {
          await fetch("/api/integrations/ebay/refresh-inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ userId: selectedUser.uid, connectionId }),
          });
        } catch {
          // ignore
        }
      }
    })();
  }, [authUser, selectedUser?.uid, inventoryLoading, inventory]);

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      {selectedUser && (
        <div className="grid grid-cols-2 gap-1.5 sm:gap-4 lg:grid-cols-4">
          <Card className="min-w-0 overflow-hidden rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-blue-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
              <CardTitle className="text-[10px] font-medium leading-tight text-blue-900 sm:text-sm">
                Total Inventory
              </CardTitle>
              <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-blue-500 shadow-sm sm:flex">
                <Boxes className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
              {inventoryLoading ? (
                <Skeleton className="h-5 w-10 rounded sm:h-8 sm:w-16" />
              ) : (
                <>
                  <div className="text-base font-bold tabular-nums text-blue-900 sm:text-3xl">
                    {stats.totalUnits.toLocaleString()}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-tight text-blue-700 sm:mt-1 sm:text-xs">
                    <span className="sm:hidden">{stats.skuCount} SKUs</span>
                    <span className="hidden sm:inline">Units across {stats.skuCount} SKU(s)</span>
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="min-w-0 overflow-hidden rounded-lg border border-amber-200/60 bg-gradient-to-br from-amber-50 to-amber-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
              <CardTitle className="text-[10px] font-medium leading-tight text-amber-900 sm:text-sm">
                Low Stock SKUs
              </CardTitle>
              <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-amber-500 shadow-sm sm:flex">
                <AlertTriangle className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
              {inventoryLoading ? (
                <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-16" />
              ) : (
                <>
                  <div className="text-base font-bold tabular-nums text-amber-900 sm:text-3xl">
                    {stats.lowStockSkus}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-tight text-amber-700 sm:mt-1 sm:text-xs">Qty ≤ 10</p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="min-w-0 overflow-hidden rounded-lg border border-teal-200/60 bg-gradient-to-br from-teal-50 to-teal-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
              <CardTitle className="text-[10px] font-medium leading-tight text-teal-900 sm:text-sm">
                Shipped Orders
              </CardTitle>
              <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-teal-500 shadow-sm sm:flex">
                <Truck className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
              {shippedLoading ? (
                <Skeleton className="h-5 w-8 rounded sm:h-8 sm:w-16" />
              ) : (
                <>
                  <div className="text-base font-bold tabular-nums text-teal-900 sm:text-3xl">
                    {stats.shippedOrders}
                  </div>
                  <p className="mt-0.5 text-[10px] leading-tight text-teal-700 sm:mt-1 sm:text-xs">
                    <span className="sm:hidden">Shipments</span>
                    <span className="hidden sm:inline">Total shipments</span>
                  </p>
                </>
              )}
            </CardContent>
          </Card>
          <Card className="min-w-0 overflow-hidden rounded-lg border border-orange-200/60 bg-gradient-to-br from-orange-50 to-orange-100/50 shadow-sm sm:rounded-xl sm:border-2 sm:shadow-lg">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 p-2 pb-0 sm:p-6 sm:pb-2">
              <CardTitle className="text-[10px] font-medium leading-tight text-orange-900 sm:text-sm">
                Pending Requests
              </CardTitle>
              <div className="hidden h-9 w-9 items-center justify-center rounded-lg bg-orange-500 shadow-sm sm:flex">
                <Clock className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent className="p-2 pt-0.5 sm:p-6 sm:pt-0">
              <div className="text-base font-bold tabular-nums text-orange-900 sm:text-3xl">
                {stats.pendingRequests}
              </div>
              <p className="mt-0.5 text-[10px] leading-tight text-orange-700 sm:mt-1 sm:text-xs">
                <span className="sm:hidden">Awaiting</span>
                <span className="hidden sm:inline">Awaiting fulfillment</span>
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-purple-500 to-indigo-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <Package className="h-6 w-6" />
                Inventory Management
              </CardTitle>
              <CardDescription className="text-purple-100 mt-2">
                Manage inventory for users
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Package className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="mb-6 pb-6 border-b">
            <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Select User:</span>
              </div>
              <div className="flex-1 w-full sm:w-auto">
                {usersLoading ? (
                  <Skeleton className="h-11 w-full sm:w-[300px]" />
                ) : (
                  <Dialog open={userDialogOpen} onOpenChange={setUserDialogOpen}>
                    <DialogTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        aria-expanded={userDialogOpen}
                        className="w-full sm:w-[300px] h-11 justify-between shadow-sm min-w-0 px-3"
                      >
                        <span className="truncate text-left flex-1 min-w-0 mr-2">
                          {selectedUser
                            ? formatUserDisplayName(selectedUser, { showEmail: true })
                            : "Select a user to manage inventory"}
                        </span>
                        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="p-0">
                      <DialogTitle className="sr-only">Select a user</DialogTitle>
                      <div className="p-3 border-b">
                        <Input
                          autoFocus
                          placeholder="Search users..."
                          value={userSearchQuery}
                          onChange={(e) => setUserSearchQuery(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              const normalized = userSearchQuery.trim().toLowerCase();
                              const matches = approvedUsers.filter(
                                (user) =>
                                  user.name?.toLowerCase().includes(normalized) ||
                                  user.email?.toLowerCase().includes(normalized) ||
                                  user.clientId?.toLowerCase().includes(normalized)
                              );
                              const first = matches[0] ?? approvedUsers[0];
                              if (first) {
                                setSelectedUserId(first.uid);
                                setUserDialogOpen(false);
                                setUserSearchQuery("");
                              }
                            }
                          }}
                        />
                      </div>
                      <div className="max-h-80 overflow-y-auto">
                        {approvedUsers
                          .filter(
                            (user) =>
                              user.name?.toLowerCase().includes(userSearchQuery.trim().toLowerCase()) ||
                              user.email?.toLowerCase().includes(userSearchQuery.trim().toLowerCase())
                          )
                          .map((user, index) => (
                            <div
                              key={user.uid || `user-${index}`}
                              role="button"
                              tabIndex={0}
                              className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground cursor-pointer min-w-0"
                              onClick={() => {
                                setSelectedUserId(user.uid);
                                setUserDialogOpen(false);
                                setUserSearchQuery("");
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  setSelectedUserId(user.uid);
                                  setUserDialogOpen(false);
                                  setUserSearchQuery("");
                                }
                              }}
                            >
                              <Check className={`h-4 w-4 shrink-0 ${selectedUserId === user.uid ? "opacity-100" : "opacity-0"}`} />
                              <span className="truncate min-w-0 flex-1">
                                {formatUserDisplayName(user, { showEmail: true })}
                              </span>
                            </div>
                          ))}
                        {approvedUsers.filter(
                          (user) =>
                            user.name?.toLowerCase().includes(userSearchQuery.trim().toLowerCase()) ||
                            user.email?.toLowerCase().includes(userSearchQuery.trim().toLowerCase()) ||
                            user.clientId?.toLowerCase().includes(userSearchQuery.trim().toLowerCase())
                        ).length === 0 && (
                          <div key="no-users" className="px-3 py-4 text-sm text-muted-foreground">
                            No users found.
                          </div>
                        )}
                      </div>
                    </DialogContent>
                  </Dialog>
                )}
              </div>
            </div>
          </div>

          {!selectedUser ? (
            <div className="text-center py-16">
              <div className="mx-auto h-20 w-20 rounded-full bg-purple-100 flex items-center justify-center mb-4">
                <Package className="h-10 w-10 text-purple-600" />
              </div>
              <h3 className="text-xl font-bold mb-2">No user selected</h3>
              <p className="text-muted-foreground">
                Please select a user from the dropdown above to manage their inventory
              </p>
            </div>
          ) : (
            <AdminInventoryManagement
              selectedUser={selectedUser}
              inventory={inventory ?? []}
              shipped={shipped ?? []}
              loading={inventoryLoading || shippedLoading}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
