"use client";

import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

/**
 * Legacy route from the old Auth-switch impersonation flow.
 * New flow opens `/dashboard?viewAs={uid}` directly in a new tab.
 */
function ImpersonateRedirect() {
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const viewAs = (searchParams.get("viewAs") || "").trim();
    if (viewAs) {
      router.replace(`/dashboard?viewAs=${encodeURIComponent(viewAs)}`);
      return;
    }
    router.replace("/admin/dashboard/users");
  }, [router, searchParams]);

  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background px-4 text-center">
      <Loader2 className="h-10 w-10 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">Opening client preview…</p>
    </div>
  );
}

export default function ImpersonatePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen w-full flex-col items-center justify-center gap-3 bg-background px-4 text-center">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Opening client preview…</p>
        </div>
      }
    >
      <ImpersonateRedirect />
    </Suspense>
  );
}
