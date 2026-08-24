"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Download,
  ExternalLink,
  Loader2,
  Trash2,
  Upload,
  Video,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { WarehouseOpsHeader } from "@/components/warehouse-ops/warehouse-ops-header";
import {
  deleteLocalWarehouseCameraClip,
  listAllLocalWarehouseCameraClips,
} from "@/lib/warehouse-camera-local";
import {
  listWarehouseCameraSessions,
  uploadWarehouseCameraClipToDrive,
} from "@/lib/warehouse-camera-client";
import {
  warehouseCameraJobTypeLabel,
  type LocalWarehouseCameraClip,
  type WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";

function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function statusLabel(status: string): string {
  switch (status) {
    case "uploaded":
      return "On Google Drive";
    case "uploading":
      return "Uploading…";
    case "upload_failed":
      return "Upload failed";
    case "stopped":
      return "Ready to upload";
    case "live":
    case "paused":
      return "Recording";
    default:
      return status;
  }
}

export function WarehouseOpsCameraGallery() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [clips, setClips] = useState<LocalWarehouseCameraClip[]>([]);
  const [sessionsById, setSessionsById] = useState<Map<string, WarehouseCameraSession>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const refresh = useCallback(async () => {
    if (!user) {
      setClips([]);
      setSessionsById(new Map());
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const local = await listAllLocalWarehouseCameraClips({ operatorId: user.uid });
      setClips(local);

      const clientIds = [...new Set(local.map((c) => c.clientUserId).filter(Boolean))];
      const sessionMap = new Map<string, WarehouseCameraSession>();
      await Promise.all(
        clientIds.map(async (clientUserId) => {
          try {
            const rows = await listWarehouseCameraSessions(user, { clientUserId });
            rows.forEach((row) => sessionMap.set(row.id, row));
          } catch {
            // Keep local list even if session lookup fails.
          }
        })
      );
      setSessionsById(sessionMap);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function uploadClip(clip: LocalWarehouseCameraClip) {
    if (!user) return;
    setUploadingId(clip.sessionId);
    setUploadProgress(0);
    try {
      const updated = await uploadWarehouseCameraClipToDrive(
        user,
        clip.sessionId,
        clip.blob,
        setUploadProgress
      );
      setSessionsById((prev) => new Map(prev).set(updated.id, updated));
      toast({
        title: "Video uploaded to Google Drive",
        description: "The phone copy remains until you remove it.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Drive upload failed",
        description: error instanceof Error ? error.message : "Try upload again.",
      });
      await refresh().catch(() => undefined);
    } finally {
      setUploadingId(null);
      setUploadProgress(0);
    }
  }

  async function removeLocalClip(clip: LocalWarehouseCameraClip) {
    await deleteLocalWarehouseCameraClip(clip.sessionId);
    setClips((prev) => prev.filter((row) => row.sessionId !== clip.sessionId));
    toast({
      title: "Phone copy removed",
      description: "Uploaded Drive copies are unchanged.",
    });
  }

  function downloadLocalClip(clip: LocalWarehouseCameraClip) {
    const extension = clip.mimeType.includes("mp4") ? "mp4" : "webm";
    const ref =
      clip.shipmentRequestIds[0] || clip.inventoryRequestIds[0] || "clip";
    const url = URL.createObjectURL(clip.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${clip.jobType}-${ref}-session-${clip.clipNumber}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-4">
      <WarehouseOpsHeader title="Camera gallery" />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Video className="h-5 w-5" />
            Clips on this device
          </CardTitle>
          <CardDescription>
            Local recordings from receive, pick, pack, and dispatch on this phone or browser.
            Upload to Google Drive when ready, or remove the phone copy after upload.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading clips…
            </div>
          ) : clips.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              No local clips yet. Record from Receiving, Pick, Pack, or Dispatch — choose Later on
              upload to keep them here.
            </div>
          ) : (
            clips.map((clip) => {
              const remote = sessionsById.get(clip.sessionId);
              const uploading = uploadingId === clip.sessionId;
              const linked =
                clip.shipmentRequestIds[0] ||
                clip.inventoryRequestIds[0] ||
                "—";
              return (
                <div key={clip.sessionId} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">
                          Session {clip.clipNumber} · {formatDuration(clip.durationMs)}
                        </p>
                        <Badge variant="secondary" className="text-[10px]">
                          {warehouseCameraJobTypeLabel(clip.jobType)}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {clip.clientDisplayName || "Client"} · {clip.warehouseLabel}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {(clip.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                        {new Date(clip.createdAt).toLocaleString()} · Ref {linked}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {statusLabel(remote?.status || "stopped")}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      <Button
                        size="icon"
                        variant="outline"
                        onClick={() => downloadLocalClip(clip)}
                        title="Save a copy to phone files"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      {remote?.status !== "uploaded" ? (
                        <Button
                          size="sm"
                          onClick={() => void uploadClip(clip)}
                          disabled={uploading}
                        >
                          {uploading ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="mr-1 h-3.5 w-3.5" />
                          )}
                          Upload
                        </Button>
                      ) : remote.driveFile?.webViewLink ? (
                        <Button size="sm" variant="outline" asChild>
                          <a
                            href={remote.driveFile.webViewLink}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <ExternalLink className="mr-1 h-3.5 w-3.5" />
                            Drive
                          </a>
                        </Button>
                      ) : null}
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => void removeLocalClip(clip)}
                        title="Remove phone copy"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {uploading ? <Progress className="mt-2" value={uploadProgress} /> : null}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
