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
import { db, auth } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, User, Calendar, Phone, Mail, Eye, Trash2, UserCheck, RotateCcw, Search, X, ArrowUpDown, Edit, Shield, ScrollText, Lock, ShieldBan, ShieldCheck, MailCheck } from "lucide-react";
import { CheckCircle, XCircle, User, Calendar, Phone, Mail, Eye, Trash2, UserCheck, RotateCcw, Search, X, ArrowUpDown, Edit, Shield, ScrollText } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import type { UserProfile } from "@/types";
import { EditUserForm } from "./edit-user-form";
import { RoleFeatureManagement } from "./role-feature-management";
import { UserAuditTrailPanel } from "./user-audit-trail-panel";
import { getUserRoles } from "@/lib/permissions";
import { formatUserDisplayName } from "@/lib/format-user-display";
import {
  asDateValue,
  getDaysSinceDate,
  isClientPortalAccount,
} from "@/lib/client-account-status";

type MemberTab = "pending" | "approved" | "locked" | "disabled" | "deleted";

function toLocalDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function getUserApprovedDateKey(user: UserProfile): string | null {
  const d = asDateValue(user.approvedAt);
  return d ? toLocalDateKey(d) : null;
}

function getUserAccountAgeLabel(user: UserProfile): string | null {
  const anchor = asDateValue(user.createdAt) || asDateValue(user.approvedAt);
  if (!anchor) return null;
  const days = getDaysSinceDate(anchor);
  if (days <= 0) return "New today";
  if (days === 1) return "1 day old";
  if (days < 30) return `${days} days old`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 mo old" : `${months} mo old`;
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days % 365) / 30);
  if (years === 1 && remMonths === 0) return "1 yr old";
  if (remMonths === 0) return `${years} yr old`;
  return `${years}y ${remMonths}m old`;
}

interface MemberManagementProps {
  adminUser: UserProfile | null;
  /** Initial tab from URL (e.g. ?status=pending) so dashboard cards can open the right tab */
  initialStatus?: MemberTab | null;
  /** When provided, use this list instead of fetching (e.g. sub admin managed users) */
  usersOverride?: UserProfile[];
  /** When true, hide approve/reject/edit/delete and role editing (sub admin view-only) */
  viewOnly?: boolean;
  /** Optional controlled search (sync with parent page search bar) */
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
}

