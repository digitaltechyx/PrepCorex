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
import { creditReturnInventory } from "@/lib/product-return-ops";
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

function isWarehouseReceivePhotoUrl(url: string): boolean {
  return /warehouse-receive\//i.test(url) || /warehouse-receive%2F/i.test(url);
}

function requestPhotoUrls(request: InventoryRequest | null): string[] {
  if (!request) return [];
  const data = request as InventoryRequest & { imageUrl?: string; imageUrls?: string[] };
  const urls: string[] = [];
  if (Array.isArray(data.imageUrls) && data.imageUrls.length > 0) {
    urls.push(...data.imageUrls.map((u) => String(u || "").trim()).filter(Boolean));
  } else if (typeof data.imageUrl === "string" && data.imageUrl.trim()) {
    urls.push(data.imageUrl.trim());
  }
  // Product thumbnails only — dock receive paths belong under remarks.
  return [...new Set(urls.filter((u) => !isWarehouseReceivePhotoUrl(u)))];
}

function requestRemarksPhotoUrls(request: InventoryRequest | null): string[] {
  if (!request) return [];
  const data = request as InventoryRequest & {
    remarksImageUrls?: string[];
    imageUrl?: string;
    imageUrls?: string[];
  };
  const fromRemarks = Array.isArray(data.remarksImageUrls)
    ? data.remarksImageUrls.map((u) => String(u || "").trim()).filter(Boolean)
    : [];
  const fromLegacyProduct: string[] = [];
  if (Array.isArray(data.imageUrls)) {
    fromLegacyProduct.push(
      ...data.imageUrls.map((u) => String(u || "").trim()).filter(isWarehouseReceivePhotoUrl)
    );
  } else if (typeof data.imageUrl === "string" && isWarehouseReceivePhotoUrl(data.imageUrl.trim())) {
    fromLegacyProduct.push(data.imageUrl.trim());
  }
  return [...new Set([...fromRemarks, ...fromLegacyProduct])];
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

    const productReturnId =
      line.productReturnId?.trim() || input.carton.productReturnId?.trim() || "";
    if (productReturnId) {
      // Returns: credit client inventory on putaway (no Return QC step).
      if (line.condition !== "damaged") {
        try {
          const photos = cartonPhotoUrls(input.carton);
          const dest = assignment.binPath || assignment.stagingArea || "storage";
          const note = input.carton.notes?.trim();
          await creditReturnInventory({
            ownerUserId: line.clientId.trim(),
            returnId: productReturnId,
            quantity: assignment.quantity,
            operatorId: input.operatorId,
            summaryNote: [
              `Return putaway ${input.carton.cartonCode} → ${dest}`,
              note ? `Receive remarks: ${note}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
            photoUrls: photos,
          });
        } catch (err) {
          console.error("[syncClientInventoryFromPutaway] return credit failed", err);
        }
      }
      continue;
    }

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

  const photoUrls = mergePhotoUrls(cartonPhotoUrls(input.carton), requestRemarksPhotoUrls(requestData));
  const productPhotoUrls = requestPhotoUrls(requestData);

  // Already synced qty — still backfill missing product photos / receiving date / remarks photos when possible.
  if (existingLog.exists()) {
    const inventoryId = String(existingLog.data()?.inventoryId ?? "").trim();
    if (!inventoryId) return;
    const invRef = doc(db, "users", clientUserId, "inventory", inventoryId);
    const invSnap = await getDoc(invRef);
    if (!invSnap.exists()) return;
    const patch: Record<string, unknown> = {};
    const rawProductUrls = Array.isArray(invSnap.data()?.imageUrls)
      ? (invSnap.data()?.imageUrls as string[]).map((u) => String(u || "").trim()).filter(Boolean)
      : typeof invSnap.data()?.imageUrl === "string" && String(invSnap.data()?.imageUrl).trim()
        ? [String(invSnap.data()?.imageUrl).trim()]
        : [];
    const legacyReceiveOnProduct = rawProductUrls.filter(isWarehouseReceivePhotoUrl);
    const prevProductUrls = rawProductUrls.filter((u) => !isWarehouseReceivePhotoUrl(u));
    if (productPhotoUrls.length > 0 && prevProductUrls.length === 0) {
      patch.imageUrls = productPhotoUrls;
      patch.imageUrl = productPhotoUrls[0];
    } else if (legacyReceiveOnProduct.length > 0) {
      patch.imageUrls = prevProductUrls;
      patch.imageUrl = prevProductUrls[0] ?? null;
    }
    const prevRemarksUrls = Array.isArray(invSnap.data()?.remarksImageUrls)
      ? (invSnap.data()?.remarksImageUrls as string[]).map((u) => String(u || "").trim()).filter(Boolean)
      : [];
    const remarksMerged = mergePhotoUrls(prevRemarksUrls, photoUrls, legacyReceiveOnProduct);
    if (remarksMerged.length > 0 && (prevRemarksUrls.length === 0 || legacyReceiveOnProduct.length > 0)) {
      patch.remarksImageUrls = remarksMerged;
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
    (requestData?.inventoryType === "container"
      ? null
      : requestData?.productName?.trim()) ||
    input.carton.productTitle?.trim() ||
    "Product";
  const sku = input.line.sku?.trim() || (requestData?.inventoryType === "container" ? null : requestData?.sku?.trim()) || null;
  const isRestock = requestData?.productSubType === "restock";
  const remarks = input.carton.notes?.trim() || requestData?.remarks?.trim() || null;

  const inventoryRef = await findInventoryDocRef(clientUserId, {
    requestId,
    requestData,
    productName,
    sku,
    productId:
      requestData?.inventoryType === "container"
        ? null
        : requestData?.productId?.trim() || null,
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
        invPatch.remarksImageUrls = photoUrls;
      }
      if (productPhotoUrls.length > 0) {
        invPatch.imageUrls = productPhotoUrls;
        invPatch.imageUrl = productPhotoUrls[0];
      }
      tx.set(inventoryRef, invPatch);
    } else {
      if (remarks) invPatch.remarks = remarks;
      if (photoUrls.length > 0) {
        const prevRemarks = Array.isArray(invSnap.data()?.remarksImageUrls)
          ? (invSnap.data()?.remarksImageUrls as string[]).map((u) => String(u || "").trim()).filter(Boolean)
          : [];
        invPatch.remarksImageUrls = mergePhotoUrls(prevRemarks, photoUrls);
      }
      if (productPhotoUrls.length > 0) {
        const prevUrls = Array.isArray(invSnap.data()?.imageUrls)
          ? (invSnap.data()?.imageUrls as string[]).map((u) => String(u || "").trim()).filter(Boolean)
          : [];
        const prevSingle =
          typeof invSnap.data()?.imageUrl === "string" && String(invSnap.data()?.imageUrl).trim()
            ? [String(invSnap.data()?.imageUrl).trim()]
            : [];
        if (prevUrls.length === 0 && prevSingle.length === 0) {
          invPatch.imageUrls = productPhotoUrls;
          invPatch.imageUrl = productPhotoUrls[0];
        }
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
      const isContainerReq = requestData.inventoryType === "container";
      const prevReqGood = Math.max(0, Number(requestData.warehouseGoodReceivedQty ?? 0));
      const prevReqDamaged = Math.max(0, Number(requestData.warehouseDamagedReceivedQty ?? 0));
      // Container handling is 1 unit — don't inflate with product SKU quantities inside.
      const nextReqGood = isContainerReq ? Math.max(prevReqGood, 1) : prevReqGood + goodQty;
      const nextReqDamaged = isContainerReq ? prevReqDamaged : prevReqDamaged + damagedQty;
      const expected = isContainerReq ? 1 : expectedRequestQty(requestData);
      const totalReceived = isContainerReq
        ? nextReqGood
        : nextReqGood + nextReqDamaged;

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
        reqPatch.closeReason = isContainerReq
          ? "Container contents put away — products added to inventory"
          : "Fully received at warehouse";
        if (isContainerReq) {
          reqPatch.receivingDate = serverTimestamp();
        }
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

  // Container handling requests can link many SKUs — never merge them into one inventory row.
  if (input.requestId && input.requestData?.inventoryType !== "container") {
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
