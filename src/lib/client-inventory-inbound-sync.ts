import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isCrossdockClosedCarton } from "@/lib/warehouse-crossdock";
import type { InventoryRequest, WarehouseCartonDoc, WarehouseCartonLine } from "@/types";

export type PutawaySyncAssignment = {
  lineId: string;
  quantity: number;
  binId?: string | null;
  binPath?: string | null;
  stagingArea?: string | null;
};

function norm(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function buildSyncKey(input: {
  warehouseId: string;
  cartonId: string;
  lineId: string;
  binId?: string | null;
  stagingArea?: string | null;
}): string {
  const dest = input.binId?.trim() || `area:${(input.stagingArea ?? "").trim().toUpperCase()}`;
  return `${input.warehouseId}_${input.cartonId}_${input.lineId}_${dest}`.replace(/\//g, "_");
}

function cartonPhotoUrls(carton: WarehouseCartonDoc): string[] {
  const fromList = Array.isArray(carton.photoUrls)
    ? carton.photoUrls.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  if (fromList.length > 0) return [...new Set(fromList)];
  if (carton.photoUrl?.trim()) return [carton.photoUrl.trim()];
  return [];
}

function requestPhotoUrls(request: InventoryRequest | null): string[] {
  if (!request) return [];
  const data = request as InventoryRequest & { imageUrl?: string; imageUrls?: string[] };
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
    return [...new Set(data.imageUrls.map((u) => String(u || "").trim()).filter(Boolean))];
  }
  if (typeof data.imageUrl === "string" && data.imageUrl.trim()) {
    return [data.imageUrl.trim()];
  }
  return [];
}

function mergePhotoUrls(...groups: string[][]): string[] {
  return [...new Set(groups.flat().map((u) => String(u || "").trim()).filter(Boolean))];
}

function expectedRequestQty(req: InventoryRequest): number {
  if (typeof req.receivedQuantity === "number" && req.receivedQuantity > 0) {
    return req.receivedQuantity;
  }
  if (typeof req.requestedQuantity === "number" && req.requestedQuantity > 0) {
    return req.requestedQuantity;
  }
  return Math.max(0, req.quantity ?? 0);
}

/** After warehouse putaway — update client sellable stock (good) or damaged on hand. */
export async function syncClientInventoryFromPutaway(input: {
  warehouseId: string;
  cartonId: string;
  carton: WarehouseCartonDoc;
  applied: PutawaySyncAssignment[];
  operatorId?: string | null;
}): Promise<void> {
  // Closed cross-dock (placeholder SKU only) never updates client inventory.
  // Opened / convert-to-open-receive cartons do sync once real SKUs exist.
  if (
    input.carton.receiveMode === "crossdock" &&
    (isCrossdockClosedCarton(input.carton) || input.carton.isClosedCrossdock === true)
  ) {
    return;
  }

  for (const assignment of input.applied) {
    const line = input.carton.lines?.find((l) => l.lineId === assignment.lineId);
    if (!line?.clientId?.trim()) continue;
    if (line.productReturnId?.trim()) continue;

    await syncPutawayLine({
      warehouseId: input.warehouseId,
      cartonId: input.cartonId,
      carton: input.carton,
      line,
      putawayQty: assignment.quantity,
      binId: assignment.binId ?? null,
      binPath: assignment.binPath ?? null,
      stagingArea: assignment.stagingArea ?? null,
      operatorId: input.operatorId ?? null,
    });
  }
}

async function syncPutawayLine(input: {
  warehouseId: string;
  cartonId: string;
  carton: WarehouseCartonDoc;
  line: WarehouseCartonLine;
  putawayQty: number;
  binId: string | null;
  binPath: string | null;
  stagingArea: string | null;
  operatorId: string | null;
}): Promise<void> {
  const clientUserId = input.line.clientId!.trim();
  const syncKey = buildSyncKey({
    warehouseId: input.warehouseId,
    cartonId: input.cartonId,
    lineId: input.line.lineId,
    binId: input.binId,
    stagingArea: input.stagingArea,
  });

  const logRef = doc(db, "users", clientUserId, "inboundReceiveLogs", syncKey);
  const existingLog = await getDoc(logRef);

  const requestId = input.line.inventoryRequestId?.trim() || input.carton.inventoryRequestId?.trim() || "";
  let requestData: InventoryRequest | null = null;
  if (requestId) {
    const reqSnap = await getDoc(doc(db, "users", clientUserId, "inventoryRequests", requestId));
    if (reqSnap.exists()) {
      requestData = { id: reqSnap.id, ...(reqSnap.data() as Omit<InventoryRequest, "id">) };
    }
  }

  const photoUrls = mergePhotoUrls(cartonPhotoUrls(input.carton), requestPhotoUrls(requestData));

  // Already synced qty — still backfill missing product photos / receiving date when possible.
  if (existingLog.exists()) {
    const inventoryId = String(existingLog.data()?.inventoryId ?? "").trim();
    if (!inventoryId) return;
    const invRef = doc(db, "users", clientUserId, "inventory", inventoryId);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) return;
    const patch: Record<string, unknown> = {};
    const prevUrls = Array.isArray(invSnap.data()?.imageUrls)
      ? (invSnap.data()?.imageUrls as string[]).map((u) => String(u || "").trim()).filter(Boolean)
      : [];
    const prevSingle =
      typeof invSnap.data()?.imageUrl === "string" && String(invSnap.data()?.imageUrl).trim()
        ? [String(invSnap.data()?.imageUrl).trim()]
        : [];
    if (photoUrls.length > 0 && prevUrls.length === 0 && prevSingle.length === 0) {
      patch.imageUrls = photoUrls;
      patch.imageUrl = photoUrls[0];
    }
    if (!invSnap.data()?.receivingDate) {
      patch.receivingDate = serverTimestamp();
    }
    if (Object.keys(patch).length === 0) return;
    patch.updatedAt = serverTimestamp();
    await updateDoc(invRef, patch);
    return;
  }

  const isDamaged = input.line.condition === "damaged";
  const goodQty = isDamaged ? 0 : Math.max(0, Math.floor(input.putawayQty));
  const damagedQty = isDamaged ? Math.max(0, Math.floor(input.putawayQty)) : 0;
  if (goodQty === 0 && damagedQty === 0) return;

  const productName =
    input.line.productTitle?.trim() ||
    requestData?.productName?.trim() ||
    input.carton.productTitle?.trim() ||
    "Product";
  const sku = input.line.sku?.trim() || requestData?.sku?.trim() || null;
  const isRestock = requestData?.productSubType === "restock";
  const remarks = input.carton.notes?.trim() || requestData?.remarks?.trim() || null;

  const inventoryRef = await findInventoryDocRef(clientUserId, {
    requestId,
    requestData,
    productName,
    sku,
    productId: requestData?.productId?.trim() || null,
  });

  await runTransaction(db, async (tx) => {
    const logSnap = await tx.get(logRef);
    if (logSnap.exists()) return;

    const invSnap = await tx.get(inventoryRef);
    const prevGood = invSnap.exists() ? Math.max(0, Number(invSnap.data()?.quantity ?? 0)) : 0;
    const prevDamaged = invSnap.exists()
      ? Math.max(0, Number(invSnap.data()?.damagedQuantity ?? 0))
      : 0;
    const nextGood = prevGood + goodQty;
    const nextDamaged = prevDamaged + damagedQty;

    const invPatch: Record<string, unknown> = {
      quantity: nextGood,
      damagedQuantity: nextDamaged,
      status: nextGood > 0 ? "In Stock" : "Out of Stock",
      updatedAt: serverTimestamp(),
      // Warehouse putaway is the moment stock is received into client inventory.
      receivingDate: serverTimestamp(),
    };

    if (!invSnap.exists()) {
      invPatch.productName = productName;
      if (sku) invPatch.sku = sku;
      invPatch.dateAdded = serverTimestamp();
      invPatch.inventoryType = "product";
      if (requestId) invPatch.sourceRequestId = requestId;
      if (requestData?.retailIdentifier) invPatch.retailIdentifier = requestData.retailIdentifier;
      if (requestData?.expiryDate) invPatch.expiryDate = requestData.expiryDate;
      if (Array.isArray(requestData?.inboundTrackings) && requestData.inboundTrackings.length > 0) {
        invPatch.inboundTrackings = requestData.inboundTrackings;
      }
      if (remarks) invPatch.remarks = remarks;
      if (photoUrls.length > 0) {
        invPatch.imageUrls = photoUrls;
        invPatch.imageUrl = photoUrls[0];
      }
      tx.set(inventoryRef, invPatch);
    } else {
      if (remarks) invPatch.remarks = remarks;
      if (photoUrls.length > 0) {
        const prevUrls = Array.isArray(invSnap.data()?.imageUrls)
          ? (invSnap.data()?.imageUrls as string[]).map((u) => String(u || "").trim()).filter(Boolean)
          : [];
        const prevSingle =
          typeof invSnap.data()?.imageUrl === "string" && String(invSnap.data()?.imageUrl).trim()
            ? [String(invSnap.data()?.imageUrl).trim()]
            : [];
        const merged = mergePhotoUrls(prevUrls, prevSingle, photoUrls);
        invPatch.imageUrls = merged;
        invPatch.imageUrl = merged[0] ?? null;
      }
      if (requestId && !invSnap.data()?.sourceRequestId) {
        invPatch.sourceRequestId = requestId;
      }
      // Don't overwrite an earlier receiving date on restock — only set if missing.
      if (invSnap.data()?.receivingDate) {
        delete invPatch.receivingDate;
      }
      tx.update(inventoryRef, invPatch);
    }

    tx.set(logRef, {
      inventoryId: inventoryRef.id,
      inventoryRequestId: requestId || null,
      productName,
      sku,
      eventType: isRestock ? "restock" : "initial",
      goodQty,
      damagedQty,
      goodQtyBefore: prevGood,
      goodQtyAfter: nextGood,
      damagedQtyBefore: prevDamaged,
      damagedQtyAfter: nextDamaged,
      remarks,
      photoUrls,
      warehouseId: input.warehouseId,
      cartonId: input.cartonId,
      cartonCode: input.carton.cartonCode,
      lineId: input.line.lineId,
      binPath: input.binPath,
      stagingArea: input.stagingArea ?? input.line.stagingArea ?? input.carton.stagingArea ?? null,
      operatorId: input.operatorId,
      putawayAt: serverTimestamp(),
      syncKey,
    });

    if (requestId && requestData) {
      const reqRef = doc(db, "users", clientUserId, "inventoryRequests", requestId);
      const prevReqGood = Math.max(0, Number(requestData.warehouseGoodReceivedQty ?? 0));
      const prevReqDamaged = Math.max(0, Number(requestData.warehouseDamagedReceivedQty ?? 0));
      const nextReqGood = prevReqGood + goodQty;
      const nextReqDamaged = prevReqDamaged + damagedQty;
      const expected = expectedRequestQty(requestData);
      const totalReceived = nextReqGood + nextReqDamaged;

      const reqPatch: Record<string, unknown> = {
        warehouseGoodReceivedQty: nextReqGood,
        warehouseDamagedReceivedQty: nextReqDamaged,
        fulfillmentStatus: requestData.fulfillmentStatus === "closed" ? "closed" : "open",
        updatedAt: serverTimestamp(),
      };

      if (
        totalReceived >= expected &&
        expected > 0 &&
        requestData.fulfillmentStatus !== "closed"
      ) {
        reqPatch.fulfillmentStatus = "closed";
        reqPatch.closedAt = serverTimestamp();
        reqPatch.closeReason = "Fully received at warehouse";
      }

      tx.update(reqRef, reqPatch);
    }
  });
}

