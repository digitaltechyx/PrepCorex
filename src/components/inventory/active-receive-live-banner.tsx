"use client";

import { useCallback, useEffect, useState } from "react";
import { Radio } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { InboundReceiveVideoDialog } from "@/components/inventory/inbound-receive-video-dialog";
import { listWarehouseCameraSessions } from "@/lib/warehouse-camera-client";
import type { WarehouseCameraSession } from "@/lib/warehouse-camera-types";

export function ActiveReceiveLiveBanner({
  clientUserId,
}: {
  clientUserId?: string;
}) {
  const { user } = useAuth();
  const [active, setActive] = useState<WarehouseCameraSession | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const sessions = await listWarehouseCameraSessions(user, { clientUserId });
    setActive(
      sessions.find((row) => row.status === "live" || row.status === "paused") ?? null
    );
  }, [clientUserId, user]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh().catch(() => undefined);
      }
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 15000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  const requestId = active?.inventoryRequestIds[0];
  if (!active || !requestId) return null;

  return (
    <Alert className="border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
      <Radio className="h-4 w-4 text-red-600" />
      <AlertTitle>
        {active.status === "paused" ? "Receiving recording paused" : "Receiving live now"}
      </AlertTitle>
      <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span>
          {active.warehouseLabel} is receiving your inbound request. Live access is restricted to
          your account.
        </span>
        <InboundReceiveVideoDialog
          requestId={requestId}
          clientUserId={clientUserId}
        />
      </AlertDescription>
    </Alert>
  );
}
