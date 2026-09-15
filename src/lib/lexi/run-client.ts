"use client";

import {
  Timestamp,
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  updateDoc,
} from "firebase/firestore";
import {
  adminAutoPickAndPackOutbound,
  adminDispatchOutboundWithTracking,
  adminShipOutboundFromInventoryOnly,
} from "@/lib/admin-warehouse-override";
import { restoreClientInventoryForOutboundRequest } from "@/lib/client-inventory-outbound-sync";
import { approveDeleteRequest, rejectDeleteRequest } from "@/lib/delete-request-ops";
import { approveDisposeBatchLine, rejectDisposeBatchLine } from "@/lib/dispose-batch";
import { db } from "@/lib/firebase";
import { auth } from "@/lib/firebase";
import { lexiCompleteInboundOnClient } from "@/lib/lexi/inbound-complete-client";
import { lexiCreateOutboundOnClient } from "@/lib/lexi/outbound-create-client";
import type {
  LexiDisposeReviewPayload,
  LexiInboundCompletePayload,
  LexiLabelReviewPayload,
  LexiOutboundCreatePayload,
  LexiOutboundDispatchPayload,
  LexiOutboundJobPayload,
  LexiPendingAction,
  LexiRejectPayload,
  LexiRestockPayload,
  LexiReviewPayload,
} from "@/lib/lexi/types";
import { approveProductReturn, rejectProductReturn } from "@/lib/product-return-ops";
import { approveQuarantineRequest, rejectQuarantineRequest } from "@/lib/quarantine-request-ops";
import { isDefaultNj2Warehouse } from "@/lib/warehouse-display";
import type {
  DeleteRequest,
  DisposeBatchLine,
  InventoryItem,
  QuarantineRequest,
  WarehouseDoc,
} from "@/types";

async function loadDefaultWarehouse(): Promise<WarehouseDoc> {
  const snap = await getDocs(collection(db, "warehouses"));
  const active = snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as WarehouseDoc))
    .filter((w) => w.active !== false);
  const warehouse = active.find((w) => isDefaultNj2Warehouse(w.name)) ?? active[0];
  if (!warehouse) throw new Error("No active warehouse found.");
  return warehouse;
}

async function adminToken(): Promise<string> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in.");
  return user.getIdToken();
}

async function postLabelReview(
  url: string,
  body: Record<string, unknown>
): Promise<string> {
  const token = await adminToken();
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(data.error || "Label review failed."));
  return "Done.";
}

