"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

/** Return QC was removed — receive → putaway (damaged → Quarantine). */
export default function WarehouseOpsReturnQcRedirectPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/warehouse-ops/returns");
  }, [router]);

  return (
    <div className="flex h-40 items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Redirecting to Returns…
    </div>
  );
}
