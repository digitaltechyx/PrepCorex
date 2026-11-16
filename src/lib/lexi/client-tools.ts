import { randomUUID } from "crypto";
import type OpenAI from "openai";
import { resolveLexiClient, resolveLexiClientForInbound } from "@/lib/lexi/access";
import { lexiGenerateReport } from "@/lib/lexi/generate-report";
import {
  lexiFindProducts,
  lexiGetInboundRequest,
  lexiGetOutboundRequest,
  lexiListPending,
  lexiLookupClientRecords,
  lexiLookupOutboundBilling,
} from "@/lib/lexi/read-tools";
import { prepareLexiOutboundCreate } from "@/lib/lexi/outbound-create-server";
import type {
  LexiCancelPayload,
  LexiInboundCreatePayload,
  LexiPendingAction,
  LexiReportAttachment,
} from "@/lib/lexi/types";
import type { UserProfile } from "@/types";

const uidProp = {
  type: "string" as const,
  description: "Always the signed-in client's Firebase uid",
};

export const LEXI_CLIENT_OPENAI_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "find_products",
      description: "Search this client's inventory by name or SKU (read-only).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          query: { type: "string" },
        },
        required: ["clientUserId", "query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_inbound_request",
      description: "Get this client's inbound request by id or product name.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_outbound_request",
      description: "Get this client's outbound request by id or product name.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          requestId: { type: "string" },
          productName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_pending_requests",
      description: "List this client's pending requests awaiting PrepCorex approval.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_client_records",
      description:
        "Read-only lookup of this client's profile, inventory, invoices, shipped, restock history, or returns.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          topic: {
            type: "string",
            enum: ["profile", "inventory", "invoices", "shipped", "restock_history", "returns"],
          },
          query: { type: "string" },
        },
        required: ["clientUserId", "topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "lookup_outbound_billing",
      description: "Read-only: whether this account uses PrepCorex invoices or CRM draft billing.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
        },
        required: ["clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "generate_report",
      description:
        "Generate a CSV report for THIS client only (read-only, no Confirm). Prefer inventory, inbound, outbound, invoices-related overview.",
      parameters: {
        type: "object",
        properties: {
          reportType: {
            type: "string",
            enum: [
              "overview",
              "inbound",
              "outbound",
              "returns",
              "dispose",
              "inventory",
              "financial",
              "operations",
            ],
          },
          period: {
            type: "string",
            enum: ["today", "last_7_days", "last_30_days", "this_month", "last_month", "this_year", "all_time"],
          },
          clientUserId: uidProp,
          clientUserName: { type: "string" },
        },
        required: ["reportType", "clientUserId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_create",
      description: "Propose creating a pending inbound request for this client (requires Confirm).",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          productName: { type: "string" },
          sku: { type: "string", description: "Optional — client can add later if omitted" },
          quantity: { type: "number" },
          productSubType: { type: "string", enum: ["new", "restock"] },
          productId: { type: "string" },
          remarks: { type: "string" },
        },
        required: ["clientUserId", "clientUserName", "productName", "quantity", "productSubType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_inbound_cancel",
      description: "Propose cancelling a pending inbound request (requires Confirm + reason).",
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
      name: "propose_outbound_create",
      description:
        "Propose creating a pending outbound request for this client (requires Confirm). Ask for service and box/pallet unless provided.",
      parameters: {
        type: "object",
        properties: {
          clientUserId: uidProp,
          clientUserName: { type: "string" },
          service: { type: "string" },
          shipmentPreference: { type: "string", enum: ["box", "pallet"] },
          productType: { type: "string" },
          shipTo: { type: "string" },
          remarks: { type: "string" },
          fbaLabelWorkflow: { type: "boolean" },
          lines: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                productName: { type: "string" },
                sku: { type: "string" },
                quantity: { type: "number" },
                packOf: { type: "number" },
              },
              required: ["productId", "productName", "quantity", "packOf"],
            },
          },
        },
        required: ["clientUserId", "clientUserName", "service", "shipmentPreference", "lines"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "propose_outbound_cancel",
      description: "Propose cancelling a pending outbound request and restoring stock (requires Confirm + reason).",
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
];

function pending(
  type: LexiPendingAction["type"],
  summary: string,
  payload: LexiPendingAction["payload"]
): { toolResult: string; pendingAction: LexiPendingAction } {
  return {
    toolResult: JSON.stringify({ proposed: true, summary, awaitingConfirmation: true }),
    pendingAction: { id: randomUUID(), type, summary, payload },
  };
}

/** Force every tool call onto the signed-in client uid. */
export function forceLexiClientSelfArgs(
  args: Record<string, unknown>,
  client: UserProfile
): Record<string, unknown> {
  return {
    ...args,
    clientUserId: client.uid,
    clientUserName: String(client.name || client.email || client.uid),
  };
}

export async function runLexiClientTool(
  clientProfile: UserProfile,
  name: string,
  rawArgs: Record<string, unknown>
): Promise<{
  toolResult: string;
  pendingAction?: LexiPendingAction;
  report?: LexiReportAttachment;
}> {
  const args = forceLexiClientSelfArgs(rawArgs, clientProfile);
  const selfUid = String(clientProfile.uid);
  const selfName = String(clientProfile.name || clientProfile.email || selfUid);

  switch (name) {
    case "find_products": {
      const results = await lexiFindProducts(clientProfile, selfUid, String(args.query ?? ""));
      return { toolResult: JSON.stringify({ clientUserId: selfUid, products: results }) };
    }
    case "get_inbound_request": {
      const client = await resolveLexiClientForInbound(clientProfile, {
        clientUserId: selfUid,
        clientUserName: selfName,
        requestId: args.requestId ? String(args.requestId) : undefined,
      });
      if (client.uid !== selfUid) {
        return { toolResult: JSON.stringify({ error: "You can only view your own inbound requests." }) };
      }
      const result = await lexiGetInboundRequest(
        clientProfile,
        selfUid,
        args.requestId ? String(args.requestId) : undefined,
        args.productName ? String(args.productName) : undefined
      );
      return { toolResult: JSON.stringify({ clientUserId: selfUid, request: result }) };
    }
    case "get_outbound_request": {
      const result = await lexiGetOutboundRequest(
        clientProfile,
        selfUid,
        args.requestId ? String(args.requestId) : undefined,
        args.productName ? String(args.productName) : undefined
      );
      return { toolResult: JSON.stringify({ clientUserId: selfUid, request: result }) };
    }
    case "list_pending_requests": {
      const pendingLists = await lexiListPending(clientProfile, selfUid);
      return {
        toolResult: JSON.stringify({
          ...pendingLists,
          clientUserId: selfUid,
          clientUserName: selfName,
        }),
      };
    }
    case "lookup_client_records": {
      const records = await lexiLookupClientRecords(
        clientProfile,
        selfUid,
        String(args.topic ?? "profile"),
        args.query ? String(args.query) : undefined
      );
      return {
        toolResult: JSON.stringify({ clientUserId: selfUid, clientUserName: selfName, records }),
      };
    }
    case "lookup_outbound_billing": {
      const billing = await lexiLookupOutboundBilling(clientProfile, selfUid);
      return { toolResult: JSON.stringify(billing) };
    }
    case "generate_report": {
      try {
        const generated = await lexiGenerateReport(clientProfile, {
          reportType: String(args.reportType ?? "inventory"),
          period: args.period ? String(args.period) : undefined,
          clientUserId: selfUid,
          clientUserName: selfName,
        });
        return { toolResult: JSON.stringify(generated.summary), report: generated.report };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Could not generate that report.";
        return { toolResult: JSON.stringify({ error: message }) };
      }
    }
    case "propose_inbound_create": {
      await resolveLexiClient(clientProfile, selfUid, selfName);
      const payload: LexiInboundCreatePayload = {
        clientUserId: selfUid,
        clientUserName: selfName,
        productName: String(args.productName),
        sku: args.sku ? String(args.sku) : undefined,
        quantity: Number(args.quantity),
        productSubType: args.productSubType === "restock" ? "restock" : "new",
        productId: args.productId ? String(args.productId) : undefined,
        remarks: args.remarks ? String(args.remarks) : undefined,
      };
      const skuLabel = payload.sku?.trim() ? `SKU ${payload.sku}` : "SKU later";
      return pending(
        "inbound_create",
        `Create inbound: ${payload.quantity} × ${payload.productName} (${skuLabel}, ${payload.productSubType})`,
        payload
      );
    }
    case "propose_inbound_cancel": {
      const requestId = String(args.requestId ?? "").trim();
      const request = await lexiGetInboundRequest(clientProfile, selfUid, requestId);
      if (!request) {
        return { toolResult: JSON.stringify({ error: `Inbound #${requestId} not found.` }) };
      }
      if (String(request.status ?? "").toLowerCase() !== "pending") {
        return {
          toolResult: JSON.stringify({
            error: `Inbound #${requestId} is "${request.status}" — only pending requests can be cancelled.`,
          }),
        };
      }
      const reason = String(args.reason ?? "").trim();
      if (reason.length < 3) {
        return { toolResult: JSON.stringify({ error: "Cancellation reason is required." }) };
      }
      const payload: LexiCancelPayload = {
        clientUserId: selfUid,
        clientUserName: selfName,
        requestId,
        productName: String(args.productName || request.productName || ""),
        reason,
      };
      return pending(
        "inbound_cancel",
        `Cancel inbound #${requestId} (${payload.productName}): ${reason}`,
        payload
      );
    }
    case "propose_outbound_create": {
      const rawLines = Array.isArray(args.lines) ? args.lines : [];
      const linesInput = rawLines.map((row: Record<string, unknown>) => ({
        productId: String(row.productId ?? ""),
        productName: String(row.productName ?? ""),
        sku: row.sku ? String(row.sku) : undefined,
        quantity: Number(row.quantity),
        packOf: row.packOf != null ? Number(row.packOf) : 1,
      }));
      try {
        const payload = await prepareLexiOutboundCreate({
          clientUserId: selfUid,
          clientUserName: selfName,
          service: String(args.service ?? ""),
          shipmentPreference: String(args.shipmentPreference ?? ""),
          productType: args.productType ? String(args.productType) : undefined,
          shipTo: args.shipTo ? String(args.shipTo) : undefined,
          remarks: args.remarks ? String(args.remarks) : undefined,
          lines: linesInput,
        });
        const totalUnits = payload.lines.reduce(
          (sum, line) => sum + line.quantity * line.packOf,
          0
        );
        const totalPrice = payload.lines.reduce((sum, line) => sum + line.totalPrice, 0);
        const lineText = payload.lines
          .map((line) => `${line.quantity}×pack${line.packOf} ${line.productName}`)
          .join("; ");
        const summary = `Create outbound: ${lineText}. ${totalUnits} units · $${totalPrice.toFixed(2)} · ${payload.service} · ${payload.shipmentPreference}`;
        return pending("outbound_create", summary, payload);
      } catch (error) {
        return {
          toolResult: JSON.stringify({
            error: error instanceof Error ? error.message : "Could not prepare outbound.",
          }),
        };
      }
    }
    case "propose_outbound_cancel": {
      const requestId = String(args.requestId ?? "").trim();
      const request = await lexiGetOutboundRequest(clientProfile, selfUid, requestId);
      if (!request) {
        return { toolResult: JSON.stringify({ error: `Outbound #${requestId} not found.` }) };
      }
      const status = String(request.status ?? "").toLowerCase();
      if (status !== "pending" && status !== "awaiting_label_upload") {
        return {
          toolResult: JSON.stringify({
            error: `Outbound #${requestId} is "${request.status}" — only pending requests can be cancelled.`,
          }),
        };
      }
      const reason = String(args.reason ?? "").trim();
      if (reason.length < 3) {
        return { toolResult: JSON.stringify({ error: "Cancellation reason is required." }) };
      }
      const payload: LexiCancelPayload = {
        clientUserId: selfUid,
        clientUserName: selfName,
        requestId,
        productName: String(args.productName || request.productName || ""),
        reason,
      };
      return pending(
        "outbound_cancel",
        `Cancel outbound #${requestId} (${payload.productName}): ${reason}`,
        payload
      );
    }
    default:
      return {
        toolResult: JSON.stringify({
          error: `Tool "${name}" is not available in client Lexi. Ask PrepCorex admin for help if needed.`,
        }),
      };
  }
}
