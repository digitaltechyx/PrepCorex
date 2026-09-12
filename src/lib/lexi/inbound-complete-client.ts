"use client";

import { collection, getDocs } from "firebase/firestore";
import { adminBatchReceiveInboundRequests } from "@/lib/admin-warehouse-override";
import { db } from "@/lib/firebase";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import type { LexiInboundCompletePayload } from "@/lib/lexi/types";
import type { WarehouseDoc } from "@/types";

async function pickDefaultWarehouseId(): Promise<string | null> {
  const snap = await getDocs(collection(db, "warehouses"));
  const active = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as WarehouseDoc))
    .filter((w) => w.active !== false);
  const nj2 = active.find((w) => isDefaultNj2Warehouse(w.name));
  return nj2?.id ?? active[0]?.id ?? null;
}

export async function lexiCompleteInboundOnClient(
  payload: LexiInboundCompletePayload,
  operatorId: string
): Promise<{ message: string; putawayDestination?: string }> {
  const warehouseId = payload.warehouseId ?? (await pickDefaultWarehouseId());
  if (!warehouseId) {
    throw new Error("No active warehouse found. Configure a warehouse first.");
  }

  const result = await adminBatchReceiveInboundRequests({
    items: [
      {
        clientUserId: payload.clientUserId,
        requestId: payload.requestId,
        clientDisplayName: payload.clientUserName,
      },
    ],
    shared: {
      warehouseId,
      binPath: payload.useDefaultBin ? null : payload.binPath ?? null,
      stagingArea: null,
      operatorId,
      notes: "Completed via LEXI assistant",
    },
  });

  const err = result.errors[0];
  if (err) throw new Error(err.error);

  const ok = result.results[0];
  if (!ok) throw new Error("Receive did not complete.");

  return {
    message: `Receive complete for #${payload.requestId}. Putaway: ${ok.putawayDestination}.`,
    putawayDestination: ok.putawayDestination,
  };
}
