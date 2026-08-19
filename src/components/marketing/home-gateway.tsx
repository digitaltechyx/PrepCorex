"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { getPostLoginPath } from "@/lib/auth-redirect";
import { MarketingLandingPage } from "@/components/marketing/marketing-landing-page";

export function HomeGateway() {
  const { user, loading, userProfile } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading || !user) return;
    router.replace(userProfile ? getPostLoginPath(userProfile) : "/login");
  }, [loading, router, user, userProfile]);

  if (user) {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-[#fffaf5]">
        <div className="text-center">
          <Loader2 className="mx-auto h-10 w-10 animate-spin text-orange-600" />
          <p className="mt-3 text-sm font-medium text-slate-600">Opening PrepCorex…</p>
        </div>
      </div>
    );
  }

  return <MarketingLandingPage />;
}