async function findInventoryDocRef(
  clientUserId: string,
  input: {
    requestId: string;
    requestData: InventoryRequest | null;
    productName: string;
    sku: string | null;
    productId: string | null;
  }
) {
  const inventoryCol = collection(db, "users", clientUserId, "inventory");

  if (input.productId) {
    const ref = doc(inventoryCol, input.productId);
    const snap = await getDoc(ref);
    if (snap.exists()) return ref;
  }

  if (input.requestId) {
    const snap = await getDocs(
      query(inventoryCol, where("sourceRequestId", "==", input.requestId), limit(1))
    );
    if (!snap.empty) return snap.docs[0].ref;
  }

  if (input.sku) {
    const snap = await getDocs(query(inventoryCol, where("sku", "==", input.sku), limit(5)));
    const match = snap.docs.find((d) => {
      const name = String(d.data().productName ?? "");
      return norm(name) === norm(input.productName);
    });
    if (match) return match.ref;
  }

  return doc(inventoryCol);
}

/** Admin closes an inbound request (short ship or client done). */
export async function closeInventoryRequest(input: {
  clientUserId: string;
  requestId: string;
  closedBy: string;
  closeReason?: string | null;
}): Promise<void> {
  const ref = doc(db, "users", input.clientUserId, "inventoryRequests", input.requestId);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Request not found.");
    const data = snap.data() as InventoryRequest;
    if (data.status !== "approved") {
      throw new Error("Only approved requests can be closed.");
    }
    tx.update(ref, {
      fulfillmentStatus: "closed",
      closedAt: Timestamp.now(),
      closedBy: input.closedBy,
      closeReason: input.closeReason?.trim() || "Closed by admin",
      updatedAt: serverTimestamp(),
    });
  });
}
