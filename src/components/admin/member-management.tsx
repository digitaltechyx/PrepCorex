"use client";

import React, { useState, useMemo, useEffect } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import type { UserProfile } from "@/types";
import { EditUserForm } from "./edit-user-form";
import { RoleFeatureManagement } from "./role-feature-management";
import { UserAuditTrailPanel } from "./user-audit-trail-panel";
import { WipeUserDataDialog } from "./wipe-user-data-dialog";
import { getUserRoles, hasRole, isAccountActivated } from "@/lib/permissions";
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
      <div className="rounded-md border bg-card px-2.5 py-2 sm:px-3 sm:py-2.5">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <Avatar className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
              <AvatarImage src={getAvatarSrc()} />
              <AvatarFallback className="text-[10px] sm:text-xs">{getInitials(user.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-1.5">
                <h3 className="min-w-0 max-w-full break-words text-xs font-semibold sm:truncate sm:text-sm">
                  {formatUserDisplayName(user, { showEmail: false })}
                </h3>
                <Badge
                  variant={statusBadge.variant}
                  className={`h-5 shrink-0 px-1.5 text-[10px] ${statusBadge.className}`}
                >
                  {statusBadge.label}
                </Badge>
                {(() => {
                  const ageLabel = getUserAccountAgeLabel(user);
                  if (!ageLabel) return null;
                  return (
                    <Badge
                      variant="outline"
                      className="hidden h-5 shrink-0 px-1.5 text-[10px] bg-sky-50 text-sky-800 border-sky-200 sm:inline-flex"
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
                      className="h-5 shrink-0 px-1.5 text-[10px] bg-amber-50 text-amber-900 border-amber-200"
                      title="Admin allowed login without email verification"
                    >
                      <span className="sm:hidden">Defer</span>
                      <span className="hidden sm:inline">Email verify deferred</span>
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="h-5 shrink-0 px-1.5 text-[10px] bg-orange-50 text-orange-900 border-orange-200"
                      title="Blocked until email is verified"
                    >
                      <span className="sm:hidden">Unverified</span>
                      <span className="hidden sm:inline">Email unverified</span>
                    </Badge>
                  ))}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground sm:text-xs">
                <span className="min-w-0 max-w-full break-all sm:truncate">{user.email}</span>
                {user.phone && (
                  <span className="hidden items-center gap-1 sm:inline-flex">
                    <Phone className="h-3 w-3" />
                    {user.phone}
                  </span>
                )}
                {user.companyName && (
                  <span className="hidden truncate sm:inline">· {user.companyName}</span>
                )}
                {user.clientId && (
                  <span className="shrink-0 font-mono text-[10px] sm:text-[11px]">· {user.clientId}</span>
                )}
              </div>
              {isAdmin && (user.status === "approved" || !user.status) && (
                <div className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block sm:text-[11px]">
                  <span className="font-medium">Pw:</span>{" "}
                  <span className="font-mono">{user.password || "Not stored"}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-1.5 sm:border-0 sm:pt-0 sm:justify-end">
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
                      className="h-8 w-8"
                      onClick={() => {
                        setIsUserDialogOpen(true);
                        setIsUserEditMode(false);
                      }}
                    >
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </DialogTrigger>
                  <DialogContent className="h-[100dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto p-4 sm:h-auto sm:max-h-[90vh] sm:p-6">
                    <DialogHeader className="text-left">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <DialogTitle className="text-base sm:text-lg">{isUserEditMode ? "Edit User" : "User Details"}</DialogTitle>
                      <DialogDescription className="text-xs sm:text-sm">
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
                            className="w-full sm:ml-auto sm:w-auto"
                            type="button"
                          >
                            <Edit className="mr-2 h-4 w-4" />
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
                      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "details" | "roles" | "audit")} className="w-full min-w-0">
                        <TabsList className="grid h-auto w-full grid-cols-3 gap-1 p-1">
                          <TabsTrigger value="details" className="gap-1 px-1.5 py-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-sm">
                            <User className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            Details
                          </TabsTrigger>
                          <TabsTrigger value="roles" className="gap-1 px-1.5 py-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-sm">
                            <Shield className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            <span className="sm:hidden">Roles</span>
                            <span className="hidden sm:inline">Roles & Features</span>
                          </TabsTrigger>
                          <TabsTrigger value="audit" className="gap-1 px-1.5 py-1.5 text-[11px] sm:gap-2 sm:px-3 sm:text-sm">
                            <ScrollText className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
                            <span className="sm:hidden">Audit</span>
                            <span className="hidden sm:inline">Audit Trail</span>
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
                        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 sm:gap-4">
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

                      {hasRole(user, "user") && (
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm border-b pb-1">Account activation</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                            <div>
                              <span className="font-medium">Client setup (MSA):</span>
                              <div className="mt-1">
                                {isAccountActivated(user) ? (
                                  <Badge className="bg-emerald-50 text-emerald-800 border-emerald-200 hover:bg-emerald-50">
                                    Active — MSA accepted
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="bg-amber-50 text-amber-900 border-amber-200">
                                    Pending — wizard not completed
                                  </Badge>
                                )}
                              </div>
                            </div>
                            {user.msaEffectiveDate && (
                              <div>
                                <span className="font-medium">MSA effective:</span>
                                <p className="text-muted-foreground">{user.msaEffectiveDate}</p>
                              </div>
                            )}
                            {user.accountActivatedAt && (
                              <div>
                                <span className="font-medium">Activated:</span>
                                <p className="text-muted-foreground">{formatDate(user.accountActivatedAt)}</p>
                              </div>
                            )}
                          </div>
                          {!isAccountActivated(user) && (
                            <p className="text-xs text-muted-foreground">
                              This client can sign in but has not finished the setup wizard or accepted the MSA. They
                              should complete activation at{" "}
                              <span className="font-mono">/dashboard/activate-account</span>.
                            </p>
                          )}
                          {isAdmin ? (
                            <div className="pt-1">
                              <WipeUserDataDialog user={user} />
                            </div>
                          ) : null}
                        </div>
                      )}

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
                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                      className="h-8 w-8 bg-green-600 hover:bg-green-700"
                    >
                      <UserCheck className="h-3.5 w-3.5" />
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
                            ? "h-8 w-8 text-amber-800 border-amber-200 hover:bg-amber-50"
                            : "h-8 w-8 text-sky-800 border-sky-200 hover:bg-sky-50"
                        }
                      >
                        <MailCheck className="h-3.5 w-3.5" />
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
                        className="h-8 w-8 text-amber-700 border-amber-200 hover:bg-amber-50"
                      >
                        <Lock className="h-3.5 w-3.5" />
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
                        className="h-8 w-8 text-red-700 border-red-200 hover:bg-red-50"
                      >
                        <ShieldBan className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Disable client account</p>
                    </TooltipContent>
                  </Tooltip>
                  {isAdmin ? <WipeUserDataDialog user={user} /> : null}
                </>
              )}
              {(tabKind === "pending" || tabKind === "approved") && (
              <Tooltip>
                <TooltipTrigger asChild>
              <Button 
                variant="destructive" 
                    size="icon"
                className="h-8 w-8"
                disabled={isActionLoading}
                onClick={() => handleDeleteUser(user)}
              >
                    <Trash2 className="h-3.5 w-3.5" />
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
                  className="h-8 w-8 text-green-700 border-green-200 hover:bg-green-50"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
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
                  className="h-8 w-8 text-green-700 border-green-200 hover:bg-green-50"
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
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
                  className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
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
      <div className="space-y-1.5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  const isSearchControlled = controlledSearchQuery !== undefined;

  return (
    <TooltipProvider>
      <div className="min-w-0">
        {/* Filters — skip duplicate search when parent page search is controlled */}
        <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-3">
            {!isSearchControlled && (
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, phone, or client ID..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-10"
                />
                {searchQuery && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-2 top-1/2 h-6 w-6 -translate-y-1/2 transform p-0"
                    onClick={() => setSearchQuery("")}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                )}
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
              <div className="relative">
                <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="date"
                  value={approvedOnDate}
                  onChange={(e) => setApprovedOnDate(e.target.value)}
                  className="h-9 w-full pl-10 sm:w-[170px]"
                  aria-label="Filter by approval date"
                  title="Filter by approval date"
                />
              </div>
              {approvedOnDate ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-9 px-2"
                  onClick={() => setApprovedOnDate("")}
                >
                  <X className="mr-1 h-3.5 w-3.5" />
                  Clear
                </Button>
              ) : null}
              <Select value={sortOrder} onValueChange={(value) => setSortOrder(value as "a-z" | "z-a")}>
                <SelectTrigger className="h-9 w-full sm:w-[150px]">
                  <ArrowUpDown className="mr-2 h-4 w-4" />
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
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50/70 px-2.5 py-1.5 text-xs text-emerald-950 sm:text-sm">
              <UserCheck className="h-3.5 w-3.5 shrink-0" />
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
                <span className="text-[11px] text-emerald-800/80">
                  · {filteredUsers.length} match search
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full min-w-0">
          <TabsList className="mb-3 grid h-auto w-full grid-cols-5 gap-0.5 p-1">
            <TabsTrigger value="pending" className="flex-col gap-0.5 px-0.5 py-1.5 text-[9px] leading-tight sm:flex-row sm:gap-1 sm:px-2 sm:text-xs">
              <span className="sm:hidden">Pend</span>
              <span className="hidden sm:inline">Pending</span>
              <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[9px] sm:h-5 sm:text-[10px]">{pendingUsers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="approved" className="flex-col gap-0.5 px-0.5 py-1.5 text-[9px] leading-tight sm:flex-row sm:gap-1 sm:px-2 sm:text-xs">
              <span className="sm:hidden">Appr</span>
              <span className="hidden sm:inline">Approved</span>
              <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[9px] sm:h-5 sm:text-[10px]">{approvedUsers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="locked" className="flex-col gap-0.5 px-0.5 py-1.5 text-[9px] leading-tight sm:flex-row sm:gap-1 sm:px-2 sm:text-xs">
              <span className="sm:hidden">Lock</span>
              <span className="hidden sm:inline">Locked</span>
              <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[9px] sm:h-5 sm:text-[10px]">{lockedUsers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="disabled" className="flex-col gap-0.5 px-0.5 py-1.5 text-[9px] leading-tight sm:flex-row sm:gap-1 sm:px-2 sm:text-xs">
              <span className="sm:hidden">Off</span>
              <span className="hidden sm:inline">Disabled</span>
              <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[9px] sm:h-5 sm:text-[10px]">{disabledUsers.length}</Badge>
            </TabsTrigger>
            <TabsTrigger value="deleted" className="flex-col gap-0.5 px-0.5 py-1.5 text-[9px] leading-tight sm:flex-row sm:gap-1 sm:px-2 sm:text-xs">
              <span className="sm:hidden">Del</span>
              <span className="hidden sm:inline">Deleted</span>
              <Badge variant="secondary" className="h-4 min-w-4 justify-center px-1 text-[9px] sm:h-5 sm:text-[10px]">{deletedUsers.length}</Badge>
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="pending" className="mt-0 pb-16 sm:pb-0">
            {pendingUsers.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `pending-user-${index}`} user={user} tabKind="pending" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                    <div className="text-xs text-muted-foreground sm:text-sm">
                      {startIndex + 1}–{Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 sm:flex-none"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Prev
                      </Button>
                      <span className="shrink-0 text-xs sm:text-sm">
                        {currentPage}/{totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 flex-1 sm:flex-none"
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
              <div className="py-6 text-center">
                <XCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="mb-1 text-sm font-semibold">No Pending Members</h3>
                <p className="text-xs text-muted-foreground">
                  All users have been processed.
                </p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="approved" className="mt-0 pb-16 sm:pb-0">
            {approvedUsers.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `user-${index}`} user={user} tabKind="approved" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                    <div className="text-xs text-muted-foreground sm:text-sm">
                      {startIndex + 1}–{Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</Button>
                      <span className="shrink-0 text-xs sm:text-sm">{currentPage}/{totalPages}</span>
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <CheckCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="mb-1 text-sm font-semibold">No Approved Members</h3>
                <p className="text-xs text-muted-foreground">No users have been approved yet.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="locked" className="mt-0 pb-16 sm:pb-0">
            {lockedUsers.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `locked-user-${index}`} user={user} tabKind="locked" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                    <div className="text-xs text-muted-foreground sm:text-sm">
                      {startIndex + 1}–{Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</Button>
                      <span className="shrink-0 text-xs sm:text-sm">{currentPage}/{totalPages}</span>
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <Lock className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="mb-1 text-sm font-semibold">No Locked Members</h3>
                <p className="text-xs text-muted-foreground">Locked client accounts will appear here.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="disabled" className="mt-0 pb-16 sm:pb-0">
            {disabledUsers.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `disabled-user-${index}`} user={user} tabKind="disabled" showActions={!viewOnly} showRestore={false} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                    <div className="text-xs text-muted-foreground sm:text-sm">
                      {startIndex + 1}–{Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</Button>
                      <span className="shrink-0 text-xs sm:text-sm">{currentPage}/{totalPages}</span>
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <ShieldBan className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="mb-1 text-sm font-semibold">No Disabled Members</h3>
                <p className="text-xs text-muted-foreground">Disabled client accounts will appear here.</p>
              </div>
            )}
          </TabsContent>
          
          <TabsContent value="deleted" className="mt-0 pb-16 sm:pb-0">
            {deletedUsers.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  {paginatedUsers.map((user, index) => (
                    <UserCard key={user.uid || `deleted-user-${index}`} user={user} tabKind="deleted" showActions={false} showRestore={!viewOnly} isAdmin={!viewOnly && adminUser?.role === "admin"} />
                  ))}
                </div>
                {totalPages > 1 && (
                  <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                    <div className="text-xs text-muted-foreground sm:text-sm">
                      {startIndex + 1}–{Math.min(endIndex, currentTabUsers.length)} of {currentTabUsers.length}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1}>Prev</Button>
                      <span className="shrink-0 text-xs sm:text-sm">{currentPage}/{totalPages}</span>
                      <Button variant="outline" size="sm" className="h-8 flex-1 sm:flex-none" onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <Trash2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <h3 className="mb-1 text-sm font-semibold">No Deleted Members</h3>
                <p className="text-xs text-muted-foreground">No users have been deleted yet.</p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </TooltipProvider>
  );
}

