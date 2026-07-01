"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { friendlyPathAction, logUserAuditEvent } from "@/lib/user-audit-trail-client";

/** Logs page navigation as user actions for the authenticated user's audit trail. */
export function UserAuditActivityTracker() {
  const { user } = useAuth();
  const pathname = usePathname();
  const lastLoggedPath = useRef<string | null>(null);

  useEffect(() => {
    if (!user?.uid || !pathname) return;
    if (pathname === lastLoggedPath.current) return;

    lastLoggedPath.current = pathname;
    const action = friendlyPathAction(pathname);

    void logUserAuditEvent("user_action", {
      action,
      description: action,
      metadata: {
        pathname,
        userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
      },
    });
  }, [user?.uid, pathname]);

  return null;
}
