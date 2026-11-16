import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { LexiActionType } from "@/lib/lexi/types";

function stripUndefinedDeep(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)).filter((item) => item !== undefined);
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (nested === undefined) continue;
    const cleaned = stripUndefinedDeep(nested);
    if (cleaned !== undefined) out[key] = cleaned;
  }
  return out;
}

export async function writeLexiAuditLog(input: {
  adminUid: string;
  adminName: string;
  actionType: LexiActionType | "chat" | "client_chat" | "client_inbound_create" | string;
  summary: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  ok: boolean;
}): Promise<void> {
  const payload = input.payload
    ? (stripUndefinedDeep(input.payload) as Record<string, unknown>)
    : null;
  const result = input.result
    ? (stripUndefinedDeep(input.result) as Record<string, unknown>)
    : null;

  await adminDb()
    .collection("lexiAuditLogs")
    .add({
      adminUid: input.adminUid,
      adminName: input.adminName,
      actionType: input.actionType,
      summary: input.summary,
      payload,
      result,
      ok: input.ok,
      at: FieldValue.serverTimestamp(),
      source: "lexi_v1",
    });
}
