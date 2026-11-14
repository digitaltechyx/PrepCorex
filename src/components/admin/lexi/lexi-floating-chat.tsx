"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Download,
  Loader2,
  Maximize2,
  Minimize2,
  PanelRight,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { LexiMarkdown } from "@/components/admin/lexi/lexi-markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { auth } from "@/lib/firebase";
import {
  firstSupportedQueueIndex,
  formatQueueContinueUserMessage,
  formatQueueStartUserMessage,
} from "@/lib/lexi/pending-queue-shared";
import { lexiRunClientAction } from "@/lib/lexi/run-client";
import {
  LEXI_CLIENT_ACTION_TYPES,
  type LexiChatMessage,
  type LexiPendingAction,
  type LexiPendingProcessingQueue,
  type LexiReportAttachment,
} from "@/lib/lexi/types";
import { cn } from "@/lib/utils";

type UiMessage = LexiChatMessage & { id: string; report?: LexiReportAttachment };
type LexiLayoutMode = "floating" | "drawer" | "expanded";

const LAYOUT_STORAGE_KEY = "prepcorex.lexi.layout";
const WELCOME =
  "Hi — I'm LEXI™, powered by PrepCorex. Ask about a client, pending work, inventory, or a report. I can export CSV, and I'll only change data after you Confirm.";

