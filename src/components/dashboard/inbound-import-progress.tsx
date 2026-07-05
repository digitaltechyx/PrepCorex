"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useCollection } from "@/hooks/use-collection";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import {
  inboundImportJobsPath,
  processInboundImportJob,
  requestInboundImportJobCancel,
} from "@/lib/inbound-import-job";
import type { InboundImportJob } from "@/types";

const ACTIVE_STATUSES = new Set(["uploading", "queued", "processing", "cancelling"]);

function formatDuration(ms?: number | null): string {
  if (!ms || ms < 0) return "Starting";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

export function InboundImportProgress({ userId }: { userId?: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isCancelling, setIsCancelling] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const processingRef = useRef(false);
  const startedAtRef = useRef<Record<string, number>>({});
  const completedToastRef = useRef<Set<string>>(new Set());
  const { data: jobs } = useCollection<InboundImportJob>(userId ? inboundImportJobsPath(userId) : "");

  const activeJobs = useMemo(
    () =>
      jobs
        .filter((job) => ACTIVE_STATUSES.has(job.status))
        .sort((a, b) => {
          const aSeconds = typeof a.addDate === "object" && a.addDate && "seconds" in a.addDate ? a.addDate.seconds : 0;
          const bSeconds = typeof b.addDate === "object" && b.addDate && "seconds" in b.addDate ? b.addDate.seconds : 0;
          return aSeconds - bSeconds;
        }),
    [jobs]
  );

  useEffect(() => {
    if (!user || !userId || activeJobs.length === 0) return;
    let cancelled = false;

    const run = async () => {
      if (processingRef.current) return;
      const job = activeJobs[0];
      if (!job) return;
      processingRef.current = true;
      startedAtRef.current[job.id] ??= Date.now();
      try {
        const idToken = await user.getIdToken();
        const result = await processInboundImportJob({ userId, jobId: job.id, idToken });
        if (result.status === "completed" && !completedToastRef.current.has(job.id)) {
          completedToastRef.current.add(job.id);
          toast({
            title: "Bulk import completed",
            description: `${result.totalRows.toLocaleString()} rows processed in ${formatDuration(result.elapsedMs)}.`,
          });
        }
        setLastError(null);
      } catch (error: any) {
        if (!cancelled) setLastError(error?.message || "Import processing paused.");
      } finally {
        processingRef.current = false;
      }
    };

    void run();
    const interval = window.setInterval(() => void run(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeJobs, toast, user, userId]);

  if (!userId || activeJobs.length === 0) return null;

  const handleCancel = async (jobId: string) => {
    setIsCancelling(jobId);
    try {
      await requestInboundImportJobCancel(userId, jobId);
      toast({
        title: "Cancellation requested",
        description: "The import will stop after the current processing chunk finishes.",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Could not cancel import",
        description: error?.message || "Please try again.",
      });
    } finally {
      setIsCancelling(null);
    }
  };

  return (
    <div className="mb-4 space-y-3 px-6">
      {activeJobs.map((job) => {
        const progress =
          job.totalRows > 0 ? Math.min(100, Math.round((job.processedRows / job.totalRows) * 100)) : 0;
        const elapsed = job.elapsedMs ?? (startedAtRef.current[job.id] ? Date.now() - startedAtRef.current[job.id] : null);
        return (
          <div key={job.id} className="rounded-xl border bg-muted/30 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Bulk import {job.status === "cancelling" ? "cancelling" : "processing"}
                </div>
                <p className="text-xs text-muted-foreground">
                  {job.processedRows.toLocaleString()} of {job.totalRows.toLocaleString()} rows processed ·{" "}
                  {formatDuration(elapsed)} · {job.status}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={job.status === "cancelling" || isCancelling === job.id}
                onClick={() => void handleCancel(job.id)}
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
            </div>
            <Progress value={progress} className="mt-3 h-2" />
            {lastError ? <p className="mt-2 text-xs text-destructive">{lastError}</p> : null}
          </div>
        );
      })}
    </div>
  );
}
