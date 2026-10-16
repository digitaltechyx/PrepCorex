"use client";

import React, { useState, useMemo, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import type { UserProfile } from "@/types";
import { useAuth } from "@/hooks/use-auth";
import { useManagedUsers } from "@/hooks/use-managed-users";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Search, Users, UserPlus, Shield, UserCheck } from "lucide-react";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { MemberManagement } from "@/components/admin/member-management";
import { CommissionAgentsManagement } from "@/components/admin/commission-agents-management";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { getUserRoles } from "@/lib/permissions";
import { assignClientIdsToExistingUsers } from "@/lib/client-id";
import { Hash, Loader2 } from "lucide-react";

export default function AdminUsersPage() {
  const searchParams = useSearchParams();
  const { userProfile: adminUser } = useAuth();
  const { toast } = useToast();
  const { managedUsers: users, loading: usersLoading, isSubAdmin } = useManagedUsers();
  const [searchTerm, setSearchTerm] = useState("");
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [isAssigningIds, setIsAssigningIds] = useState(false);
  const tabFromUrl = searchParams.get("tab");
  const statusFromUrl = searchParams.get("status") as "pending" | "approved" | "deleted" | null;
  const [activeTab, setActiveTab] = useState<"users" | "commission_agents">(
    tabFromUrl === "commission_agents" ? "commission_agents" : "users"
  );

  useEffect(() => {
    if (tabFromUrl === "commission_agents" || tabFromUrl === "users") {
      setActiveTab(tabFromUrl);
    }
  }, [tabFromUrl]);

  // Sub admin sees only Users (clients), not Commission Agents tab — force "users" tab
  useEffect(() => {
    if (isSubAdmin && activeTab === "commission_agents") {
      setActiveTab("users");
    }
  }, [isSubAdmin, activeTab]);

  const filteredUsers = useMemo(() => {
    return users
      .filter((user) => user.uid !== adminUser?.uid)
      .filter((user) => user.status !== "deleted")
      .filter((user) => {
        if (searchTerm === "") return true;
        const name = user.name?.toLowerCase() || "";
        const email = user.email?.toLowerCase() || "";
        const phone = user.phone?.toLowerCase() || "";
        const clientId = user.clientId?.toLowerCase() || "";
        const term = searchTerm.toLowerCase();
        return name.includes(term) || email.includes(term) || phone.includes(term) || clientId.includes(term);
      });
  }, [users, adminUser, searchTerm]);

  // Count pending commission agents
  const pendingCommissionAgentsCount = useMemo(() => {
    return users.filter((user) => {
      const userRoles = getUserRoles(user);
      return userRoles.includes("commission_agent") && user.status === "pending";
    }).length;
  }, [users]);

  const pendingUsersCount = users.filter((user) => 
    user.uid !== adminUser?.uid && user.status === "pending"
  ).length;

  const usersWithoutClientIdCount = useMemo(
    () => users.filter((u) => u.uid && !u.clientId).length,
    [users]
  );

  const handleAssignClientIds = async () => {
    if (usersWithoutClientIdCount === 0) return;
    setIsAssigningIds(true);
    try {
      const { assigned, errors } = await assignClientIdsToExistingUsers(users);
      if (errors.length > 0) {
        toast({
          variant: "destructive",
          title: "Partially complete",
          description: `Assigned ${assigned} client ID(s). ${errors.length} error(s): ${errors.slice(0, 2).join("; ")}${errors.length > 2 ? "…" : ""}`,
        });
      } else {
        toast({
          title: "Done",
          description: `Assigned client IDs to ${assigned} user(s). The list will update automatically.`,
        });
      }
    } catch (e) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e instanceof Error ? e.message : "Failed to assign client IDs.",
      });
    } finally {
      setIsAssigningIds(false);
    }
  };

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-green-500 to-emerald-600 pb-3 text-white sm:pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
                <Users className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                User Management
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-green-100 sm:mt-2 sm:text-sm">
                Manage accounts &amp; approvals ({filteredUsers.length})
              </CardDescription>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:flex">
              <Shield className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          <div className="mb-3 flex flex-col gap-2 border-b pb-3 sm:mb-4 sm:flex-row sm:gap-3 sm:pb-4">
            <div className="min-w-0 flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
                <Input
                  placeholder="Search name, email, phone, ID…"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="h-9 pl-10 shadow-sm sm:h-10"
                />
              </div>
            </div>
            {!isSubAdmin && (
              <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
                {usersWithoutClientIdCount > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-9 w-full shadow-sm sm:w-auto"
                    onClick={handleAssignClientIds}
                    disabled={isAssigningIds}
                  >
                    {isAssigningIds ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Hash className="h-4 w-4" />
                    )}
                    <span className="ml-2">Assign IDs ({usersWithoutClientIdCount})</span>
                  </Button>
                )}
                <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
                  <DialogTrigger asChild>
                    <Button size="sm" className="h-9 w-full shadow-sm sm:w-auto">
                      <UserPlus className="mr-2 h-4 w-4" />
                      Create User
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="flex max-h-[100dvh] w-[calc(100%-1.5rem)] max-w-lg flex-col gap-0 overflow-hidden p-0 sm:max-h-[90vh]">
                    <DialogHeader className="shrink-0 border-b p-4 text-left sm:p-6">
                      <DialogTitle>Create New User</DialogTitle>
                      <DialogDescription className="text-xs sm:text-sm">
                        Add a new user to the inventory management system.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
                      <CreateUserForm
                        onSuccess={() => setShowCreateUser(false)}
                        onCancel={() => setShowCreateUser(false)}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            )}
          </div>

          <Tabs
            value={isSubAdmin ? "users" : activeTab}
            onValueChange={(v) => !isSubAdmin && setActiveTab(v as "users" | "commission_agents")}
            className="w-full min-w-0"
          >
            <TabsList className={isSubAdmin ? "mb-3 grid h-auto w-full grid-cols-1" : "mb-3 grid h-auto w-full grid-cols-2 gap-1 p-1"}>
              <TabsTrigger value="users" className="gap-1 px-2 py-1.5 text-xs sm:gap-2 sm:px-3 sm:text-sm">
                <Users className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Users
                {pendingUsersCount > 0 && (
                  <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">
                    {pendingUsersCount}
                  </Badge>
                )}
              </TabsTrigger>
              {!isSubAdmin && (
                <TabsTrigger value="commission_agents" className="gap-1 px-2 py-1.5 text-xs sm:gap-2 sm:px-3 sm:text-sm">
                  <UserCheck className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                  <span className="sm:hidden">Agents</span>
                  <span className="hidden sm:inline">Commission Agents</span>
                  {pendingCommissionAgentsCount > 0 && (
                    <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">
                      {pendingCommissionAgentsCount}
                    </Badge>
                  )}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="users" className="mt-0">
              {usersLoading ? (
                <div className="space-y-1.5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <Skeleton key={i} className="h-14 w-full rounded-lg" />
                  ))}
                </div>
              ) : (
                <MemberManagement
                  adminUser={adminUser}
                  initialStatus={statusFromUrl}
                  usersOverride={users}
                  viewOnly={isSubAdmin}
                  searchQuery={searchTerm}
                  onSearchQueryChange={setSearchTerm}
                />
              )}
            </TabsContent>

            {!isSubAdmin && (
              <TabsContent value="commission_agents" className="mt-0">
                {usersLoading ? (
                  <div className="space-y-1.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Skeleton key={i} className="h-14 w-full rounded-lg" />
                    ))}
                  </div>
                ) : (
                  <CommissionAgentsManagement adminUser={adminUser} />
                )}
              </TabsContent>
            )}
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
