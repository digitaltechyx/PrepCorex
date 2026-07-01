"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Mail, Phone, User, LogOut } from "lucide-react";
import { Loader2 } from "lucide-react";

export default function PendingApprovalPage() {
  const { user, userProfile, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace("/login");
      } else if (userProfile?.role === "admin") {
        router.replace("/admin/dashboard");
      } else if (userProfile?.status === "approved") {
        if (userProfile?.role === "commission_agent") {
          router.replace("/dashboard/agent");
        } else {
          router.replace("/dashboard");
        }
      } else if (userProfile?.status === "deleted") {
        router.replace("/login");
      }
    }
  }, [user, userProfile, loading, router]);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  if (loading || !user || userProfile?.status !== "pending") {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-background">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100">
            <Clock className="h-8 w-8 text-yellow-600" />
          </div>
          <CardTitle className="text-2xl font-bold">Account Pending Approval</CardTitle>
          <CardDescription className="text-base">
            Your account is waiting for administrator approval.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* User Info */}
          <div className="bg-muted/50 rounded-lg p-4 space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground">Account Details</h3>
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm">
                <User className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">{userProfile?.name}</span>
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{userProfile?.email}</span>
              </div>
              {userProfile?.phone && (
                <div className="flex items-center gap-2 text-sm">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span>{userProfile.phone}</span>
                </div>
              )}
            </div>
          </div>

          {/* Status Message */}
          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Your account is under review. Most accounts are approved within 1 business day.
              We will email you when your account is ready.
            </p>
            <p className="text-xs text-muted-foreground">
              {userProfile?.role === "commission_agent" 
                ? "You will receive access to your portal once approved."
                : "You will receive access to the inventory management system once approved."}
            </p>
          </div>

          {/* Actions */}
          <div className="space-y-3">
            <Button 
              onClick={() => window.location.reload()} 
              variant="outline" 
              className="w-full"
            >
              Check Status
            </Button>
            <Button 
              onClick={handleSignOut} 
              variant="ghost" 
              className="w-full"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>

          {/* Contact Info */}
          <div className="text-center pt-4 border-t">
            <p className="text-xs text-muted-foreground">
              Need help? Contact your administrator.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

