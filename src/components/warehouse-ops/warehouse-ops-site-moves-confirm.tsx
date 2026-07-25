"use client";

import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowRightLeft, Check, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  listPendingInternalMovesForSourceWarehouse,
  processInternalMoveRequest,
} from "@/lib/internal-move-ops";
import type { InternalMoveRequest, WarehouseDoc } from "@/types";

function toMs(v: InternalMoveRequest["createdAt"]): number {
  if (!v) return 0;
  if (typeof v === "string") {
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? 0 : t;
  }
  if (v instanceof Date) return v.getTime();
  if (typeof v === "object" && typeof (v as { seconds?: number }).seconds === "number") {
    return (v as { seconds: number }).seconds * 1000;
  }
  return 0;
}

type Props = {
  warehouse: WarehouseDoc;
};

/**
 * Source-warehouse confirmations for admin Internal Move (site-to-site) requests.
 * Confirming transfers carton labels to the destination putaway queue.
 */
export function WarehouseOpsSiteMovesConfirm({ warehouse }: Props) {
  const { toast } = useToast();
  const { user, userProfile } = useAuth();
  const [requests, setRequests] = useState<InternalMoveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listPendingInternalMovesForSourceWarehouse(warehouse.id);
      setRequests(rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt)));
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [warehouse.id]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleConfirm = async (request: InternalMoveRequest) => {
    const operatorId = user?.uid || userProfile?.uid;
    if (!operatorId) {
      toast({
        variant: "destructive",
        title: "Not signed in",
        description: "Sign in again to confirm this move.",
      });
      return;
    }
    setProcessingId(request.id);
    try {
      await processInternalMoveRequest({
        requestId: request.id,
        operatorId,
        operatorName: userProfile?.name || userProfile?.email || "Ops",
        processMode: "ops_confirm",
      });
      toast({
        title: "Moved out confirmed",
        description: `Labels now await putaway at ${request.toWarehouseCode || request.toLocationName}.`,
      });
      await reload();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Confirm failed",
        description: err instanceof Error ? err.message : "Please try again.",
      });
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <ArrowRightLeft className="h-5 w-5 text-pink-600" />
            Site moves to confirm
          </CardTitle>
          <CardDescription>
            Admin requested stock leave this site ({warehouse.code}). Confirm moved out to
            send existing labels to the destination putaway queue.
          </CardDescription>
        </div>
        <Button variant="outline" size="sm" onClick={() => void reload()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          <span className="ml-1">Refresh</span>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : requests.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No pending site-to-site moves from this warehouse.
          </p>
        ) : (
          <div className="space-y-3">
            {requests.map((r) => (
              <div
                key={r.id}
                className="rounded-xl border p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm">
                      {r.fromLocationName || r.fromWarehouseCode} →{" "}
                      {r.toLocationName || r.toWarehouseCode}
                    </span>
                    <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-200">
                      pending
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {r.lines.length} line{r.lines.length === 1 ? "" : "s"} ·{" "}
                    {r.userIds.length} user{r.userIds.length === 1 ? "" : "s"}
                    {toMs(r.createdAt)
                      ? ` · ${format(new Date(toMs(r.createdAt)), "PP")}`
                      : ""}
                  </p>
                  <div className="text-xs text-muted-foreground max-h-16 overflow-y-auto">
                    {r.lines
                      .slice(0, 5)
                      .map((l) => `${l.productName} ×${l.quantity}`)
                      .join(" · ")}
                    {r.lines.length > 5 ? ` · +${r.lines.length - 5} more` : ""}
                  </div>
                </div>
                <Button
                  onClick={() => handleConfirm(r)}
                  disabled={processingId === r.id}
                  className="shrink-0"
                >
                  {processingId === r.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Check className="mr-2 h-4 w-4" />
                  )}
                  Confirm moved out
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
