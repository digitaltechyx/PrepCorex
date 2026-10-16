"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useCollection } from "@/hooks/use-collection";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, XCircle, User, Calendar, Phone, Mail, Eye, UserCheck, Search, X, ArrowUpDown, Copy, Check, Trash2, RotateCcw, Shield } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format } from "date-fns";
import type { UserProfile } from "@/types";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getUserRoles, getDefaultFeaturesForRole } from "@/lib/permissions";
import { RoleFeatureManagement } from "./role-feature-management";
import { generateUniqueReferralCode } from "@/lib/commission-utils";
import { logAffiliateAuditEvent } from "@/lib/affiliate-audit-trail-client";

interface CommissionAgentsManagementProps {
  adminUser: UserProfile | null;
  /** When provided (e.g. sub admin), only show commission agents from this list */
  usersOverride?: UserProfile[];
}

export function CommissionAgentsManagement({ adminUser, usersOverride }: CommissionAgentsManagementProps) {
  const { data: usersFromCollection, loading } = useCollection<UserProfile>("users");
  const users = usersOverride ?? usersFromCollection;
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sortOrder, setSortOrder] = useState<"a-z" | "z-a">("a-z");
  const itemsPerPage = 12;

  // Filter commission agents (include users with commission_agent role, even if they have other roles)
  const commissionAgents = useMemo(() => {
    return users.filter((user) => {
      const userRoles = getUserRoles(user);
      return userRoles.includes("commission_agent");
    });
  }, [users]);

  // Filter and apply search
  const filteredAgents = useMemo(() => {
    return commissionAgents.filter((agent) => {
      const matchesSearch = searchQuery === "" || 
        agent.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.phone?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        agent.referralCode?.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesSearch;
    });
  }, [commissionAgents, searchQuery]);

  // Reset to page 1 when search query or sort order changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, sortOrder]);

  // Sort function
  const sortAgents = (agents: UserProfile[]) => {
    return agents.sort((a, b) => {
      const nameA = (a.name || '').toLowerCase();
      const nameB = (b.name || '').toLowerCase();
      return sortOrder === "a-z" 
        ? nameA.localeCompare(nameB)
        : nameB.localeCompare(nameA);
    });
  };

  // Separate agents by status and sort
  const pendingAgents = sortAgents(filteredAgents.filter((agent) => agent.status === "pending"));
  const approvedAgents = sortAgents(filteredAgents.filter((agent) => agent.status === "approved" || !agent.status));
  const deletedAgents = sortAgents(filteredAgents.filter((agent) => agent.status === "deleted"));

  // Get current tab agents based on active tab
  const [activeTab, setActiveTab] = useState<"pending" | "approved" | "deleted">("pending");
  
  const getCurrentTabAgents = () => {
    switch (activeTab) {
      case "pending":
        return pendingAgents;
      case "approved":
        return approvedAgents;
      case "deleted":
        return deletedAgents;
      default:
        return [];
    }
  };

  const currentTabAgents = getCurrentTabAgents();
  
  // Pagination logic
  const totalPages = Math.ceil(currentTabAgents.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedAgents = currentTabAgents.slice(startIndex, endIndex);

  // Reset to page 1 when tab changes
  const handleTabChange = (value: string) => {
    setActiveTab(value as "pending" | "approved" | "deleted");
    setCurrentPage(1);
  };

  const handleApproveAgent = async (agent: UserProfile) => {
    try {
      // Always generate a NEW referral code when approving (per user requirement)
      // This ensures that if an agent loses access and gets it back, they get a new code
      const referralCode = await generateUniqueReferralCode(
        agent.name || "AGENT",
        agent.uid
      );

      const agentRoles = getUserRoles(agent);
      const updateData: any = {
        status: "approved",
        approvedAt: new Date(),
        referralCode: referralCode,
      };

      // If agent doesn't have features yet, give them default features
      if (!agent.features || agent.features.length === 0) {
        const defaultFeatures: string[] = [];
        agentRoles.forEach((role) => {
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
      if (!agent.roles || agent.roles.length === 0) {
        updateData.roles = agentRoles.length > 0 ? agentRoles : [agent.role || "commission_agent"];
      }

      await updateDoc(doc(db, "users", agent.uid), updateData);

      void logAffiliateAuditEvent({
        agentId: agent.uid,
        agentName: agent.name || null,
        type: "agent_approved",
        action: "Agent approved",
        description: `Commission agent "${agent.name}" approved with referral code ${referralCode}.`,
        performedByUid: adminUser?.uid || null,
        performedByName: adminUser?.name || null,
        metadata: { referralCode },
      });

      toast({
        title: "Success",
        description: `Commission agent "${agent.name}" has been approved! Referral code: ${referralCode}`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to approve agent.",
      });
    }
  };

  const handleRejectAgent = async (agent: UserProfile) => {
    try {
      await updateDoc(doc(db, "users", agent.uid), {
        status: "deleted",
        deletedAt: new Date(),
      });

      const isPending = agent.status === "pending";
      void logAffiliateAuditEvent({
        agentId: agent.uid,
        agentName: agent.name || null,
        type: isPending ? "agent_rejected" : "agent_deleted",
        action: isPending ? "Agent rejected" : "Agent deleted",
        description: isPending
          ? `Commission agent "${agent.name}" was rejected during approval.`
          : `Commission agent "${agent.name}" was removed from the program.`,
        performedByUid: adminUser?.uid || null,
        performedByName: adminUser?.name || null,
      });

      const message = agent.status === "pending" 
        ? `Commission agent "${agent.name}" has been rejected.`
        : `Commission agent "${agent.name}" has been deleted.`;

      toast({
        title: "Success",
        description: message,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to delete agent.",
      });
    }
  };

  const handleRestoreAgent = async (agent: UserProfile) => {
    try {
      await updateDoc(doc(db, "users", agent.uid), {
        status: "pending",
        deletedAt: null,
      });

      void logAffiliateAuditEvent({
        agentId: agent.uid,
        agentName: agent.name || null,
        type: "agent_restored",
        action: "Agent restored",
        description: `Commission agent "${agent.name}" restored to pending approval.`,
        performedByUid: adminUser?.uid || null,
        performedByName: adminUser?.name || null,
      });

      toast({
        title: "Success",
        description: `Commission agent "${agent.name}" has been restored.`,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: error.message || "Failed to restore agent.",
      });
    }
  };

  const getInitials = (name: string | null) => {
    if (!name) return "CA";
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
      
      if (date && typeof date === 'object' && date.seconds) {
        dateObj = new Date(date.seconds * 1000);
      } else if (date instanceof Date) {
        dateObj = date;
      } else {
        dateObj = new Date(date);
      }
      
      if (isNaN(dateObj.getTime())) {
        return "N/A";
      }
      
      return format(dateObj, "MMM dd, yyyy");
    } catch (error) {
      console.error("Error formatting date:", error);
      return "N/A";
    }
  };

  const AgentCard = ({ agent, showActions = false }: { agent: UserProfile; showActions?: boolean }) => {
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [copiedCode, setCopiedCode] = useState(false);
    const [dialogTab, setDialogTab] = useState<"details" | "roles">("details");
    const isAdmin = adminUser?.role === "admin";

    const copyReferralCode = () => {
      if (agent.referralCode) {
        navigator.clipboard.writeText(agent.referralCode);
        setCopiedCode(true);
        setTimeout(() => setCopiedCode(false), 2000);
        toast({
          title: "Copied!",
          description: "Referral code copied to clipboard.",
        });
      }
    };

    return (
      <div className="rounded-md border bg-card px-2.5 py-2 sm:px-3 sm:py-2.5">
        <div className="flex flex-col gap-2">
          <div className="flex min-w-0 items-start gap-2">
            <Avatar className="h-8 w-8 shrink-0 sm:h-9 sm:w-9">
              <AvatarImage src={`https://avatar.vercel.sh/${agent.email}.png`} />
              <AvatarFallback className="text-[10px] sm:text-xs">{getInitials(agent.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-1 sm:gap-1.5">
                <h3 className="min-w-0 max-w-full break-words text-xs font-semibold sm:truncate sm:text-sm">
                  {agent.name}
                </h3>
                <Badge
                  variant={
                    agent.status === "approved" || !agent.status
                      ? "default"
                      : agent.status === "deleted"
                        ? "destructive"
                        : "secondary"
                  }
                  className="h-5 shrink-0 px-1.5 text-[10px]"
                >
                  {agent.status === "approved" || !agent.status
                    ? "Approved"
                    : agent.status === "deleted"
                      ? "Deleted"
                      : "Pending"}
                </Badge>
                {agent.referralCode && (
                  <button
                    type="button"
                    onClick={copyReferralCode}
                    className="inline-flex shrink-0 items-center gap-1 rounded border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] hover:bg-muted"
                    title="Copy referral code"
                  >
                    {agent.referralCode}
                    {copiedCode ? (
                      <Check className="h-3 w-3 text-green-600" />
                    ) : (
                      <Copy className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>
                )}
              </div>
              <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground sm:text-xs">
                <span className="min-w-0 max-w-full break-all sm:truncate">{agent.email}</span>
                {agent.phone && (
                  <span className="hidden items-center gap-1 sm:inline-flex">
                    <Phone className="h-3 w-3" />
                    {agent.phone}
                  </span>
                )}
              </div>
              {isAdmin && (agent.status === "approved" || !agent.status) && (
                <div className="mt-0.5 hidden text-[10px] text-muted-foreground sm:block sm:text-[11px]">
                  <span className="font-medium">Pw:</span>{" "}
                  <span className="font-mono">{agent.password || "Not stored"}</span>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-1.5 sm:border-0 sm:pt-0 sm:justify-end">
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="icon" className="h-8 w-8">
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View Details</p>
                </TooltipContent>
              </Tooltip>
              <DialogContent className="h-[100dvh] w-[calc(100%-1.5rem)] max-w-2xl overflow-y-auto p-4 sm:h-auto sm:max-h-[90vh] sm:p-6">
                <DialogHeader>
                  <DialogTitle>Agent Details</DialogTitle>
                  <DialogDescription>Complete information about this commission agent.</DialogDescription>
                </DialogHeader>
                <Tabs value={dialogTab} onValueChange={(v) => setDialogTab(v as "details" | "roles")} className="w-full">
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
                          <AvatarImage src={`https://avatar.vercel.sh/${agent.email}.png`} />
                          <AvatarFallback>{getInitials(agent.name)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <h3 className="font-semibold">{agent.name}</h3>
                          <p className="text-sm text-muted-foreground">{agent.email}</p>
                        </div>
                      </div>
                      
                      <div className="space-y-3">
                        <h4 className="font-semibold text-sm border-b pb-1">Basic Information</h4>
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <span className="font-medium">Status:</span>
                            <p className="text-muted-foreground capitalize">{agent.status || "N/A"}</p>
                          </div>
                          <div>
                            <span className="font-medium">Email:</span>
                            <p className="text-muted-foreground break-all">{agent.email || "N/A"}</p>
                          </div>
                          {isAdmin && (
                            <div>
                              <span className="font-medium">Password:</span>
                              <p className="font-mono text-muted-foreground">{agent.password || "Not stored"}</p>
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Phone/WhatsApp:</span>
                            <p className="text-muted-foreground">{agent.phone || "N/A"}</p>
                          </div>
                          {(agent as any).country && (
                            <div>
                              <span className="font-medium">Country:</span>
                              <p className="text-muted-foreground">{(agent as any).country || "N/A"}</p>
                            </div>
                          )}
                          {(agent as any).socialProfile && (
                            <div className="col-span-2">
                              <span className="font-medium">LinkedIn / Facebook Profile:</span>
                              <p className="text-muted-foreground break-all">
                                <a 
                                  href={(agent as any).socialProfile} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:underline"
                                >
                                  {(agent as any).socialProfile}
                                </a>
                              </p>
                            </div>
                          )}
                          <div>
                            <span className="font-medium">Created:</span>
                            <p className="text-muted-foreground">{formatDate(agent.createdAt)}</p>
                          </div>
                          {agent.approvedAt && (
                            <div>
                              <span className="font-medium">Approved:</span>
                              <p className="text-muted-foreground">{formatDate(agent.approvedAt)}</p>
                            </div>
                          )}
                        </div>
                      </div>

                      {(agent as any).salesExperience && Array.isArray((agent as any).salesExperience) && (agent as any).salesExperience.length > 0 && (
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm border-b pb-1">Sales Experience</h4>
                          <div className="flex flex-wrap gap-2">
                            {(agent as any).salesExperience.map((exp: string, index: number) => (
                              <Badge key={index} variant="secondary" className="text-xs">
                                {exp}
                              </Badge>
                            ))}
                          </div>
                          {(agent as any).salesExperienceOther && (
                            <div className="mt-2">
                              <span className="font-medium text-sm">Other Experience:</span>
                              <p className="text-muted-foreground text-sm">{(agent as any).salesExperienceOther}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {(agent as any).referralSource && (
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm border-b pb-1">Referral Information</h4>
                          <div className="text-sm">
                            <span className="font-medium">How Did You Hear About Us:</span>
                            <p className="text-muted-foreground">{(agent as any).referralSource}</p>
                          </div>
                        </div>
                      )}

                      {agent.referralCode && (
                        <div className="space-y-3">
                          <h4 className="font-semibold text-sm border-b pb-1">Referral Code</h4>
                          <div className="flex items-center gap-2">
                            <p className="text-muted-foreground font-mono font-semibold text-sm">{agent.referralCode}</p>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0"
                              onClick={copyReferralCode}
                            >
                              {copiedCode ? (
                                <Check className="h-3 w-3 text-green-600" />
                              ) : (
                                <Copy className="h-3 w-3" />
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </TabsContent>
                  <TabsContent value="roles" className="mt-4">
                    <RoleFeatureManagement
                      user={agent}
                      onSuccess={() => {
                        // Refresh will happen automatically via useCollection
                      }}
                    />
                  </TabsContent>
                </Tabs>
              </DialogContent>
            </Dialog>

            {showActions && (
              <>
                {agent.status === "pending" && (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="default"
                          size="icon"
                          onClick={() => handleApproveAgent(agent)}
                          className="h-8 w-8 bg-green-600 hover:bg-green-700"
                        >
                          <UserCheck className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Approve Agent</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => handleRejectAgent(agent)}
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Reject Agent</p>
                      </TooltipContent>
                    </Tooltip>
                  </>
                )}
                {(agent.status === "approved" || !agent.status) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => handleRejectAgent(agent)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Delete Agent</p>
                    </TooltipContent>
                  </Tooltip>
                )}
              </>
            )}

            {agent.status === "deleted" && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => handleRestoreAgent(agent)}
                    className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Restore Agent</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="space-y-1.5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="min-w-0">
          <div className="mb-3 flex flex-col gap-2 sm:mb-4 sm:flex-row sm:gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 transform text-muted-foreground" />
              <Input
                placeholder="Search agents…"
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
          
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full min-w-0">
            <TabsList className="mb-3 grid h-auto w-full grid-cols-3 gap-1 p-1">
              <TabsTrigger value="pending" className="gap-0.5 px-1.5 py-1.5 text-[10px] sm:gap-1 sm:px-2 sm:text-xs">
                <XCircle className="hidden h-3.5 w-3.5 sm:block" />
                <span>Pending</span>
                <Badge variant="secondary" className="h-4 px-1 text-[9px] sm:h-5 sm:text-[10px]">{pendingAgents.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="approved" className="gap-0.5 px-1.5 py-1.5 text-[10px] sm:gap-1 sm:px-2 sm:text-xs">
                <CheckCircle className="hidden h-3.5 w-3.5 sm:block" />
                <span>Approved</span>
                <Badge variant="secondary" className="h-4 px-1 text-[9px] sm:h-5 sm:text-[10px]">{approvedAgents.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="deleted" className="gap-0.5 px-1.5 py-1.5 text-[10px] sm:gap-1 sm:px-2 sm:text-xs">
                <Trash2 className="hidden h-3.5 w-3.5 sm:block" />
                <span>Deleted</span>
                <Badge variant="secondary" className="h-4 px-1 text-[9px] sm:h-5 sm:text-[10px]">{deletedAgents.length}</Badge>
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="pending" className="mt-0">
              {pendingAgents.length > 0 ? (
                <>
                  <div className="space-y-1.5">
                    {paginatedAgents.map((agent, index) => (
                      <AgentCard key={agent.uid || `pending-agent-${index}`} agent={agent} showActions={true} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                      <div className="text-xs text-muted-foreground sm:text-sm">
                        {startIndex + 1}–{Math.min(endIndex, currentTabAgents.length)} of {currentTabAgents.length}
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
                  <XCircle className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                  <h3 className="mb-1 text-sm font-semibold">No Pending Agents</h3>
                  <p className="text-xs text-muted-foreground">All applications have been processed.</p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="approved" className="mt-0">
              {approvedAgents.length > 0 ? (
                <>
                  <div className="space-y-1.5">
                    {paginatedAgents.map((agent, index) => (
                      <AgentCard key={agent.uid || `agent-${index}`} agent={agent} showActions={true} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                      <div className="text-xs text-muted-foreground sm:text-sm">
                        {startIndex + 1}–{Math.min(endIndex, currentTabAgents.length)} of {currentTabAgents.length}
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
                  <h3 className="mb-1 text-sm font-semibold">No Approved Agents</h3>
                  <p className="text-xs text-muted-foreground">No commission agents have been approved yet.</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="deleted" className="mt-0">
              {deletedAgents.length > 0 ? (
                <>
                  <div className="space-y-1.5">
                    {paginatedAgents.map((agent, index) => (
                      <AgentCard key={agent.uid || `deleted-agent-${index}`} agent={agent} showActions={false} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="mt-3 flex flex-col gap-2 border-t pt-3 sm:mt-4 sm:flex-row sm:items-center sm:justify-between sm:pt-4">
                      <div className="text-xs text-muted-foreground sm:text-sm">
                        {startIndex + 1}–{Math.min(endIndex, currentTabAgents.length)} of {currentTabAgents.length}
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
                  <h3 className="mb-1 text-sm font-semibold">No Deleted Agents</h3>
                  <p className="text-xs text-muted-foreground">No commission agents have been deleted.</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
      </div>
    </TooltipProvider>
  );
}

