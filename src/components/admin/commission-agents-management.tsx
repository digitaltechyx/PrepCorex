"use client";

import React, { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
      <Card className="hover:shadow-md transition-shadow h-full flex flex-col">
        <CardContent className="p-4 flex flex-col h-full">
          <div className="flex items-start gap-3 mb-3">
            <Avatar className="h-12 w-12 flex-shrink-0">
              <AvatarImage src={`https://avatar.vercel.sh/${agent.email}.png`} />
              <AvatarFallback>{getInitials(agent.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-base truncate">{agent.name}</h3>
              <p className="text-sm text-muted-foreground truncate">{agent.email}</p>
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2 mb-3">
            <Badge 
              variant={
                agent.status === "approved" || !agent.status ? "default" : 
                agent.status === "deleted" ? "destructive" : "secondary"
              }
              className="text-xs"
            >
              {agent.status === "approved" || !agent.status ? "Approved" : 
               agent.status === "deleted" ? "Deleted" : "Pending"}
            </Badge>
            {agent.phone && (
              <span className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Phone className="h-3 w-3" />
                {agent.phone}
              </span>
            )}
          </div>

          {agent.referralCode && (
            <div className="mb-3 p-2 bg-muted rounded-md">
              <div className="text-xs font-medium text-muted-foreground mb-1">Referral Code:</div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono font-semibold">{agent.referralCode}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
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
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Copy referral code</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 mt-auto">
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button 
                      variant="outline" 
                      size="icon"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>View Details</p>
                </TooltipContent>
              </Tooltip>
              <DialogContent className="max-w-full sm:max-w-2xl h-[100dvh] sm:h-auto sm:max-h-[90vh] overflow-y-auto">
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
                          className="bg-green-600 hover:bg-green-700"
                        >
                          <UserCheck className="h-4 w-4" />
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
                          onClick={() => handleRejectAgent(agent)}
                        >
                          <XCircle className="h-4 w-4" />
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
                        onClick={() => handleRejectAgent(agent)}
                      >
                        <Trash2 className="h-4 w-4" />
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
                    className="text-green-600 hover:text-green-700 hover:bg-green-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Restore Agent</p>
                </TooltipContent>
              </Tooltip>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Commission Agents</CardTitle>
          <CardDescription>Loading agents...</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
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
            Commission Agents
          </CardTitle>
          <CardDescription>
            Manage commission agent applications and approvals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search agents by name, email, phone, or referral code..."
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
                <Badge variant="secondary" className="text-[10px] sm:text-xs">{pendingAgents.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="approved" className="flex items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm">
                <CheckCircle className="h-4 w-4" />
                <span>Approved</span>
                <Badge variant="secondary" className="text-[10px] sm:text-xs">{approvedAgents.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="deleted" className="flex items-center justify-center gap-1 px-2 py-2 text-xs sm:text-sm">
                <Trash2 className="h-4 w-4" />
                <span>Deleted</span>
                <Badge variant="secondary" className="text-[10px] sm:text-xs">{deletedAgents.length}</Badge>
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="pending" className="mt-6">
              {pendingAgents.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedAgents.map((agent, index) => (
                      <AgentCard key={agent.uid || `pending-agent-${index}`} agent={agent} showActions={true} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">
                        Showing {startIndex + 1} to {Math.min(endIndex, currentTabAgents.length)} of {currentTabAgents.length} agents
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
                  <h3 className="text-lg font-semibold mb-2">No Pending Agents</h3>
                  <p className="text-muted-foreground">
                    All commission agent applications have been processed.
                  </p>
                </div>
              )}
            </TabsContent>
            
            <TabsContent value="approved" className="mt-6">
              {approvedAgents.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedAgents.map((agent, index) => (
                      <AgentCard key={agent.uid || `agent-${index}`} agent={agent} showActions={true} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">
                        Showing {startIndex + 1} to {Math.min(endIndex, currentTabAgents.length)} of {currentTabAgents.length} agents
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
                  <h3 className="text-lg font-semibold mb-2">No Approved Agents</h3>
                  <p className="text-muted-foreground">
                    No commission agents have been approved yet.
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="deleted" className="mt-6">
              {deletedAgents.length > 0 ? (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {paginatedAgents.map((agent, index) => (
                      <AgentCard key={agent.uid || `deleted-agent-${index}`} agent={agent} showActions={false} />
                    ))}
                  </div>
                  {totalPages > 1 && (
                    <div className="flex items-center justify-between mt-6 pt-4 border-t">
                      <div className="text-sm text-muted-foreground">
                        Showing {startIndex + 1} to {Math.min(endIndex, currentTabAgents.length)} of {currentTabAgents.length} agents
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
                  <h3 className="text-lg font-semibold mb-2">No Deleted Agents</h3>
                  <p className="text-muted-foreground">
                    No commission agents have been deleted.
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

