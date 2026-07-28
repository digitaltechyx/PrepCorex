"use client";

import { useMemo, useState } from "react";
import { Check, Package, Search } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { PurchasedLabelsPanel } from "@/components/labels/purchased-labels-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { hasRole } from "@/lib/permissions";

type ViewMode = "mine" | "client";

export function AdminPurchasedLabelsSection() {
  const { userProfile } = useAuth();
  const { managedUsers, loading: usersLoading } = useManagedUsers();
  const [viewMode, setViewMode] = useState<ViewMode>("mine");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [clientSearch, setClientSearch] = useState("");

  const approvedUsers = useMemo(
    () =>
      managedUsers
        .filter((u) => u.uid && u.status !== "deleted" && hasRole(u, "user"))
        .sort((a, b) =>
          formatUserDisplayName(a, { showEmail: false }).localeCompare(
            formatUserDisplayName(b, { showEmail: false })
          )
        ),
    [managedUsers]
  );

  const filteredUsers = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return approvedUsers;
    return approvedUsers.filter(
      (user) =>
        formatUserDisplayName(user, { showEmail: true }).toLowerCase().includes(q) ||
        (user.email ?? "").toLowerCase().includes(q) ||
        (user.clientId ?? "").toLowerCase().includes(q)
    );
  }, [approvedUsers, clientSearch]);

  const selectedUser = approvedUsers.find((u) => u.uid === selectedUserId) || null;
  const activeUserId = viewMode === "mine" ? userProfile?.uid : selectedUser?.uid;

  return (
    <div className="space-y-6">
      <Card className="border border-border/70 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Whose labels?</CardTitle>
          <CardDescription>
            Labels you buy here are saved under your admin account. You can also open any
            client&apos;s purchase history.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="mine">My purchases</TabsTrigger>
              <TabsTrigger value="client">Client purchases</TabsTrigger>
            </TabsList>
          </Tabs>

          {viewMode === "client" && (
            <div className="space-y-3 sm:max-w-md">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search clients…"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="pl-9"
                  disabled={usersLoading}
                />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-md border bg-background">
                {usersLoading ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">Loading clients…</p>
                ) : filteredUsers.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No client found.</p>
                ) : (
                  filteredUsers.map((user) => {
                    const isSelected = selectedUserId === user.uid;
                    return (
                      <button
                        key={user.uid}
                        type="button"
                        onClick={() => setSelectedUserId(user.uid)}
                        className={cn(
                          "flex w-full items-start gap-2 border-b px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-accent",
                          isSelected && "bg-accent"
                        )}
                      >
                        <Check
                          className={cn(
                            "mt-0.5 h-4 w-4 shrink-0",
                            isSelected ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <div className="min-w-0">
                          <p className="truncate font-medium">
                            {formatUserDisplayName(user, { showEmail: false })}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
              {selectedUser ? (
                <p className="text-xs text-muted-foreground">
                  Showing labels for{" "}
                  <span className="font-medium text-foreground">
                    {formatUserDisplayName(selectedUser, { showEmail: true })}
                  </span>
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <PurchasedLabelsPanel
        userId={activeUserId}
        emptyHint={
          viewMode === "mine"
            ? "Buy a label from the Buy Label tab — completed purchases will appear here for download."
            : selectedUser
              ? "This client has not purchased any labels yet."
              : "Select a client to view their purchased labels."
        }
      />

      {viewMode === "client" && !selectedUser && !usersLoading && (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Package className="h-4 w-4" />
          Pick a client above to load their label history.
        </div>
      )}
    </div>
  );
}
