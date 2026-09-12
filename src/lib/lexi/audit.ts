import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import type { LexiActionType } from "@/lib/lexi/types";

export async function writeLexiAuditLog(input: {
  adminUid: string;
  adminName: string;
  actionType: LexiActionType | "chat";
  summary: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  ok: boolean;
}): Promise<void> {
  await adminDb()
    .collection("lexiAuditLogs")
    .add({
      adminUid: input.adminUid,
      adminName: input.adminName,
      actionType: input.actionType,
      summary: input.summary,
      payload: input.payload ?? null,
      result: input.result ?? null,
      ok: input.ok,
      at: FieldValue.serverTimestamp(),
      source: "lexi_v1",
    });
}
