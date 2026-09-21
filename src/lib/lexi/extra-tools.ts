import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { resolveLexiClient, resolveLexiClientForInbound } from "@/lib/lexi/access";
import { lexiGenerateReport } from "@/lib/lexi/generate-report";
import { buildPendingProcessingQueue } from "@/lib/lexi/pending-queue";
import {
  lexiGetInboundRequest,
  lexiGetOutboundRequest,
  lexiListAllPending,
  lexiListPending,
  lexiListWarehouses,
  lexiLookupClientRecords,
} from "@/lib/lexi/read-tools";
import type {
  LexiActionType,
  LexiDisposeReviewPayload,
  LexiInboundFulfillAllPayload,
  LexiLabelReviewPayload,
  LexiOutboundDispatchPayload,
  LexiOutboundFulfillAllPayload,
  LexiOutboundJobPayload,
  LexiPendingAction,
  LexiRejectPayload,
  LexiPendingProcessingQueue,
  LexiReportAttachment,
  LexiRestockPayload,
  LexiReviewPayload,
} from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

function pending(
  type: LexiActionType,
  summary: string,
  payload: LexiPendingAction["payload"]
): { toolResult: string; pendingAction: LexiPendingAction } {
  return {
    toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
    pendingAction: { id: randomUUID(), type, summary, payload },
  };
}

const uidProp = {
  type: "string" as const,
  description: "Exact Firebase uid from find_clients — never a display name",
};

