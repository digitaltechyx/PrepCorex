"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalVideoTrack,
  Room,
  type LocalVideoTrack,
  VideoPresets,
} from "livekit-client";
import {
  Download,
  ExternalLink,
  Loader2,
  Pause,
  Play,
  Square,
  SwitchCamera,
  Trash2,
  Upload,
  Video,
  Wifi,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  createWarehouseCameraSession,
  listWarehouseCameraSessions,
  updateWarehouseCameraSession,
  uploadWarehouseCameraClipToDrive,
} from "@/lib/warehouse-camera-client";
import {
  deleteLocalWarehouseCameraClip,
  listLocalWarehouseCameraClips,
  saveLocalWarehouseCameraClip,
} from "@/lib/warehouse-camera-local";
import type {
  LocalWarehouseCameraClip,
  WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";

type Props = {
  clientUserId: string;
  clientDisplayName: string;
  inventoryRequestIds: string[];
  warehouseId: string;
  warehouseLabel: string;
  onRecordingChange?: (active: boolean) => void;
};

type CameraFacingMode = "environment" | "user";

function preferredVideoMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    [
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8",
      "video/webm",
      "video/mp4",
    ].find((type) => MediaRecorder.isTypeSupported(type)) || ""
  );
}

function formatDuration(ms: number | null | undefined): string {
  if (!ms) return "0:00";
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

function statusLabel(status: WarehouseCameraSession["status"]): string {
  if (status === "live") return "Live";
  if (status === "paused") return "Paused";
  if (status === "stopped") return "On this device";
  if (status === "uploading") return "Uploading";
  if (status === "uploaded") return "Google Drive";
  if (status === "upload_failed") return "Upload failed";
  return "Discarded";
}

export function WarehouseMobileCameraRecorder({
  clientUserId,
  clientDisplayName,
  inventoryRequestIds,
  warehouseId,
  warehouseLabel,
  onRecordingChange,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);

  const [session, setSession] = useState<WarehouseCameraSession | null>(null);
  const [serverSessions, setServerSessions] = useState<WarehouseCameraSession[]>([]);
  const [localClips, setLocalClips] = useState<LocalWarehouseCameraClip[]>([]);
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPrompt, setUploadPrompt] = useState<LocalWarehouseCameraClip | null>(null);
  const [cameraFacingMode, setCameraFacingMode] =
    useState<CameraFacingMode>("environment");

  const refreshLists = useCallback(async () => {
    if (!user || inventoryRequestIds.length === 0) return;
    const [local, remote] = await Promise.all([
      listLocalWarehouseCameraClips(inventoryRequestIds),
      listWarehouseCameraSessions(user, {
        requestId: inventoryRequestIds[0],
        clientUserId,
      }),
    ]);
    setLocalClips(local);
    setServerSessions(remote);
  }, [clientUserId, inventoryRequestIds, user]);

  useEffect(() => {
    void refreshLists().catch(() => undefined);
  }, [refreshLists]);

  useEffect(() => {
    onRecordingChange?.(Boolean(session));
  }, [onRecordingChange, session]);

  useEffect(() => {
    if (!user || !session || (session.status !== "live" && session.status !== "paused")) return;
    const sendHeartbeat = () => {
      void updateWarehouseCameraSession(user, session.id, "heartbeat").catch(() => undefined);
    };
    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 8_000);
    return () => window.clearInterval(timer);
  }, [session, user]);

  useEffect(() => {
    if (!session) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [session]);

  useEffect(() => {
    return () => {
      onRecordingChange?.(false);
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      videoTrackRef.current?.stop();
      roomRef.current?.disconnect();
    };
  }, [onRecordingChange]);

  async function startRecording() {
    if (!user || starting || session) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast({
        variant: "destructive",
        title: "Recording is not supported",
        description: "Use current Chrome on Android or Safari on iPhone over HTTPS.",
      });
      return;
    }
    setStarting(true);
    let localTrack: LocalVideoTrack | null = null;
    let room: Room | null = null;
    let createdSessionId = "";
    try {
      localTrack = await createLocalVideoTrack({
        facingMode: cameraFacingMode,
        resolution: VideoPresets.h720.resolution,
      });
      await navigator.storage?.persist?.().catch(() => false);
      const created = await createWarehouseCameraSession(user, {
        clientUserId,
        clientDisplayName,
        inventoryRequestIds,
        warehouseId,
        warehouseLabel,
        clipNumber: Math.max(serverSessions.length, localClips.length) + 1,
      });
      createdSessionId = created.session.id;
      room = new Room({ adaptiveStream: true, dynacast: true });
      await room.connect(created.url, created.token);
      await room.localParticipant.publishTrack(localTrack);

      const stream = new MediaStream([localTrack.mediaStreamTrack]);
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
      const mimeType = preferredVideoMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 2_500_000,
      });
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.start(1000);
      recorderRef.current = recorder;
      roomRef.current = room;
      videoTrackRef.current = localTrack;
      startedAtRef.current = Date.now();
      pausedAtRef.current = 0;
      pausedTotalRef.current = 0;
      setSession(created.session);
      setServerSessions((prev) => [created.session, ...prev]);
      toast({
        title: "Recording and live view started",
        description: `${clientDisplayName} can now watch this receive live.`,
      });
    } catch (error) {
      localTrack?.stop();
      room?.disconnect();
      if (createdSessionId) {
        await updateWarehouseCameraSession(user, createdSessionId, "discard").catch(
          () => undefined
        );
      }
      toast({
        variant: "destructive",
        title: "Could not start recording",
        description: error instanceof Error ? error.message : "Camera start failed.",
      });
    } finally {
      setStarting(false);
    }
  }

  async function pauseRecording() {
    if (!user || !session || recorderRef.current?.state !== "recording") return;
    recorderRef.current.pause();
    videoTrackRef.current?.mute();
    pausedAtRef.current = Date.now();
    try {
      const updated = await updateWarehouseCameraSession(user, session.id, "pause");
      setSession(updated);
    } catch (error) {
      recorderRef.current.resume();
      videoTrackRef.current?.unmute();
      toast({
        variant: "destructive",
        title: "Pause failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  async function resumeRecording() {
    if (!user || !session || recorderRef.current?.state !== "paused") return;
    recorderRef.current.resume();
    videoTrackRef.current?.unmute();
    if (pausedAtRef.current) pausedTotalRef.current += Date.now() - pausedAtRef.current;
    pausedAtRef.current = 0;
    try {
      const updated = await updateWarehouseCameraSession(user, session.id, "resume");
      setSession(updated);
    } catch (error) {
      recorderRef.current.pause();
      videoTrackRef.current?.mute();
      toast({
        variant: "destructive",
        title: "Resume failed",
        description: error instanceof Error ? error.message : "Try again.",
      });
    }
  }

  async function stopRecording() {
    if (!user || !session || !recorderRef.current || stopping) return;
    setStopping(true);
    const activeSession = session;
    const recorder = recorderRef.current;
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error("The phone could not finish the video file"));
        recorder.onstop = () => {
          const type = recorder.mimeType || chunksRef.current[0]?.type || "video/webm";
          resolve(new Blob(chunksRef.current, { type }));
        };
        recorder.stop();
      });
      const pauseInProgress = pausedAtRef.current ? Date.now() - pausedAtRef.current : 0;
      const durationMs = Math.max(
        0,
        Date.now() - startedAtRef.current - pausedTotalRef.current - pauseInProgress
      );
      videoTrackRef.current?.stop();
      roomRef.current?.disconnect();
      if (previewRef.current) previewRef.current.srcObject = null;

      const localClip: LocalWarehouseCameraClip = {
        sessionId: activeSession.id,
        clientUserId,
        clientDisplayName,
        inventoryRequestIds,
        warehouseId,
        warehouseLabel,
        clipNumber: activeSession.clipNumber,
        mimeType: blob.type || "video/webm",
        durationMs,
        sizeBytes: blob.size,
        createdAt: new Date().toISOString(),
        blob,
      };
      const updated = await updateWarehouseCameraSession(user, activeSession.id, "stop", {
        durationMs,
        sizeBytes: blob.size,
        mimeType: localClip.mimeType,
      });
      setServerSessions((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row))
      );
      setSession(null);
      await saveLocalWarehouseCameraClip(localClip);
      setLocalClips((prev) => [localClip, ...prev.filter((c) => c.sessionId !== localClip.sessionId)]);
      setUploadPrompt(localClip);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Could not finish recording",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      recorderRef.current = null;
      videoTrackRef.current = null;
      roomRef.current = null;
      setStopping(false);
    }
  }

  async function uploadClip(clip: LocalWarehouseCameraClip) {
    if (!user) return;
    setUploadPrompt(null);
    setUploadingId(clip.sessionId);
    setUploadProgress(0);
    try {
      const updated = await uploadWarehouseCameraClipToDrive(
        user,
        clip.sessionId,
        clip.blob,
        setUploadProgress
      );
      setServerSessions((prev) =>
        prev.map((row) => (row.id === updated.id ? updated : row))
      );
      toast({
        title: "Video uploaded to Google Drive",
        description: "The clip remains listed on this receive.",
      });
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Drive upload failed",
        description: error instanceof Error ? error.message : "Try upload again.",
      });
      await refreshLists().catch(() => undefined);
    } finally {
      setUploadingId(null);
      setUploadProgress(0);
    }
  }

  async function removeLocalClip(clip: LocalWarehouseCameraClip) {
    await deleteLocalWarehouseCameraClip(clip.sessionId);
    setLocalClips((prev) => prev.filter((row) => row.sessionId !== clip.sessionId));
    toast({
      title: "Phone copy removed",
      description: "The session record and uploaded Drive copy are unchanged.",
    });
  }

  function downloadLocalClip(clip: LocalWarehouseCameraClip) {
    const extension = clip.mimeType.includes("mp4") ? "mp4" : "webm";
    const url = URL.createObjectURL(clip.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `receive-${inventoryRequestIds[0]}-session-${clip.clipNumber}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const sessionById = new Map(serverSessions.map((row) => [row.id, row]));
  const localSessionIds = new Set(localClips.map((clip) => clip.sessionId));
  const serverOnlySessions = serverSessions.filter(
    (row) => row.id !== session?.id && !localSessionIds.has(row.id) && row.status !== "discarded"
  );

  return (
    <>
      <Card className="border-blue-200 bg-blue-50/40 dark:border-blue-900 dark:bg-blue-950/20">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Video className="h-5 w-5" />
            Receive video
          </CardTitle>
          <CardDescription>
            Record this receive with the phone camera. The client can watch live; completed clips
            stay on this device until you choose Google Drive upload.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {session ? (
            <>
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video
                  ref={previewRef}
                  muted
                  playsInline
                  className="aspect-video w-full object-cover"
                />
                <Badge
                  className="absolute left-3 top-3 gap-1 bg-red-600 text-white hover:bg-red-600"
                >
                  <Wifi className="h-3 w-3" />
                  {session.status === "paused" ? "PAUSED" : "LIVE"}
                </Badge>
                <Badge className="absolute right-3 top-3 bg-black/70 text-white hover:bg-black/70">
                  {cameraFacingMode === "environment" ? "Back camera" : "Front camera"}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {session.status === "paused" ? (
                  <Button onClick={() => void resumeRecording()} variant="outline">
                    <Play className="mr-2 h-4 w-4" />
                    Resume
                  </Button>
                ) : (
                  <Button onClick={() => void pauseRecording()} variant="outline">
                    <Pause className="mr-2 h-4 w-4" />
                    Pause
                  </Button>
                )}
                <Button
                  onClick={() => void stopRecording()}
                  disabled={stopping}
                  variant="destructive"
                >
                  {stopping ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Square className="mr-2 h-4 w-4" />
                  )}
                  Stop
                </Button>
              </div>
            </>
          ) : (
            <Alert>
              <Video className="h-4 w-4" />
              <AlertTitle>Start a recording for this receive?</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p>
                  Camera access is used only after you tap Start. You can pause, resume, stop, and
                  create multiple clips. Keep this page open and the phone screen awake while
                  recording.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setCameraFacingMode((current) =>
                      current === "environment" ? "user" : "environment"
                    )
                  }
                >
                  <SwitchCamera className="mr-2 h-4 w-4" />
                  Use {cameraFacingMode === "environment" ? "front" : "back"} camera
                </Button>
                <Button onClick={() => void startRecording()} disabled={starting}>
                  {starting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Video className="mr-2 h-4 w-4" />
                  )}
                  Start recording
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {localClips.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Clips on this phone</p>
              {localClips.map((clip) => {
                const remote = sessionById.get(clip.sessionId);
                const uploading = uploadingId === clip.sessionId;
                return (
                  <div key={clip.sessionId} className="rounded-lg border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium">
                          Session {clip.clipNumber} · {formatDuration(clip.durationMs)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {(clip.sizeBytes / 1024 / 1024).toFixed(1)} MB ·{" "}
                          {statusLabel(remote?.status || "stopped")}
                        </p>
                      </div>
                      <div className="flex gap-1">
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
                            <a href={remote.driveFile.webViewLink} target="_blank" rel="noreferrer">
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
              })}
            </div>
          ) : null}
          {serverOnlySessions.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Receive session history</p>
              {serverOnlySessions.map((row) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-background p-3"
                >
                  <div>
                    <p className="text-sm font-medium">
                      Session {row.clipNumber} · {formatDuration(row.durationMs)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(row.startedAt).toLocaleString()} · {statusLabel(row.status)}
                    </p>
                  </div>
                  {row.driveFile?.webViewLink ? (
                    <Button size="sm" variant="outline" asChild>
                      <a href={row.driveFile.webViewLink} target="_blank" rel="noreferrer">
                        <ExternalLink className="mr-1 h-3.5 w-3.5" />
                        Open Drive
                      </a>
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <AlertDialog open={Boolean(uploadPrompt)} onOpenChange={(open) => !open && setUploadPrompt(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Upload this video to Google Drive?</AlertDialogTitle>
            <AlertDialogDescription>
              The clip is safely stored on this phone for now. Upload places it in the admin
              PrepCorex Warehouse Recordings folder. You can also upload later from this receive.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Later</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => uploadPrompt && void uploadClip(uploadPrompt)}
            >
              Upload now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
