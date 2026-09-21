import type { LexiPendingProcessingQueue, LexiPendingQueueItem } from "@/lib/lexi/types";

export type PendingQueueMode = LexiPendingProcessingQueue["mode"];

export function firstSupportedQueueIndex(
  items: LexiPendingQueueItem[],
  start = 0
): number {
  for (let i = start; i < items.length; i++) {
    if (items[i].supported) return i;
  }
  return -1;
}

export function formatQueueContinueUserMessage(
  item: LexiPendingQueueItem,
  step: number,
  totalSupported: number,
  mode: PendingQueueMode
): string {
  const lines = [
    `[Pending queue step ${step} of ${totalSupported} — auto-continue]`,
    `Mode: ${mode}`,
    `proposeTool: ${item.proposeTool}`,
    `clientUserId: ${item.clientUserId}`,
    `clientUserName: ${item.clientUserName}`,
    `requestId: ${item.requestId}`,
    `type: ${item.type}`,
    `productName: ${item.productName}`,
    `quantity: ${item.quantity}`,
  ];
  if (item.labelKind) lines.push(`labelKind: ${item.labelKind}`);
  if (item.batchId) lines.push(`batchId: ${item.batchId}`);
  if (item.batchLineId) lines.push(`batchLineId: ${item.batchLineId}`);
  lines.push(
    "",
    `Immediately call ${item.proposeTool} for this item (decision: approve for review tools; label kind as shown). Then wait for admin Confirm.`
  );
  return lines.join("\n");
}

export function formatQueueStartUserMessage(mode: PendingQueueMode, clientUserId?: string): string {
  const scope = clientUserId ? `for client ${clientUserId}` : "across all clients";
  return `Start pending processing queue ${scope} — ${mode} each pending request one by one with Confirm after each.`;
}
