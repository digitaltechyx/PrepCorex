import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { resolveLexiClient } from "@/lib/lexi/access";
import { lexiGenerateReport } from "@/lib/lexi/generate-report";
import { lexiListPending, lexiListWarehouses, lexiLookupClientRecords } from "@/lib/lexi/read-tools";
import type {
  LexiActionType,
  LexiDisposeReviewPayload,
  LexiLabelReviewPayload,
  LexiOutboundDispatchPayload,
  LexiOutboundJobPayload,
  LexiPendingAction,
  LexiRejectPayload,
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
      name: "list_pending_requests",
      description: "List ALL pending inbound, outbound, returns, dispose, delete, quarantine, and label requests on a client's real account. Always call this when asked what is pending. Pass the uid from find_clients (or the client's name as a fallback). Returns counts, product names, and quantities.",
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
): Promise<{ toolResult: string; pendingAction?: LexiPendingAction; report?: LexiReportAttachment } | null> {
  const resolve = () =>
    resolveLexiClient(adminProfile, String(args.clientUserId ?? ""), String(args.clientUserName ?? ""));

  switch (name) {
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