export function MemberManagement({
  adminUser,
  initialStatus,
  usersOverride,
  viewOnly,
  searchQuery: controlledSearchQuery,
  onSearchQueryChange,
}: MemberManagementProps) {
  const { data: usersFromCollection, loading } = useCollection<UserProfile>("users");
  const users = usersOverride ?? usersFromCollection;
  const usersLoading = usersOverride !== undefined ? false : loading;
  const { toast } = useToast();
  const [localSearchQuery, setLocalSearchQuery] = useState("");
  const searchQuery = controlledSearchQuery ?? localSearchQuery;
  const setSearchQuery = onSearchQueryChange ?? setLocalSearchQuery;
  const [approvedOnDate, setApprovedOnDate] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<"a-z" | "z-a">("a-z");
  const [accountActionUid, setAccountActionUid] = useState<string | null>(null);
  const itemsPerPage = 12;

  // Filter users and apply search + optional approved-on date
  // Requirement: show all users in User Management, regardless of role.
  const filteredUsers = useMemo(() => {
    const term = searchQuery.trim().toLowerCase();
    return users.filter((user) => {
      if (approvedOnDate) {
        const key = getUserApprovedDateKey(user);
        if (key !== approvedOnDate) return false;
      }
      if (!term) return true;
      const fields = [
        user.name,
        user.email,
        user.phone,
        user.companyName,
        user.ein,
        user.clientId,
      ];
      return fields.some((value) => String(value ?? "").toLowerCase().includes(term));
    });
  }, [users, searchQuery, approvedOnDate]);

  const approvedOnDateCount = useMemo(() => {
    if (!approvedOnDate) return 0;
    return users.filter((user) => getUserApprovedDateKey(user) === approvedOnDate).length;
  }, [users, approvedOnDate]);

  // Reset to page 1 when search query, sort order, or date filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortOrder, approvedOnDate]);

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
  const approvedUsers = sortUsers(
    filteredUsers.filter((user) => user.status === "approved" || !user.status)
  );
  const lockedUsers = sortUsers(filteredUsers.filter((user) => user.status === "locked"));
  const disabledUsers = sortUsers(filteredUsers.filter((user) => user.status === "disabled"));
  const deletedUsers = sortUsers(filteredUsers.filter((user) => user.status === "deleted"));

  const [activeTab, setActiveTab] = useState<MemberTab>(
    initialStatus === "pending" ||
      initialStatus === "approved" ||
      initialStatus === "locked" ||
      initialStatus === "disabled" ||
      initialStatus === "deleted"
      ? initialStatus
      : "pending"
  );

  useEffect(() => {
    if (
      initialStatus === "pending" ||
      initialStatus === "approved" ||
      initialStatus === "locked" ||
      initialStatus === "disabled" ||
      initialStatus === "deleted"
    ) {
      setActiveTab(initialStatus);
    }
  }, [initialStatus]);

  // Approval-date filter is most useful on the Approved tab
  useEffect(() => {
    if (approvedOnDate) setActiveTab("approved");
  }, [approvedOnDate]);

  const getCurrentTabUsers = () => {
    switch (activeTab) {
      case "pending":
        return pendingUsers;
      case "approved":
        return approvedUsers;
      case "locked":
        return lockedUsers;
      case "disabled":
        return disabledUsers;
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
    setActiveTab(value as MemberTab);
    setCurrentPage(1);
  };

  const handleAccountStatusChange = async (
    user: UserProfile,
    action: "lock" | "unlock" | "disable" | "enable" | "delete" | "restore",
    successTitle: string
  ) => {
    setAccountActionUid(user.uid);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        toast({
          variant: "destructive",
          title: "Not signed in",
          description: "Please sign in again and retry.",
        });
        return;
      }

      const res = await fetch(`/api/admin/users/${user.uid}/account-status`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || `Failed to ${action} user.`);
      }

      toast({
        title: successTitle,
        description: data.emailSent
          ? `${formatUserDisplayName(user, { showEmail: false })} was updated and notified by email.`
          : data.emailError ||
            `${formatUserDisplayName(user, { showEmail: false })} was updated, but the email could not be sent.`,
        variant: data.emailSent ? "default" : "destructive",
      });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : `Failed to ${action} user.`,
      });
    } finally {
      setAccountActionUid(null);
    }
  };

  const handleApproveUser = async (user: UserProfile) => {
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        toast({
          variant: "destructive",
          title: "Not signed in",
          description: "Please sign in again and retry approval.",
        });
        return;
      }

      const res = await fetch(`/api/admin/users/${user.uid}/approve`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to approve user.");
      }

      if (data.emailSent) {
        toast({
          title: "Success",
          description: `User "${user.name}" has been approved and notified by email.`,
        });
      } else {
        toast({
          title: "User approved",
          description:
            data.emailError ||
            `User "${user.name}" was approved, but the approval email could not be sent.`,
          variant: "destructive",
        });
      }
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to approve user.",
      });
    }
  };

  const handleDeleteUser = async (user: UserProfile) => {
    await handleAccountStatusChange(user, "delete", "User deleted");
  };

  const handleRestoreUser = async (user: UserProfile) => {
    await handleAccountStatusChange(user, "restore", "User restored");
  };

  const handleEmailVerificationAction = async (
    user: UserProfile,
    action: "defer" | "revoke_defer" | "mark_verified"
  ) => {
    setAccountActionUid(user.uid);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        toast({
          variant: "destructive",
          title: "Not signed in",
          description: "Please sign in again and retry.",
        });
        return;
      }
      const res = await fetch(`/api/admin/users/${user.uid}/email-verification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to update email verification.");
      }
      toast({
        title: "Email verification updated",
        description:
          action === "defer"
            ? `${user.name || user.email} can continue without verifying. They may verify later.`
            : action === "revoke_defer"
              ? `${user.name || user.email} must verify email before signing in.`
              : `${user.name || user.email} email was marked verified.`,
      });
    } catch (error: unknown) {
      toast({
        variant: "destructive",
        title: "Error",
        description:
          error instanceof Error ? error.message : "Failed to update email verification.",
      });
    } finally {
      setAccountActionUid(null);
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

  const UserCard = ({ user, tabKind, showActions = false, showRestore = false, isAdmin = false }: { user: UserProfile; tabKind: MemberTab; showActions?: boolean; showRestore?: boolean; isAdmin?: boolean }) => {
    const [isUserDialogOpen, setIsUserDialogOpen] = useState(false);
    const [isUserEditMode, setIsUserEditMode] = useState(false);
    const [activeTab, setActiveTab] = useState<"details" | "roles" | "audit">("details");

    const getAvatarSrc = () => {
      if (user.profilePictureUrl) {
        return user.profilePictureUrl;
      }
      if (user.email) {
        return `https://avatar.vercel.sh/${encodeURIComponent(user.email)}.png`;
      }
      return undefined;
    };
    const isClient = isClientPortalAccount(user);
    const isActionLoading = accountActionUid === user.uid;
    const statusBadge = (() => {
      switch (user.status) {
        case "locked":
          return { label: "Locked", variant: "secondary" as const, className: "bg-amber-50 text-amber-800 border-amber-200" };
        case "disabled":
          return { label: "Disabled", variant: "destructive" as const, className: "bg-red-50 text-red-800 border-red-200" };
        case "pending":
          return { label: "Pending", variant: "secondary" as const, className: "" };
        case "deleted":
          return { label: "Deleted", variant: "destructive" as const, className: "" };
        default:
          return { label: "Approved", variant: "default" as const, className: "" };
      }
    })();

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
                  variant={statusBadge.variant}
                  className={`text-[10px] sm:text-xs ${statusBadge.className}`}
                >
                  {statusBadge.label}
                </Badge>
                {(() => {
                  const ageLabel = getUserAccountAgeLabel(user);
                  if (!ageLabel) return null;
                  return (
                    <Badge
                      variant="outline"
                      className="text-[10px] sm:text-xs bg-sky-50 text-sky-800 border-sky-200"
                      title={
                        asDateValue(user.createdAt)
                          ? `Created ${formatDate(user.createdAt)}`
                          : user.approvedAt
                            ? `Approved ${formatDate(user.approvedAt)}`
                            : undefined
                      }
                    >
                      {ageLabel}
                    </Badge>
                  );
                })()}
                {user.emailVerificationRequired === true &&
                  (user.emailVerificationDeferredByAdmin ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] sm:text-xs bg-amber-50 text-amber-900 border-amber-200"
                      title="Admin allowed login without email verification"
                    >
                      Email verify deferred
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] sm:text-xs bg-orange-50 text-orange-900 border-orange-200"
                      title="Blocked until email is verified"
                    >
                      Email unverified
                    </Badge>
                  ))}
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
                      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "details" | "roles" | "audit")} className="w-full">
                        <TabsList className="grid w-full grid-cols-3">
                          <TabsTrigger value="details" className="flex items-center gap-2">
                            <User className="h-4 w-4" />
                            Details
                          </TabsTrigger>
                          <TabsTrigger value="roles" className="flex items-center gap-2">
                            <Shield className="h-4 w-4" />
                            Roles & Features
                          </TabsTrigger>
                          <TabsTrigger value="audit" className="flex items-center gap-2">
                            <ScrollText className="h-4 w-4" />
                            Audit Trail
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
                          {getUserAccountAgeLabel(user) && (
                            <div>
                              <span className="font-medium">Account age:</span>
                              <p className="text-muted-foreground">{getUserAccountAgeLabel(user)}</p>
                            </div>
                          )}
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
                        <TabsContent value="audit" className="mt-4">
                          <UserAuditTrailPanel userId={user.uid} userName={user.name} />
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
              {tabKind === "pending" && user.status === "pending" && (
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
              {isAdmin &&
                user.emailVerificationRequired === true &&
                (tabKind === "pending" || tabKind === "approved") && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={isActionLoading}
                        onClick={() =>
                          void handleEmailVerificationAction(
                            user,
                            user.emailVerificationDeferredByAdmin ? "revoke_defer" : "defer"
                          )
                        }
                        className={
                          user.emailVerificationDeferredByAdmin
                            ? "text-amber-800 border-amber-200 hover:bg-amber-50"
                            : "text-sky-800 border-sky-200 hover:bg-sky-50"
                        }
                      >
                        <MailCheck className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {user.emailVerificationDeferredByAdmin
                          ? "Require email verification again"
                          : "Allow continue without email verification"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
              {tabKind === "approved" && isClient && (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={isActionLoading}
                        onClick={() => void handleAccountStatusChange(user, "lock", "User locked")}
                        className="text-amber-700 border-amber-200 hover:bg-amber-50"
                      >
                        <Lock className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Lock client account</p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        disabled={isActionLoading}
                        onClick={() => void handleAccountStatusChange(user, "disable", "User disabled")}
                        className="text-red-700 border-red-200 hover:bg-red-50"
                      >
                        <ShieldBan className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Disable client account</p>
                    </TooltipContent>
                  </Tooltip>
                </>
              )}
              {(tabKind === "pending" || tabKind === "approved") && (
              <Tooltip>
                <TooltipTrigger asChild>
              <Button 
                variant="destructive" 
                    size="icon"
                disabled={isActionLoading}
                onClick={() => handleDeleteUser(user)}
              >
                    <Trash2 className="h-4 w-4" />
              </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Delete user account</p>
                </TooltipContent>
              </Tooltip>
              )}
            </>
          )}

          {showActions && tabKind === "locked" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={isActionLoading}
                  onClick={() => void handleAccountStatusChange(user, "unlock", "User unlocked")}
                  className="text-green-700 border-green-200 hover:bg-green-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Unlock client account</p>
              </TooltipContent>
            </Tooltip>
          )}

          {showActions && tabKind === "disabled" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  disabled={isActionLoading}
                  onClick={() => void handleAccountStatusChange(user, "enable", "User re-enabled")}
                  className="text-green-700 border-green-200 hover:bg-green-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Re-enable client account</p>
              </TooltipContent>
            </Tooltip>
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
        {/* Search Bar, approval date filter, and Sort */}
        <div className="mb-6 flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by name, email, phone, or client ID..."
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
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  type="date"
                  value={approvedOnDate}
                  onChange={(e) => setApprovedOnDate(e.target.value)}
                  className="pl-10 w-full sm:w-[180px]"
                  aria-label="Filter by approval date"
                  title="Filter by approval date"
                />
              </div>
              {approvedOnDate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-10 px-2"
                  onClick={() => setApprovedOnDate("")}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Clear date
                </Button>
              ) : null}
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
          </div>
          {approvedOnDate ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-sm text-emerald-950 flex flex-wrap items-center gap-2">
              <UserCheck className="h-4 w-4 shrink-0" />
              <span>
                <strong>{approvedOnDateCount}</strong> user
                {approvedOnDateCount === 1 ? "" : "s"} approved on{" "}
                <strong>
                  {(() => {
                    try {
                      return format(new Date(`${approvedOnDate}T12:00:00`), "MMM dd, yyyy");
                    } catch {
                      return approvedOnDate;
                    }
                  })()}
                </strong>
              </span>
              {filteredUsers.length !== approvedOnDateCount ? (
                <span className="text-emerald-800/80 text-xs">
                  · {filteredUsers.length} match current search
                </span>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Pick a date to see how many users were approved that day.
            </p>
          )}
        </div>
        
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid grid-cols-2 sm:grid-cols-5 w-full gap-1 sm:gap-0">
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
            <TabsTrigger value="locked" className="flex items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm">
              <Lock className="h-4 w-4" />
              <span>Locked</span>
              <Badge variant="secondary" className="text-[10px] sm:text-xs">{lockedUsers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="disabled" className="flex items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm">
              <ShieldBan className="h-4 w-4" />
              <span>Disabled</span>
              <Badge variant="secondary" className="text-[10px] sm:text-xs">{disabledUsers.length}</Badge>
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
                    <UserCard key={user.uid || `pending-user-${index}`} user={user} tabKind="pending" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
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
                    <UserCard key={user.uid || `user-${index}`} user={user} tabKind="approved" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
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

          <TabsContent value="locked" className="mt-6">
            {lockedUsers.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `locked-user-${index}`} user={user} tabKind="locked" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length} users
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</Button>
                      <span className="text-sm">Page {currentPage} of {totalPages}</span>
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <Lock className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Locked Members</h3>
                <p className="text-muted-foreground">Client accounts locked for inactivity or by an admin will appear here.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="disabled" className="mt-6">
            {disabledUsers.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `disabled-user-${index}`} user={user} tabKind="disabled" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-6 pt-4 border-t">
                    <div className="text-sm text-muted-foreground">
                      Showing {startIndex + 1} to {Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length} users
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>Previous</Button>
                      <span className="text-sm">Page {currentPage} of {totalPages}</span>
                      <Button variant="outline" size="sm" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <ShieldBan className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">No Disabled Members</h3>
                <p className="text-muted-foreground">Client accounts disabled for inactivity or by an admin will appear here.</p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="deleted" className="mt-6">
            {deletedUsers.length > 0 ? (
              <>
                <div className="space-y-2">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `deleted-user-${index}`} user={user} tabKind="deleted" showActions={false} showRestore={!viewOnly} isAdmin={!viewOnly && adminUser?.role === "admin"} />
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

