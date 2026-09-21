"use client";

import { useCallback, useRef, useState } from "react";
import { Download, Loader2, Send, Sparkles, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { lexiRunClientAction } from "@/lib/lexi/run-client";
import {
  firstSupportedQueueIndex,
  formatQueueContinueUserMessage,
  formatQueueStartUserMessage,
} from "@/lib/lexi/pending-queue-shared";
import {
  LEXI_CLIENT_ACTION_TYPES,
  type LexiChatMessage,
  type LexiPendingAction,
  type LexiPendingProcessingQueue,
  type LexiReportAttachment,
} from "@/lib/lexi/types";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type UiMessage = LexiChatMessage & { id: string; report?: LexiReportAttachment };

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

export function LexiFloatingChat() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UiMessage[]>([
    {
      id: newId(),
      role: "assistant",
      content:
        "Hi, I'm LEXI™, powered by PrepCorex. Ask me anything about PrepCorex, a client's data, or a report — I'll look it up and can download a CSV. I only change data for inbound, outbound, restock, returns, dispose, delete, quarantine, and label reviews, and only after you Confirm.",
    },
  ]);
  const [pendingAction, setPendingAction] = useState<LexiPendingAction | null>(null);
  const [pendingQueue, setPendingQueue] = useState<LexiPendingProcessingQueue | null>(null);
  const [queueActive, setQueueActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queueActiveRef = useRef(false);
  const pendingQueueRef = useRef<LexiPendingProcessingQueue | null>(null);

  const supportedQueueTotal = pendingQueue?.supportedCount ?? 0;

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

  const handleStartQueue = async () => {
    if (loading) return;
    stopQueue();
    await sendUserText(formatQueueStartUserMessage("approve"));
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

  return (
    <>
      {!open ? (
        <Button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-50 h-14 w-14 rounded-full bg-violet-600 p-0 shadow-lg hover:bg-violet-700 sm:bottom-6 sm:right-24"
          aria-label="Open LEXI, powered by PrepCorex"
          title="LEXI™ · Powered by PrepCorex"
        >
          <Sparkles className="h-6 w-6 text-white" />
        </Button>
      ) : null}

      {open ? (
        <div className="fixed bottom-4 right-4 z-50 flex h-[min(560px,calc(100vh-2rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:bottom-6 sm:right-24">
          <div className="flex items-center justify-between border-b bg-violet-600 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold leading-tight">
                  LEXI<sup className="ml-0.5 text-[9px] font-normal opacity-90">™</sup>
                </p>
                <p className="mt-0.5 text-[11px] text-violet-100">
                  powered by <span className="font-semibold text-white">PrepCorex</span>
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white hover:bg-violet-500"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {queueActive && pendingQueue ? (
            <div className="border-b bg-violet-50 px-4 py-2 dark:bg-violet-950/30">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-violet-900 dark:text-violet-100">
                  Pending queue:{" "}
                  {pendingQueue.items
                    .slice(0, pendingQueue.currentIndex + 1)
                    .filter((i) => i.supported).length}
                  /{supportedQueueTotal} ({pendingQueue.mode})
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={stopQueue}
                  disabled={executing}
                >
                  Stop queue
                </Button>
              </div>
            </div>
          ) : null}

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={cn(
                  "max-w-[92%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
                  m.role === "user"
                    ? "ml-auto bg-violet-600 text-white"
                    : "mr-auto bg-muted text-foreground"
                )}
              >
                {m.content}
                {m.report ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-8 bg-background"
                    onClick={() => downloadReportCsv(m.report!)}
                  >
                    <Download className="mr-1 h-3 w-3" />
                    Download CSV — {m.report.title}
                  </Button>
                ) : null}
              </div>
            ))}
            {loading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                LEXI™ is thinking…
              </div>
            ) : null}
          </div>

          {pendingAction ? (
            <div className="border-t bg-amber-50 px-4 py-3 dark:bg-amber-950/30">
              <p className="text-xs font-medium text-amber-900 dark:text-amber-100">
                Confirm action
              </p>
              <p className="mt-1 text-sm text-amber-950 dark:text-amber-50">
                {pendingAction.summary}
              </p>
              <div className="mt-2 flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="bg-violet-600 hover:bg-violet-700"
                  disabled={executing}
                  onClick={handleConfirm}
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
                  disabled={executing}
                  onClick={() => setPendingAction(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : null}

          <div className="border-t p-3">
            {!queueActive ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mb-2 h-8 w-full text-xs"
                disabled={loading}
                onClick={() => void handleStartQueue()}
              >
                Process pending queue (approve one by one)
              </Button>
            ) : null}
            <div className="flex gap-2">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask PrepCorex, a client, or generate a report…"
                rows={2}
                className="min-h-[44px] resize-none"
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
                className="shrink-0 bg-violet-600 hover:bg-violet-700"
                disabled={loading || !input.trim()}
                onClick={() => void handleSend()}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
            <p className="mt-2 text-center text-[10px] text-muted-foreground">
              LEXI™ · Powered by PrepCorex
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
