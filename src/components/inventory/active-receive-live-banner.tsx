"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radio, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { InboundReceiveVideoDialog } from "@/components/inventory/inbound-receive-video-dialog";
import { listWarehouseCameraSessions } from "@/lib/warehouse-camera-client";
import {
  isWarehouseCameraSessionActive,
  warehouseCameraSessionProductLabel,
  type WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";

export function ActiveReceiveLiveBanner({
  clientUserId,
}: {
  clientUserId?: string;
}) {
  const { user } = useAuth();
  const [active, setActive] = useState<WarehouseCameraSession | null>(null);
  const [ended, setEnded] = useState<WarehouseCameraSession | null>(null);
  const previousActiveRef = useRef<WarehouseCameraSession | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    const sessions = await listWarehouseCameraSessions(user, { clientUserId });
    const nextActive = sessions.find((row) => isWarehouseCameraSessionActive(row)) ?? null;
    const previous = previousActiveRef.current;
    if (previous && !nextActive) {
      setEnded(previous);
    }
    if (nextActive) setEnded(null);
    previousActiveRef.current = nextActive;
    setActive(nextActive);
  }, [clientUserId, user]);

  useEffect(() => {
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh().catch(() => undefined);
      }
    };
    refreshWhenVisible();
    const timer = window.setInterval(refreshWhenVisible, 5000);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  const requestId = active?.inventoryRequestIds[0] || ended?.inventoryRequestIds[0];
  if (!requestId || (!active && !ended)) return null;

  if (active) {
    return (
      <Alert className="border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30">
        <Radio className="h-4 w-4 text-red-600" />
        <AlertTitle>
          {active.status === "paused" ? "Receiving recording paused" : "Receiving live now"}
        </AlertTitle>
        <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <span>
            {active.warehouseLabel} is receiving{" "}
            <strong>{warehouseCameraSessionProductLabel(active)}</strong>. Live access is
            restricted to your account.
          </span>
          <InboundReceiveVideoDialog
            requestId={requestId}
            clientUserId={clientUserId}
          />
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Alert className="border-slate-300 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40">
      <Radio className="h-4 w-4 text-slate-600" />
      <AlertTitle className="flex items-center justify-between gap-2">
        <span>Live session ended for {warehouseCameraSessionProductLabel(ended!)}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={() => setEnded(null)}
          title="Dismiss"
        >
          <X className="h-4 w-4" />
        </Button>
      </AlertTitle>
      <AlertDescription className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <span>
          {ended!.warehouseLabel} finished live receiving. Watch the uploaded clip from this
          request or its inbound history after Drive upload.
        </span>
        <InboundReceiveVideoDialog
          requestId={requestId}
          clientUserId={clientUserId}
          triggerLabel="Watch receiving video"
        />
      </AlertDescription>
    </Alert>
  );
}
