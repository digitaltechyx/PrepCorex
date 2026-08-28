"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createLocalVideoTrack,
  LocalVideoTrack,
  Room,
  VideoPresets,
} from "livekit-client";
import {
  Download,
  ExternalLink,
  Hand,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Square,
  SwitchCamera,
  Trash2,
  Upload,
  Video,
  Wifi,
  X,
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
  listLocalWarehouseCameraClipsByShipment,
  saveLocalWarehouseCameraClip,
} from "@/lib/warehouse-camera-local";
import type {
  LocalWarehouseCameraClip,
  WarehouseCameraJobType,
  WarehouseCameraRequestSummary,
  WarehouseCameraSession,
} from "@/lib/warehouse-camera-types";
import { warehouseCameraJobTypeLabel } from "@/lib/warehouse-camera-types";

type Props = {
  jobType?: WarehouseCameraJobType;
  clientUserId: string;
  clientDisplayName: string;
  inventoryRequestIds?: string[];
  shipmentRequestIds?: string[];
  requestSummaries?: WarehouseCameraRequestSummary[];
  warehouseId: string;
  warehouseLabel: string;
  onRecordingChange?: (active: boolean) => void;
};

type CameraFacingMode = "environment" | "user";

const PRE_LIVE_COUNTDOWN_SECONDS = 10;
const MAX_LIVE_SESSION_MS = 2 * 60 * 1000;
const PALM_HOLD_MS = 2_000;
const GESTURE_SAMPLE_MS = 150;
const VOICE_END_PHRASES = [
  "prepcorex end session",
  "prep corex end session",
  "prep core x end session",
];

type HandsFreeStopMethod = "gesture" | "voice";
type GestureRecognizerInstance = {
  recognizeForVideo(
    video: HTMLVideoElement,
    timestampMs: number
  ): { gestures?: Array<Array<{ categoryName?: string; score?: number }>> };
  close(): void;
};

type BrowserSpeechRecognitionEvent = {
  resultIndex: number;
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
};

type BrowserSpeechRecognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  processLocally?: boolean;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;
  const speechWindow = window as typeof window & {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

function transcriptRequestsSessionEnd(transcript: string): boolean {
  const normalized = transcript
    .toLowerCase()
    .replace(/[.,!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return VOICE_END_PHRASES.some((phrase) => normalized.includes(phrase));
}

async function createCameraTrack(facingMode: CameraFacingMode): Promise<LocalVideoTrack> {
  const resolution = VideoPresets.h720.resolution;
  const attempts: MediaTrackConstraints[] = [
    {
      facingMode: { exact: facingMode },
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
    },
    {
      facingMode: { ideal: facingMode },
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
    },
    {
      facingMode,
      width: { ideal: resolution.width },
      height: { ideal: resolution.height },
    },
  ];

  for (const video of attempts) {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video,
        audio: false,
      });
      const mediaTrack = mediaStream.getVideoTracks()[0];
      if (mediaTrack) {
        return new LocalVideoTrack(mediaTrack);
      }
    } catch {
      // Try the next constraint set.
    }
  }

  return createLocalVideoTrack({
    facingMode,
    resolution,
  });
}

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
  jobType = "receive",
  clientUserId,
  clientDisplayName,
  inventoryRequestIds = [],
  shipmentRequestIds = [],
  requestSummaries = [],
  warehouseId,
  warehouseLabel,
  onRecordingChange,
}: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const jobLabel = warehouseCameraJobTypeLabel(jobType);
  const isOutbound = jobType !== "receive";
  const linkedIds = isOutbound ? shipmentRequestIds : inventoryRequestIds;
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const roomRef = useRef<Room | null>(null);
  const videoTrackRef = useRef<LocalVideoTrack | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const pausedAtRef = useRef(0);
  const pausedTotalRef = useRef(0);
  const sessionLimitTimerRef = useRef<number | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const goLiveInProgressRef = useRef(false);
  const gestureRecognizerRef = useRef<GestureRecognizerInstance | null>(null);
  const gestureAnimationRef = useRef<number | null>(null);
  const palmStartedAtRef = useRef(0);
  const lastGestureSampleRef = useRef(0);
  const speechRecognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const handsFreeActiveRef = useRef(false);
  const stopRecordingRef = useRef<
    (options?: { autoStop?: boolean; handsFree?: HandsFreeStopMethod }) => Promise<void>
  >(async () => undefined);

  const [session, setSession] = useState<WarehouseCameraSession | null>(null);
  const [serverSessions, setServerSessions] = useState<WarehouseCameraSession[]>([]);
  const [localClips, setLocalClips] = useState<LocalWarehouseCameraClip[]>([]);
  const [starting, setStarting] = useState(false);
  const [countdownRemaining, setCountdownRemaining] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPrompt, setUploadPrompt] = useState<LocalWarehouseCameraClip | null>(null);
  const [cameraFacingMode, setCameraFacingMode] =
    useState<CameraFacingMode>("environment");
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [switchingCamera, setSwitchingCamera] = useState(false);
  const [gestureStatus, setGestureStatus] = useState<
    "loading" | "ready" | "holding" | "unavailable"
  >("loading");
  const [palmHoldProgress, setPalmHoldProgress] = useState(0);
  const [voiceStatus, setVoiceStatus] = useState<
    "checking" | "listening" | "unavailable"
  >("checking");
  const [handsFreeStopMethod, setHandsFreeStopMethod] =
    useState<HandsFreeStopMethod | null>(null);

  const refreshLists = useCallback(async () => {
    if (!user || linkedIds.length === 0) return;
    const [local, remote] = await Promise.all([
      isOutbound
        ? listLocalWarehouseCameraClipsByShipment(linkedIds)
        : listLocalWarehouseCameraClips(linkedIds),
      listWarehouseCameraSessions(user, {
        ...(isOutbound
          ? { shipmentRequestId: linkedIds[0] }
          : { requestId: linkedIds[0] }),
        clientUserId,
        jobType,
      }),
    ]);
    setLocalClips(local);
    setServerSessions(remote);
  }, [clientUserId, isOutbound, jobType, linkedIds, user]);

  useEffect(() => {
    void refreshLists().catch(() => undefined);
  }, [refreshLists]);

  useEffect(() => {
    onRecordingChange?.(Boolean(session));
  }, [onRecordingChange, session]);

  function clearSessionTimers() {
    if (sessionLimitTimerRef.current != null) {
      window.clearTimeout(sessionLimitTimerRef.current);
      sessionLimitTimerRef.current = null;
    }
    if (elapsedTimerRef.current != null) {
      window.clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  }

  function stopHandsFreeControls() {
    handsFreeActiveRef.current = false;
    if (gestureAnimationRef.current != null) {
      window.cancelAnimationFrame(gestureAnimationRef.current);
      gestureAnimationRef.current = null;
    }
    palmStartedAtRef.current = 0;
    lastGestureSampleRef.current = 0;
    setPalmHoldProgress(0);
    speechRecognitionRef.current?.abort();
    speechRecognitionRef.current = null;
  }

  async function loadGestureRecognizer(): Promise<GestureRecognizerInstance | null> {
    if (gestureRecognizerRef.current) {
      setGestureStatus("ready");
      return gestureRecognizerRef.current;
    }
    try {
      const { FilesetResolver, GestureRecognizer } = await import("@mediapipe/tasks-vision");
      const vision = await FilesetResolver.forVisionTasks(
        "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm"
      );
      const modelAssetPath =
        "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
      let recognizer: GestureRecognizerInstance;
      try {
        recognizer = (await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
        })) as GestureRecognizerInstance;
      } catch {
        recognizer = (await GestureRecognizer.createFromOptions(vision, {
          baseOptions: { modelAssetPath },
          runningMode: "VIDEO",
          numHands: 1,
        })) as GestureRecognizerInstance;
      }
      gestureRecognizerRef.current = recognizer;
      setGestureStatus("ready");
      return recognizer;
    } catch (error) {
      console.warn("[warehouse-camera] palm recognition unavailable", error);
      setGestureStatus("unavailable");
      return null;
    }
  }

  function startPalmControl(recognizer: GestureRecognizerInstance) {
    const detect = (now: number) => {
      if (!handsFreeActiveRef.current) return;
      gestureAnimationRef.current = window.requestAnimationFrame(detect);
      if (now - lastGestureSampleRef.current < GESTURE_SAMPLE_MS) return;
      lastGestureSampleRef.current = now;

      const video = previewRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

      try {
        const result = recognizer.recognizeForVideo(video, now);
        const topGesture = result.gestures?.[0]?.[0];
        const openPalm =
          topGesture?.categoryName === "Open_Palm" && Number(topGesture.score ?? 0) >= 0.65;
        if (!openPalm) {
          palmStartedAtRef.current = 0;
          setPalmHoldProgress(0);
          setGestureStatus("ready");
          return;
        }

        if (!palmStartedAtRef.current) palmStartedAtRef.current = now;
        const progress = Math.min(100, ((now - palmStartedAtRef.current) / PALM_HOLD_MS) * 100);
        setPalmHoldProgress(progress);
        setGestureStatus("holding");
        if (progress >= 100) {
          handsFreeActiveRef.current = false;
          setHandsFreeStopMethod("gesture");
          void stopRecordingRef.current({ handsFree: "gesture" });
        }
      } catch (error) {
        console.warn("[warehouse-camera] palm detection failed", error);
      }
    };
    gestureAnimationRef.current = window.requestAnimationFrame(detect);
  }

  function startVoiceControl() {
    const Recognition = getSpeechRecognitionConstructor();
    if (!Recognition) {
      setVoiceStatus("unavailable");
      return;
    }

    const recognition = new Recognition();
    // Enforce local recognition. If the browser cannot guarantee this, voice control stays off.
    if (!("processLocally" in recognition)) {
      setVoiceStatus("unavailable");
      return;
    }
    recognition.processLocally = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i]?.[0]?.transcript ?? "";
        if (!transcriptRequestsSessionEnd(transcript)) continue;
        handsFreeActiveRef.current = false;
        setHandsFreeStopMethod("voice");
        recognition.abort();
        void stopRecordingRef.current({ handsFree: "voice" });
        return;
      }
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted" && handsFreeActiveRef.current) {
        setVoiceStatus("unavailable");
      }
    };
    recognition.onend = () => {
      if (!handsFreeActiveRef.current) return;
      window.setTimeout(() => {
        if (!handsFreeActiveRef.current) return;
        try {
          recognition.start();
          setVoiceStatus("listening");
        } catch {
          setVoiceStatus("unavailable");
        }
      }, 250);
    };
    speechRecognitionRef.current = recognition;
    try {
      recognition.start();
      setVoiceStatus("listening");
    } catch {
      speechRecognitionRef.current = null;
      setVoiceStatus("unavailable");
    }
  }

  async function startHandsFreeControls() {
    stopHandsFreeControls();
    handsFreeActiveRef.current = true;
    setGestureStatus("loading");
    setVoiceStatus("checking");
    setHandsFreeStopMethod(null);
    const recognizer = await loadGestureRecognizer();
    if (recognizer && handsFreeActiveRef.current) startPalmControl(recognizer);
    if (handsFreeActiveRef.current) startVoiceControl();
  }

  function scheduleSessionTimers() {
    clearSessionTimers();
    sessionLimitTimerRef.current = window.setTimeout(() => {
      void stopRecording({ autoStop: true });
    }, MAX_LIVE_SESSION_MS);
    elapsedTimerRef.current = window.setInterval(() => {
      if (startedAtRef.current > 0) {
        setElapsedMs(Math.min(Date.now() - startedAtRef.current, MAX_LIVE_SESSION_MS));
      }
    }, 500);
  }

  function detachPreviewTrack() {
    const activeTrack = videoTrackRef.current;
    const previewEl = previewRef.current;
    if (activeTrack && previewEl) {
      activeTrack.detach(previewEl);
    }
  }

  function cancelCountdown() {
    setCountdownRemaining(null);
    detachPreviewTrack();
    videoTrackRef.current?.stop();
    videoTrackRef.current = null;
    setActiveTrackId(null);
    setStarting(false);
  }

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
    if (!session && countdownRemaining === null) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [countdownRemaining, session]);

  useEffect(() => {
    if (countdownRemaining == null || countdownRemaining > 0 || session || goLiveInProgressRef.current) {
      return;
    }
    void activateLiveSession();
  }, [countdownRemaining, session]);

  useEffect(() => {
    if (countdownRemaining == null || countdownRemaining <= 0) return;
    const timer = window.setTimeout(() => {
      setCountdownRemaining((current) => (current != null && current > 0 ? current - 1 : current));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdownRemaining]);

  useEffect(() => {
    return () => {
      onRecordingChange?.(false);
      clearSessionTimers();
      stopHandsFreeControls();
      gestureRecognizerRef.current?.close();
      gestureRecognizerRef.current = null;
      recorderRef.current?.state !== "inactive" && recorderRef.current?.stop();
      detachPreviewTrack();
      videoTrackRef.current?.stop();
      roomRef.current?.disconnect();
    };
  }, [onRecordingChange]);

  useEffect(() => {
    const videoEl = previewRef.current;
    const track = videoTrackRef.current;
    if ((!session && countdownRemaining === null) || !videoEl || !track) return;

    track.attach(videoEl);
    void videoEl.play().catch(() => undefined);

    return () => {
      track.detach(videoEl);
    };
  }, [countdownRemaining, session, activeTrackId]);

  async function beginCountdown() {
    if (!user || starting || session || countdownRemaining !== null) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      toast({
        variant: "destructive",
        title: "Recording is not supported",
        description: "Use current Chrome on Android or Safari on iPhone over HTTPS.",
      });
      return;
    }
    setStarting(true);
    try {
      const localTrack = await createCameraTrack(cameraFacingMode);
      await navigator.storage?.persist?.().catch(() => false);
      videoTrackRef.current = localTrack;
      setActiveTrackId(localTrack.mediaStreamTrack.id);
      setCountdownRemaining(PRE_LIVE_COUNTDOWN_SECONDS);
    } catch (error) {
      videoTrackRef.current?.stop();
      videoTrackRef.current = null;
      setActiveTrackId(null);
      toast({
        variant: "destructive",
        title: "Could not open camera",
        description: error instanceof Error ? error.message : "Camera start failed.",
      });
    } finally {
      setStarting(false);
    }
  }

  async function activateLiveSession() {
    if (!user || goLiveInProgressRef.current || session) return;
    const localTrack = videoTrackRef.current;
    if (!localTrack) {
      cancelCountdown();
      return;
    }

    goLiveInProgressRef.current = true;
    setStarting(true);
    let room: Room | null = null;
    let createdSessionId = "";
    try {
      const created = await createWarehouseCameraSession(user, {
        jobType,
        clientUserId,
        clientDisplayName,
        inventoryRequestIds: isOutbound ? [] : inventoryRequestIds,
        shipmentRequestIds: isOutbound ? shipmentRequestIds : [],
        requestSummaries: isOutbound ? requestSummaries : undefined,
        warehouseId,
        warehouseLabel,
        clipNumber: Math.max(serverSessions.length, localClips.length) + 1,
      });
      createdSessionId = created.session.id;
      room = new Room({ adaptiveStream: true, dynacast: true });
      await room.connect(created.url, created.token);
      await room.localParticipant.publishTrack(localTrack);

      const stream = new MediaStream([localTrack.mediaStreamTrack]);
      recorderStreamRef.current = stream;
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
      startedAtRef.current = Date.now();
      pausedAtRef.current = 0;
      pausedTotalRef.current = 0;
      setElapsedMs(0);
      scheduleSessionTimers();
      setSession(created.session);
      setCountdownRemaining(null);
      setServerSessions((prev) => [created.session, ...prev]);
      void startHandsFreeControls();
      toast({
        title: "Recording and live view started",
        description: `${clientDisplayName} can now watch this ${jobLabel.toLowerCase()} live.`,
      });
    } catch (error) {
      localTrack.stop();
      room?.disconnect();
      if (createdSessionId) {
        await updateWarehouseCameraSession(user, createdSessionId, "discard").catch(
          () => undefined
        );
      }
      videoTrackRef.current = null;
      setActiveTrackId(null);
      setCountdownRemaining(null);
      toast({
        variant: "destructive",
        title: "Could not start recording",
        description: error instanceof Error ? error.message : "Camera start failed.",
      });
    } finally {
      goLiveInProgressRef.current = false;
      setStarting(false);
    }
  }

  async function startRecording() {
    await beginCountdown();
  }

  async function switchCamera() {
    if (
      !user ||
      switchingCamera ||
      (!session && countdownRemaining === null) ||
      !videoTrackRef.current
    ) {
      return;
    }

    const nextFacing: CameraFacingMode =
      cameraFacingMode === "environment" ? "user" : "environment";
    const room = roomRef.current;
    const oldTrack = videoTrackRef.current;
    const recorder = recorderRef.current;
    const recorderStream = recorderStreamRef.current;

    setSwitchingCamera(true);
    let newTrack: LocalVideoTrack | null = null;
    try {
      newTrack = await createCameraTrack(nextFacing);
      if (room) {
        await room.localParticipant.unpublishTrack(oldTrack);
        await room.localParticipant.publishTrack(newTrack);
      }

      if (recorderStream && recorder && recorder.state !== "inactive") {
        recorderStream.getVideoTracks().forEach((track) => {
          recorderStream.removeTrack(track);
        });
        recorderStream.addTrack(newTrack.mediaStreamTrack);
      }

      detachPreviewTrack();
      oldTrack.stop();
      videoTrackRef.current = newTrack;
      setCameraFacingMode(nextFacing);
      setActiveTrackId(newTrack.mediaStreamTrack.id);
    } catch (error) {
      newTrack?.stop();
      toast({
        variant: "destructive",
        title: "Could not switch camera",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setSwitchingCamera(false);
    }
  }

  async function pauseRecording() {
    if (!user || !session || recorderRef.current?.state !== "recording") return;
    stopHandsFreeControls();
    recorderRef.current.pause();
    videoTrackRef.current?.mute();
    pausedAtRef.current = Date.now();
    try {
      const updated = await updateWarehouseCameraSession(user, session.id, "pause");
      setSession(updated);
    } catch (error) {
      recorderRef.current.resume();
      videoTrackRef.current?.unmute();
      void startHandsFreeControls();
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
      void startHandsFreeControls();
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

  async function stopRecording(options?: {
    autoStop?: boolean;
    handsFree?: HandsFreeStopMethod;
  }) {
    if (!user || !session || !recorderRef.current || stopping) return;
    setStopping(true);
    if (options?.handsFree) setHandsFreeStopMethod(options.handsFree);
    stopHandsFreeControls();
    clearSessionTimers();
    const activeSession = session;
    const recorder = recorderRef.current;
    const activeTrack = videoTrackRef.current;
    try {
      // Privacy first: remove the camera from the live room before finalizing the local file.
      // `false` keeps the source track alive for the immediate MediaRecorder stop below.
      activeTrack?.mute();
      if (activeTrack && roomRef.current) {
        await roomRef.current.localParticipant
          .unpublishTrack(activeTrack, false)
          .catch(() => undefined);
      }
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
      const previewEl = previewRef.current;
      if (activeTrack && previewEl) {
        activeTrack.detach(previewEl);
      }
      activeTrack?.stop();
      roomRef.current?.disconnect();

      const localClip: LocalWarehouseCameraClip = {
        sessionId: activeSession.id,
        clientUserId,
        clientDisplayName,
        inventoryRequestIds: isOutbound ? [] : inventoryRequestIds,
        shipmentRequestIds: isOutbound ? shipmentRequestIds : [],
        jobType,
        warehouseId,
        warehouseLabel,
        operatorId: user.uid,
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
      setElapsedMs(0);
      await saveLocalWarehouseCameraClip(localClip);
      setLocalClips((prev) => [localClip, ...prev.filter((c) => c.sessionId !== localClip.sessionId)]);
      setUploadPrompt(localClip);
      if (options?.autoStop) {
        toast({
          title: "Recording stopped",
          description: "The 2 minute session limit was reached.",
        });
      } else if (options?.handsFree) {
        toast({
          title: "Session completed",
          description:
            options.handsFree === "gesture"
              ? "Open-palm gesture recognized. Live view and recording stopped."
              : "Voice command recognized. Live view and recording stopped.",
        });
      }
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
      recorderStreamRef.current = null;
      setActiveTrackId(null);
      setStopping(false);
    }
  }

  stopRecordingRef.current = stopRecording;

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
        description: `The clip remains listed on this ${jobLabel.toLowerCase()}.`,
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
    anchor.download = `${jobType}-${linkedIds[0] || "clip"}-session-${clip.clipNumber}.${extension}`;
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
            {jobLabel} video
            <Badge variant="outline" className="text-[10px] font-normal">
              Optional
            </Badge>
          </CardTitle>
          <CardDescription>
            Record this {jobLabel.toLowerCase()} with the phone camera if you want. After a 10
            second countdown the client can watch live for up to 2 minutes. Completed clips stay on
            this device until you upload to Google Drive (now or later from Gallery / dispatch).
            Hold an open palm for 2 seconds or say &quot;PrepCorex, end session&quot; to stop
            hands-free.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {session || countdownRemaining !== null ? (
            <>
              <div className="relative overflow-hidden rounded-xl bg-black">
                <video
                  ref={previewRef}
                  autoPlay
                  muted
                  playsInline
                  className="aspect-video w-full object-cover"
                />
                {countdownRemaining !== null ? (
                  <>
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55">
                      {countdownRemaining > 0 ? (
                        <>
                          <p className="text-sm font-medium uppercase tracking-wide text-white/90">
                            Going live in
                          </p>
                          <p className="mt-2 text-6xl font-bold tabular-nums text-white">
                            {countdownRemaining}
                          </p>
                          <p className="mt-3 max-w-xs px-4 text-center text-xs text-white/80">
                            Client cannot see this yet. Frame the shot, then wait for live +
                            recording to start.
                          </p>
                        </>
                      ) : (
                        <>
                          <Loader2 className="h-10 w-10 animate-spin text-white" />
                          <p className="mt-3 text-sm font-medium text-white">
                            Starting live &amp; recording…
                          </p>
                        </>
                      )}
                    </div>
                    <Badge className="absolute left-3 top-3 bg-amber-600 text-white hover:bg-amber-600">
                      {countdownRemaining > 0 ? `PREP ${countdownRemaining}s` : "CONNECTING"}
                    </Badge>
                  </>
                ) : (
                  <>
                    <Badge
                      className="absolute left-3 top-3 gap-1 bg-red-600 text-white hover:bg-red-600"
                    >
                      <Wifi className="h-3 w-3" />
                      {session?.status === "paused" ? "PAUSED" : "LIVE"}
                    </Badge>
                    <Badge className="absolute bottom-3 left-3 bg-black/75 text-white hover:bg-black/75 tabular-nums">
                      {formatDuration(elapsedMs)} / {formatDuration(MAX_LIVE_SESSION_MS)}
                    </Badge>
                    {gestureStatus === "holding" ? (
                      <div className="absolute inset-x-4 bottom-12 rounded-lg bg-amber-500/95 p-3 text-center text-sm font-semibold text-black">
                        Hold palm to end session
                        <Progress className="mt-2 h-2" value={palmHoldProgress} />
                      </div>
                    ) : null}
                  </>
                )}
                <Badge className="absolute right-3 top-3 bg-black/70 text-white hover:bg-black/70">
                  {cameraFacingMode === "environment" ? "Back camera" : "Front camera"}
                </Badge>
              </div>
              {countdownRemaining !== null && countdownRemaining > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    onClick={() => void switchCamera()}
                    disabled={switchingCamera}
                    variant="outline"
                  >
                    {switchingCamera ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <SwitchCamera className="mr-2 h-4 w-4" />
                    )}
                    {cameraFacingMode === "environment" ? "Front" : "Back"}
                  </Button>
                  <Button onClick={cancelCountdown} variant="outline">
                    <X className="mr-2 h-4 w-4" />
                    Cancel
                  </Button>
                </div>
              ) : (
              <div className="grid grid-cols-3 gap-2">
                {session?.status === "paused" ? (
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
                  onClick={() => void switchCamera()}
                  disabled={switchingCamera}
                  variant="outline"
                >
                  {switchingCamera ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <SwitchCamera className="mr-2 h-4 w-4" />
                  )}
                  {cameraFacingMode === "environment" ? "Front" : "Back"}
                </Button>
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
              )}
              {session && session.status !== "paused" ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Badge variant="outline" className="gap-1">
                    <Hand className="h-3 w-3" />
                    {gestureStatus === "loading"
                      ? "Palm control loading"
                      : gestureStatus === "unavailable"
                        ? "Palm control unavailable"
                        : gestureStatus === "holding"
                          ? "Hold palm steady"
                          : "Palm control ready"}
                  </Badge>
                  <Badge variant="outline" className="gap-1">
                    {voiceStatus === "listening" ? (
                      <Mic className="h-3 w-3" />
                    ) : (
                      <MicOff className="h-3 w-3" />
                    )}
                    {voiceStatus === "listening"
                      ? 'Say "PrepCorex, end session"'
                      : voiceStatus === "checking"
                        ? "Checking local voice control"
                        : "Local voice control unavailable"}
                  </Badge>
                  <span className="text-muted-foreground">
                    Audio is never added to the live stream or recording.
                  </span>
                </div>
              ) : null}
              {handsFreeStopMethod ? (
                <p className="text-xs text-muted-foreground">
                  Last session ended by {handsFreeStopMethod === "gesture" ? "palm gesture" : "voice command"}.
                </p>
              ) : null}
            </>
          ) : (
            <Alert>
              <Video className="h-4 w-4" />
              <AlertTitle>Start a recording for this {jobLabel.toLowerCase()}?</AlertTitle>
              <AlertDescription className="mt-2 space-y-3">
                <p>
                  Camera access is used only after you tap Start. You get a 10 second on-screen
                  countdown to frame the shot before the client goes live. Sessions auto-stop after
                  2 minutes. Palm gesture, local voice command, and manual Stop can end sooner. Live
                  and saved video never include microphone audio. Keep this page open and the phone
                  screen awake while recording.
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
                  Starting camera: {cameraFacingMode === "environment" ? "Back" : "Front"}
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
              <p className="text-sm font-medium">{jobLabel} session history</p>
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
              PrepCorex Warehouse Ops Recordings folder. You can also upload later from Gallery or this
              screen.
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
