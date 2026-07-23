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
    admin: { icon: <Crown className="h-5 w-5" />, accent: "from-violet-500/15 to-purple-600/10 border-violet-200 dark:border-violet-800/50" },
    user: { icon: <User className="h-5 w-5" />, accent: "from-blue-500/15 to-cyan-500/10 border-blue-200 dark:border-blue-800/50" },
    commission_agent: { icon: <HandCoins className="h-5 w-5" />, accent: "from-emerald-500/15 to-teal-500/10 border-emerald-200 dark:border-emerald-800/50" },
    sub_admin: { icon: <UserCog className="h-5 w-5" />, accent: "from-amber-500/15 to-orange-500/10 border-amber-200 dark:border-amber-800/50" },
  };

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-primary/5 via-background to-primary/5 px-6 py-8 shadow-sm">
        <div className="relative flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary shadow-inner">
              <ShieldCheck className="h-6 w-6" />
            </span>
            Roles & Permissions
          </h1>
          <p className="text-muted-foreground max-w-xl">
            Full control over roles and feature access. Assign roles and granular permissions to users.
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "overview" | "assign" | "locations" | "logs")}>
        <TabsList className="inline-flex h-14 w-full max-w-4xl rounded-2xl border-2 border-border/60 bg-gradient-to-r from-muted/60 to-muted/40 p-1.5 shadow-sm">
          <TabsTrigger
            value="overview"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all duration-200 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-md"
          >
            <ListChecks className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="assign"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all duration-200 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-md"
          >
            <UserCog className="h-4 w-4" />
            Assign to User
          </TabsTrigger>
          <TabsTrigger
            value="locations"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all duration-200 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-md"
          >
            <MapPin className="h-4 w-4" />
            Assign Location
          </TabsTrigger>
          <TabsTrigger
            value="logs"
            className="flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-medium transition-all duration-200 data-[state=inactive]:text-muted-foreground data-[state=inactive]:hover:text-foreground data-[state=active]:bg-background data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-md"
          >
            <ScrollText className="h-4 w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-8 mt-8">
          <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
            <CardHeader className="border-b bg-muted/20 pb-6">
              <CardTitle className="flex items-center gap-3 text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <Users className="h-5 w-5" />
                </span>
                Roles
              </CardTitle>
              <CardDescription className="text-base">
                System roles. Users can have multiple roles and get access to all corresponding dashboards.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              {usersLoading ? (
                <Skeleton className="h-40 w-full rounded-xl" />
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
                  {ROLE_DEFINITIONS.map((role) => {
                    const meta = roleMeta[role.value];
                    const count = roleCounts[role.value] ?? 0;
                    return (
                      <button
                        key={role.value}
                        type="button"
                        onClick={() => setSelectedRoleForDialog(role.value)}
                        className={`group relative text-left overflow-hidden rounded-xl border-2 bg-gradient-to-br ${meta?.accent ?? ""} p-5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-background/80 text-foreground shadow-sm">
                            {meta?.icon}
                          </span>
                          <Badge variant="secondary" className="shrink-0 font-semibold">
                            {count} users
                          </Badge>
                        </div>
                        <h3 className="mt-3 font-semibold text-foreground">{role.label}</h3>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{role.description}</p>
                        <p className="mt-2 text-xs text-muted-foreground/90">{role.dashboardAccess}</p>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
            <CardHeader className="border-b bg-muted/20 pb-6">
              <CardTitle className="flex items-center gap-3 text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400">
                  <KeyRound className="h-5 w-5" />
                </span>
                Client Features
              </CardTitle>
              <CardDescription className="text-base">
                Permissions for the client dashboard. Grant or revoke per user in Assign to User.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {CLIENT_FEATURES_CONFIG.map((f) => (
                  <div
                    key={f.value}
                    className="flex flex-col rounded-xl border-2 border-border/60 bg-card p-4 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md"
                  >
                    <span className="font-semibold text-foreground">{f.label}</span>
                    <span className="mt-1 text-sm text-muted-foreground leading-relaxed">{f.description}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
            <CardHeader className="border-b bg-muted/20 pb-6">
              <CardTitle className="flex items-center gap-3 text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/15 text-violet-600 dark:text-violet-400">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                Admin Features
              </CardTitle>
              <CardDescription className="text-base">
                Permissions for the admin panel. Sub admins only see modules for which they have the matching feature.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {ADMIN_FEATURES_CONFIG.map((f) => (
                  <div
                    key={f.value}
                    className="flex flex-col rounded-xl border-2 border-border/60 bg-card p-4 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md"
                  >
                    <span className="font-semibold text-foreground">{f.label}</span>
                    <span className="mt-1 text-sm text-muted-foreground leading-relaxed">{f.description}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="assign" className="mt-8">
          <Card className="overflow-hidden rounded-2xl border-2 shadow-sm">
            <CardHeader className="border-b bg-muted/20 pb-6">
              <CardTitle className="flex items-center gap-3 text-xl">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <UserCog className="h-5 w-5" />
                </span>
                Assign roles and permissions
              </CardTitle>
              <CardDescription className="text-base">
                Select a user and update their roles and feature access. Changes take effect immediately.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6 pt-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">Select user</label>
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
                      className="w-full max-w-md justify-between rounded-xl border-2 h-11 font-normal"
                    >
                      {selectedUser
                        ? formatUserDisplayName(selectedUser, { showEmail: true })
                        : "Choose a user..."}
                      <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="w-[var(--radix-popover-trigger-width)] max-w-md p-0"
                    align="start"
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <div className="p-2 border-b">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                        <Input
                          placeholder="Search users by name or email..."
                          value={userSelectSearch}
                          onChange={(e) => setUserSelectSearch(e.target.value)}
                          className="pl-8 h-10 rounded-lg"
                          autoComplete="off"
                        />
                      </div>
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {filteredUsersForSelect.length} user{filteredUsersForSelect.length !== 1 ? "s" : ""}
                        {userSelectSearch.trim() ? " match search" : ""}
                      </p>
                    </div>
                    <ScrollArea className="h-[280px]">
                      <div className="p-1">
                        {filteredUsersForSelect.length === 0 ? (
                          <p className="py-6 text-center text-sm text-muted-foreground">No user found.</p>
                        ) : (
                          filteredUsersForSelect.map((u) => (
                            <button
                              key={u.uid}
                              type="button"
                              className="w-full text-left rounded-lg px-3 py-2.5 text-sm font-medium text-foreground hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground focus:outline-none"
                              onClick={() => {
                                setSelectedUserId(u.uid ?? "");
                                setUserSelectOpen(false);
                              }}
                            >
                              {formatUserDisplayName(u, { showEmail: true })}
                            </button>
                          ))
                        )}
                      </div>
                    </ScrollArea>
                  </PopoverContent>
                </Popover>
              </div>

              {selectedUser ? (
                <div className="rounded-xl border-2 border-border/60 bg-card p-6 shadow-sm">
                  <RoleFeatureManagement
                    user={selectedUser}
                    onSuccess={() => {
                      setSelectedUserId("");
                    }}
                  />
                </div>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Select a user above to manage their roles and permissions.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="locations" className="mt-8">
          <AssignLocationTab />
        </TabsContent>

        <TabsContent value="logs" className="mt-8">
          <RolesPermissionsLogsTab />
        </TabsContent>
      </Tabs>

      <Dialog open={selectedRoleForDialog !== null} onOpenChange={(open) => !open && setSelectedRoleForDialog(null)}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[90vh] flex flex-col gap-4 p-0">
          <DialogHeader className="px-6 pt-6 pb-0">
            <DialogTitle>
              {selectedRoleForDialog ? roleLabelByValue[selectedRoleForDialog] : ""} — Users
            </DialogTitle>
            <DialogDescription>
              {usersWithSelectedRole.length} user{usersWithSelectedRole.length !== 1 ? "s" : ""} with this role.
              Each user shows all of their role tags.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search by name or email..."
                value={dialogUserSearch}
                onChange={(e) => setDialogUserSearch(e.target.value)}
                className="pl-9 h-10 rounded-xl border-2"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {filteredDialogUsers.length} of {usersWithSelectedRole.length} shown
            </p>
          </div>
          <ScrollArea className="h-[50vh] min-h-[240px] max-h-[420px] px-6 pb-6">
            <ul className="space-y-2 pr-4 pb-4">
              {filteredDialogUsers.length === 0 ? (
                <li className="py-8 text-center text-sm text-muted-foreground">
                  No users match your search.
                </li>
              ) : (
                filteredDialogUsers.map((u) => {
                  const roles = getUserRoles(u);
                  return (
                    <li
                      key={u.uid}
                      className="flex flex-col gap-1.5 rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 hover:bg-muted/30 transition-colors"
                    >
                      <span className="font-medium text-foreground text-sm">
                        {formatUserDisplayName(u, { showEmail: true })}
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {roles.map((r) => (
                          <Badge key={r} variant="secondary" className="text-xs font-medium">
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
