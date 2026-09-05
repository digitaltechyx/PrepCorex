"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, Video } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  importWarehouseCameraVideoFile,
  listWarehouseCameraSessions,
} from "@/lib/warehouse-camera-client";
import {
  warehouseCameraSessionHasPlayback,
  type WarehouseCameraRequestSummary,
} from "@/lib/warehouse-camera-types";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const ACCEPTED_VIDEO = "video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov";

type Props = {
  warehouseId: string;
  warehouseLabel: string;
  clientUserId: string;
  clientDisplayName: string;
  inventoryRequestIds: string[];
  requestSummaries: WarehouseCameraRequestSummary[];
  disabled?: boolean;
  disabledReason?: string;
};

export function ReceiveLogVideoUpload({
  warehouseId,
  warehouseLabel,
  clientUserId,
  clientDisplayName,
  inventoryRequestIds,
  requestSummaries,
  disabled = false,
  disabledReason,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [hasUploadedVideo, setHasUploadedVideo] = useState(false);
  const [checking, setChecking] = useState(true);

  const primaryRequestId = inventoryRequestIds[0] ?? "";

  const refreshStatus = useCallback(async () => {
    if (disabled || !user || !primaryRequestId) {
      setHasUploadedVideo(false);
      setChecking(false);
      return;
    }
    setChecking(true);
    try {
      const sessions = await listWarehouseCameraSessions(user, {
        requestId: primaryRequestId,
        clientUserId,
        jobType: "receive",
      });
      setHasUploadedVideo(sessions.some(warehouseCameraSessionHasPlayback));
    } catch {
      setHasUploadedVideo(false);
    } finally {
      setChecking(false);
    }
  }, [clientUserId, disabled, primaryRequestId, user]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  async function handleFileSelected(file: File | null) {
    if (!file || !user) return;
    if (!file.type.startsWith("video/") && !/\.(mp4|webm|mov)$/i.test(file.name)) {
      toast({
        variant: "destructive",
        title: "Unsupported file",
        description: "Choose an MP4, WebM, or MOV video file.",
      });
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      toast({
        variant: "destructive",
        title: "Video too large",
        description: "Maximum upload size is 250 MB.",
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      let clipNumber = 1;
      if (primaryRequestId) {
        const existing = await listWarehouseCameraSessions(user, {
          requestId: primaryRequestId,
          clientUserId,
          jobType: "receive",
        });
        clipNumber = existing.filter((row) => row.status !== "discarded").length + 1;
      }

      await importWarehouseCameraVideoFile(
        user,
        {
          jobType: "receive",
          clientUserId,
          clientDisplayName,
          inventoryRequestIds,
          requestSummaries,
          warehouseId,
          warehouseLabel,
          clipNumber,
          file,
        },
        setUploadProgress
      );

      toast({
        title: "Receiving video uploaded",
        description: "The client can watch this video from their Inventory page.",
      });
      await refreshStatus();
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Video upload failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const buttonDisabled = disabled || uploading || checking;

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        {checking ? (
          <Badge variant="outline" className="text-[10px]">
            Video…
          </Badge>
        ) : hasUploadedVideo ? (
          <Badge className="bg-emerald-100 text-[10px] text-emerald-800 hover:bg-emerald-100">
            Video uploaded
          </Badge>
        ) : null}

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_VIDEO}
          className="hidden"
          onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)}
        />

        <Tooltip>
          <TooltipTrigger asChild>
            <span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                disabled={buttonDisabled}
                onClick={() => inputRef.current?.click()}
              >
                {uploading ? (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                ) : hasUploadedVideo ? (
                  <Video className="mr-1 h-3.5 w-3.5" />
                ) : (
                  <Upload className="mr-1 h-3.5 w-3.5" />
                )}
                {uploading ? "Uploading…" : hasUploadedVideo ? "Add video" : "Upload video"}
              </Button>
            </span>
          </TooltipTrigger>
          {disabled && disabledReason ? (
            <TooltipContent>{disabledReason}</TooltipContent>
          ) : (
            <TooltipContent>
              Upload a receiving video linked to this inbound request for the client to watch.
            </TooltipContent>
          )}
        </Tooltip>

        {uploading ? (
          <div className="w-24">
            <Progress value={uploadProgress} className="h-1.5" />
          </div>
        ) : null}
      </div>
    </TooltipProvider>
  );
}
