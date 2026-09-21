import { loadManagedClientProfiles } from "@/lib/lexi/access";
import type { PendingQueueMode } from "@/lib/lexi/pending-queue-shared";
import { firstSupportedQueueIndex } from "@/lib/lexi/pending-queue-shared";
import { lexiListPending } from "@/lib/lexi/read-tools";
import type { LexiPendingProcessingQueue, LexiPendingQueueItem } from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

export type { PendingQueueMode } from "@/lib/lexi/pending-queue-shared";
export {
  firstSupportedQueueIndex,
  formatQueueContinueUserMessage,
  formatQueueStartUserMessage,
} from "@/lib/lexi/pending-queue-shared";

function displayName(user: UserProfile): string {
  return String(user.name ?? user.email ?? user.uid ?? "Unknown").trim();
}

const PENDING_ITEM_KEYS = [
  "inbound",
  "inboundBatches",
  "outbound",
  "returns",
  "dispose",
  "disposeBatches",
  "deletes",
  "quarantine",
  "labelRefunds",
  "labelTopups",
  "labelApiFees",
] as const;

function flattenAllPendingItems(pending: Record<string, unknown>): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const key of PENDING_ITEM_KEYS) {
    const block = pending[key] as { items?: Array<Record<string, unknown>> } | undefined;
    if (block?.items?.length) items.push(...block.items);
  }
  return items;
}

function mapProposeTool(
  type: string,
  mode: PendingQueueMode
): Pick<LexiPendingQueueItem, "proposeTool" | "supported" | "skipReason" | "labelKind"> {
  switch (type) {
    case "inbound":
      return {
        proposeTool: mode === "fulfill" ? "propose_inbound_fulfill_all" : "propose_inbound_approve",
        supported: true,
      };
    case "outbound":
      return {
        proposeTool: mode === "fulfill" ? "propose_outbound_fulfill_all" : "propose_outbound_approve",
        supported: true,
      };
    case "return":
      return { proposeTool: "propose_return_review", supported: true };
    case "dispose":
      return { proposeTool: "propose_dispose_review", supported: true };
    case "delete":
      return { proposeTool: "propose_delete_review", supported: true };
    case "quarantine":
      return { proposeTool: "propose_quarantine_review", supported: true };
    case "label_refund":
      return { proposeTool: "propose_label_review", supported: true, labelKind: "refund" };
    case "label_topup":
      return { proposeTool: "propose_label_review", supported: true, labelKind: "topup" };
    case "label_api_fee":
      return { proposeTool: "propose_label_review", supported: true, labelKind: "api_fee" };
    case "inbound_batch":
      return {
        proposeTool: "",
        supported: false,
        skipReason: "Multi-line inbound batches must be approved in Admin → Notifications.",
      };
    case "dispose_batch":
      return {
        proposeTool: "",
        supported: false,
        skipReason: "Dispose batches must be reviewed in Admin → Notifications.",
      };
    default:
      return {
        proposeTool: "",
        supported: false,
        skipReason: `Unsupported type "${type}" for LEXI queue.`,
      };
  }
}

function itemKey(clientUserId: string, requestId: string, type: string): string {
  return `${clientUserId}:${requestId}:${type}`;
}

export async function buildPendingProcessingQueue(
  adminProfile: UserProfile,
  mode: PendingQueueMode = "approve",
  clientUserIdFilter?: string
): Promise<LexiPendingProcessingQueue> {
  const clients = await loadManagedClientProfiles(adminProfile);
  const items: LexiPendingQueueItem[] = [];
  const BATCH_SIZE = 8;

  for (let i = 0; i < clients.length; i += BATCH_SIZE) {
    const chunk = clients.slice(i, i + BATCH_SIZE);
    const rows = await Promise.all(
      chunk.map(async (client) => {
        const uid = String(client.uid ?? "").trim();
        if (!uid) return null;
        if (clientUserIdFilter && uid !== clientUserIdFilter) return null;
        const pending = await lexiListPending(adminProfile, uid);
        if (!Number(pending.totalPending)) return null;
        return {
          clientUserId: uid,
          clientUserName: displayName(client),
          rawItems: flattenAllPendingItems(pending),
        };
      })
    );

    for (const row of rows) {
      if (!row) continue;
      for (const raw of row.rawItems) {
        const type = String(raw.type ?? "");
        const requestId = String(raw.requestId ?? "");
        const clientUserId = String(raw.clientUserId ?? row.clientUserId);
        if (!requestId || !clientUserId) continue;

        const mapped = mapProposeTool(type, mode);
        items.push({
          key: itemKey(clientUserId, requestId, type),
          clientUserId,
          clientUserName: row.clientUserName,
          requestId,
          type,
          productName: String(raw.productName ?? "Request"),
          quantity: Number(raw.quantity) || 0,
          batchId: raw.batchId ? String(raw.batchId) : undefined,
          batchLineId: raw.batchLineId ? String(raw.batchLineId) : undefined,
          ...mapped,
        });
      }
    }
  }

  const supportedCount = items.filter((i) => i.supported).length;
  const skippedCount = items.length - supportedCount;
  const firstIndex = firstSupportedQueueIndex(items, 0);

  return {
    mode,
    total: items.length,
    supportedCount,
    skippedCount,
    items,
    currentIndex: firstIndex >= 0 ? firstIndex : 0,
  };
}
