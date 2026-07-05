"use client";

import {
  collection,
  doc,
  getDocs,
  query,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { inboundBatchesPath, type InboundBatchLineInput } from "@/lib/inbound-batch";
import type { InboundImportJob, InboundLoadContents, InboundShipmentType } from "@/types";

export const INBOUND_IMPORT_JOB_CHUNK_SIZE = 250;
export const INBOUND_BACKGROUND_IMPORT_THRESHOLD = 1000;
const UPLOAD_CONCURRENCY = 4;

export function inboundImportJobsPath(userId: string): string {
  return `users/${userId}/inboundImportJobs`;
}

export function inboundImportJobChunksPath(userId: string, jobId: string): string {
  return `${inboundImportJobsPath(userId)}/${jobId}/chunks`;
}

type StartInboundImportJobInput = {
  userId: string;
  userName: string;
  requestedBy: string;
  shipmentType?: InboundShipmentType;
  loadContents?: InboundLoadContents;
  productNotes?: string;
  lines: InboundBatchLineInput[];
  idToken: string;
};

function stripUndefinedForFirestore<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedForFirestore(item)) as T;
  }
  if (value && typeof value === "object") {
    const cleaned: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child !== undefined) {
        cleaned[key] = stripUndefinedForFirestore(child);
      }
    }
    return cleaned as T;
  }
  return value;
}

export async function startInboundImportJob(input: StartInboundImportJobInput): Promise<string> {
  const now = Timestamp.now();
  const jobRef = doc(collection(db, inboundImportJobsPath(input.userId)));
  const batchId = doc(collection(db, inboundBatchesPath(input.userId))).id;
  const totalChunks = Math.ceil(input.lines.length / INBOUND_IMPORT_JOB_CHUNK_SIZE);

  await setDoc(jobRef, {
    userId: input.userId,
    userName: input.userName,
    batchId,
    shipmentType: input.shipmentType ?? null,
    loadContents: input.loadContents ?? null,
    productNotes: input.productNotes?.trim() || null,
    status: "uploading",
    totalRows: input.lines.length,
    processedRows: 0,
    failedRows: 0,
    totalChunks,
    processedChunks: 0,
    cancelRequested: false,
    addDate: now,
    requestedAt: now,
    requestedBy: input.requestedBy,
    lastProgressAt: now,
  });

  const chunks = [];
  for (let start = 0; start < input.lines.length; start += INBOUND_IMPORT_JOB_CHUNK_SIZE) {
    const chunkIndex = Math.floor(start / INBOUND_IMPORT_JOB_CHUNK_SIZE);
    chunks.push({
      chunkIndex,
      startLine: start + 1,
      lines: input.lines.slice(start, start + INBOUND_IMPORT_JOB_CHUNK_SIZE),
    });
  }

  let nextChunk = 0;
  async function uploadNextChunk(): Promise<void> {
    const chunk = chunks[nextChunk];
    nextChunk += 1;
    if (!chunk) return;
    const response = await fetch("/api/inbound-import/upload-chunk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.idToken}`,
      },
      body: JSON.stringify(
        stripUndefinedForFirestore({
          userId: input.userId,
          jobId: jobRef.id,
          index: chunk.chunkIndex,
          startLine: chunk.startLine,
          lines: chunk.lines,
        })
      ),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.error || `Failed to upload import chunk ${chunk.chunkIndex + 1} of ${totalChunks}.`);
    }
    await uploadNextChunk();
  }

  await Promise.all(
    Array.from({ length: Math.min(UPLOAD_CONCURRENCY, chunks.length) }, () => uploadNextChunk())
  );

  await updateDoc(jobRef, { status: "queued", lastProgressAt: Timestamp.now() });
  return jobRef.id;
}

export async function processInboundImportJob(input: {
  userId: string;
  jobId: string;
  idToken: string;
}): Promise<{ status: InboundImportJob["status"]; processedRows: number; totalRows: number; elapsedMs?: number }> {
  const response = await fetch("/api/inbound-import/process", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${input.idToken}`,
    },
    body: JSON.stringify({ userId: input.userId, jobId: input.jobId }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.error || "Failed to process import job.");
  }
  return body;
}

export async function requestInboundImportJobCancel(userId: string, jobId: string): Promise<void> {
  await updateDoc(doc(db, inboundImportJobsPath(userId), jobId), {
    status: "cancelling",
    cancelRequested: true,
    lastProgressAt: Timestamp.now(),
  });
}

export async function hasActiveInboundImportJobs(userId: string): Promise<boolean> {
  const snap = await getDocs(
    query(
      collection(db, inboundImportJobsPath(userId)),
      where("status", "in", ["uploading", "queued", "processing", "cancelling"])
    )
  );
  return !snap.empty;
}
