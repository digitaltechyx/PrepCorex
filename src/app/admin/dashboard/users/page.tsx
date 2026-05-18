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
import { getUserRoles, hasRole } from "@/lib/permissions";
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
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-green-500 to-emerald-600 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <Users className="h-6 w-6" />
                User Management
              </CardTitle>
              <CardDescription className="text-green-100 mt-2">
                Manage user accounts and approvals ({filteredUsers.length} users)
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Shield className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row gap-4 mb-6 pb-6 border-b">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, phone, or client ID..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 h-11 shadow-sm"
                />
              </div>
            </div>
            {!isSubAdmin && (
            <>
              {usersWithoutClientIdCount > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex items-center gap-2 shadow-sm"
                  onClick={handleAssignClientIds}
                  disabled={isAssigningIds}
                >
                  {isAssigningIds ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Hash className="h-4 w-4" />
                  )}
                  Assign client IDs ({usersWithoutClientIdCount})
                </Button>
              )}
              <Dialog open={showCreateUser} onOpenChange={setShowCreateUser}>
                <DialogTrigger asChild>
                  <Button className="flex items-center gap-2 shadow-sm">
                    <UserPlus className="h-4 w-4" />
                    Create User
                  </Button>
                </DialogTrigger>
              <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Create New User</DialogTitle>
                  <DialogDescription>
                    Add a new user to the inventory management system.
                  </DialogDescription>
                </DialogHeader>
                <CreateUserForm 
                  onSuccess={() => setShowCreateUser(false)}
                  onCancel={() => setShowCreateUser(false)}
                />
              </DialogContent>
            </Dialog>
            </>
            )}
          </div>

          <Tabs
            value={isSubAdmin ? "users" : activeTab}
            onValueChange={(v) => !isSubAdmin && setActiveTab(v as "users" | "commission_agents")}
            className="w-full"
          >
            <TabsList className={isSubAdmin ? "grid w-full grid-cols-1 mb-6" : "grid w-full grid-cols-2 mb-6"}>
              <TabsTrigger value="users" className="flex items-center gap-2">
                <Users className="h-4 w-4" />
                Users
                {pendingUsersCount > 0 && (
                  <Badge variant="destructive" className="ml-2">
                    {pendingUsersCount}
                  </Badge>
                )}
              </TabsTrigger>
              {!isSubAdmin && (
                <TabsTrigger value="commission_agents" className="flex items-center gap-2">
                  <UserCheck className="h-4 w-4" />
                  Commission Agents
                  {pendingCommissionAgentsCount > 0 && (
                    <Badge variant="destructive" className="ml-2">
                      {pendingCommissionAgentsCount}
                    </Badge>
                  )}
                </TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="users" className="mt-0">
              {usersLoading ? (
                <div className="space-y-4">
                  {[1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-32 w-full rounded-xl" />
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
                  <div className="space-y-4">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-32 w-full rounded-xl" />
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