export async function lexiRunClientAction(
  action: LexiPendingAction,
  operatorId: string,
  operatorName: string
): Promise<string> {
  switch (action.type) {
    case "inbound_complete":
      return (await lexiCompleteInboundOnClient(action.payload as LexiInboundCompletePayload, operatorId))
        .message;

    case "outbound_create":
      return (await lexiCreateOutboundOnClient(action.payload as LexiOutboundCreatePayload, operatorId))
        .message;

    case "outbound_reject": {
      const p = action.payload as LexiRejectPayload;
      await updateDoc(doc(db, `users/${p.clientUserId}/shipmentRequests`, p.requestId), {
        status: "rejected",
        rejectedBy: operatorId,
        rejectedAt: Timestamp.now(),
        rejectionReason: p.reason,
      });
      await restoreClientInventoryForOutboundRequest({
        clientUserId: p.clientUserId,
        shipmentRequestId: p.requestId,
        reason: p.reason,
      });
      return `Outbound #${p.requestId} rejected. Reserved stock restored.`;
    }

    case "outbound_pick_pack": {
      const p = action.payload as LexiOutboundJobPayload;
      const warehouse = await loadDefaultWarehouse();
      await adminAutoPickAndPackOutbound({
        warehouse,
        clientUserId: p.clientUserId,
        shipmentRequestId: p.requestId,
        operatorId,
      });
      return `Pick & pack complete for outbound #${p.requestId}. Add tracking if you have it, then dispatch.`;
    }

    case "outbound_ship_inventory": {
      const p = action.payload as LexiOutboundJobPayload;
      const warehouse = await loadDefaultWarehouse();
      await adminShipOutboundFromInventoryOnly({
        warehouseId: warehouse.id,
        clientUserId: p.clientUserId,
        shipmentRequestId: p.requestId,
        operatorId,
      });
      return `Outbound #${p.requestId} marked ready to dispatch from client inventory.`;
    }

    case "outbound_dispatch": {
      const p = action.payload as LexiOutboundDispatchPayload;
      const warehouse = await loadDefaultWarehouse();
      await adminDispatchOutboundWithTracking({
        warehouseId: warehouse.id,
        clientUserId: p.clientUserId,
        shipmentRequestId: p.requestId,
        trackingNumber: p.trackingNumber,
        operatorId,
      });
      return `Outbound #${p.requestId} dispatched${p.trackingNumber ? ` (tracking ${p.trackingNumber})` : ""}.`;
    }

    case "restock": {
      const p = action.payload as LexiRestockPayload;
      const productRef = doc(db, `users/${p.clientUserId}/inventory`, p.productId);
      const snap = await getDoc(productRef);
      if (!snap.exists()) throw new Error("Product not found.");
      const product = snap.data() as InventoryItem;
      const addQty = Math.floor(p.quantity);
      if (addQty <= 0) throw new Error("Restock quantity must be greater than zero.");
      const previousQuantity = Number(product.quantity) || 0;
      const newQuantity = previousQuantity + addQty;
      await updateDoc(productRef, { quantity: newQuantity, status: "In Stock" });
      await addDoc(collection(db, `users/${p.clientUserId}/restockHistory`), {
        productName: product.productName || p.productName,
        previousQuantity,
        restockedQuantity: addQty,
        newQuantity,
        restockedBy: operatorName || "Admin",
        restockedAt: Timestamp.now(),
        remarks: p.remarks?.trim() || "Restocked via LEXI",
      });
      return `Restocked ${p.productName}: ${previousQuantity} → ${newQuantity} (+${addQty}).`;
    }

    case "return_review": {
      const p = action.payload as LexiReviewPayload;
      if (p.decision === "approve") {
        await approveProductReturn({
          ownerUserId: p.clientUserId,
          returnId: p.requestId,
          operatorId,
        });
        return `Return #${p.requestId} approved.`;
      }
      await rejectProductReturn({
        ownerUserId: p.clientUserId,
        returnId: p.requestId,
        reason: p.reason || "Rejected via LEXI",
      });
      return `Return #${p.requestId} rejected.`;
    }

    case "dispose_review": {
      const p = action.payload as LexiDisposeReviewPayload;
      if (p.decision === "reject") {
        if (p.batchId && p.batchLineId) {
          await rejectDisposeBatchLine({
            userId: p.clientUserId,
            batchId: p.batchId,
            lineId: p.batchLineId,
            adminUid: operatorId,
            adminFeedback: p.reason,
          });
        } else {
          const patch: Record<string, unknown> = {
            status: "rejected",
            rejectedBy: operatorId,
            rejectedAt: Timestamp.now(),
          };
          if (p.reason?.trim()) patch.adminFeedback = p.reason.trim();
          await updateDoc(doc(db, `users/${p.clientUserId}/disposeRequests`, p.requestId), patch);
        }
        return `Dispose #${p.requestId} rejected.`;
      }

      const productId = p.productId;
      if (!productId) throw new Error("productId is required to approve dispose.");
      const invSnap = await getDoc(doc(db, `users/${p.clientUserId}/inventory`, productId));
      if (!invSnap.exists()) throw new Error("Product not found in inventory.");
      const invItem = { id: invSnap.id, ...invSnap.data() } as InventoryItem;
      const qty = Math.floor(p.quantity ?? 0);
      if (qty <= 0) throw new Error("Dispose quantity is required.");

      if (p.batchId && p.batchLineId) {
        const line: DisposeBatchLine = {
          id: p.batchLineId,
          batchId: p.batchId,
          lineNumber: 0,
          productId,
          productName: p.productName,
          quantity: qty,
          currentQuantity: invItem.quantity,
          stockStatus: "In Stock",
          reason: p.reason || "",
          status: "pending",
        };
        await approveDisposeBatchLine({
          userId: p.clientUserId,
          batchId: p.batchId,
          line,
          inventoryItem: invItem,
          adminUid: operatorId,
          adminName: operatorName || "Admin",
        });
      } else {
        const requestRef = doc(db, `users/${p.clientUserId}/disposeRequests`, p.requestId);
        const recycledCol = collection(db, `users/${p.clientUserId}/recycledInventory`);
        const inventoryRef = doc(db, `users/${p.clientUserId}/inventory`, invItem.id);
        await runTransaction(db, async (tx) => {
          const now = Timestamp.now();
          const newRecycledRef = doc(recycledCol);
          if (qty >= invItem.quantity) {
            tx.set(newRecycledRef, {
              ...invItem,
              recycledAt: now,
              recycledBy: operatorName || "Admin",
              remarks: p.reason || "",
            });
            tx.delete(inventoryRef);
          } else {
            const newQty = invItem.quantity - qty;
            tx.update(inventoryRef, {
              quantity: newQty,
              status: newQty > 0 ? "In Stock" : "Out of Stock",
            });
            tx.set(newRecycledRef, {
              productName: invItem.productName,
              quantity: qty,
              dateAdded: invItem.dateAdded,
              status: invItem.status,
              recycledAt: now,
              recycledBy: operatorName || "Admin",
              remarks: p.reason || "",
            });
          }
          tx.update(requestRef, {
            status: "approved",
            approvedBy: operatorId,
            approvedAt: now,
          });
        });
      }
      return `Disposed ${qty} unit(s) of ${p.productName}.`;
    }

    case "delete_review": {
      const p = action.payload as LexiReviewPayload;
      const reqSnap = await getDoc(doc(db, `users/${p.clientUserId}/deleteRequests`, p.requestId));
      if (!reqSnap.exists()) throw new Error("Delete request not found.");
      const request = { id: reqSnap.id, ...reqSnap.data() } as DeleteRequest;
      if (p.decision === "approve") {
        await approveDeleteRequest({
          userId: p.clientUserId,
          request,
          adminUid: operatorId,
          adminName: operatorName || "Admin",
        });
        return `Deleted ${request.productName} from inventory.`;
      }
      await rejectDeleteRequest({
        userId: p.clientUserId,
        request,
        adminUid: operatorId,
        adminName: operatorName || "Admin",
        adminFeedback: p.reason,
      });
      return `Delete request #${p.requestId} rejected.`;
    }

    case "quarantine_review": {
      const p = action.payload as LexiReviewPayload;
      const snap = await getDoc(doc(db, "quarantineRequests", p.requestId));
      if (!snap.exists()) throw new Error("Quarantine request not found.");
      const request = { id: snap.id, ...snap.data() } as QuarantineRequest;
      if (p.decision === "approve") {
        await approveQuarantineRequest({
          request,
          approverUid: operatorId,
          approverName: operatorName || "Admin",
        });
        return `Quarantine request #${p.requestId} approved. Warehouse will complete the move.`;
      }
      await rejectQuarantineRequest({
        request,
        approverUid: operatorId,
        approverName: operatorName || "Admin",
        adminFeedback: p.reason,
      });
      return `Quarantine request #${p.requestId} rejected.`;
    }

    case "label_review": {
      const p = action.payload as LexiLabelReviewPayload;
      if (p.kind === "refund") {
        await postLabelReview("/api/label-refunds/review", {
          userId: p.clientUserId,
          refundRequestId: p.requestId,
          action: p.decision,
          rejectionReason: p.reason,
        });
        return `Label refund #${p.requestId} ${p.decision}d.`;
      }
      if (p.kind === "topup") {
        await postLabelReview("/api/label-wallet/topup-review", {
          userId: p.clientUserId,
          topupRequestId: p.requestId,
          action: p.decision,
          rejectionReason: p.reason,
        });
        return `Wallet top-up #${p.requestId} ${p.decision}d.`;
      }
      await postLabelReview("/api/label-api-fee/payment-review", {
        userId: p.clientUserId,
        paymentRequestId: p.requestId,
        action: p.decision,
        rejectionReason: p.reason,
      });
      return `API fee payment #${p.requestId} ${p.decision}d.`;
    }

    default:
      throw new Error(`Action ${action.type} does not run in the browser.`);
  }
}