const SUGGESTIONS = [
  { label: "What's pending?", prompt: "What is pending across all clients?" },
  { label: "Process queue", prompt: formatQueueStartUserMessage("approve"), queue: true },
  { label: "Find a client", prompt: "Help me find a client — ask for the name if needed." },
  { label: "Export inventory", prompt: "Export CSV inventory for a client — ask which client if needed." },
] as const;

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function downloadReportCsv(report: LexiReportAttachment) {
  const blob = new Blob([report.csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = report.filename;
  a.click();
  URL.revokeObjectURL(url);
}

function readStoredLayout(): LexiLayoutMode {
  if (typeof window === "undefined") return "floating";
  const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
  if (raw === "drawer" || raw === "expanded" || raw === "floating") return raw;
  return "floating";
}

export function LexiFloatingChat() {
  const [open, setOpen] = useState(false);
  const [layout, setLayout] = useState<LexiLayoutMode>("floating");
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([
    { id: newId(), role: "assistant", content: WELCOME },
  ]);
  const [pendingAction, setPendingAction] = useState<LexiPendingAction | null>(null);
  const [pendingQueue, setPendingQueue] = useState<LexiPendingProcessingQueue | null>(null);
  const [queueActive, setQueueActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queueActiveRef = useRef(false);
  const pendingQueueRef = useRef<LexiPendingProcessingQueue | null>(null);

  useEffect(() => {
    setLayout(readStoredLayout());
  }, []);

  const setLayoutMode = useCallback((mode: LexiLayoutMode) => {
    setLayout(mode);
    try {
      window.localStorage.setItem(LAYOUT_STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
  }, []);

  const supportedQueueTotal = pendingQueue?.supportedCount ?? 0;

  const statusLabel = useMemo(() => {
    if (executing) return "Running confirmed action…";
    if (loading) return "Looking up PrepCorex…";
    if (pendingAction) return "Waiting for your Confirm";
    if (queueActive) return "Queue active";
    return "Online";
  }, [executing, loading, pendingAction, queueActive]);

  const stopQueue = useCallback(() => {
    queueActiveRef.current = false;
    pendingQueueRef.current = null;
    setQueueActive(false);
    setPendingQueue(null);
  }, []);

  const applyQueueFromResponse = useCallback((queue: LexiPendingProcessingQueue | null | undefined) => {
    if (!queue || queue.supportedCount === 0) return;
    queueActiveRef.current = true;
    pendingQueueRef.current = queue;
    setQueueActive(true);
    setPendingQueue(queue);
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, []);

  const getToken = useCallback(async () => {
    const user = auth.currentUser;
    if (!user) throw new Error("You must be signed in to use LEXI.");
    return user.getIdToken();
  }, []);

  const sendToLexi = useCallback(
    async (nextMessages: UiMessage[]) => {
      setLoading(true);
      try {
        const token = await getToken();
        const res = await fetch("/api/admin/lexi/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            messages: nextMessages.map(({ role, content }) => ({ role, content })),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "LEXI request failed.");

        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: "assistant",
            content: String(data.reply ?? ""),
            report: data.report ?? undefined,
          },
        ]);
        setPendingAction(data.pendingAction ?? null);
        applyQueueFromResponse(data.pendingQueue ?? null);
        scrollToBottom();
        return data;
      } catch (error) {
        const text = error instanceof Error ? error.message : "LEXI request failed.";
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: "assistant", content: `Sorry — ${text}` },
        ]);
      } finally {
        setLoading(false);
      }
    },
    [applyQueueFromResponse, getToken, scrollToBottom]
  );

  const sendUserText = useCallback(
    async (text: string, options?: { keepQueue?: boolean }) => {
      const trimmed = text.trim();
      if (!trimmed || loading) return;
      if (!options?.keepQueue) {
        setPendingAction(null);
      }
      const userMsg: UiMessage = { id: newId(), role: "user", content: trimmed };
      const next = [...messages, userMsg];
      setMessages(next);
      scrollToBottom();
      await sendToLexi(next);
    },
    [loading, messages, scrollToBottom, sendToLexi]
  );

  const continueQueueAfterConfirm = useCallback(
    async (baseMessages: UiMessage[], queue: LexiPendingProcessingQueue) => {
      if (!queueActiveRef.current) return;

      const nextIndex = firstSupportedQueueIndex(queue.items, queue.currentIndex + 1);
      if (nextIndex < 0) {
        stopQueue();
        const doneMsg: UiMessage = {
          id: newId(),
          role: "user",
          content: `[Pending queue complete] All ${queue.supportedCount} supported pending items were processed. Summarize what was done.`,
        };
        const next = [...baseMessages, doneMsg];
        setMessages(next);
        scrollToBottom();
        await sendToLexi(next);
        return;
      }

      const nextItem = queue.items[nextIndex];
      const step = queue.items.slice(0, nextIndex + 1).filter((i) => i.supported).length;
      const updatedQueue = { ...queue, currentIndex: nextIndex };
      pendingQueueRef.current = updatedQueue;
      setPendingQueue(updatedQueue);

      const continueMsg: UiMessage = {
        id: newId(),
        role: "user",
        content: formatQueueContinueUserMessage(nextItem, step, queue.supportedCount, queue.mode),
      };
      const next = [...baseMessages, continueMsg];
      setMessages(next);
      scrollToBottom();
      await sendToLexi(next);
    },
    [scrollToBottom, sendToLexi, stopQueue]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    if (!text.toLowerCase().includes("pending processing queue")) {
      stopQueue();
    }
    await sendUserText(text);
  };

  const handleSuggestion = async (prompt: string, isQueue?: boolean) => {
    if (loading) return;
    if (isQueue) stopQueue();
    else stopQueue();
    await sendUserText(prompt);
  };

  const handleConfirm = async () => {
    if (!pendingAction || executing) return;
    setExecuting(true);
    try {
      let resultMessage = "";

      if (LEXI_CLIENT_ACTION_TYPES.includes(pendingAction.type)) {
        const user = auth.currentUser;
        if (!user) throw new Error("Not signed in.");
        resultMessage = await lexiRunClientAction(
          pendingAction,
          user.uid,
          user.displayName || "Admin"
        );
      } else {
        const token = await getToken();
        const res = await fetch("/api/admin/lexi/execute", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ action: pendingAction }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Action failed.");
        resultMessage = String(data.message ?? "Action completed.");
      }

      const payload = pendingAction.payload as Record<string, unknown> | undefined;
      const clientUserId =
        payload?.clientUserId != null ? String(payload.clientUserId).trim() : "";
      const requestId = payload?.requestId != null ? String(payload.requestId).trim() : "";
      const metaLines = [
        `[Confirmed ${pendingAction.type}]`,
        clientUserId ? `clientUserId=${clientUserId}` : null,
        requestId ? `requestId=${requestId}` : null,
        pendingAction.summary,
        `Result: ${resultMessage}`,
      ].filter(Boolean);
      const systemNote: UiMessage = {
        id: newId(),
        role: "user",
        content: metaLines.join("\n"),
      };
      const next = [...messages, systemNote];
      setMessages(next);
      setPendingAction(null);
      scrollToBottom();

      if (queueActiveRef.current && pendingQueueRef.current) {
        await continueQueueAfterConfirm(next, pendingQueueRef.current);
      } else {
        await sendToLexi(next);
      }
    } catch (error) {
      const text = error instanceof Error ? error.message : "Action failed.";
      stopQueue();
      setMessages((prev) => [
        ...prev,
        { id: newId(), role: "assistant", content: `Action failed: ${text}` },
      ]);
    } finally {
      setExecuting(false);
    }
  };

  const panelClass = cn(
    "z-50 flex flex-col overflow-hidden border border-slate-200/80 bg-[#f7f8fa] shadow-2xl dark:border-slate-700 dark:bg-slate-950",
    layout === "floating" &&
      "fixed bottom-4 right-4 h-[min(640px,calc(100vh-2rem))] w-[min(420px,calc(100vw-2rem))] rounded-2xl sm:bottom-6 sm:right-24",
    layout === "drawer" &&
      "fixed inset-y-0 right-0 h-full w-[min(440px,100vw)] rounded-none border-l shadow-[-12px_0_40px_rgba(15,23,42,0.12)]",
    layout === "expanded" &&
      "fixed inset-3 sm:inset-6 h-auto max-h-[calc(100vh-1.5rem)] w-auto max-w-3xl rounded-2xl sm:left-1/2 sm:right-auto sm:w-full sm:-translate-x-1/2"
  );

  const showSuggestions = messages.length <= 2 && !pendingAction && !queueActive && !loading;

  return (
    <>
      {!open ? (
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full bg-gradient-to-br from-violet-600 to-indigo-700 p-0 shadow-lg shadow-violet-600/30 hover:from-violet-500 hover:to-indigo-600 sm:bottom-6 sm:right-24"
          aria-label="Open LEXI, powered by PrepCorex"
          title="LEXI™ · Powered by PrepCorex"
        >
          <Sparkles className="h-6 w-6 text-white" />
        </Button>
      ) : null}

      {open ? (
        <>
          {layout === "expanded" ? (
            <button
              type="button"
              aria-label="Close Lexi backdrop"
              className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
          ) : null}

          <div className={panelClass}>
            <div className="flex items-center justify-between gap-2 border-b border-violet-500/20 bg-gradient-to-r from-violet-700 via-violet-600 to-indigo-700 px-4 py-3 text-white">
              <div className="flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/25">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold leading-tight tracking-tight">
                    LEXI<sup className="ml-0.5 text-[9px] font-normal opacity-90">™</sup>
                  </p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-violet-100">
                    <span
                      className={cn(
                        "inline-block h-1.5 w-1.5 rounded-full",
                        loading || executing ? "animate-pulse bg-amber-300" : "bg-emerald-300"
                      )}
                    />
                    <span className="truncate">{statusLabel}</span>
                    <span className="opacity-60">·</span>
                    <span className="truncate opacity-90">PrepCorex</span>
                  </p>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Floating"
                  className={cn(
                    "h-8 w-8 text-white hover:bg-white/15",
                    layout === "floating" && "bg-white/20"
                  )}
                  onClick={() => setLayoutMode("floating")}
                >
                  <Minimize2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Side drawer"
                  className={cn(
                    "h-8 w-8 text-white hover:bg-white/15",
                    layout === "drawer" && "bg-white/20"
                  )}
                  onClick={() => setLayoutMode("drawer")}
                >
                  <PanelRight className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  title="Expanded"
                  className={cn(
                    "h-8 w-8 text-white hover:bg-white/15",
                    layout === "expanded" && "bg-white/20"
                  )}
                  onClick={() => setLayoutMode("expanded")}
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-white hover:bg-white/15"
                  onClick={() => setOpen(false)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {queueActive && pendingQueue ? (
              <div className="border-b border-violet-100 bg-violet-50/90 px-4 py-2.5 dark:border-violet-900 dark:bg-violet-950/40">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-violet-900 dark:text-violet-100">
                    Queue {pendingQueue.mode}:{" "}
                    {
                      pendingQueue.items
                        .slice(0, pendingQueue.currentIndex + 1)
                        .filter((i) => i.supported).length
                    }
                    /{supportedQueueTotal}
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 border-violet-200 bg-white text-xs"
                    onClick={stopQueue}
                    disabled={executing}
                  >
                    Stop queue
                  </Button>
                </div>
              </div>
            ) : null}

            <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
              {messages.map((m) => {
                const isUser = m.role === "user";
                const isConfirmMeta = isUser && m.content.startsWith("[Confirmed ");
                return (
                  <div
                    key={m.id}
                    className={cn(
                      "max-w-[92%] text-sm",
                      isUser ? "ml-auto" : "mr-auto",
                      isConfirmMeta && "max-w-full"
                    )}
                  >
                    {isConfirmMeta ? (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/90 px-3 py-2 text-[12px] text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-50">
                        <div className="mb-1 flex items-center gap-1.5 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Confirmed
                        </div>
                        <LexiMarkdown content={m.content.replace(/^\[Confirmed [^\]]+\]\n?/, "")} />
                      </div>
                    ) : isUser ? (
                      <div className="rounded-2xl rounded-br-md bg-violet-600 px-3.5 py-2.5 text-white shadow-sm">
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{m.content}</p>
                      </div>
                    ) : (
                      <div className="rounded-2xl rounded-bl-md border border-slate-200/80 bg-white px-3.5 py-2.5 text-slate-800 shadow-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
                        <LexiMarkdown content={m.content} />
                        {m.report ? (
                          <button
                            type="button"
                            onClick={() => downloadReportCsv(m.report!)}
                            className="mt-2.5 flex w-full items-center gap-2 rounded-xl border border-violet-200 bg-violet-50 px-3 py-2 text-left text-xs font-medium text-violet-900 transition hover:bg-violet-100 dark:border-violet-800 dark:bg-violet-950/50 dark:text-violet-100"
                          >
                            <Download className="h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0 flex-1 truncate">
                              Download CSV — {m.report.title}
                            </span>
                          </button>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}

              {loading ? (
                <div className="mr-auto flex max-w-[85%] items-center gap-2 rounded-2xl border border-slate-200/80 bg-white px-3.5 py-2.5 text-sm text-muted-foreground shadow-sm dark:border-slate-700 dark:bg-slate-900">
                  <Loader2 className="h-4 w-4 animate-spin text-violet-600" />
                  Lexi is working…
                </div>
              ) : null}

              {showSuggestions ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s.label}
                      type="button"
                      disabled={loading}
                      onClick={() => void handleSuggestion(s.prompt, "queue" in s && s.queue)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-700 shadow-sm transition hover:border-violet-300 hover:bg-violet-50 hover:text-violet-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            {pendingAction ? (
              <div className="border-t border-amber-200/80 bg-gradient-to-b from-amber-50 to-orange-50/80 px-4 py-3 dark:border-amber-900 dark:from-amber-950/50 dark:to-amber-950/20">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800/80 dark:text-amber-200/80">
                  Confirm required
                </p>
                <p className="mt-1 text-sm font-medium leading-snug text-amber-950 dark:text-amber-50">
                  {pendingAction.summary}
                </p>
                <p className="mt-1 text-[11px] text-amber-800/70 dark:text-amber-200/70">
                  Nothing changes until you confirm.
                </p>
                <div className="mt-2.5 flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="bg-violet-600 hover:bg-violet-700"
                    disabled={executing}
                    onClick={() => void handleConfirm()}
                  >
                    {executing ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                        Running…
                      </>
                    ) : (
                      "Confirm"
                    )}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="border-amber-300 bg-white/80"
                    disabled={executing}
                    onClick={() => setPendingAction(null)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="border-t border-slate-200/80 bg-white/90 p-3 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
              {!queueActive && !showSuggestions ? (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => void handleSuggestion(formatQueueStartUserMessage("approve"), true)}
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    Process queue
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() =>
                      void handleSuggestion("What is pending across all clients?")
                    }
                    className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-900 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    What's pending?
                  </button>
                </div>
              ) : null}
              <div className="flex gap-2">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Lexi about a client, request, or report…"
                  rows={2}
                  className="min-h-[48px] resize-none rounded-xl border-slate-200 bg-white shadow-sm dark:border-slate-700"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  className="h-12 w-12 shrink-0 rounded-xl bg-violet-600 hover:bg-violet-700"
                  disabled={loading || !input.trim()}
                  onClick={() => void handleSend()}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <p className="mt-2 text-center text-[10px] text-muted-foreground">
                LEXI™ · Powered by PrepCorex · Layout: {layout}
              </p>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}