export const LEXI_EXTRA_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "start_pending_processing_queue",
      description:
        "Start a one-by-one pending queue (approve or fulfill each item with Confirm after each). Returns queue metadata and firstItem. ALWAYS call when admin asks to process/approve all pending one by one. Default mode is approve (safer). Use fulfill only when admin explicitly wants full inbound receive or outbound ship in one step per item.",
      parameters: {
        type: "object",
        properties: {
          mode: { type: "string", enum: ["approve", "fulfill"], description: "Default approve" },
          clientUserId: {
            type: "string",
            description: "Optional — limit queue to one client's uid",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_all_pending_requests",
      description:
        "List pending requests awaiting admin approval across ALL managed clients (matches Admin → Notifications → Pending tab total). Returns grandTotalPending, per-client totals, and sample items. ALWAYS call this first when the admin asks what is pending without naming a specific client. Never infer pending counts from find_clients alone.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_requests",
      description: "List pending requests awaiting admin approval for ONE client (matches Notifications → Pending tab). Returns totalPending, per-type counts, product names, quantities, and outbound line details. pendingReceive is separate (approved inbound awaiting receive). Use when a specific client is named or after list_all_pending_requests identifies them.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string", description: "Display name hint if uid is uncertain" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_warehouses",
      description: "List PrepCorex warehouses (read-only). Use when the admin asks which warehouse exists or is active.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_client_records",
      description:
        "Read-only lookup of a client's PrepCorex records: profile, inventory, invoices, shipped orders, restock history, or returns. Use this to answer questions. Never treat this as a write.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string", description: "Display name hint if uid is uncertain" },
          topic: {
            type: "string",
            enum: ["profile", "inventory", "invoices", "shipped", "restock_history", "returns"],
          },
          query: { type: "string", description: "Optional name/SKU/number filter" },
        },
        required: ["clientUserId", "topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description:
        "Generate a PrepCorex admin report from live data (read-only, no Confirm). Use when the admin asks for a report, CSV, or summary of inbound, outbound, stock, invoices, returns, dispose, operations, or financials. If the data is not in PrepCorex, say so.",
      parameters: {
        type: "object",
        properties: {
          reportType: {
            type: "string",
            enum: [
              "overview",
              "full",
              "financial",
              "commission",
              "client_activity",
              "operations",
              "inbound",
              "outbound",
              "returns",
              "dispose",
              "audit",
              "inventory",
            ],
          },
          period: {
            type: "string",
            enum: ["today", "last_7_days", "last_30_days", "this_month", "last_month", "this_year", "all_time"],
          },
          from: { type: "string", description: "Optional ISO date start" },
          to: { type: "string", description: "Optional ISO date end" },
          clientUserId: uidProp,
          clientUserName: { type: "string" },
        },
        required: ["reportType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_reject",
      description: "Propose rejecting a pending inbound request (requires confirmation).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_reject",
      description: "Propose rejecting a pending outbound request and restoring reserved stock (requires confirmation).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_pick_pack",
      description: "Propose admin auto pick & pack for a confirmed outbound (not Warehouse Ops scanning).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_ship_inventory",
      description: "Propose marking a confirmed outbound ready to dispatch from client inventory (no bin pick).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_dispatch",
      description: "Propose admin dispatch for an outbound that is ready to dispatch. Tracking optional.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          trackingNumber: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_restock",
      description: "Propose adding sellable quantity to an existing client product (requires confirmation).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          productId: { type: "string", description: "Exact product id from find_products" },
          productName: { type: "string" },
          quantity: { type: "number" },
          remarks: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "productId", "productName", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_return_review",
      description: "Propose approve or reject a product return request.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_dispose_review",
      description: "Propose approve or reject a dispose request.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          reason: { type: "string" },
          productId: { type: "string" },
          quantity: { type: "number" },
          batchId: { type: "string" },
          batchLineId: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_delete_review",
      description: "Propose approve or reject a delete-product request.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_quarantine_review",
      description: "Propose approve or reject a quarantine request.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          decision: { type: "string", enum: ["approve", "reject"] },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "decision"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_fulfill_all",
      description:
        "Propose approve + receive + putaway for an inbound in ONE confirm when admin asks to complete/process/fulfill the whole request. Use when status is pending or approved open inbound.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          sku: { type: "string" },
          quantity: { type: "number" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "sku", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_fulfill_all",
      description:
        "Propose approve + pick/pack + dispatch for an outbound in ONE confirm when admin asks to complete/process/ship the whole request.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
          quantity: { type: "number" },
          trackingNumber: { type: "string" },
          useShipFromInventory: { type: "boolean" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "productName", "quantity"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_label_review",
      description: "Propose approve or reject a label refund, wallet top-up, or API fee payment request.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          kind: { type: "string", enum: ["refund", "topup", "api_fee"] },
          decision: { type: "string", enum: ["approve", "reject"] },
          reason: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "requestId", "kind", "decision"],
      },
    },
  },
];

export async function runLexiExtraTool(
  adminProfile: UserProfile,
  name: string,
  args: Record<string, unknown>
): Promise<{
  toolResult: string;
  pendingAction?: LexiPendingAction;
  report?: LexiReportAttachment;
  pendingQueue?: LexiPendingProcessingQueue;
} | null> {
  const resolve = () =>
    resolveLexiClient(adminProfile, String(args.clientUserId ?? ""), String(args.clientUserName ?? ""));

  switch (name) {
    case "list_all_pending_requests": {
      try {
        const summary = await lexiListAllPending(adminProfile);
        return { toolResult: JSON.stringify(summary) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not list all pending requests.";
        return { toolResult: JSON.stringify({ error: message, grandTotalPending: 0 }) };
      }
    }
    case "start_pending_processing_queue": {
      try {
        const mode = args.mode === "fulfill" ? "fulfill" : "approve";
        const clientUserId = args.clientUserId ? String(args.clientUserId).trim() : undefined;
        const queue = await buildPendingProcessingQueue(adminProfile, mode, clientUserId);
        return {
          toolResult: JSON.stringify({
            started: true,
            mode: queue.mode,
            total: queue.total,
            supportedCount: queue.supportedCount,
            skippedCount: queue.skippedCount,
            currentIndex: queue.currentIndex,
            firstItem: queue.items[queue.currentIndex] ?? null,
            note:
              "After starting, immediately propose the action for firstItem using its proposeTool. Client will auto-continue the queue after each Confirm.",
          }),
          pendingQueue: queue,
        };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not start pending processing queue.";
        return { toolResult: JSON.stringify({ error: message, started: false }) };
      }
    }
    case "list_pending_requests": {
      try {
        const client = await resolve();
        const pendingLists = await lexiListPending(adminProfile, client.uid);
        return {
          toolResult: JSON.stringify({
            ...pendingLists,
            clientUserName: client.name,
          }),
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not list pending requests.";
        return { toolResult: JSON.stringify({ error: message, totalPending: 0 }) };
      }
    }
    case "list_warehouses": {
      const warehouses = await lexiListWarehouses();
      return { toolResult: JSON.stringify({ warehouses }) };
    }
    case "lookup_client_records": {
      try {
        const client = await resolve();
        const records = await lexiLookupClientRecords(
          adminProfile,
          client.uid,
          String(args.topic ?? "profile"),
          args.query ? String(args.query) : undefined
        );
        return { toolResult: JSON.stringify({ clientUserId: client.uid, clientUserName: client.name, records }) };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Lookup failed.";
        return { toolResult: JSON.stringify({ error: message }) };
      }
    }
    case "generate_report": {
      try {
        const generated = await lexiGenerateReport(adminProfile, {
          reportType: String(args.reportType ?? "overview"),
          period: args.period ? String(args.period) : undefined,
          from: args.from ? String(args.from) : undefined,
          to: args.to ? String(args.to) : undefined,
          clientUserId: args.clientUserId ? String(args.clientUserId) : undefined,
          clientUserName: args.clientUserName ? String(args.clientUserName) : undefined,
        });
        return {
          toolResult: JSON.stringify(generated.summary),
          report: generated.report,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not generate that report.";
        return { toolResult: JSON.stringify({ error: message }) };
      }
    }
    case "propose_inbound_reject":
    case "propose_outbound_reject": {
      const client = await resolve();
      const payload: LexiRejectPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
        reason: String(args.reason ?? ""),
      };
      const kind = name === "propose_inbound_reject" ? "inbound" : "outbound";
      return pending(
        name === "propose_inbound_reject" ? "inbound_reject" : "outbound_reject",
        `Reject ${kind} #${payload.requestId} for ${payload.clientUserName} (${payload.productName}): ${payload.reason}`,
        payload
      );
    }
    case "propose_outbound_pick_pack":
    case "propose_outbound_ship_inventory": {
      const client = await resolve();
      const payload: LexiOutboundJobPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
      };
      const pick = name === "propose_outbound_pick_pack";
      return pending(
        pick ? "outbound_pick_pack" : "outbound_ship_inventory",
        pick
          ? `Admin pick & pack outbound #${payload.requestId} (${payload.productName}) for ${payload.clientUserName}`
          : `Ship outbound #${payload.requestId} from client inventory for ${payload.clientUserName}`,
        payload
      );
    }
    case "propose_outbound_dispatch": {
      const client = await resolve();
      const payload: LexiOutboundDispatchPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
        trackingNumber: args.trackingNumber ? String(args.trackingNumber) : undefined,
      };
      return pending(
        "outbound_dispatch",
        `Dispatch outbound #${payload.requestId} for ${payload.clientUserName}${payload.trackingNumber ? ` tracking ${payload.trackingNumber}` : ""}`,
        payload
      );
    }
    case "propose_inbound_fulfill_all": {
      const requestId = String(args.requestId ?? "").trim();
      const client = await resolveLexiClientForInbound(adminProfile, {
        clientUserId: String(args.clientUserId ?? ""),
        clientUserName: String(args.clientUserName ?? ""),
        requestId,
      });
      const request = await lexiGetInboundRequest(adminProfile, client.uid, requestId);
      if (!request) {
        return { toolResult: JSON.stringify({ error: `Inbound #${requestId} not found.` }) };
      }
      const status = String(request.status ?? "").toLowerCase();
      const skipApprove = status === "approved";
      if (status !== "pending" && !skipApprove) {
        return {
          toolResult: JSON.stringify({
            error: `Inbound #${requestId} is "${request.status}" — only pending or approved open inbounds can be fulfilled.`,
          }),
        };
      }
      const payload: LexiInboundFulfillAllPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId,
        productName: String(args.productName || request.productName || ""),
        sku: String(args.sku || request.sku || ""),
        quantity: Number(args.quantity ?? request.quantity ?? request.remainingToReceive ?? 0),
        skipApprove,
        useDefaultBin: true,
      };
      const summary = skipApprove
        ? `Complete receive for inbound #${requestId} (${payload.productName}) — receive + putaway in one step`
        : `Approve + complete inbound #${requestId} (${payload.productName}) in one step`;
      return pending("inbound_fulfill_all", summary, payload);
    }
    case "propose_outbound_fulfill_all": {
      const requestId = String(args.requestId ?? "").trim();
      const client = await resolve();
      const request = await lexiGetOutboundRequest(adminProfile, client.uid, requestId);
      if (!request) {
        return { toolResult: JSON.stringify({ error: `Outbound #${requestId} not found.` }) };
      }
      const status = String(request.status ?? "").toLowerCase();
      const skipApprove = status !== "pending";
      if (status === "rejected" || status === "cancelled") {
        return {
          toolResult: JSON.stringify({
            error: `Outbound #${requestId} is "${request.status}" and cannot be fulfilled.`,
          }),
        };
      }
      const payload: LexiOutboundFulfillAllPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId,
        productName: String(args.productName || request.productName || ""),
        quantity: Number(args.quantity ?? request.quantity ?? 0),
        trackingNumber: args.trackingNumber ? String(args.trackingNumber) : undefined,
        useShipFromInventory: args.useShipFromInventory === true,
        skipApprove,
      };
      const summary = skipApprove
        ? `Pick/pack + dispatch outbound #${requestId} (${payload.productName}) in one step`
        : `Approve + pick/pack + dispatch outbound #${requestId} (${payload.productName}) in one step`;
      return pending("outbound_fulfill_all", summary, payload);
    }
    case "propose_restock": {
      const client = await resolve();
      const payload: LexiRestockPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        productId: String(args.productId),
        productName: String(args.productName),
        quantity: Number(args.quantity),
        remarks: args.remarks ? String(args.remarks) : undefined,
      };
      return pending(
        "restock",
        `Restock ${payload.productName} for ${payload.clientUserName}: +${payload.quantity} units`,
        payload
      );
    }
    case "propose_return_review":
    case "propose_delete_review":
    case "propose_quarantine_review": {
      const client = await resolve();
      const decision = args.decision === "reject" ? "reject" : "approve";
      const payload: LexiReviewPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
        decision,
        reason: args.reason ? String(args.reason) : undefined,
      };
      const type =
        name === "propose_return_review"
          ? "return_review"
          : name === "propose_delete_review"
            ? "delete_review"
            : "quarantine_review";
      const label = name.replace("propose_", "").replace("_review", "");
      return pending(
        type,
        `${decision === "approve" ? "Approve" : "Reject"} ${label} #${payload.requestId} for ${payload.clientUserName} (${payload.productName})`,
        payload
      );
    }
    case "propose_dispose_review": {
      const client = await resolve();
      const decision = args.decision === "reject" ? "reject" : "approve";
      const payload: LexiDisposeReviewPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        productName: String(args.productName),
        decision,
        reason: args.reason ? String(args.reason) : undefined,
        productId: args.productId ? String(args.productId) : undefined,
        quantity: args.quantity != null ? Number(args.quantity) : undefined,
        batchId: args.batchId ? String(args.batchId) : undefined,
        batchLineId: args.batchLineId ? String(args.batchLineId) : undefined,
      };
      return pending(
        "dispose_review",
        `${decision === "approve" ? "Approve dispose" : "Reject dispose"} #${payload.requestId} for ${payload.clientUserName} (${payload.productName})`,
        payload
      );
    }
    case "propose_label_review": {
      const client = await resolve();
      const kind =
        args.kind === "topup" ? "topup" : args.kind === "api_fee" ? "api_fee" : "refund";
      const decision = args.decision === "reject" ? "reject" : "approve";
      const payload: LexiLabelReviewPayload = {
        clientUserId: client.uid,
        clientUserName: client.name,
        requestId: String(args.requestId),
        kind,
        decision,
        reason: args.reason ? String(args.reason) : undefined,
      };
      return pending(
        "label_review",
        `${decision === "approve" ? "Approve" : "Reject"} label ${kind} #${payload.requestId} for ${payload.clientUserName}`,
        payload
      );
    }
    default:
      return null;
  }
}
