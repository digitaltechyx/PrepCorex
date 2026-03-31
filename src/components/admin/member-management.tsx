"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useCollection } from "@/hooks/use-collection";
import { doc, updateDoc, deleteDoc } from "firebase/firestore";
import { deleteUser } from "firebase/auth";
import { db, auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, User, Calendar, Phone, Mail, Eye, Trash2, UserCheck, RotateCcw, Search, X, ArrowUpDown, Edit, Shield } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import type { UserProfile } from "@/types";
import { EditUserForm } from "./edit-user-form";
import { RoleFeatureManagement } from "./role-feature-management";
import { getDefaultFeaturesForRole, getUserRoles } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";

interface MemberManagementProps {
  adminUser: UserProfile | null;
  /** Initial tab from URL (e.g. ?status=pending) so dashboard cards can open the right tab */
  initialStatus?: "pending" | "approved" | "deleted" | null;
  /** When provided, use this list instead of fetching (e.g. sub admin managed users) */
  usersOverride?: UserProfile[];
  /** When true, hide approve/reject/edit/delete and role editing (sub admin view-only) */
  viewOnly?: boolean;
}

export function MemberManagement({ adminUser, initialStatus, usersOverride, viewOnly }: MemberManagementProps) {
  const { data: usersFromCollection, loading } = useCollection<UserProfile>("users");
  const users = usersOverride ?? usersFromCollection;
  const usersLoading = usersOverride !== undefined ? false : loading;
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<"a-z" | "z-a">("a-z");
  const itemsPerPage = 12;

  // Filter users and apply search
  // Requirement: show all users in User Management, regardless of role.
  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch = searchQuery === "" || 
        user.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.companyName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        user.ein?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });
  }, [users, searchQuery]);

  // Reset to page 1 when search query or sort order changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortOrder]);

  // Sort function for users - pin admin first, then sort others
  const sortUsers = (users: UserProfile[]) => {
    // Separate admin and other users
    const admin = users.find((user) => user.uid === adminUser?.uid);
    const others = users.filter((user) => user.uid !== adminUser?.uid);
    
    // Sort others
    const sortedOthers = others.sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return sortOrder === "a-z" 
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    });
    
    // Pin admin first, then others
    return admin ? [admin, ...sortedOthers] : sortedOthers;
  };

  // Separate users by status and sort
  const pendingUsers = sortUsers(filteredUsers.filter((user) => user.status === "pending"));
  const approvedUsers = sortUsers(filteredUsers.filter((user) => user.status === "approved" || !user.status));
  const deletedUsers = sortUsers(filteredUsers.filter((user) => user.status === "deleted"));

  // Get current tab users based on active tab
  const [activeTab, setActiveTab] = useState<"pending" | "approved" | "deleted">(
    initialStatus === "pending" || initialStatus === "approved" || initialStatus === "deleted" ? initialStatus : "pending"
  );

  useEffect(() => {
    if (initialStatus === "pending" || initialStatus === "approved" || initialStatus === "deleted") {
      setActiveTab(initialStatus);
    }
  }, [initialStatus]);

  const getCurrentTabUsers = () => {
    switch (activeTab) {
      case "pending":
        return pendingUsers;
      case "approved":
        return approvedUsers;
      case "deleted":
        return deletedUsers;
      default:
        return [];
    }
  };

  const currentTabUsers = getCurrentTabUsers();
  
  // Pagination logic
  const totalPages = Math.ceil(currentTabUsers.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedUsers = currentTabUsers.slice(startIndex, endIndex);

  // Reset to page 1 when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value as "pending" | "approved" | "deleted");
    setCurrentPage(1);
  };

  const handleApproveUser = async (user: UserProfile) => {
    try {
      const userRoles = getUserRoles(user);
      const updateData: any = {
        status: "approved",
        approvedAt: new Date(),
      };

      // If user doesn't have features yet, give them default features based on their role
      if (!user.features || user.features.length === 0) {
        // Get all default features for all user roles
        const defaultFeatures: string[] = [];
        userRoles.forEach((role) => {
          const roleFeatures = getDefaultFeaturesForRole(role);
          roleFeatures.forEach((feature) => {
            if (!defaultFeatures.includes(feature)) {
              defaultFeatures.push(feature);
            }
          });
        });
        updateData.features = defaultFeatures;
      }

      // Ensure roles array is set
      if (!user.roles || user.roles.length === 0) {
        updateData.roles = userRoles.length > 0 ? userRoles : [user.role || "user"];
      }

      await updateDoc(doc(db, "users", user.uid), updateData);

      toast({
        title: "Success",
        description: `User "${user.name}" has been approved!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to approve user.",
      });
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    try {
      // Mark user as deleted in Firestore
      await updateDoc(doc(db, "users", user.uid), {
        status: "deleted",
        deletedAt: new Date(),
      });

      toast({
        title: "Success",
        description: `User "${user.name}" has been moved to deleted members!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete user.",
      });
    }
  };

  const handleRestoreUser = async (user: UserProfile) => {
    try {
      // Restore user by changing status back to approved
      await updateDoc(doc(db, "users", user.uid), {
        status: "approved",
        approvedAt: new Date(),
        deletedAt: null,
      });

      toast({
        title: "Success",
        description: `User "${user.name}" has been restored successfully!`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to restore user.",
      });
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return "U";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const formatDate = (date: any) => {
    if (!date) return "N/A";
    
    try {
      let dateObj: Date;
      
      // Handle Firestore timestamp
      if (date && typeof date === 'object' && date.seconds) {
        dateObj = new Date(date.seconds * 1000);
      }
      // Handle regular Date object
      else if (date instanceof Date) {
        dateObj = date;
      }
      // Handle string or number
      else {
        dateObj = new Date(date);
      }
      
      // Check if the date is valid
      if (isNaN(dateObj.getTime())) {
        return "N/A";
      }
      
      return format(dateObj, "MMM dd, yyyy");
    } catch (error) {
      console.error("Error formatting date:", error);
      return "N/A";
    }
  };

  const UserCard = ({ user, showActions = false, showRestore = false, isAdmin = false }: { user: UserProfile; showActions?: boolean; showRestore?: boolean; isAdmin?: boolean }) => {
    const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
    const [isUserEditMode, setIsUserEditMode] = useState(false);
    const [activeTab, setActiveTab] = useState<"details" | "roles">("details");

    const getAvatarSrc = () => {
      if (user.profilePictureUrl) {
        return user.profilePictureUrl;
      }
      if (user.email) {
        return `https://avatar.vercel.sh/${encodeURIComponent(user.email)}.png`;
      }
      return undefined;
    };
    
    return (
      <div className="rounded-lg border bg-card px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex items-start gap-3">
            <Avatar className="h-10 w-10 flex-shrink-0">
              <AvatarImage src={getAvatarSrc()} />
              <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-sm sm:text-base truncate">{formatUserDisplayName(user, { showEmail: false })}</h3>
                <Badge
                  variant={
                    user.status === "approved" || !user.status ? "default" :
                    user.status === "pending" ? "secondary" : "destructive"
                  }
                  className="text-[10px] sm:text-xs"
                >
                  {user.status === "approved" || !user.status ? "Approved" :
                   user.status === "pending" ? "Pending" : "Deleted"}
                </Badge>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs sm:text-sm text-muted-foreground">
                <span className="truncate">{user.email}</span>
                {user.phone && (
                  <span className="inline-flex items-center gap-1">
                    <Phone className="h-3 w-3" />
                    {user.phone}
                  </span>
                )}
                {user.companyName && <span className="truncate">Company: {user.companyName}</span>}
              </div>
              {isAdmin && (user.status === "approved" || !user.status) && (
                <div className="mt-1.5 text-[11px] sm:text-xs text-muted-foreground">
                  <span className="font-medium">Login:</span>{" "}
                  <span className="font-mono">{user.email}</span>{" "}
                  <span className="font-medium">| Password:</span>{" "}
                  <span className="font-mono">{user.password || "Not stored"}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 lg:shrink-0">
          <Tooltip>
            <TooltipTrigger asChild>
                <Dialog
                  open={isUserDialogOpen}
                  onOpenChange={(open) => {
                    setIsUserDialogOpen(open);
                    if (!open) {
                      setIsUserEditMode(false);
                    }
                  }}
                >
                <DialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={() => {
                        setIsUserDialogOpen(true);
                        setIsUserEditMode(false);
                      }}
                    >
                    <Eye className="h-4 w-4" />
                  </Button>
                </DialogTrigger>
                  <DialogContent className="max-w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                      <div className="flex items-center justify-between">
                        <div>
                          <DialogTitle>{isUserEditMode ? "Edit User" : "User Details"}</DialogTitle>
                      <DialogDescription>
                            {isUserEditMode ? "Update user information." : "Complete information about this user."}
                      </DialogDescription>
                        </div>
                        {!isUserEditMode && isAdmin && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setIsUserEditMode(true);
                            }}
                            className="ml-auto"
                            type="button"
                          >
                            <Edit className="h-4 w-4 mr-2" />
                            Edit
                          </Button>
                        )}
                      </div>
                    </DialogHeader>
                    {isUserEditMode && isAdmin ? (
                      <EditUserForm
                        user={user}
                        onSuccess={() => {
                          setIsUserEditMode(false);
                          setIsUserDialogOpen(false);
                        }}
                        onCancel={() => setIsUserEditMode(false)}
                      />
                    ) : isAdmin ? (
                      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "details" | "roles")} className="w-full">
                        <TabsList className="grid w-full grid-cols-2">
                          <TabsTrigger value="details" className="flex items-center gap-2">
                            <User className="h-4 w-4" />
                            Details
                          </TabsTrigger>
                          <TabsTrigger value="roles" className="flex items-center gap-2">
                            <Shield className="h-4 w-4" />
                            Roles & Features
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="details" className="mt-4">
                    <div className="space-y-4">
                      <div className="flex items-center space-x-3">
                        <Avatar className="h-12 w-12">
                          <AvatarImage src={`https://avatar.vercel.sh/${user.email}.png`} />
                          <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold">{user.name}</h3>
                          <p className="text-sm text-muted-foreground">{user.email}</p>
                        </div>
                      </div>
                      
                      {/* Personal Information */}
                      <div className="space-y-3">
                        <h4 className="font-semibold text-sm border-b pb-1">Personal Information</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="font-medium">Role:</span>
                            <p className="text-muted-foreground capitalize">{user.role}</p>
                          </div>
                          <div>
                            <span className="font-medium">Status:</span>
                            <p className="text-muted-foreground capitalize">{user.status || "N/A"}</p>
                          </div>
                          <div>
                            <span className="font-medium">Phone:</span>
                            <p className="text-muted-foreground">{user.phone || "N/A"}</p>
                          </div>
                          <div>
                            <span className="font-medium">Created:</span>
                            <p className="text-muted-foreground">{formatDate(user.createdAt)}</p>
                          </div>
                          {user.approvedAt && (
                            <div>
                              <span className="font-medium">Approved:</span>
                              <p className="text-muted-foreground">{formatDate(user.approvedAt)}</p>
                            </div>
                          )}
                          {user.referredBy && (
                            <>
                              <div>
                                <span className="font-medium">Referred By:</span>
                                <p className="text-muted-foreground font-mono">{user.referredBy}</p>
                              </div>
                              {user.referredByAgentId && (() => {
                                const agent = users.find(u => u.uid === user.referredByAgentId);
                                return (
                                  <div>
                                    <span className="font-medium">Agent Name:</span>
                                    <p className="text-muted-foreground">{agent?.name || "N/A"}</p>
                                  </div>
                                );
                              })()}
                            </>
                          )}
                        </div>
                      </div>

                      {/* Company Information */}
                      {(user.companyName || user.ein) && (
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm border-b pb-1">Company Information</h4>
                          <div className="grid grid-cols-1 gap-3 text-sm">
                            {user.companyName && (
                              <div>
                                <span className="font-medium">Company Name:</span>
                                <p className="text-muted-foreground">{user.companyName}</p>
                              </div>
                            )}
                            {user.ein && (
                              <div>
                                <span className="font-medium">EIN:</span>
                                <p className="text-muted-foreground font-mono">{user.ein}</p>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Address Information */}
                      {(user.address || user.city || user.state || user.zipCode) && (
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm border-b pb-1">Address Information</h4>
                          <div className="grid grid-cols-1 gap-3 text-sm">
                            {user.address && (
                              <div>
                                <span className="font-medium">Address:</span>
                                <p className="text-muted-foreground">{user.address}</p>
                              </div>
                            )}
                            <div className="grid grid-cols-3 gap-3">
                              {user.city && (
                                <div>
                                  <span className="font-medium">City:</span>
                                  <p className="text-muted-foreground">{user.city}</p>
                                </div>
                              )}
                              {user.state && (
                                <div>
                                  <span className="font-medium">State:</span>
                                  <p className="text-muted-foreground">{user.state}</p>
                                </div>
                              )}
                              {user.zipCode && (
                                <div>
                                  <span className="font-medium">Zip Code:</span>
                                  <p className="text-muted-foreground font-mono">{user.zipCode}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                        </TabsContent>
                        <TabsContent value="roles" className="mt-4">
                          <RoleFeatureManagement
                            user={user}
                            onSuccess={() => {
                              // Refresh will happen automatically via useCollection
                            }}
                          />
                        </TabsContent>
                      </Tabs>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center space-x-3">
                          <Avatar className="h-12 w-12">
                            <AvatarImage src={`https://avatar.vercel.sh/${user.email}.png`} />
                            <AvatarFallback>{getInitials(user.name)}</AvatarFallback>
                          </Avatar>
                          <div>
                            <h3 className="font-semibold">{user.name}</h3>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                        <div className="text-sm text-muted-foreground">
                          <p>Role: {getUserRoles(user).join(", ") || user.role || "N/A"}</p>
                        </div>
                      </div>
                    )}
                  </DialogContent>
                </Dialog>
              </TooltipTrigger>
              <TooltipContent>
                <p>View user details</p>
              </TooltipContent>
            </Tooltip>

          {showActions && (
            <>
              {user.status === "pending" && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="default"
                      size="icon"
                      onClick={() => handleApproveUser(user)}
                      className="bg-green-600 hover:bg-green-700"
                    >
                      <UserCheck className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Approve user account</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
              <Button 
                variant="destructive" 
                    size="icon"
                onClick={() => handleDeleteUser(user)}
              >
                    <Trash2 className="h-4 w-4" />
              </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete user account</p>
                </TooltipContent>
              </Tooltip>
            </>
          )}

          {showRestore && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleRestoreUser(user)}
                  className="text-green-600 hover:text-green-700 hover:bg-green-50"
                >
                  <RotateCcw className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Restore user account</p>
              </TooltipContent>
            </Tooltip>
          )}
          </div>
        </div>
      </div>
    );
  };

  if (usersLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Member Management</CardTitle>
          <CardDescription>Loading members...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
              <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          Member Management
        </CardTitle>
        <CardDescription>
          Manage user approvals and view member details.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* Search Bar and Sort */}
        <div className="mb-6 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search members by name, email, or phone..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                className="absolute right-2 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                onClick={() => setSearchQuery("")}
              >
                <X className="h-3 w-3" />
              </Button>
            )}
          </div>
          <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as "a-z" | "z-a")}>
            <SelectTrigger className="w-full sm:w-[180px]">
              <ArrowUpDown className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="a-z">Sort A-Z</SelectItem>
              <SelectItem value="z-a">Sort Z-A</SelectItem>
            </SelectContent>
          </Select>
        </div>
        
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid grid-cols-3 w-full gap-1 sm:gap-0">
            <TabsTrigger value="pending" className="flex items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm">
              <XCircle className="h-4 w-4" />
              <span>Pending</span>
              <Badge variant="secondary" className="text-[10px] sm:text-xs">{pendingUsers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="approved" className="flex items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm">
              <CheckCircle className="h-4 w-4" />
              <span>Approved</span>
              <Badge variant="secondary" className="text-[10px] sm:text-xs">{approvedUsers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="deleted" className="flex items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm">
              <Trash2 className="h-4 w-4" />
              <span>Deleted</span>
              <Badge variant="secondary" className="text-[10px] sm:text-xs">{deletedUsers.length}</Badge>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="pending" className="mt-6">
            {pendingUsers.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `pending-user-${index}`} user={user} showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length} users
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-sm">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Pending Members</h3>
                <p className="text-muted-foreground">
                  All users have been processed.
                </p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="approved" className="mt-6">
            {approvedUsers.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `user-${index}`} user={user} showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length} users
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-sm">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <CheckCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Approved Members</h3>
                <p className="text-muted-foreground">
                  No users have been approved yet.
                </p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="deleted" className="mt-6">
            {deletedUsers.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `deleted-user-${index}`} user={user} showActions={false} showRestore={!viewOnly} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length} users
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <span className="text-sm">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <Trash2 className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Deleted Members</h3>
                <p className="text-muted-foreground">
                  No users have been deleted yet.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
    </TooltipProvider>
  );
}

