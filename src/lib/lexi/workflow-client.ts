"use client";

import {
  adminAutoPickAndPackOutbound,
  adminDispatchOutboundWithTracking,
  adminShipOutboundFromInventoryOnly,
} from "@/lib/admin-warehouse-override";
import { lexiCompleteInboundOnClient } from "@/lib/lexi/inbound-complete-client";
import type {
  LexiInboundFulfillAllPayload,
  LexiOutboundFulfillAllPayload,
} from "@/lib/lexi/types";
import { auth } from "@/lib/firebase";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import type { WarehouseDoc } from "@/types";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";

async function loadDefaultWarehouse(): Promise<WarehouseDoc> {
  const snap = await getDocs(collection(db, "warehouses"));
  const active = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as WarehouseDoc))
    .filter((w) => w.active !== false);
  const warehouse = active.find((w) => isDefaultNj2Warehouse(w.name)) ?? active[0];
  if (!warehouse) throw new Error("No active warehouse found.");
  return warehouse;
}

async function postLexiExecute(action: {
  type: string;
  summary: string;
  payload: Record<string, unknown>;
}): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  const token = await user.getIdToken();
  const res = await fetch("/api/admin/lexi/execute", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action: { id: "workflow", ...action } }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.error || "Server action failed."));
  return String(data.message ?? "Done.");
}

/** Approve (if needed) then receive + putaway in one confirm. */
export async function lexiFulfillInboundAll(
  payload: LexiInboundFulfillAllPayload,
  operatorId: string
): Promise<string> {
  const steps: string[] = [];
  if (!payload.skipApprove) {
    steps.push(
      await postLexiExecute({
        type: "inbound_approve",
        summary: `Approve inbound #${payload.requestId}`,
        payload: {
          clientUserId: payload.clientUserId,
          clientUserName: payload.clientUserName,
          requestId: payload.requestId,
          productName: payload.productName,
          quantity: payload.quantity,
        },
      })
    );
  }
  const complete = await lexiCompleteInboundOnClient(
    {
      clientUserId: payload.clientUserId,
      clientUserName: payload.clientUserName,
      requestId: payload.requestId,
      productName: payload.productName,
      sku: payload.sku,
      quantity: payload.quantity,
      useDefaultBin: payload.useDefaultBin !== false,
      binPath: payload.binPath,
      warehouseId: payload.warehouseId,
    },
    operatorId
  );
  steps.push(complete.message);
  return steps.join(" ");
}

/** Approve (if needed) then pick/pack and dispatch in one confirm. */
export async function lexiFulfillOutboundAll(
  payload: LexiOutboundFulfillAllPayload,
  operatorId: string
): Promise<string> {
  const steps: string[] = [];
  if (!payload.skipApprove) {
    steps.push(
      await postLexiExecute({
        type: "outbound_approve",
        summary: `Approve outbound #${payload.requestId}`,
        payload: {
          clientUserId: payload.clientUserId,
          clientUserName: payload.clientUserName,
          requestId: payload.requestId,
          productName: payload.productName,
          quantity: payload.quantity,
        },
      })
    );
  }

  const warehouse = await loadDefaultWarehouse();
  if (payload.useShipFromInventory) {
    await adminShipOutboundFromInventoryOnly({
      warehouseId: warehouse.id,
      clientUserId: payload.clientUserId,
      shipmentRequestId: payload.requestId,
      operatorId,
    });
    steps.push("Marked ready to dispatch from client inventory.");
  } else {
    await adminAutoPickAndPackOutbound({
      warehouse,
      clientUserId: payload.clientUserId,
      shipmentRequestId: payload.requestId,
      operatorId,
    });
    steps.push("Pick & pack complete.");
  }

  await adminDispatchOutboundWithTracking({
    warehouseId: warehouse.id,
    clientUserId: payload.clientUserId,
    shipmentRequestId: payload.requestId,
    trackingNumber: payload.trackingNumber,
    operatorId,
  });
  steps.push(
    `Outbound #${payload.requestId} dispatched${payload.trackingNumber ? ` (tracking ${payload.trackingNumber})` : ""}.`
  );
  return steps.join(" ");
}
