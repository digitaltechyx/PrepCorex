"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useCollection } from "@/hooks/use-collection";
import type { UserProfile, UserRole } from "@/types";
import { hasRole, getUserRoles } from "@/lib/permissions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, Users, KeyRound, ListChecks, UserCog, MapPin, Loader2, AlertCircle, Crown, User, HandCoins, ScrollText } from "lucide-react";
import { ROLE_DEFINITIONS, CLIENT_FEATURES_CONFIG, ADMIN_FEATURES_CONFIG } from "@/lib/roles-permissions-config";
import { RoleFeatureManagement } from "@/components/admin/role-feature-management";
import { AssignLocationTab } from "@/components/admin/assign-location-tab";
import { RolesPermissionsLogsTab } from "@/components/admin/roles-permissions-logs-tab";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUserDisplayName } from "@/lib/format-user-display";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function RolesPermissionsPage() {
  const router = useRouter();
  const { userProfile: adminUser } = useAuth();
  const { data: users, loading: usersLoading } = useCollection<UserProfile>("users");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [userSelectOpen, setUserSelectOpen] = useState(false);
  const [userSelectSearch, setUserSelectSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"overview" | "assign" | "locations" | "logs">("overview");
  const [selectedRoleForDialog, setSelectedRoleForDialog] = useState<UserRole | null>(null);
  const [dialogUserSearch, setDialogUserSearch] = useState("");

  const isSuperAdmin = adminUser && hasRole(adminUser, "admin");

  useEffect(() => {
    if (adminUser && !isSuperAdmin) {
      router.replace("/admin/dashboard");
    }
  }, [adminUser, isSuperAdmin, router]);

  const roleCounts = useMemo(() => {
    const counts: Record<string, number> = { admin: 0, user: 0, commission_agent: 0, sub_admin: 0 };
    users.forEach((u) => {
      const roles = getUserRoles(u);
      roles.forEach((r) => {
        if (r in counts) counts[r]++;
      });
      if (roles.length === 0 && u.role) {
        const r = u.role as keyof typeof counts;
        if (r in counts) counts[r]++;
      }
    });
    return counts;
  }, [users]);

  const nonAdminUsers = useMemo(
    () => users.filter((u) => u.uid !== adminUser?.uid && u.status !== "deleted"),
    [users, adminUser]
  );

  const sortedUsersForSelect = useMemo(
    () =>
      [...nonAdminUsers].sort((a, b) => {
        const nameA = (a.name || a.email || a.uid || "").toLowerCase();
        const nameB = (b.name || b.email || b.uid || "").toLowerCase();
        return nameA.localeCompare(nameB);
      }),
    [nonAdminUsers]
  );

  const filteredUsersForSelect = useMemo(() => {
    const q = userSelectSearch.trim().toLowerCase();
    if (!q) return sortedUsersForSelect;
    return sortedUsersForSelect.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.uid ?? "").toLowerCase().includes(q)
    );
  }, [sortedUsersForSelect, userSelectSearch]);

  const selectedUser = useMemo(
    () => nonAdminUsers.find((u) => u.uid === selectedUserId),
    [nonAdminUsers, selectedUserId]
  );

  const usersWithSelectedRole = useMemo(() => {
    if (!selectedRoleForDialog) return [];
    return users
      .filter((u) => u.status !== "deleted")
      .filter((u) => getUserRoles(u).includes(selectedRoleForDialog))
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || ""));
  }, [users, selectedRoleForDialog]);

  const roleLabelByValue: Record<UserRole, string> = useMemo(
    () =>
      Object.fromEntries(ROLE_DEFINITIONS.map((r) => [r.value, r.label])) as Record<UserRole, string>,
    []
  );

  const filteredDialogUsers = useMemo(() => {
    const q = dialogUserSearch.trim().toLowerCase();
    if (!q) return usersWithSelectedRole;
    return usersWithSelectedRole.filter(
      (u) =>
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.uid ?? "").toLowerCase().includes(q)
    );
  }, [usersWithSelectedRole, dialogUserSearch]);

  useEffect(() => {
    setDialogUserSearch("");
  }, [selectedRoleForDialog]);

  if (!adminUser) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isSuperAdmin) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-4">
        <AlertCircle className="h-12 w-12 text-amber-500" />
        <p className="text-center text-muted-foreground">You do not have access to Roles & Permissions.</p>
      </div>
    );
  }

  const roleMeta: Record<string, { icon: React.ReactNode; accent: string }> = {
    admin: { icon: <Crown className="h-4 w-4 sm:h-5 sm:w-5" />, accent: "from-violet-500/15 to-purple-600/10 border-violet-200 dark:border-violet-800/50" },
    user: { icon: <User className="h-4 w-4 sm:h-5 sm:w-5" />, accent: "from-blue-500/15 to-cyan-500/10 border-blue-200 dark:border-blue-800/50" },
    commission_agent: { icon: <HandCoins className="h-4 w-4 sm:h-5 sm:w-5" />, accent: "from-emerald-500/15 to-teal-500/10 border-emerald-200 dark:border-emerald-800/50" },
    sub_admin: { icon: <UserCog className="h-4 w-4 sm:h-5 sm:w-5" />, accent: "from-amber-500/15 to-orange-500/10 border-amber-200 dark:border-amber-800/50" },
  };

  const tabTriggerClass =
    "gap-1 rounded-lg px-1.5 py-1.5 text-[10px] font-medium sm:gap-2 sm:rounded-xl sm:px-3 sm:py-2.5 sm:text-sm data-[state=inactive]:text-muted-foreground data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:shadow-sm";

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <div className="relative overflow-hidden rounded-xl border border-border/60 bg-gradient-to-br from-primary/5 via-background to-primary/5 px-3 py-3 shadow-sm sm:rounded-2xl sm:px-6 sm:py-6">
        <div className="relative flex flex-col gap-0.5 sm:gap-1">
          <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-foreground sm:gap-3 sm:text-3xl">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary shadow-inner sm:h-11 sm:w-11 sm:rounded-xl">
              <ShieldCheck className="h-4 w-4 sm:h-6 sm:w-6" />
            </span>
            Roles & Permissions
          </h1>
          <p className="max-w-xl text-xs text-muted-foreground sm:text-sm">
            Assign roles and feature access to users.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "overview" | "assign" | "locations" | "logs")}>
        <TabsList className="mb-3 grid h-auto w-full grid-cols-4 gap-0.5 rounded-xl border border-border/60 bg-muted/50 p-1 sm:mb-4 sm:max-w-4xl sm:gap-1 sm:rounded-2xl sm:border-2 sm:p-1.5">
          <TabsTrigger value="overview" className={tabTriggerClass}>
            <ListChecks className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Overview</span>
            <span className="hidden sm:inline">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="assign" className={tabTriggerClass}>
            <UserCog className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Assign</span>
            <span className="hidden sm:inline">Assign to User</span>
          </TabsTrigger>
          <TabsTrigger value="locations" className={tabTriggerClass}>
            <MapPin className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            <span className="sm:hidden">Locs</span>
            <span className="hidden sm:inline">Assign Location</span>
          </TabsTrigger>
          <TabsTrigger value="logs" className={tabTriggerClass}>
            <ScrollText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-0 space-y-3 sm:space-y-6">
          <Card className="min-w-0 overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl sm:border-2">
            <CardHeader className="border-b bg-muted/20 p-3 sm:p-6 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:gap-3 sm:text-xl">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary sm:h-10 sm:w-10 sm:rounded-xl">
                  <Users className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                Roles
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Users can have multiple roles. Tap a card to see who has it.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-3 sm:p-6 sm:pt-4">
              {usersLoading ? (
                <Skeleton className="h-24 w-full rounded-xl sm:h-40" />
              ) : (
                <div className="grid grid-cols-2 gap-2 sm:gap-4 lg:grid-cols-4">
                  {ROLE_DEFINITIONS.map((role) => {
                    const meta = roleMeta[role.value];
                    const count = roleCounts[role.value] ?? 0;
                    return (
                      <button
                        key={role.value}
                        type="button"
                        onClick={() => setSelectedRoleForDialog(role.value)}
                        className={`group relative overflow-hidden rounded-lg border bg-gradient-to-br p-2.5 text-left shadow-sm transition-all hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-1 sm:rounded-xl sm:border-2 sm:p-4 ${meta?.accent ?? ""}`}
                      >
                        <div className="flex items-start justify-between gap-1">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-background/80 text-foreground shadow-sm sm:h-10 sm:w-10 sm:rounded-lg">
                            {meta?.icon}
                          </span>
                          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-semibold sm:h-6 sm:text-xs">
                            {count}
                          </Badge>
                        </div>
                        <h3 className="mt-1.5 text-xs font-semibold text-foreground sm:mt-3 sm:text-base">
                          {role.label}
                        </h3>
                        <p className="mt-0.5 line-clamp-2 text-[10px] leading-snug text-muted-foreground sm:mt-1 sm:line-clamp-none sm:text-xs sm:leading-relaxed">
                          {role.description}
                        </p>
                        <p className="mt-1 hidden text-xs text-muted-foreground/90 sm:block">
                          {role.dashboardAccess}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl sm:border-2">
            <CardHeader className="border-b bg-muted/20 p-3 sm:p-6 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:gap-3 sm:text-xl">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/15 text-blue-600 dark:text-blue-400 sm:h-10 sm:w-10 sm:rounded-xl">
                  <KeyRound className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                Client Features
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Grant or revoke per user in Assign.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-3 sm:p-6 sm:pt-4">
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                {CLIENT_FEATURES_CONFIG.map((f) => (
                  <div
                    key={f.value}
                    className="flex flex-col rounded-lg border bg-card p-2.5 shadow-sm sm:rounded-xl sm:border-2 sm:p-4"
                  >
                    <span className="text-xs font-semibold text-foreground sm:text-sm">{f.label}</span>
                    <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:mt-1 sm:text-sm sm:leading-relaxed">
                      {f.description}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl sm:border-2">
            <CardHeader className="border-b bg-muted/20 p-3 sm:p-6 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:gap-3 sm:text-xl">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15 text-violet-600 dark:text-violet-400 sm:h-10 sm:w-10 sm:rounded-xl">
                  <ShieldCheck className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                Admin Features
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Sub admins only see modules they are granted.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-3 pt-3 sm:p-6 sm:pt-4">
              <div className="grid gap-2 sm:grid-cols-2 sm:gap-3 lg:grid-cols-3">
                {ADMIN_FEATURES_CONFIG.map((f) => (
                  <div
                    key={f.value}
                    className="flex flex-col rounded-lg border bg-card p-2.5 shadow-sm sm:rounded-xl sm:border-2 sm:p-4"
                  >
                    <span className="text-xs font-semibold text-foreground sm:text-sm">{f.label}</span>
                    <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground sm:mt-1 sm:text-sm sm:leading-relaxed">
                      {f.description}
                    </span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assign" className="mt-0">
          <Card className="min-w-0 overflow-hidden rounded-xl border shadow-sm sm:rounded-2xl sm:border-2">
            <CardHeader className="border-b bg-muted/20 p-3 sm:p-6 sm:pb-4">
              <CardTitle className="flex items-center gap-2 text-base sm:gap-3 sm:text-xl">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary sm:h-10 sm:w-10 sm:rounded-xl">
                  <UserCog className="h-4 w-4 sm:h-5 sm:w-5" />
                </span>
                Assign roles &amp; permissions
              </CardTitle>
              <CardDescription className="text-xs sm:text-sm">
                Select a user and update roles / features. Changes apply immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-3 pt-3 sm:space-y-6 sm:p-6 sm:pt-4">
              <div className="space-y-1.5 sm:space-y-2">
                <label className="text-xs font-medium sm:text-sm">Select user</label>
                <Popover
                  open={userSelectOpen}
                  onOpenChange={(open) => {
                    setUserSelectOpen(open);
                    if (!open) setUserSelectSearch("");
                  }}
                >
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={userSelectOpen}
                      className="h-10 w-full max-w-md justify-between rounded-lg border font-normal sm:h-11 sm:rounded-xl sm:border-2"
                    >
                      <span className="truncate">
                        {selectedUser
                          ? formatUserDisplayName(selectedUser, { showEmail: true })
                          : "Choose a user..."}
                      </span>
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] max-w-md p-0"
                    align="start"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <div className="border-b p-2">
                      <div className="relative">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          placeholder="Search name or email…"
                          value={userSelectSearch}
                          onChange={(e) => setUserSelectSearch(e.target.value)}
                          className="h-9 rounded-lg pl-8"
                          autoComplete="off"
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-muted-foreground">
                        {filteredUsersForSelect.length} user{filteredUsersForSelect.length !== 1 ? "s" : ""}
                        {userSelectSearch.trim() ? " match" : ""}
                      </p>
                    </div>
                    <ScrollArea className="h-[min(280px,50dvh)]">
                      <div className="p-1">
                        {filteredUsersForSelect.length === 0 ? (
                          <p className="py-6 text-center text-sm text-muted-foreground">No user found.</p>
                        ) : (
                          filteredUsersForSelect.map((u, index) => (
                            <button
                              key={u.uid || u.email || `user-${index}`}
                              type="button"
                              className="w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:outline-none"
                              onClick={() => {
                                setSelectedUserId(u.uid ?? "");
                                setUserSelectOpen(false);
                              }}
                            >
                              <span className="block truncate">
                                {formatUserDisplayName(u, { showEmail: true })}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>

              {selectedUser ? (
                <div className="rounded-lg border bg-card p-2.5 shadow-sm sm:rounded-xl sm:border-2 sm:p-6">
                  <RoleFeatureManagement
                    user={selectedUser}
                    onSuccess={() => {
                      setSelectedUserId("");
                    }}
                  />
                </div>
              ) : (
                <p className="py-6 text-center text-xs text-muted-foreground sm:py-10 sm:text-sm">
                  Select a user above to manage their roles and permissions.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locations" className="mt-0">
          <AssignLocationTab />
        </TabsContent>

        <TabsContent value="logs" className="mt-0">
          <RolesPermissionsLogsTab />
        </TabsContent>
      </Tabs>

      <Dialog open={selectedRoleForDialog !== null} onOpenChange={(open) => !open && setSelectedRoleForDialog(null)}>
        <DialogContent className="flex max-h-[100dvh] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh]">
          <DialogHeader className="shrink-0 border-b p-4 text-left sm:p-6 sm:pb-4">
            <DialogTitle className="text-base sm:text-lg">
              {selectedRoleForDialog ? roleLabelByValue[selectedRoleForDialog] : ""} — Users
            </DialogTitle>
            <DialogDescription className="text-xs sm:text-sm">
              {usersWithSelectedRole.length} user{usersWithSelectedRole.length !== 1 ? "s" : ""} with this role.
            </DialogDescription>
          </DialogHeader>
          <div className="shrink-0 space-y-1.5 border-b px-4 py-3 sm:px-6">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search by name or email…"
                value={dialogUserSearch}
                onChange={(e) => setDialogUserSearch(e.target.value)}
                className="h-9 rounded-lg border pl-9 sm:h-10 sm:rounded-xl"
              />
            </div>
            <p className="text-[11px] text-muted-foreground sm:text-xs">
              {filteredDialogUsers.length} of {usersWithSelectedRole.length} shown
            </p>
          </div>
          <ScrollArea className="min-h-0 flex-1 px-4 py-3 sm:px-6 sm:pb-6">
            <ul className="space-y-1.5 pb-4 pr-2 sm:space-y-2">
              {filteredDialogUsers.length === 0 ? (
                <li className="py-8 text-center text-sm text-muted-foreground">
                  No users match your search.
                </li>
              ) : (
                filteredDialogUsers.map((u, index) => {
                  const roles = getUserRoles(u);
                  return (
                    <li
                      key={u.uid || u.email || `dialog-user-${index}`}
                      className="flex flex-col gap-1 rounded-lg border border-border/60 bg-muted/20 px-2.5 py-2 sm:gap-1.5 sm:rounded-xl sm:px-3 sm:py-2.5"
                    >
                      <span className="truncate text-xs font-medium text-foreground sm:text-sm">
                        {formatUserDisplayName(u, { showEmail: true })}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {roles.map((r) => (
                          <Badge key={r} variant="secondary" className="h-5 px-1.5 text-[10px] font-medium sm:text-xs">
                            {roleLabelByValue[r]}
                          </Badge>
                        ))}
                      </div>
                    </li>
                  );
                })
              )}
            </ul>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
