"use client";

import React, { Suspense, useState, useMemo, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Package, Users, ChevronsUpDown } from "lucide-react";
import { AdminInventoryManagement } from "@/components/admin/admin-inventory-management";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile, InventoryItem, ShippedItem } from "@/types";
import { useSearchParams, useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { hasRole } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { useAuth } from "@/hooks/use-auth";

function InventoryContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const userId = searchParams.get("userId");
  const section = searchParams.get("section");
  const tab = searchParams.get("tab");
  const requestId = searchParams.get("requestId");
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState("");
  
  const { data: users, loading: usersLoading, error: usersError } = useCollection<UserProfile>("users");
  
  // Debug logging
  React.useEffect(() => {
    console.log("=== USER SELECTOR DEBUG ===");
    console.log("Users loaded:", users.length);
    console.log("Users:", users);
    console.log("Loading:", usersLoading);
    console.log("Error:", usersError);
    
    // If we get a permission error, show alert to clear cache
    if (usersError && usersError.message?.includes('permission')) {
      console.error("PERMISSION ERROR DETECTED!");
      console.error("The Firestore client may be corrupted.");
      console.error("Please clear browser storage:");
      console.error("1. Go to: http://localhost:3000/clear-firestore-cache.html");
      console.error("2. Or manually clear IndexedDB in DevTools (F12 → Application → IndexedDB)");
    }
  }, [users, usersLoading, usersError]);
  
  // Function to clear Firestore cache
  const clearFirestoreCache = async () => {
    try {
      // Import the utility function
      const { clearFirestoreCache: clearCache } = await import("@/lib/firebase");
      const cleared = await clearCache();
      if (cleared) {
        alert('✅ Firestore cache cleared! Refreshing page in 2 seconds...');
        setTimeout(() => {
          window.location.reload();
        }, 2000);
      } else {
        alert('Could not clear cache automatically. Please clear manually in DevTools (F12 → Application → IndexedDB).');
      }
    } catch (error) {
      console.error('Error clearing cache:', error);
      alert('Error clearing cache. Please clear manually in DevTools (F12 → Application → IndexedDB).');
    }
  };
  
  // Filter out admin users - show all approved users except admins
  const selectableUsers = useMemo(() => {
    const filtered = users.filter(user => {
      // Exclude admin users
      if (hasRole(user, "admin")) return false;
      
      // Include approved users or users without status (for backward compatibility)
      const isApproved = user.status === "approved" || !user.status;
      const isNotDeleted = user.status !== "deleted";
      
      return isApproved && isNotDeleted;
    }).sort((a, b) => {
      // Sort alphabetically by name
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    console.log("Selectable users (filtered):", filtered.length, filtered);
    return filtered;
  }, [users]);
  
  const selectedUser = useMemo(() => {
    if (userId) {
      return selectableUsers.find(u => u.uid === userId);
    }
    return selectableUsers[0];
  }, [userId, selectableUsers]);
  
  const handleUserSelect = (user: UserProfile) => {
    router.push(`/admin/dashboard/inventory?userId=${user.uid}`);
    setUserDialogOpen(false);
    setUserSearchQuery("");
  };
  
  // Normalize user ID (handle both id and uid fields) - ensure it's a valid string
  const normalizedUserId = selectedUser?.uid || selectedUser?.id;
  const isValidUserId = normalizedUserId && typeof normalizedUserId === 'string' && normalizedUserId.trim() !== '';
  
  const { data: inventory, loading: inventoryLoading, error: inventoryError } = useCollection<InventoryItem>(
    isValidUserId ? `users/${normalizedUserId}/inventory` : ""
  );
  const { data: shipped, loading: shippedLoading, error: shippedError } = useCollection<ShippedItem>(
    isValidUserId ? `users/${normalizedUserId}/shipped` : ""
  );

  const { user: authUser } = useAuth();
  const ebayRefreshDoneForUser = useRef<string | null>(null);
  useEffect(() => {
    if (!authUser || !normalizedUserId || inventoryLoading || !inventory.length) return;
    const items = inventory as (InventoryItem & { source?: string; ebayConnectionId?: string })[];
    const connectionIds = [...new Set(
      items.filter((i) => i.source === "ebay" && i.ebayConnectionId).map((i) => i.ebayConnectionId!)
    )];
    if (connectionIds.length === 0) return;
    if (ebayRefreshDoneForUser.current === normalizedUserId) return;
    ebayRefreshDoneForUser.current = normalizedUserId;
    (async () => {
      const token = await authUser.getIdToken();
      for (const connectionId of connectionIds) {
        try {
          await fetch("/api/integrations/ebay/refresh-inventory", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
            body: JSON.stringify({ userId: normalizedUserId, connectionId }),
          });
        } catch {
          // ignore
        }
      }
    })();
  }, [authUser, normalizedUserId, inventoryLoading, inventory]);

  return (
    <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
      <CardHeader className="bg-gradient-to-r from-purple-500 to-indigo-600 px-4 py-4 text-white sm:px-6 sm:pb-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
              <Package className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
              Inventory Management
            </CardTitle>
            <CardDescription className="mt-1 line-clamp-2 text-xs text-purple-100 sm:mt-2 sm:text-sm">
              {selectedUser
                ? `Managing inventory for ${selectedUser.name}`
                : "Select a user to manage their inventory"}
            </CardDescription>
          </div>
          <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:flex">
            <Package className="h-7 w-7 text-white" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-3 sm:space-y-6 sm:p-6">
        {(inventoryError || shippedError) && (
          <div className="mb-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 sm:mb-4">
            <div className="font-semibold">Firestore access error</div>
            <div className="mt-1 text-xs break-words">
              {String((inventoryError || shippedError)?.message || "Missing or insufficient permissions.")}
            </div>
            <div className="mt-2 text-xs">
              If this is an admin account, confirm your <span className="font-mono">users/&#123;uid&#125;</span> doc has <span className="font-mono">role: &quot;admin&quot;</span> (or <span className="font-mono">roles: [&quot;admin&quot;]</span>).
            </div>
          </div>
        )}
        {/* User Selector */}
        <div className="border-b pb-4 sm:mb-2 sm:pb-6">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">Select User:</span>
            </div>
            {usersError && (
              <Button
                variant="destructive"
                size="sm"
                onClick={clearFirestoreCache}
                className="w-full text-xs sm:w-auto"
              >
                Clear Firestore Cache (Fix Errors)
              </Button>
            )}
            <div className="min-w-0 w-full flex-1 sm:w-auto">
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
                      className="h-11 min-h-[44px] w-full min-w-0 justify-between px-3 shadow-sm sm:w-[300px]"
                    >
                      <span className="mr-2 min-w-0 flex-1 truncate text-left">
                        {selectedUser
                          ? formatUserDisplayName(selectedUser, { showEmail: true })
                          : selectableUsers.length === 0
                          ? "No users available"
                          : "Select a user to manage inventory"}
                      </span>
                      <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="w-[calc(100%-1rem)] max-w-lg overflow-hidden p-0 sm:p-0">
                    <DialogTitle className="sr-only">Select a user</DialogTitle>
                    <div className="border-b p-3">
                      <Input
                        autoFocus
                        placeholder="Search users..."
                        value={userSearchQuery}
                        onChange={(e) => setUserSearchQuery(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            const normalized = userSearchQuery.trim().toLowerCase();
                            const matches = selectableUsers.filter(user =>
                              user.name?.toLowerCase().includes(normalized) ||
                              user.email?.toLowerCase().includes(normalized) ||
                              user.clientId?.toLowerCase().includes(normalized)
                            );
                            const first = matches[0];
                            if (first) {
                              handleUserSelect(first);
                            }
                          }
                        }}
                      />
                    </div>
                    <div className="max-h-[60dvh] overflow-y-auto overscroll-contain sm:max-h-80">
                      {selectableUsers
                        .filter(user =>
                          user.name?.toLowerCase().includes(userSearchQuery.trim().toLowerCase()) ||
                          user.email?.toLowerCase().includes(userSearchQuery.trim().toLowerCase()) ||
                          user.clientId?.toLowerCase().includes(userSearchQuery.trim().toLowerCase())
                        )
                        .map((user, index) => (
                          <div
                            key={user.uid || `user-${index}`}
                            role="button"
                            tabIndex={0}
                            className={`flex min-h-[44px] min-w-0 cursor-pointer items-center gap-2 px-3 py-2.5 text-sm hover:bg-accent hover:text-accent-foreground ${
                              selectedUser?.uid === user.uid ? "bg-accent" : ""
                            }`}
                            onClick={() => handleUserSelect(user)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                handleUserSelect(user);
                              }
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {formatUserDisplayName(user, { showEmail: true })}
                            </span>
                            {selectedUser?.uid === user.uid && (
                              <span className="text-primary">✓</span>
                            )}
                          </div>
                        ))}
                      {selectableUsers.length === 0 && (
                        <div className="px-3 py-4 text-center text-sm text-muted-foreground">
                          No users available
                        </div>
                      )}
                    </div>
                  </DialogContent>
                </Dialog>
              )}
            </div>
          </div>
        </div>
        
        {usersLoading || !selectedUser ? (
          <div className="space-y-4">
            <Skeleton className="h-64 w-full rounded-xl" />
          </div>
        ) : (
          <div className="min-w-0 space-y-4 sm:space-y-6">
            <AdminInventoryManagement
              selectedUser={selectedUser}
              inventory={inventory}
              shipped={shipped}
              loading={inventoryLoading}
              initialSection={section || undefined}
              initialRequestTab={tab || undefined}
              initialRequestId={requestId || undefined}
            />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function AdminInventoryPage() {
  return (
    <div className="min-w-0 space-y-4 pb-24 sm:space-y-6 sm:pb-8">
      <Suspense fallback={
        <Card className="border-2 shadow-xl">
          <CardContent className="p-4 sm:p-6">
            <Skeleton className="h-64 w-full rounded-xl" />
          </CardContent>
        </Card>
      }>
        <InventoryContent />
      </Suspense>
    </div>
  );
}
