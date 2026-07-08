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
    <div className="space-y-6">
      <Card className="border-2 shadow-xl overflow-hidden">
        <CardHeader className="bg-gradient-to-r from-violet-600 via-purple-600 to-indigo-700 text-white pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl font-bold text-white flex items-center gap-2">
                <Handshake className="h-6 w-6" />
                Affiliate Management
              </CardTitle>
              <CardDescription className="text-violet-100 mt-2">
                Monitor commission agents, referred clients, earnings breakdown, and audit history
              </CardDescription>
            </div>
            <div className="h-14 w-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
              <Handshake className="h-7 w-7 text-white" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-6">
          <AffiliateManagementDashboard users={users} />
        </CardContent>
      </Card>
    </div>
  );
}
