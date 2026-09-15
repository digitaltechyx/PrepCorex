"use client";

import { useCallback, useRef, useState } from "react";
import { Download, Loader2, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { auth } from "@/lib/firebase";
import { lexiRunClientAction } from "@/lib/lexi/run-client";
import {
  LEXI_CLIENT_ACTION_TYPES,
  type LexiChatMessage,
  type LexiPendingAction,
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
        "Hi, I'm LEXI. Ask me anything about PrepCorex, a client's data, or a report — I'll look it up and can download a CSV. I only change data for inbound, outbound, restock, returns, dispose, delete, quarantine, and label reviews, and only after you Confirm.",
    },
  ]);
  const [pendingAction, setPendingAction] = useState<LexiPendingAction | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

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
        scrollToBottom();
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
    [getToken, scrollToBottom]
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setPendingAction(null);
    const userMsg: UiMessage = { id: newId(), role: "user", content: text };
    const next = [...messages, userMsg];
    setMessages(next);
    scrollToBottom();
    await sendToLexi(next);
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

      const systemNote: UiMessage = {
        id: newId(),
        role: "user",
        content: `[Confirmed] ${pendingAction.summary}\nResult: ${resultMessage}`,
      };
      const next = [...messages, systemNote];
      setMessages(next);
      setPendingAction(null);
      scrollToBottom();
      await sendToLexi(next);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Action failed.";
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
          aria-label="Open LEXI assistant"
        >
          <Sparkles className="h-6 w-6 text-white" />
        </Button>
      ) : null}

      {open ? (
        <div className="fixed bottom-4 right-4 z-50 flex h-[min(560px,calc(100vh-2rem))] w-[min(400px,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-2xl sm:bottom-6 sm:right-24">
          <div className="flex items-center justify-between border-b bg-violet-600 px-4 py-3 text-white">
            <div className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5" />
              <div>
                <p className="font-semibold leading-tight">LEXI</p>
                <p className="text-xs text-violet-100">PrepCorex admin assistant</p>
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
                LEXI is thinking…
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
          </div>
        </div>
      ) : null}
    </>
  );
}
