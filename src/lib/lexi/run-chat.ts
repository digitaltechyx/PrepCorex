import OpenAI from "openai";
import { LEXI_SYSTEM_PROMPT } from "@/lib/lexi/system-prompt";
import { LEXI_OPENAI_TOOLS, runLexiTool } from "@/lib/lexi/tools";
import type { LexiChatMessage, LexiPendingAction, LexiReportAttachment } from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured on the server.");
  }
  return new OpenAI({ apiKey });
}

export async function runLexiChat(input: {
  adminProfile: UserProfile;
  messages: LexiChatMessage[];
}): Promise<{ reply: string; pendingAction: LexiPendingAction | null; report: LexiReportAttachment | null }> {
  const openai = getOpenAIClient();
  const model = process.env.LEXI_OPENAI_MODEL?.trim() || "gpt-4o-mini";

  const conversation: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: LEXI_SYSTEM_PROMPT },
    ...input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    })),
  ];

  let pendingAction: LexiPendingAction | null = null;
  let report: LexiReportAttachment | null = null;

  for (let step = 0; step < 8; step++) {
    const completion = await openai.chat.completions.create({
      model,
      messages: conversation,
      tools: LEXI_OPENAI_TOOLS,
      tool_choice: "auto",
    });

    const choice = completion.choices[0]?.message;
    if (!choice) break;

    conversation.push(choice);

    const toolCalls = choice.tool_calls;
    if (!toolCalls?.length) {
      return {
        reply: choice.content?.trim() || "Done.",
        pendingAction,
        report,
      };
    }

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        args = {};
      }

      const result = await runLexiTool(input.adminProfile, call.function.name, args);
      if (result.pendingAction) {
        // Keep approve before complete when the model proposes both in one turn.
        if (
          !pendingAction ||
          (result.pendingAction.type === "inbound_approve" &&
            pendingAction.type === "inbound_complete")
        ) {
          pendingAction = result.pendingAction;
        }
      }
      if (result.report) {
        report = result.report;
      }

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: result.toolResult,
      });
    }

    if (pendingAction) {
      const followUp = await openai.chat.completions.create({
        model,
        messages: conversation,
      });
      const text = followUp.choices[0]?.message?.content?.trim();
      return {
        reply:
          text ||
          `${pendingAction.summary}\n\nPlease review and confirm to proceed.`,
        pendingAction,
        report,
      };
    }
  }

  const fallbackPending = pendingAction as LexiPendingAction | null;
  return {
    reply: fallbackPending
      ? `${fallbackPending.summary}\n\nPlease review and confirm to proceed.`
      : "I couldn't complete that request. Please try again with more detail.",
    pendingAction: fallbackPending,
    report,
  };
}
