"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Handshake } from "lucide-react";
import { AffiliateManagementDashboard } from "@/components/admin/affiliate-management-dashboard";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import type { UserProfile } from "@/types";
import { hasRole } from "@/lib/permissions";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export default function AdminAffiliateManagementPage() {
  const { userProfile, loading } = useAuth();
  const router = useRouter();
  const { data: users, loading: usersLoading } = useCollection<UserProfile>("users");
  const isFullAdmin = hasRole(userProfile, "admin");

  useEffect(() => {
    if (!loading && userProfile && !isFullAdmin) {
      router.replace("/admin/dashboard");
    }
  }, [loading, userProfile, isFullAdmin, router]);

  if (loading || usersLoading || !isFullAdmin) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-3 sm:space-y-6">
      <Card className="min-w-0 overflow-hidden border-2 shadow-xl">
        <CardHeader className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-700 pb-3 text-white sm:pb-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2 text-lg font-bold text-white sm:text-2xl">
                <Handshake className="h-5 w-5 shrink-0 sm:h-6 sm:w-6" />
                Affiliate Management
              </CardTitle>
              <CardDescription className="mt-1 text-xs text-violet-100 sm:mt-2 sm:text-sm">
                Agents, referrals, earnings &amp; audit
              </CardDescription>
            </div>
            <div className="hidden h-14 w-14 shrink-0 items-center justify-center rounded-full bg-white/20 backdrop-blur-sm sm:flex">
              <Handshake className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-6">
          <AffiliateManagementDashboard users={users} />
        </CardContent>
      </Card>
    </div>
  );
}
